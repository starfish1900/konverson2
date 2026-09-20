import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Minus, Plus, Scan } from 'lucide-react';
import { COLORS, LETTERS, colorOf, coordinate } from './types';
import type { GameState } from './types';
import type { LastMove } from './useKonverson';
import styles from './App.module.css';

function zone(index: number, size: number) {
  const r = Math.floor(index / size), c = index % size;
  if ((r === 0 || r === size - 1) && (c === 0 || c === size - 1)) return 'corner';
  if (r === 0 || c === 0 || r === size - 1 || c === size - 1) return 'border';
  if (r === 1 || c === 1 || r === size - 2 || c === size - 2) return 'preborder';
  return 'interior';
}
const pathFor = (indices: number[], size: number) => indices.map((i, j) => `${j ? 'L' : 'M'} ${i % size + .5} ${Math.floor(i / size) + .5}`).join(' ');

export const Board = memo(function Board({ game, legal, canPlay, labels, hints, lastMove, onPlace }: {
  game: GameState; legal: number[]; canPlay: boolean; labels: boolean; hints: boolean; lastMove: LastMove | null; onPlace: (index: number) => void;
}) {
  const reduced = useReducedMotion();
  const boardRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(Math.floor(game.cells.length / 2));
  const [zoom, setZoom] = useState(1);
  const legalSet = useMemo(() => new Set(legal), [legal]);
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
    return [...rays.values()].map(ray => [lastMove.index, ...ray.sort((a,b) => Math.max(Math.abs(Math.floor(a/game.size)-r),Math.abs(a%game.size-c))-Math.max(Math.abs(Math.floor(b/game.size)-r),Math.abs(b%game.size-c)))]);
  }, [lastMove, game.size]);
  const isWinning = (i: number) => !!game.result?.path.includes(i);
  return <>
    <div className={styles.boardViewport} data-testid="board-viewport">
      <div className={styles.boardShell} style={{ width: `${zoom * 100}%` }}>
        <div className={styles.columnLabels} aria-hidden="true">{Array.from({length:game.size},(_,i)=><span key={i}>{String.fromCharCode(65+i)}</span>)}</div>
        <div className={styles.boardWrap}>
          <div className={styles.rowLabels} aria-hidden="true">{Array.from({length:game.size},(_,i)=><span key={i}>{i+1}</span>)}</div>
          <div ref={boardRef} className={`${styles.board} ${!canPlay ? styles.boardWaiting : ''}`} style={{gridTemplateColumns:`repeat(${game.size},1fr)`}} role="grid" aria-label={`Konverson ${game.size} by ${game.size} board`} aria-rowcount={game.size} aria-colcount={game.size} data-testid="game-board" data-size={game.size}>
            {Array.from({length:game.size},(_,row)=><div key={row} role="row" className={styles.boardRow}>
              {Array.from({length:game.size},(_,column)=>{
                const index = row*game.size+column, cell=game.cells[index], color=colorOf(cell), isNew=!!(cell&8), area=zone(index,game.size);
                const excluded=game.first!==null&&!cell&&Math.max(Math.abs(row-Math.floor(game.first/game.size)),Math.abs(column-game.first%game.size))<3;
                const converted=lastMove?.converted.includes(index)??false;
                const recentlyPlaced=lastMove?.index===index;
                const occupiedLabel=cell?`${LETTERS[color-1]}, ${isNew?'NEW protected':'OLD convertible'}`:'empty';
                return <button key={index} role="gridcell" className={[styles.cell,styles[area],excluded&&styles.excluded,legalSet.has(index)&&canPlay&&styles.legalCell,isWinning(index)&&styles.winningCell].filter(Boolean).join(' ')} style={{'--pawn-color':COLORS[color-1]??COLORS[game.active-1]} as CSSProperties} data-index={index} data-cell={cell} data-legal={legalSet.has(index)} aria-label={`${coordinate(index,game.size)}: ${occupiedLabel}${!cell&&legalSet.has(index)?', legal placement':''}`} aria-rowindex={row+1} aria-colindex={column+1} aria-disabled={!canPlay||!!cell||!legalSet.has(index)} tabIndex={focusIndex===index?0:-1} onFocus={()=>setFocusIndex(index)} onKeyDown={event=>navigate(event,index)} onClick={()=>{setFocusIndex(index);onPlace(index);}}>
                  {!cell&&hints&&legalSet.has(index)&&canPlay&&<span className={styles.legalDot}/>}
                  {!cell&&area==='corner'&&<span className={styles.cornerMark} aria-hidden="true">×</span>}
                  {!!cell&&<motion.span key={`${index}-${color}`} className={`${styles.pawn} ${recentlyPlaced?styles.lastPawn:''}`} data-posture={isNew?'new':'old'} initial={reduced?false:converted?{backgroundColor:COLORS[colorOf(lastMove!.before[index])-1],scale:1}:recentlyPlaced?{scale:.25,opacity:0}:false} animate={{backgroundColor:COLORS[color-1],scale:converted&&!reduced?[1,1.16,1]:1,opacity:1,borderRadius:isNew?'24%':'50%'}} transition={{duration:reduced?0:converted?.32:.2,delay:converted&&!reduced?Math.min(.11,Math.max(Math.abs(row-Math.floor(lastMove!.index/game.size)),Math.abs(column-lastMove!.index%game.size))*.022):0,ease:'easeOut'}}>
                    {labels&&<span>{LETTERS[color-1]}</span>}
                    {recentlyPlaced&&<i className={styles.lastMarker} aria-hidden="true"/>}
                  </motion.span>}
                </button>;
              })}
            </div>)}
            <svg className={styles.boardOverlay} viewBox={`0 0 ${game.size} ${game.size}`} aria-hidden="true">
              {lastMove&&captureRays.map((ray,i)=><motion.path key={`${lastMove.nonce}-${i}`} d={pathFor(ray,game.size)} stroke={COLORS[lastMove.color-1]} strokeWidth=".05" fill="none" initial={{pathLength:0,opacity:.7}} animate={{pathLength:1,opacity:0}} transition={{duration:reduced?0:.45}}/>)}
              {game.result?.winner&&<><motion.path className={styles.winGlow} d={pathFor(game.result.path,game.size)} stroke={COLORS[game.result.winner-1]} strokeWidth=".23" strokeLinecap="round" strokeLinejoin="round" fill="none" initial={{pathLength:0,opacity:0}} animate={{pathLength:1,opacity:.55}} transition={{duration:reduced?0:1.1,delay:reduced?0:.4}}/><motion.path data-testid="winning-path" d={pathFor(game.result.path,game.size)} stroke="#f7fffb" strokeWidth=".055" strokeLinecap="round" strokeLinejoin="round" fill="none" initial={{pathLength:0}} animate={{pathLength:1}} transition={{duration:reduced?0:1.1,delay:reduced?0:.4}}/></>}
            </svg>
          </div>
        </div>
      </div>
    </div>
    <div className={styles.boardFooter}><span><span className={styles.squareKey}/> New · protected <span className={styles.circleKey}/> Old · convertible</span><div className={styles.zoomControls}><button aria-label="Zoom out" disabled={zoom<=1} onClick={()=>setZoom(z=>Math.max(1,z-.25))}><Minus size={13}/></button><button aria-label="Fit board" onClick={()=>setZoom(1)}><Scan size={13}/></button><button aria-label="Zoom in" disabled={zoom>=2.5} onClick={()=>setZoom(z=>Math.min(2.5,z+.25))}><Plus size={13}/></button></div></div>
  </>;
});
