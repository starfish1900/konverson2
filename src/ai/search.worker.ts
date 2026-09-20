import init, { SearchSession } from '../generated/konverson_engine.js';
import wasmUrl from '../generated/konverson_engine_bg.wasm?url';
import type { SearchReport, WorkerRequest, WorkerResponse } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

interface ActiveSearch {
  searchId: number;
  fingerprint: string;
  deadlineEpochMs: number;
  sequence: number;
  lastReportAt: number;
  session: SearchSession;
}

const scope = self as unknown as WorkerScope;
let active: ActiveSearch | null = null;
let scheduled: ReturnType<typeof setTimeout> | null = null;
const epochNow = () => performance.timeOrigin + performance.now();

function release(): void {
  if (scheduled !== null) clearTimeout(scheduled);
  scheduled = null;
  active?.session.free();
  active = null;
}

function emitReport(search: ActiveSearch, done: boolean): SearchReport {
  const report = JSON.parse(search.session.report()) as SearchReport;
  scope.postMessage({
    type: 'report', searchId: search.searchId, fingerprint: search.fingerprint,
    sequence: ++search.sequence, done, report,
  });
  search.lastReportAt = performance.now();
  return report;
}

function fail(search: ActiveSearch | null, error: unknown): void {
  scope.postMessage({
    type: 'error', searchId: search?.searchId, fingerprint: search?.fingerprint,
    message: error instanceof Error ? error.message : String(error),
  });
  release();
}

function runBatch(): void {
  scheduled = null;
  const search = active;
  if (!search) return;
  try {
    const batchStart = performance.now();
    while (performance.now() - batchStart < 20 && epochNow() < search.deadlineEpochMs) {
      search.session.step(1);
    }
    const done = epochNow() >= search.deadlineEpochMs;
    if (done || performance.now() - search.lastReportAt >= 80) {
      const report = emitReport(search, done);
      if (done || report.immediateWin !== null) {
        release();
        return;
      }
    }
    scheduled = setTimeout(runBatch, 0);
  } catch (error) {
    fail(search, error);
  }
}

async function boot(): Promise<void> {
  try {
    await init({ module_or_path: wasmUrl });
    scope.onmessage = ({ data }) => {
      if (data.type === 'cancel') {
        if (active?.searchId === data.searchId) release();
        return;
      }
      if (data.type !== 'search') return;
      release();
      try {
        const search: ActiveSearch = {
          searchId: data.searchId, fingerprint: data.fingerprint,
          deadlineEpochMs: data.deadlineEpochMs, sequence: 0,
          lastReportAt: performance.now(),
          session: new SearchSession(data.stateJson, data.seed, data.maxNodes),
        };
        active = search;
        const initial = emitReport(search, false);
        if (initial.immediateWin !== null) release();
        else scheduled = setTimeout(runBatch, 0);
      } catch (error) {
        scope.postMessage({ type: 'error', searchId: data.searchId, fingerprint: data.fingerprint, message: error instanceof Error ? error.message : String(error) });
        release();
      }
    };
    scope.postMessage({ type: 'ready' });
  } catch (error) {
    fail(null, error);
  }
}

void boot();
