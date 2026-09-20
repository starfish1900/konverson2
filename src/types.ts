export type Alliance = 0 | 1;
export type BoardSize = 9 | 11 | 13 | 15;
export type Difficulty = 'casual' | 'standard' | 'strong' | 'deep';
export interface Outcome { winner: number | null; path: number[]; orientation: string | null }
export interface GameState {
  size: BoardSize; cells: number[]; active: number; stage: number;
  first: number | null; opening: boolean; turn: number; placements: number;
  result: Outcome | null;
}
export interface GameEvent { kind: 'placed' | 'converted' | 'aged' | 'turn' | 'ended'; color: number; indices: number[] }
export interface MoveResult { state: GameState; events: GameEvent[] }
export interface GameSettings { size: BoardSize; human: Alliance; difficulty: Difficulty; workers: number; labels: boolean; hints: boolean }
export const COLORS = ['#4ed6c1', '#f5bc67', '#ab91ff', '#f28b8c'];
export const COLOR_NAMES = ['Jade', 'Amber', 'Amethyst', 'Coral'];
export const LETTERS = ['A', 'B', 'C', 'D'];
export const BUDGETS: Record<Difficulty, number> = { casual: 1000, standard: 3000, strong: 10000, deep: 30000 };
export const colorOf = (cell: number) => cell & 7;
export const allianceOf = (color: number) => ((color - 1) % 2) as Alliance;
export const coordinate = (index: number, size: number) => `${String.fromCharCode(65 + index % size)}${Math.floor(index / size) + 1}`;
