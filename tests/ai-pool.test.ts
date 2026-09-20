import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateReports, AiPool, AiUnavailableError, chooseMove, defaultWorkerCount, SearchAbortedError, TREE_MEMORY_BUDGET } from '../src/ai/pool';
import type { SearchWorker } from '../src/ai/pool';
import type { AiSearchOptions, SearchReport, WorkerRequest, WorkerResponse } from '../src/ai/protocol';

class MockWorker implements SearchWorker {
  onmessage: SearchWorker['onmessage'] = null;
  onerror: SearchWorker['onerror'] = null;
  onmessageerror: SearchWorker['onmessageerror'] = null;
  messages: WorkerRequest[] = [];
  terminated = false;
  postMessage(message: WorkerRequest) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(message: WorkerResponse) { this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>); }
  fail() { this.onerror?.({ preventDefault() {} } as ErrorEvent); }
  searches() { return this.messages.filter((message): message is Extract<WorkerRequest, { type: 'search' }> => message.type === 'search'); }
}

function report(visits = 10, index = 4, valueSum = visits / 2): SearchReport {
  return { simulations: visits, nodes: visits + 1, memoryBytes: visits * 24, moves: [{ index, visits, valueSum }], best: index, immediateWin: null };
}

const options: AiSearchOptions = { stateJson: '{}', fingerprint: 'state-1', legalMoves: [4, 8, 12], activeColor: 1, budgetMs: 100 };
const pools: AiPool[] = [];
function makePool(count = 2, timeout = 1000) {
  const workers: MockWorker[] = [];
  const pool = new AiPool(count, { workerFactory: () => { const worker = new MockWorker(); workers.push(worker); return worker; }, initializationTimeoutMs: timeout });
  pools.push(pool);
  return { pool, workers };
}

