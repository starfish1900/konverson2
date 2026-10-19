import { useSyncExternalStore } from 'react';

// Unlike the animation library's mount-time preference, this follows changes
// made in device settings while the game is open.
const motionPreference = typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)');
const subscribeMotionPreference = (notify: () => void) => {
  motionPreference?.addEventListener('change', notify);
  return () => motionPreference?.removeEventListener('change', notify);
};
export function useReducedMotionPreference() {
  return useSyncExternalStore(subscribeMotionPreference, () => motionPreference?.matches ?? false, () => false);
}

// One timeline for presentation and input/AI lockout. Values are milliseconds.
export const ANIMATION = {
  placement: 260,
  conversionLead: 180,
  conversionStep: 80,
  conversionMaxStagger: 320,
  conversion: 1100,
  winPause: 180,
  winDraw: 2200,
  winSettle: 280,
  reduced: 35,
} as const;

interface PresentedMove { index: number; converted: number[] }

export function conversionDelay(index: number, move: PresentedMove, size: number) {
  const distance = Math.max(Math.abs(Math.floor(index / size) - Math.floor(move.index / size)), Math.abs(index % size - move.index % size));
  return ANIMATION.conversionLead + Math.min(Math.max(0, distance - 1) * ANIMATION.conversionStep, ANIMATION.conversionMaxStagger);
}

export function movePresentationTime(move: PresentedMove | null, size: number) {
  if (!move) return 0;
  if (!move.converted.length) return ANIMATION.placement;
  return Math.max(...move.converted.map(index => conversionDelay(index, move, size))) + ANIMATION.conversion;
}

export function winningPathDelay(move: PresentedMove | null, size: number) {
  return movePresentationTime(move, size) + ANIMATION.winPause;
}

export function presentationTime(move: PresentedMove, size: number, winner: number | null | undefined, reduced: boolean) {
  if (reduced) return ANIMATION.reduced;
  return winner ? winningPathDelay(move, size) + ANIMATION.winDraw + ANIMATION.winSettle : movePresentationTime(move, size);
}
