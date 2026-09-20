import type {
  AiProgress,
  AiResult,
  AiSearchOptions,
  MoveReport,
  SearchReport,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

export type { AiProgress, AiResult, AiSearchOptions } from './protocol';

export const TREE_MEMORY_BUDGET = 256 * 1024 * 1024;
// Rust's compact search node is 24 bytes; reserve a little extra for each engine's scratch storage.
export const ESTIMATED_NODE_BYTES = 24;
const PER_ENGINE_RESERVE = 64 * 1024;

export function defaultWorkerCount(hardwareConcurrency = globalThis.navigator?.hardwareConcurrency ?? 2): number {
  return Math.max(1, Math.floor(hardwareConcurrency || 2) - 1);
}

export class SearchAbortedError extends Error {
  override name = 'AbortError';
  constructor() {
    super('The AI search was cancelled.');
  }
}

export class AiUnavailableError extends Error {
  override name = 'AiUnavailableError';
  constructor() {
    super('The browser could not start an AI worker. Reload the page to try again.');
  }
}

/** Small injectable interface so pool lifecycle tests do not need a browser. */
export interface SearchWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

export interface PoolOptions {
  workerFactory?: (id: number) => SearchWorker;
  initializationTimeoutMs?: number;
  estimatedNodeBytes?: number;
}

interface WorkerSlot {
  id: number;
  worker: SearchWorker;
  ready: boolean;
  failed: boolean;
  initializationTimer: ReturnType<typeof setTimeout> | null;
  finishInitialization: () => void;
}

interface AcceptedReport {
  sequence: number;
  report: SearchReport;
}

interface SearchJob {
  id: number;
  options: AiSearchOptions;
  legal: Set<number>;
  latest: Map<number, AcceptedReport>;
  dispatched: Set<number>;
  completed: Set<number>;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: (result: AiResult) => void;
  reject: (reason: Error) => void;
}

/** Merge cumulative reports exactly once per worker; callers supply only each worker's latest. */
export function aggregateReports(reports: Iterable<SearchReport>, legalMoves: readonly number[]): MoveReport[] {
  const merged = new Map(legalMoves.map((index) => [index, { index, visits: 0, valueSum: 0 }]));
  for (const report of reports) {
    const seen = new Set<number>();
    for (const move of report.moves) {
      const entry = merged.get(move.index);
      if (!entry || seen.has(move.index)) continue;
      seen.add(move.index);
      if (!Number.isSafeInteger(move.visits) || move.visits < 0 || !Number.isFinite(move.valueSum)) continue;
      if (move.valueSum < 0 || move.valueSum > move.visits) continue;
      entry.visits += move.visits;
      entry.valueSum += move.valueSum;
    }
  }
  return [...merged.values()];
}

export function chooseMove(reports: Iterable<SearchReport>, legalMoves: readonly number[], activeColor: number): number {
  if (legalMoves.length === 0) throw new Error('An AI search requires at least one legal placement.');
  const snapshot = [...reports];
  const legal = new Set(legalMoves);
  for (const report of snapshot) {
    if (report.immediateWin !== null && legal.has(report.immediateWin)) return report.immediateWin;
  }
  const acTurn = (activeColor - 1) % 2 === 0;
  const mean = (move: MoveReport) => move.visits ? move.valueSum / move.visits : 0.5;
  const ranked = aggregateReports(snapshot, legalMoves);
  ranked.sort((a, b) => b.visits - a.visits || (acTurn ? mean(b) - mean(a) : mean(a) - mean(b)) || a.index - b.index);
  if (ranked[0].visits === 0) {
    const fallback = snapshot.find((report) => report.best !== null && legal.has(report.best));
    if (fallback?.best !== null && fallback?.best !== undefined) return fallback.best;
  }
  return ranked[0].index;
}

function reportIsValid(report: SearchReport): boolean {
  return !!report && Array.isArray(report.moves)
    && Number.isSafeInteger(report.simulations) && report.simulations >= 0
    && Number.isSafeInteger(report.nodes) && report.nodes >= 0
    && Number.isFinite(report.memoryBytes) && report.memoryBytes >= 0;
}

function freshSeed(): number {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 0x100000000);
}

