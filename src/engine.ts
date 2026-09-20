import init, { new_game, legal_moves, explain_move, apply_move } from './generated/konverson_engine';
import wasmUrl from './generated/konverson_engine_bg.wasm?url';
import type { BoardSize, GameState, MoveResult } from './types';

let initialization: Promise<unknown> | undefined;
export function loadEngine() { return initialization ??= init({ module_or_path: wasmUrl }); }
export function createGame(size: BoardSize): GameState { return JSON.parse(new_game(size)); }
export function legalMoves(state: GameState): number[] { return JSON.parse(legal_moves(JSON.stringify(state))); }
export function explainMove(state: GameState, index: number): string { return explain_move(JSON.stringify(state), index); }
export function applyMove(state: GameState, index: number): MoveResult { return JSON.parse(apply_move(JSON.stringify(state), index)); }
// Full canonical snapshots make search identity exact even when posture or phase differs.
export function fingerprint(state: GameState): string { return JSON.stringify(state); }
