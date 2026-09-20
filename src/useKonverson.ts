import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AiPool, defaultWorkerCount } from './ai/pool';
import type { AiProgress } from './ai/pool';
import { applyMove, createGame, explainMove, fingerprint, legalMoves, loadEngine } from './engine';
import { allianceOf, BUDGETS } from './types';
import type { GameSettings, GameState, GameEvent } from './types';

export interface LastMove { index: number; color: number; before: number[]; converted: number[]; nonce: number; events: GameEvent[] }
const maxWorkers = Math.max(1, navigator.hardwareConcurrency || 2);
export const DEFAULT_SETTINGS: GameSettings = { size: 11, human: 0, difficulty: 'standard', workers: defaultWorkerCount(), labels: true, hints: true };
function initialSettings(): GameSettings {
  try {
    const stored = JSON.parse(localStorage.getItem('konverson-preferences') ?? '{}');
    return { ...DEFAULT_SETTINGS, labels: typeof stored.labels === 'boolean' ? stored.labels : true, hints: typeof stored.hints === 'boolean' ? stored.hints : true, workers: Number.isSafeInteger(stored.workers) ? Math.max(1, Math.min(maxWorkers, stored.workers)) : DEFAULT_SETTINGS.workers };
  } catch { return DEFAULT_SETTINGS; }
}