/** Persistent, independently allocated WASM engines, one per browser worker. */
export class AiPool {
  readonly workerCount: number;
  private readonly slots: WorkerSlot[] = [];
  private readonly initialization: Promise<void>;
  private readonly estimatedNodeBytes: number;
  private current: SearchJob | null = null;
  private nextSearchId = 0;
  private disposed = false;

  constructor(workerCount = defaultWorkerCount(), options: PoolOptions = {}) {
    this.workerCount = Math.max(1, Math.floor(Number.isFinite(workerCount) ? workerCount : 1));
    this.estimatedNodeBytes = options.estimatedNodeBytes ?? ESTIMATED_NODE_BYTES;
    const factory = options.workerFactory ?? (() => new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' }) as SearchWorker);
    const readyPromises: Promise<void>[] = [];
    for (let id = 0; id < this.workerCount; id++) {
      let worker: SearchWorker;
      try {
        worker = factory(id);
      } catch {
        continue;
      }
      let finishInitialization!: () => void;
      readyPromises.push(new Promise<void>((resolve) => { finishInitialization = resolve; }));
      const slot: WorkerSlot = { id, worker, ready: false, failed: false, initializationTimer: null, finishInitialization };
      this.slots.push(slot);
      slot.initializationTimer = setTimeout(() => this.failWorker(slot), options.initializationTimeoutMs ?? 15_000);
      worker.onmessage = (event) => this.handleMessage(slot, event.data);
      worker.onerror = (event) => { event.preventDefault?.(); this.failWorker(slot); };
      worker.onmessageerror = () => this.failWorker(slot);
    }
    this.initialization = Promise.all(readyPromises).then(() => undefined);
  }

  get availableWorkers(): number {
    return this.slots.filter((slot) => slot.ready && !slot.failed).length;
  }

  async ready(): Promise<number> {
    await this.initialization;
    return this.availableWorkers;
  }

  search(options: AiSearchOptions): Promise<AiResult> {
    this.cancel();
    if (this.disposed) return Promise.reject(new SearchAbortedError());
    if (options.legalMoves.length === 0) return Promise.reject(new Error('An AI search requires at least one legal placement.'));
    if (![1, 2, 3, 4].includes(options.activeColor) || !Number.isFinite(options.budgetMs) || options.budgetMs < 0) {
      return Promise.reject(new Error('Invalid AI search settings.'));
    }
    return new Promise<AiResult>((resolve, reject) => {
      const job: SearchJob = {
        id: ++this.nextSearchId,
        options: { ...options, legalMoves: [...options.legalMoves] },
        legal: new Set(options.legalMoves),
        latest: new Map(),
        dispatched: new Set(),
        completed: new Set(),
        startedAt: performance.now(),
        timer: null,
        resolve,
        reject,
      };
      this.current = job;
      void this.initialization.then(() => this.beginSearch(job));
    });
  }

  cancel(): void {
    const job = this.current;
    if (!job) return;
    this.current = null;
    this.stopJob(job);
    job.reject(new SearchAbortedError());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    for (const slot of this.slots) {
      this.clearInitialization(slot);
      slot.failed = true;
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.worker.onmessageerror = null;
      slot.worker.terminate();
    }
  }

  private beginSearch(job: SearchJob): void {
    if (this.current !== job || this.disposed) return;
    const slots = this.slots.filter((slot) => slot.ready && !slot.failed);
    if (slots.length === 0) {
      this.current = null;
      job.reject(new AiUnavailableError());
      return;
    }
    job.startedAt = performance.now();
    const deadlineEpochMs = performance.timeOrigin + job.startedAt + job.options.budgetMs;
    const maxNodes = Math.max(2, Math.floor((TREE_MEMORY_BUDGET / slots.length - PER_ENGINE_RESERVE) / this.estimatedNodeBytes));
    const seed = freshSeed();
    for (const slot of slots) job.dispatched.add(slot.id);
    // Workers send their final reports at the deadline; this bounds an unresponsive worker.
    job.timer = setTimeout(() => this.finishSearch(job), job.options.budgetMs + 35);
    for (const slot of slots) {
      try {
        slot.worker.postMessage({
          type: 'search', searchId: job.id, fingerprint: job.options.fingerprint,
          stateJson: job.options.stateJson, seed: (seed + Math.imul(slot.id + 1, 0x9e3779b9)) >>> 0,
          maxNodes, deadlineEpochMs,
        });
      } catch {
        this.failWorker(slot);
      }
    }
    this.publishProgress(job);
  }

  private handleMessage(slot: WorkerSlot, message: WorkerResponse): void {
    if (this.disposed || slot.failed || !message) return;
    if (message.type === 'ready') {
      slot.ready = true;
      this.clearInitialization(slot);
      return;
    }
    if (message.type === 'error') {
      if (message.searchId !== undefined && (this.current?.id !== message.searchId || this.current.options.fingerprint !== message.fingerprint)) return;
      this.failWorker(slot);
      return;
    }
    if (message.type !== 'report') return;
    const job = this.current;
    if (!job || message.searchId !== job.id || message.fingerprint !== job.options.fingerprint || !job.dispatched.has(slot.id)) return;
    if (!Number.isSafeInteger(message.sequence) || !reportIsValid(message.report)) return;
    const previous = job.latest.get(slot.id);
    if (previous && (message.sequence <= previous.sequence || message.report.simulations < previous.report.simulations)) return;
    job.latest.set(slot.id, { sequence: message.sequence, report: message.report });
    if (message.done) job.completed.add(slot.id);
    if (message.report.immediateWin !== null && job.legal.has(message.report.immediateWin)) {
      this.finishSearch(job);
      return;
    }
    this.publishProgress(job);
    if ([...job.dispatched].every((id) => job.completed.has(id))) this.finishSearch(job);
  }

  private failWorker(slot: WorkerSlot): void {
    if (slot.failed) return;
    slot.failed = true;
    slot.ready = false;
    this.clearInitialization(slot);
    slot.worker.terminate();
    const job = this.current;
    if (job?.dispatched.has(slot.id)) {
      job.completed.add(slot.id);
      this.publishProgress(job);
      if ([...job.dispatched].every((id) => job.completed.has(id))) this.finishSearch(job);
    }
  }

  private clearInitialization(slot: WorkerSlot): void {
    if (slot.initializationTimer !== null) clearTimeout(slot.initializationTimer);
    slot.initializationTimer = null;
    slot.finishInitialization();
  }

  private progress(job: SearchJob): AiProgress {
    const reports = [...job.latest.values()].map((entry) => entry.report);
    return {
      simulations: reports.reduce((sum, entry) => sum + entry.simulations, 0),
      nodes: reports.reduce((sum, entry) => sum + entry.nodes, 0),
      memoryBytes: reports.reduce((sum, entry) => sum + entry.memoryBytes, 0),
      activeWorkers: this.slots.filter((slot) => job.dispatched.has(slot.id) && !slot.failed).length,
      workers: [...job.dispatched].map((id) => ({ id, simulations: job.latest.get(id)?.report.simulations ?? 0 })),
      elapsedMs: Math.max(0, performance.now() - job.startedAt),
    };
  }

  private publishProgress(job: SearchJob): void {
    if (this.current !== job) return;
    // A consumer's presentation callback must not interrupt worker cleanup or deadlines.
    try { job.options.onProgress?.(this.progress(job)); } catch { /* Consumer owns its UI errors. */ }
  }

  private finishSearch(job: SearchJob): void {
    if (this.current !== job) return;
    const progress = this.progress(job);
    this.current = null;
    this.stopJob(job);
    if (progress.activeWorkers === 0) {
      job.reject(new AiUnavailableError());
      return;
    }
    const index = chooseMove([...job.latest.values()].map((entry) => entry.report), job.options.legalMoves, job.options.activeColor);
    try { job.options.onProgress?.(progress); } catch { /* Consumer owns its UI errors. */ }
    job.resolve({ index, progress, elapsedMs: progress.elapsedMs });
  }

  private stopJob(job: SearchJob): void {
    if (job.timer !== null) clearTimeout(job.timer);
    job.timer = null;
    for (const slot of this.slots) {
      if (!job.dispatched.has(slot.id) || slot.failed) continue;
      try { slot.worker.postMessage({ type: 'cancel', searchId: job.id }); } catch { this.failWorker(slot); }
    }
  }
}
