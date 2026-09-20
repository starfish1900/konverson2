export interface MoveReport {
  index: number;
  visits: number;
  /** Accumulated A/C reward: 1 for an A/C win, 0 for B/D, 0.5 for a draw. */
  valueSum: number;
}

export interface SearchReport {
  simulations: number;
  nodes: number;
  memoryBytes: number;
  moves: MoveReport[];
  best: number | null;
  immediateWin: number | null;
}

export type WorkerRequest =
  | {
      type: 'search';
      searchId: number;
      fingerprint: string;
      stateJson: string;
      seed: number;
      maxNodes: number;
      deadlineEpochMs: number;
    }
  | { type: 'cancel'; searchId: number };

export type WorkerResponse =
  | { type: 'ready' }
  | {
      type: 'report';
      searchId: number;
      fingerprint: string;
      sequence: number;
      done: boolean;
      report: SearchReport;
    }
  | { type: 'error'; searchId?: number; fingerprint?: string; message: string };

export interface AiProgress {
  simulations: number;
  nodes: number;
  memoryBytes: number;
  activeWorkers: number;
  workers: { id: number; simulations: number }[];
  elapsedMs: number;
}

export interface AiResult {
  index: number;
  progress: AiProgress;
  elapsedMs: number;
}

export interface AiSearchOptions {
  stateJson: string;
  fingerprint: string;
  legalMoves: readonly number[];
  activeColor: number;
  budgetMs: number;
  onProgress?: (progress: AiProgress) => void;
}
