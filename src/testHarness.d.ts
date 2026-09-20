import type { GameState } from './types';
declare global {
  interface Window {
    __konversonQA?: { snapshot(): GameState | null; load(snapshot: GameState): void };
  }
}