async function ready(workers: MockWorker[]) {
  for (const worker of workers) worker.emit({ type: 'ready' });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function send(worker: MockWorker, stats: SearchReport, sequence = 1, done = false, overrides: Partial<Extract<WorkerResponse, { type: 'report' }>> = {}) {
  const search = worker.searches().at(-1)!;
  worker.emit({ type: 'report', searchId: search.searchId, fingerprint: search.fingerprint, sequence, done, report: stats, ...overrides });
}

afterEach(() => {
  for (const pool of pools.splice(0)) pool.dispose();
  vi.useRealTimers();
});

describe('root report selection', () => {
  it('reserves one browser-exposed logical processor and never selects zero workers', () => {
    expect(defaultWorkerCount(16)).toBe(15);
    expect(defaultWorkerCount(1)).toBe(1);
    expect(defaultWorkerCount(0)).toBe(1);
  });

  it('sums independent workers and ignores illegal, malformed, and duplicate moves', () => {
    const malformed = report(1);
    malformed.moves = [
      { index: 4, visits: 2, valueSum: 1 },
      { index: 4, visits: 90, valueSum: 70 },
      { index: 8, visits: -1, valueSum: 0 },
      { index: 12, visits: 3, valueSum: 4 },
      { index: 99, visits: 999, valueSum: 900 },
    ];
    expect(aggregateReports([report(10, 4, 7), malformed], [4, 8, 12])).toEqual([
      { index: 4, visits: 12, valueSum: 8 }, { index: 8, visits: 0, valueSum: 0 }, { index: 12, visits: 0, valueSum: 0 },
    ]);
  });

  it('uses the acting alliance to break tied visit counts', () => {
    const reports = [report(10, 4, 8), report(10, 8, 2)];
    expect(chooseMove(reports, [4, 8], 1)).toBe(4);
    expect(chooseMove(reports, [4, 8], 3)).toBe(4);
    expect(chooseMove(reports, [4, 8], 2)).toBe(8);
    expect(chooseMove(reports, [4, 8], 4)).toBe(8);
  });

  it('prefers proven wins and preserves the engine heuristic when no simulation fits', () => {
    expect(chooseMove([{ ...report(0, 8), immediateWin: 12 }], [4, 8, 12], 1)).toBe(12);
    expect(chooseMove([report(0, 8)], [4, 8], 1)).toBe(8);
    expect(chooseMove([{ ...report(0, 8), immediateWin: 99 }], [4, 8], 1)).toBe(8);
  });
});

describe('persistent worker lifecycle', () => {
  it('replaces cumulative reports and rejects older sequences, regressing counts, and mismatched states', async () => {
    const { pool, workers } = makePool();
    await ready(workers);
    const progress = vi.fn();
    const result = pool.search({ ...options, onProgress: progress });
    await Promise.resolve();
    send(workers[0], report(10), 1);
    send(workers[0], report(20), 2);
    send(workers[0], report(99), 1);
    send(workers[0], report(19), 3);
    send(workers[0], report(999), 4, false, { fingerprint: 'stale-state' });
    send(workers[0], report(20), 5, true);
    send(workers[1], report(7, 8), 1, true);
    const resolved = await result;
    expect(resolved.index).toBe(4);
    expect(resolved.progress.simulations).toBe(27);
    expect(resolved.progress.activeWorkers).toBe(2);
    expect(resolved.progress.workers).toEqual([{ id: 0, simulations: 20 }, { id: 1, simulations: 7 }]);
    expect(progress).toHaveBeenCalled();
    expect(workers.every((worker) => !worker.terminated)).toBe(true);
  });

  it('cancels before initialization without dispatching a stale search', async () => {
    const { pool, workers } = makePool();
    const search = pool.search(options);
    const rejection = expect(search).rejects.toBeInstanceOf(SearchAbortedError);
    pool.cancel();
    await ready(workers);
    await rejection;
    expect(workers.flatMap((worker) => worker.searches())).toHaveLength(0);
  });

  it('cancels a running search and ignores its reports during the next one', async () => {
    const { pool, workers } = makePool(1);
    await ready(workers);
    const first = pool.search(options);
    const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    const oldId = workers[0].searches()[0].searchId;
    const second = pool.search({ ...options, fingerprint: 'state-2' });
    await Promise.resolve();
    send(workers[0], report(999, 4), 100, true, { searchId: oldId, fingerprint: options.fingerprint });
    send(workers[0], report(5, 8), 1, true);
    await rejection;
    expect((await second).index).toBe(8);
    expect(workers[0].messages).toContainEqual({ type: 'cancel', searchId: oldId });
  });

  it('continues after failed initialization and budgets memory across surviving workers', async () => {
    const { pool, workers } = makePool(3);
    workers[1].fail();
    await ready([workers[0], workers[2]]);
    expect(await pool.ready()).toBe(2);
    const result = pool.search(options);
    await Promise.resolve();
    expect(workers[1].terminated).toBe(true);
    const allocatedNodes = workers.flatMap((worker) => worker.searches()).reduce((total, message) => total + message.maxNodes, 0);
    expect(allocatedNodes * 24 + 2 * 64 * 1024).toBeLessThanOrEqual(TREE_MEMORY_BUDGET);
    send(workers[0], report(8), 1, true);
    send(workers[2], report(6, 8), 1, true);
    expect((await result).progress.activeWorkers).toBe(2);
  });

  it('reports reduced capacity and keeps useful results after a worker crashes', async () => {
    const { pool, workers } = makePool();
    await ready(workers);
    const result = pool.search(options);
    await Promise.resolve();
    send(workers[0], report(7), 1);
    workers[0].fail();
    send(workers[1], report(9, 8), 1, true);
    const resolved = await result;
    expect(resolved.progress.activeWorkers).toBe(1);
    expect(resolved.progress.simulations).toBe(16);
    expect(resolved.index).toBe(8);
  });

  it('uses a bounded deadline even if a worker stops responding', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { pool, workers } = makePool(1);
    await ready(workers);
    const result = pool.search(options);
    await Promise.resolve();
    send(workers[0], report(7, 12), 1);
    await vi.advanceTimersByTimeAsync(135);
    expect((await result).index).toBe(12);
    expect(workers[0].messages.at(-1)?.type).toBe('cancel');
  });

  it('ends early on a proven legal winning placement', async () => {
    const { pool, workers } = makePool();
    await ready(workers);
    const result = pool.search(options);
    await Promise.resolve();
    send(workers[0], { ...report(0, 12), immediateWin: 12 }, 1);
    expect((await result).index).toBe(12);
    expect(workers.every((worker) => worker.messages.at(-1)?.type === 'cancel')).toBe(true);
  });

  it('fails clearly when no engine can initialize and clears startup timeouts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { pool, workers } = makePool(1, 100);
    const result = pool.search(options);
    const rejection = expect(result).rejects.toBeInstanceOf(AiUnavailableError);
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(workers[0].terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disposes in-flight work and terminates every persistent worker', async () => {
    const { pool, workers } = makePool();
    await ready(workers);
    const result = pool.search(options);
    const rejection = expect(result).rejects.toBeInstanceOf(SearchAbortedError);
    await Promise.resolve();
    pool.dispose();
    await rejection;
    expect(workers.every((worker) => worker.terminated)).toBe(true);
    expect(await pool.ready()).toBe(0);
  });
});
// Add inside the existing persistent-worker describe block in tests/ai-pool.test.ts.
it('rejects when every worker crashes after partial progress and clears the search deadline', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { pool, workers } = makePool(2);
  await ready(workers);
  const progress = vi.fn();
  const result = pool.search({ ...options, onProgress: progress });
  const rejection = expect(result).rejects.toBeInstanceOf(AiUnavailableError);
  await Promise.resolve();

  // Both workers have useful results; losing all workers must still report failure.
  send(workers[0], report(7, 4), 1);
  send(workers[1], report(9, 8), 1);
  workers[0].fail();
  expect(progress.mock.calls.at(-1)?.[0].activeWorkers).toBe(1);
  workers[1].fail();

  await rejection;
  expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ activeWorkers: 0, simulations: 16 });
  expect(pool.availableWorkers).toBe(0);
  expect(workers.every((worker) => worker.terminated)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);

  // Late messages cannot resurrect the completed job or its deadline.
  const callbacksAfterFailure = progress.mock.calls.length;
  send(workers[0], report(100, 4), 2, true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(progress).toHaveBeenCalledTimes(callbacksAfterFailure);
  await expect(pool.search(options)).rejects.toBeInstanceOf(AiUnavailableError);
});

