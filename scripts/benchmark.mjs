import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const outputPath = process.env.KONVERSON_BENCHMARK_OUTPUT || fileURLToPath(new URL('../validation/browser-benchmark.json', import.meta.url));
const baseUrl = process.env.KONVERSON_BENCHMARK_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route(`${baseUrl}/__konverson-benchmark`, (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>Konverson benchmark</title><p>Worker benchmark</p>',
  }));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/__konverson-benchmark`);
  const hardware = await page.evaluate(() => ({ hardwareConcurrency: navigator.hardwareConcurrency, userAgent: navigator.userAgent }));
  const results = {
    timestamp: new Date().toISOString(), source: baseUrl, browserVersion: browser.version(), ...hardware,
    methodology: 'One seeded state per board size, 20 legal non-terminal placements; counts 1, 2, 4 and browser default. Each fresh pool is initialized and warmed for 250ms, then searched for1000ms. Search seeds vary by worker and run. Memory is estimated engine-owned storage, excluding browser/WASM runtime. Other local workloads may affect throughput.',
    samples: [], errors,
  };
  for (const size of [9, 11, 13, 15]) {
    const counts = [...new Set([1, 2, 4, Math.max(1, hardware.hardwareConcurrency - 1)])];
    for (const count of counts) {
      const sample = await page.evaluate(async ({ size, count }) => {
        const { AiPool } = await import('/src/ai/pool.ts');
        const { loadEngine, createGame, applyMove, legalMoves, fingerprint } = await import('/src/engine.ts');
        await loadEngine();
        let state = createGame(size);
        let seed = (0x5eed1234 ^ size) >>> 0;
        const nextRandom = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
        for (let placement = 0; placement < 20; placement++) {
          const legal = legalMoves(state);
          if (!legal.length) throw new Error('Benchmark state became terminal before20placements.');
          const start = nextRandom() % legal.length;
          let next = null;
          for (let offset = 0; offset < legal.length; offset++) {
            const candidate = applyMove(state, legal[(start + offset) % legal.length]).state;
            if (!candidate.result) { next = candidate; break; }
          }
          if (!next) throw new Error('No non-terminal preparation move was available.');
          state = next;
        }
        const pool = new AiPool(count);
        try {
          const startup = performance.now();
          const readyWorkers = await pool.ready();
          const startupMs = performance.now() - startup;
          if (readyWorkers !== count) throw new Error(`Only${readyWorkers}/${count}workers initialized.`);
          const options = { stateJson: fingerprint(state), fingerprint: fingerprint(state), legalMoves: legalMoves(state), activeColor: state.active };
          await pool.search({ ...options, budgetMs: 250 });
          const started = performance.now();
          const result = await pool.search({ ...options, budgetMs: 1000 });
          const wallElapsedMs = performance.now() - started;
          if (!options.legalMoves.includes(result.index)) throw new Error('AI selected an illegal placement.');
          return {
            boardSize: size, requestedWorkers: count, readyWorkers, startupMs,
            statePlacements: state.placements, stateFingerprint: options.fingerprint,
            selectedMove: result.index, legalMove: true, wallElapsedMs,
            elapsedMs: result.elapsedMs, ...result.progress,
            contributingWorkers: result.progress.workers.filter((worker) => worker.simulations > 0).length,
            simulationsPerSecond: result.progress.simulations / (result.elapsedMs / 1000),
          };
        } finally { pool.dispose(); }
      }, { size, count });
      results.samples.push(sample);
      await writeFile(outputPath, JSON.stringify(results, null, 2) + '\n');
      console.log(`${size}×${size} | ${count} workers | ${sample.simulations} simulations | ${Math.round(sample.elapsedMs)} ms | ${sample.contributingWorkers} contributing`);
    }
  }
  console.log(`Saved ${results.samples.length} samples to ${outputPath}`);
} finally {
  await browser.close();
}
