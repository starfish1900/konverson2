import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import { Minus, Plus, Scan } from 'lucide-react';
import { COLORS, LETTERS, colorOf, coordinate } from './types';
import type { GameState } from './types';
import type { LastMove } from './useKonverson';
import { ANIMATION, conversionDelay, movePresentationTime, winningPathDelay, useReducedMotionPreference } from './animation';
import styles from './App.module.css';

function zone(index: number, size: number) {
  const r = Math.floor(index / size), c = index % size;
  if ((r === 0 || r === size - 1) && (c === 0 || c === size - 1)) return 'corner';
  if (r === 0 || c === 0 || r === size - 1 || c === size - 1) return 'border';
  if (r === 1 || c === 1 || r === size - 2 || c === size - 2) return 'preborder';
  return 'interior';
}
const pathFor = (indices: number[], size: number) => indices.map((i, j) => `${j ? 'L' : 'M'} ${i % size + .5} ${Math.floor(i / size) + .5}`).join(' ');

export const Board = memo(function Board({ game, legal, canPlay, presenting, labels, hints, lastMove, onPlace }: {
  game: GameState; legal: number[]; canPlay: boolean; presenting: boolean; labels: boolean; hints: boolean; lastMove: LastMove | null; onPlace: (index: number) => void;
}) {
  const reduced = useReducedMotionPreference();
  const boardRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(Math.floor(game.cells.length / 2));
  const [zoom, setZoom] = useState(1);
  const [revealedWin, setRevealedWin] = useState('');
  const legalSet = useMemo(() => new Set(legal), [legal]);
  const winIdentity = game.result?.winner ? `${lastMove?.nonce ?? 'snapshot'}:${game.placements}:${game.result.path.join(',')}` : '';
  const winDelay = reduced ? 0 : winningPathDelay(lastMove, game.size) / 1000;
  useEffect(() => {
    if (!winIdentity) { setRevealedWin(''); return; }
    if (revealedWin === winIdentity) return;
    if (reduced) { setRevealedWin(winIdentity); return; }
    const timer = setTimeout(() => setRevealedWin(winIdentity), winDelay * 1000 + ANIMATION.winDraw);
    return () => clearTimeout(timer);
  }, [winIdentity, winDelay, reduced, revealedWin]);
  useEffect(() => {
    setFocusIndex(Math.floor(game.size ** 2 / 2));
    setZoom(window.innerWidth < 600 && game.size >= 13 ? Math.max(1, game.size * 40 / (window.innerWidth - 65)) : 1);
  }, [game.size]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = Math.min(game.cells.length - 1, index + 1);
    else if (event.key === 'ArrowLeft') next = Math.max(0, index - 1);
    else if (event.key === 'ArrowDown') next = Math.min(game.cells.length - 1, index + game.size);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - game.size);
    else if (event.key === 'Home') next = Math.floor(index / game.size) * game.size;
    else if (event.key === 'End') next = Math.floor(index / game.size) * game.size + game.size - 1;
    else return;
    event.preventDefault(); setFocusIndex(next);
    boardRef.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus();
  }
  const captureRays = useMemo(() => {
    if (!lastMove) return [];
    const r = Math.floor(lastMove.index / game.size), c = lastMove.index % game.size;
    const rays = new Map<string, number[]>();
    for (const index of lastMove.converted) {
      const direction = `${Math.sign(Math.floor(index / game.size) - r)},${Math.sign(index % game.size - c)}`;
      const ray = rays.get(direction) ?? []; ray.push(index); rays.set(direction, ray);
    }
    return [...rays.values()].map(ray => {
      ray.sort((a,b) => Math.max(Math.abs(Math.floor(a/game.size)-r),Math.abs(a%game.size-c))-Math.max(Math.abs(Math.floor(b/game.size)-r),Math.abs(b%game.size-c)));
      const far = ray[ray.length - 1];
      const endRow = Math.floor(far / game.size) + Math.sign(Math.floor(far / game.size) - r);
      const endColumn = far % game.size + Math.sign(far % game.size - c);
      const endpoint = endRow * game.size + endColumn;
      const bracket = endRow >= 0 && endRow < game.size && endColumn >= 0 && endColumn < game.size && colorOf(lastMove.before[endpoint]) === lastMove.color ? [endpoint] : [];
      return [lastMove.index, ...ray, ...bracket];
    });
  }, [lastMove, game.size]);
  const isWinning = (i: number) => revealedWin === winIdentity && !!game.result?.path.includes(i);
  return <>
    <div className={styles.boardViewport} data-testid="board-viewport">
      <div className={styles.boardShell} style={{ width: `${zoom * 100}%` }}>
        <div className={styles.columnLabels} aria-hidden="true">{Array.from({length:game.size},(_,i)=><span key={i}>{String.fromCharCode(65+i)}</span>)}</div>
        <div className={styles.boardWrap}>
          <div className={styles.rowLabels} aria-hidden="true">{Array.from({length:game.size},(_,i)=><span key={i}>{i+1}</span>)}</div>
          <div ref={boardRef} className={`${styles.board} ${!canPlay ? styles.boardWaiting : ''}`} style={{gridTemplateColumns:`repeat(${game.size},1fr)`}} role="grid" aria-label={`Konverson ${game.size} by ${game.size} board`} aria-rowcount={game.size} aria-colcount={game.size} data-testid="game-board" data-size={game.size} data-presenting={presenting}>
            {Array.from({length:game.size},(_,row)=><div key={row} role="row" className={styles.boardRow}>
              {Array.from({length:game.size},(_,column)=>{
                const index = row*game.size+column, cell=game.cells[index], color=colorOf(cell), isNew=!!(cell&8), area=zone(index,game.size);
                const excluded=game.first!==null&&!cell&&Math.max(Math.abs(row-Math.floor(game.first/game.size)),Math.abs(column-game.first%game.size))<3;
                const converted=presenting&&(lastMove?.converted.includes(index)??false);
                const recentlyPlaced=lastMove?.index===index;
                const beforeColor=converted?colorOf(lastMove!.before[index]):color;
                const delay=converted&&!reduced?conversionDelay(index,lastMove!,game.size)/1000:0;
                const duration=reduced?0:converted?ANIMATION.conversion/1000:.22;
                const tint=COLORS[color-1], beforeTint=COLORS[beforeColor-1];
                const radius=isNew?'18%':'50%';
                const occupiedLabel=cell?`${LETTERS[color-1]}, ${isNew?'NEW protected':'OLD convertible'}`:'empty';
                return <button key={index} role="gridcell" className={[styles.cell,styles[area],excluded&&styles.excluded,legalSet.has(index)&&canPlay&&styles.legalCell,isWinning(index)&&styles.winningCell].filter(Boolean).join(' ')} style={{'--pawn-color':COLORS[color-1]??COLORS[game.active-1]} as CSSProperties} data-index={index} data-cell={cell} data-legal={legalSet.has(index)} aria-label={`${coordinate(index,game.size)}: ${occupiedLabel}${!cell&&legalSet.has(index)?', legal placement':''}`} aria-rowindex={row+1} aria-colindex={column+1} aria-disabled={!canPlay||!!cell||!legalSet.has(index)} tabIndex={focusIndex===index?0:-1} onFocus={()=>setFocusIndex(index)} onKeyDown={event=>navigate(event,index)} onClick={()=>{setFocusIndex(index);onPlace(index);}}>
                  {!cell&&hints&&legalSet.has(index)&&canPlay&&<span className={styles.legalDot}/>}
                  {!cell&&area==='corner'&&<span className={styles.cornerMark} aria-hidden="true">×</span>}
                  {!!cell&&<motion.span key={`${index}-${color}`} className={`${styles.pawn} ${recentlyPlaced?styles.lastPawn:''} ${converted&&!reduced?styles.convertingPawn:''}`} data-testid="pawn" data-posture={isNew?'new':'old'} data-converting={converted}
                    style={{borderRadius:radius,'--conversion-delay':`${delay}s`,'--conversion-duration':`${duration}s`} as CSSProperties}
                    initial={reduced?false:converted?{backgroundColor:beforeTint,color:beforeTint,scale:1,y:0,borderRadius:radius}:recentlyPlaced?{scale:.35,opacity:0,y:-4,borderRadius:radius}:false}
                    animate={{backgroundColor:converted&&!reduced?[beforeTint,beforeTint,tint,tint]:tint,color:converted&&!reduced?[beforeTint,beforeTint,tint,tint]:tint,scale:converted&&!reduced?[1,1.08,1.08,1]:1,y:converted&&!reduced?[0,-3,-3,0]:0,opacity:1,borderRadius:radius}}
                    transition={{duration,delay,times:converted?[0,.22,.8,1]:undefined,ease:'easeInOut'}}>
                    {labels&&(converted&&!reduced?<>
                      <motion.span className={styles.pawnLabel} aria-hidden="true" style={{position:'absolute'}} initial={{opacity:1}} animate={{opacity:[1,1,0,0]}} transition={{duration,delay,times:[0,.35,.65,1]}}>{LETTERS[beforeColor-1]}</motion.span>
                      <motion.span className={styles.pawnLabel} initial={{opacity:0}} animate={{opacity:[0,0,1,1]}} transition={{duration,delay,times:[0,.35,.65,1]}}>{LETTERS[color-1]}</motion.span>
                    </>:<span className={styles.pawnLabel}>{LETTERS[color-1]}</span>)}
                    {recentlyPlaced&&<i className={styles.lastMarker} aria-hidden="true"/>}
                  </motion.span>}
                </button>;
              })}
            </div>)}
            <svg className={styles.boardOverlay} viewBox={`0 0 ${game.size} ${game.size}`} aria-hidden="true">
              {presenting&&!reduced&&lastMove&&captureRays.map((ray,i)=><motion.path key={`${lastMove.nonce}-${i}`} data-testid="conversion-ray" d={pathFor(ray,game.size)} stroke={COLORS[lastMove.color-1]} strokeWidth=".065" strokeLinecap="round" strokeLinejoin="round" fill="none" initial={{pathLength:0,opacity:0}} animate={{pathLength:[0,1,1],opacity:[0,.8,.8,0]}} transition={{pathLength:{duration:movePresentationTime(lastMove,game.size)/1000,times:[0,.48,1],ease:'easeInOut'},opacity:{duration:movePresentationTime(lastMove,game.size)/1000,times:[0,.12,.8,1]}}}/>)}
              {game.result?.winner&&<g key={winIdentity}>
                <motion.path className={styles.winGlow} d={pathFor(game.result.path,game.size)} stroke={COLORS[game.result.winner-1]} strokeWidth=".23" strokeLinecap="round" strokeLinejoin="round" fill="none" initial={reduced?false:{pathLength:0,opacity:0}} animate={{pathLength:1,opacity:reduced?.5:[0,.5,.5,.7,.5]}} transition={{pathLength:{duration:reduced?0:ANIMATION.winDraw/1000,delay:winDelay,ease:'linear'},opacity:{duration:reduced?0:(ANIMATION.winDraw+ANIMATION.winSettle)/1000,delay:winDelay,times:[0,.15,.85,.93,1]}}}/>
                <motion.path data-testid="winning-path" d={pathFor(game.result.path,game.size)} stroke="#f7fffb" strokeWidth=".055" strokeLinecap="round" strokeLinejoin="round" fill="none" initial={reduced?false:{pathLength:0}} animate={{pathLength:1}} transition={{duration:reduced?0:ANIMATION.winDraw/1000,delay:winDelay,ease:'linear'}}/>
              </g>}
            </svg>
          </div>
        </div>
      </div>
    </div>
    <div className={styles.boardFooter}><span><span className={styles.squareKey}/> New · protected <span className={styles.circleKey}/> Old · convertible</span><div className={styles.zoomControls}><button aria-label="Zoom out" disabled={zoom<=1} onClick={()=>setZoom(z=>Math.max(1,z-.25))}><Minus size={13}/></button><button aria-label="Fit board" onClick={()=>setZoom(1)}><Scan size={13}/></button><button aria-label="Zoom in" disabled={zoom>=2.5} onClick={()=>setZoom(z=>Math.min(2.5,z+.25))}><Plus size={13}/></button></div></div>
  </>;
});