export function useKonverson() {
  const [settings, setSettings] = useState<GameSettings>(initialSettings);
  const [game, setGame] = useState<GameState | null>(null);
  const [booted, setBooted] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [visible, setVisible] = useState(!document.hidden);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [progress, setProgress] = useState<AiProgress | null>(null);
  const [availableWorkers, setAvailableWorkers] = useState(0);
  const [poolGeneration, setPoolGeneration] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const [gameGeneration, setGameGeneration] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const gameRef = useRef<GameState | null>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const pool = useRef<AiPool | null>(null);
  const epoch = useRef(0);
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnTime = useRef({ turn: -1, used: 0 });
  const placementTime = useRef({ key: '', used: 0, allowance: 0 });
  const searchStarted = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    void loadEngine().then(() => {
      if (!live) return;
      const fresh = createGame(settingsRef.current.size);
      gameRef.current = fresh; setGame(fresh); setBooted(true);
    }).catch(() => { if (live) setError('The game engine could not load. Check your connection and reload this page.'); });
    return () => { live = false; if (animationTimer.current) clearTimeout(animationTimer.current); };
  }, []);

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    try { localStorage.setItem('konverson-preferences', JSON.stringify({ workers: settings.workers, labels: settings.labels, hints: settings.hints })); } catch { /* Storage is optional. */ }
  }, [settings.workers, settings.labels, settings.hints]);

  useEffect(() => {
    if (!booted) return;
    const next = new AiPool(settings.workers);
    pool.current = next;
    setAvailableWorkers(0);
    let live = true;
    void next.ready().then(count => {
      if (!live) return;
      setAvailableWorkers(count);
      if (!count) setError('The AI could not start. Try fewer workers in Settings, then retry.');
      else { setError(''); setPoolGeneration(value => value + 1); }
    });
    return () => { live = false; next.dispose(); if (pool.current === next) pool.current = null; };
  }, [booted, settings.workers, retryToken]);

  const commit = useCallback((index: number) => {
    const current = gameRef.current;
    if (!current || current.result) return;
    const reason = explainMove(current, index);
    if (reason) { setNotice(reason); return; }
    const result = applyMove(current, index);
    gameRef.current = result.state;
    setGame(result.state);
    setNotice('');
    const converted = result.events.filter(e => e.kind === 'converted').flatMap(e => e.indices);
    setLastMove({ index, color: current.active, before: current.cells, converted, nonce: performance.now(), events: result.events });
    setAnimating(true);
    const ownEpoch = epoch.current;
    if (animationTimer.current) clearTimeout(animationTimer.current);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    animationTimer.current = setTimeout(() => { if (epoch.current === ownEpoch) setAnimating(false); }, reduced ? 35 : converted.length ? 500 : 260);
  }, []);

  const key = game ? fingerprint(game) : '';
  useEffect(() => {
    const current = gameRef.current;
    const activePool = pool.current;
    if (!current || !activePool || !activePool.availableWorkers || animating || !visible || current.result || allianceOf(current.active) === settings.human) return;
    const legal = legalMoves(current);
    if (!legal.length) return;
    if (turnTime.current.turn !== current.turn) turnTime.current = { turn: current.turn, used: 0 };
    const total = BUDGETS[settings.difficulty];
    if (placementTime.current.key !== key) {
      const remaining = Math.max(0, total - turnTime.current.used);
      placementTime.current = { key, used: 0, allowance: current.stage === 0 && !current.opening ? Math.min(total * 0.6, remaining) : remaining };
    }
    const budgetMs = Math.max(1, placementTime.current.allowance - placementTime.current.used);
    const ownEpoch = epoch.current;
    let live = true;
    let accounted = false;
    let actualStart: number | null = null;
    let lastPresentation = -Infinity;
    const account = (spent: number) => {
      if (accounted || epoch.current !== ownEpoch) return;
      accounted = true;
      turnTime.current.used += spent;
      placementTime.current.used += spent;
    };
    setThinking(true); setProgress(null); setElapsed(0); setError('');
    void activePool.search({
      stateJson: key, fingerprint: key, legalMoves: legal, activeColor: current.active,
      budgetMs,
      onProgress: report => {
        if (!live || epoch.current !== ownEpoch) return;
        actualStart ??= performance.now() - report.elapsedMs;
        searchStarted.current = actualStart;
        setAvailableWorkers(report.activeWorkers);
        if (report.elapsedMs - lastPresentation >= 100) {
          setProgress(report);
          lastPresentation = report.elapsedMs;
        }
      },
    }).then(result => {
      if (!live || epoch.current !== ownEpoch || !gameRef.current || fingerprint(gameRef.current) !== key) return;
      account(result.elapsedMs);
      setProgress(result.progress); setThinking(false); searchStarted.current = null;
      commit(result.index);
    }).catch(reason => {
      if (!live || epoch.current !== ownEpoch) return;
      setThinking(false); searchStarted.current = null;
      if (reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'The AI stopped unexpectedly. Please retry.');
    });
    return () => {
      live = false;
      if (actualStart !== null) account(Math.max(0, performance.now() - actualStart));
      activePool.cancel(); setThinking(false); searchStarted.current = null;
    };
  // Board snapshots, rather than rendering updates, define the search lifecycle.
  }, [key, animating, visible, settings.human, settings.difficulty, settings.workers, retryToken, gameGeneration, poolGeneration, commit]);

  useEffect(() => {
    if (!thinking) return;
    const interval = setInterval(() => { if (searchStarted.current !== null) setElapsed(performance.now() - searchStarted.current); }, 100);
    return () => clearInterval(interval);
  }, [thinking]);

  const newGame = useCallback((next: GameSettings) => {
    epoch.current++;
    setGameGeneration(value => value + 1);
    pool.current?.cancel();
    if (animationTimer.current) clearTimeout(animationTimer.current);
    setAnimating(false); setThinking(false); setError(''); setNotice(''); setLastMove(null); setProgress(null); setElapsed(0);
    searchStarted.current = null; turnTime.current = { turn: -1, used: 0 }; placementTime.current = { key: '', used: 0, allowance: 0 };
    setSettings(next);
    const fresh = createGame(next.size);
    gameRef.current = fresh; setGame(fresh);
  }, []);

  const place = useCallback((index: number) => {
    const current = gameRef.current;
    if (!current || current.result || animating || allianceOf(current.active) !== settingsRef.current.human) return;
    commit(index);
  }, [animating, commit]);

  const retry = useCallback(() => { setError(''); setRetryToken(v => v + 1); }, []);
  const setPreferences = useCallback((patch: Partial<Pick<GameSettings, 'workers' | 'labels' | 'hints'>>) => setSettings(s => ({ ...s, ...patch })), []);
  useEffect(() => {
    // Explicitly opt-in, development-only fixture access; removed by the production build.
    if (!import.meta.env.DEV || !booted || !new URLSearchParams(location.search).has('test')) return;
    window.__konversonQA = {
      snapshot: () => gameRef.current,
      load: snapshot => {
        legalMoves(snapshot); // Strict engine validation before accepting a test fixture.
        newGame({ ...settingsRef.current, size: snapshot.size, human: allianceOf(snapshot.active) });
        gameRef.current = snapshot; setGame(snapshot);
      },
    };
    return () => { delete window.__konversonQA; };
  }, [booted, newGame]);
  const legal = useMemo(() => game ? legalMoves(game) : [], [game]);
  return { game, settings, legal, booted, animating, thinking, visible, error, notice, lastMove, progress, elapsed, availableWorkers, maxWorkers, place, newGame, retry, setPreferences };
}
