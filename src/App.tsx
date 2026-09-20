import { useCallback, useState } from 'react';
import type { CSSProperties } from 'react';
import { BookOpen, SlidersHorizontal, ArrowUpRight, Plus, Cpu, UserRound, RotateCcw, ArrowRight, Trophy, RefreshCw, CircleHelp } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Board } from './Board';
import { Dialog } from './Dialog';
import { Rules } from './Rules';
import { useKonverson } from './useKonverson';
import { COLORS, COLOR_NAMES, LETTERS, BUDGETS, allianceOf, coordinate } from './types';
import type { Alliance, BoardSize, Difficulty } from './types';
import styles from './App.module.css';

const titleCase = (value: string) => value[0].toUpperCase()+value.slice(1);

export default function App() {
  const match = useKonverson();
  const { game, settings, lastMove } = match;
  const [dialog, setDialog] = useState<'rules' | 'settings' | 'new' | 'restart' | null>(null);
  const [draft, setDraft] = useState(settings);
  const closeDialog = useCallback(()=>setDialog(null),[]);
  const reduced = useReducedMotion();
  const isHuman = game ? allianceOf(game.active) === settings.human : true;
  const humanWon = game?.result?.winner != null && allianceOf(game.result.winner) === settings.human;
  const first = game?.stage === 0;
  const heading = !game ? 'Preparing the board.' : game.result ? game.result.winner ? 'Connexion.' : 'A draw.' : isHuman ? first ? 'Your move.' : 'One more pawn.' : 'Their move.';
  const instruction = !game ? 'Getting your colors ready…' : game.result ? game.result.winner ? `${humanWon?'You':'The AI'} connected ${game.result.orientation==='north-south'?'north to south':'west to east'} with color ${LETTERS[game.result.winner-1]}.` : 'No legal placement remains. A well-fought match.' : !isHuman ? !match.visible ? 'Thinking is paused while this tab is hidden.' : match.availableWorkers === 0 ? 'Your opponent is getting ready…' : `The AI is considering its ${first?'first':'second'} placement.` : game.opening ? 'Place your opening pawn in the interior.' : first ? `Place the first of your two ${LETTERS[game.active-1]} pawns.` : 'Place your second pawn at least three steps away.';
  const humanColors = settings.human===0?[0,2]:[1,3];
  const aiColors = settings.human===0?[1,3]:[0,2];
  const startGame = () => { match.newGame(draft); closeDialog(); };
  const openNew = () => { setDraft(settings); setDialog('new'); };
  function player(name: string, indices: number[], human: boolean) {
    const active = !!game&&!game.result&&(human===isHuman);
    return <div className={`${styles.playerRow} ${active?styles.activePlayer:''}`}>
      <div className={styles.playerIcon}>{human?<UserRound size={19}/>:<Cpu size={19}/>}</div>
      <div><h3>{name}{active&&<span className={styles.playerActive}>TO PLAY</span>}</h3><p>{indices.map(i=>COLOR_NAMES[i]).join(' & ')}</p></div>
      <div className={styles.pair}>{indices.map(i=><i key={i} style={{background:COLORS[i]}}>{LETTERS[i]}</i>)}</div>
    </div>;
  }
  return <div className={styles.app}>
    <header className={styles.header}>
      <a href="/" className={styles.brand} aria-label="Konverson home"><span className={styles.logo}><i/><i/><i/><i/></span><span>konverson<span className={styles.brandPeriod}>.</span></span></a>
      <span className={styles.tagline}>CONNEXIONS & CONVERSIONS</span>
      <nav className={styles.nav} aria-label="Game controls"><button onClick={()=>setDialog('rules')}><BookOpen size={17}/> How to play</button><button aria-label="Settings" onClick={()=>setDialog('settings')}><SlidersHorizontal size={19}/></button></nav>
    </header>
    <main className={styles.main}>
      <section className={styles.arena} aria-label="Game board">
        <div className={styles.arenaHeading}><div><p className={styles.eyebrow}>{game?.result?'THE MATCH IS COMPLETE':game?.opening?'LET THE CONNEXIONS BEGIN':match.thinking?'FINDING A WAY THROUGH':`TURN ${String(game?.turn??1).padStart(2,'0')} · ${first?'FIRST':'SECOND'} PLACEMENT`}</p><h1 aria-live="polite">{heading.slice(0,-1)}<span className={styles.brandPeriod}>.</span></h1><p className={styles.instruction} aria-live="polite">{instruction}</p></div>{game&&!game.result&&<span className={styles.turnBadge} style={{color:COLORS[game.active-1],borderColor:`${COLORS[game.active-1]}40`}}><span style={{background:COLORS[game.active-1]}}/> COLOR {LETTERS[game.active-1]}</span>}</div>
        {game?<Board game={game} legal={match.legal} canPlay={isHuman&&!match.animating&&!game.result} labels={settings.labels} hints={settings.hints} lastMove={lastMove} onPlace={match.place}/>:<div className={styles.loadingBoard}><span className={styles.loadingRing}/><p>Preparing Konverson</p></div>}
        <div className={styles.boardMessage} aria-live="polite">{match.notice||(!game?.result&&game?.stage===1&&isHuman?'The shaded area is too close to your first pawn.':lastMove?`${LETTERS[lastMove.color-1]} · ${coordinate(lastMove.index,game?.size??11)}${lastMove.converted.length?` · ${lastMove.converted.length} pawn${lastMove.converted.length===1?'':'s'} converted`:''}`:'Side or corner: touching pawns can form a connexion.')}</div>
        <AnimatePresence>{game?.result&&<motion.div className={styles.resultBanner} initial={reduced?false:{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:reduced?0:1.1}} role="status"><Trophy size={24}/><div><h2>{game.result.winner?humanWon?'Beautifully connected. You win.':'A connexion for the AI.':'No connexion. This match is a draw.'}</h2><p>{game.result.winner?`Color ${LETTERS[game.result.winner-1]} found a path across the board.`:'A fresh board brings new possibilities.'}</p></div><button onClick={openNew}>Play again <ArrowRight size={16}/></button></motion.div>}</AnimatePresence>
        {match.error&&<div className={styles.errorBanner} role="alert"><p>{match.error}</p><button onClick={match.booted?match.retry:()=>location.reload()}><RefreshCw size={15}/> {match.booted?'Retry AI':'Reload game'}</button></div>}
      </section>
      <aside className={styles.sidebar}>
        <section className={styles.matchPanel}><div className={styles.panelHeading}><h2>The match</h2><span>TURN {String(game?.turn??1).padStart(2,'0')}</span></div>{player('You',humanColors,true)}{player('Konverson AI',aiColors,false)}<div className={styles.cycleLabel}>COLOR ORDER</div><div className={styles.colorCycle}>{COLORS.map((color,i)=><div key={color} className={game?.active===i+1&&!game.result?styles.activeColor:''} style={{'--cycle-color':color} as CSSProperties}><span style={{background:color}}>{LETTERS[i]}</span>{i<3&&<span className={styles.cycleDivider}>···</span>}</div>)}</div>
          <div className={`${styles.thinkingStatus} ${match.thinking?styles.isThinking:''}`} aria-live="polite" data-testid="ai-status" data-workers={match.availableWorkers} data-simulations={match.progress?.simulations??0}>{match.thinking?<><span className={styles.thinkingDots}><i/><i/><i/></span><span>Considering the board</span><span className={styles.thinkingTime}>{(match.elapsed/1000).toFixed(1)}s</span></>:<><span className={styles.statusMark}/><span>{game?.result?'Match complete':isHuman?'Your turn to connect':match.visible?'Your opponent is ready':'Thinking paused'}</span></>}</div>
        </section>
        <section className={styles.objective}><span className={styles.eyebrow}>ONE COLOR. ONE CONNECTION.</span><h2>Make your way<br/>to the other side.</h2><p>Connect opposite edges with a chain of a single color. Convert pawns to open a new path.</p><div className={styles.miniConnection} aria-hidden="true"><i/><i/><i/><i/><ArrowUpRight size={20}/></div></section>
        <div className={styles.summary}><span>Board size<strong>{settings.size} × {settings.size}</strong></span><span>Difficulty<strong>{titleCase(settings.difficulty)}</strong></span></div>
        <div className={styles.gameActions}><button className={styles.newGame} onClick={openNew} disabled={!match.booted}><Plus size={18}/> New game</button><button className={styles.restartButton} aria-label="Restart match" onClick={()=>setDialog('restart')} disabled={!game?.placements}><RotateCcw size={17}/></button></div>
        <p className={styles.localNote}>Your opponent thinks on your device.</p>
      </aside>
    </main>
    <footer className={styles.footer}><span>FOUR COLORS. TWO ALLIANCES. ONE CONNEXION.</span><span>Konverson <span className={styles.footerDiamond}>◆</span> XaXua Games</span></footer>
    {dialog==='rules'&&<Dialog title="How to play" onClose={closeDialog} wide><Rules/></Dialog>}
    {dialog==='new'&&<Dialog title="A new connexion" onClose={closeDialog}><p className={styles.dialogIntro}>Choose your board. Find your way across.</p><fieldset className={styles.fieldset}><legend>Board size</legend><div className={styles.sizeOptions}>{([9,11,13,15] as BoardSize[]).map(size=><button key={size} aria-pressed={draft.size===size} onClick={()=>setDraft(d=>({...d,size}))}><strong>{size} × {size}</strong><span>{size===9?'Compact':size===11?'Classic':size===13?'Expansive':'Grand'}</span></button>)}</div></fieldset><fieldset className={styles.fieldset}><legend>Your alliance</legend><div className={styles.allianceOptions}>{([0,1] as Alliance[]).map(alliance=><button key={alliance} aria-pressed={draft.human===alliance} onClick={()=>setDraft(d=>({...d,human:alliance}))}><span className={styles.pair}>{(alliance===0?[0,2]:[1,3]).map(i=><i key={i} style={{background:COLORS[i]}}>{LETTERS[i]}</i>)}</span><strong>{alliance===0?'A + C':'B + D'}</strong><span>{alliance===0?'You open the match':'The AI opens'}</span></button>)}</div></fieldset><fieldset className={styles.fieldset}><legend>Opponent difficulty</legend><div className={styles.difficultyOptions}>{(Object.keys(BUDGETS) as Difficulty[]).map(difficulty=><button key={difficulty} aria-pressed={draft.difficulty===difficulty} onClick={()=>setDraft(d=>({...d,difficulty}))}>{titleCase(difficulty)}<span>{BUDGETS[difficulty]/1000}s</span></button>)}</div><p className={styles.fieldHint}>Maximum thinking time per turn, shared across both pawns.</p></fieldset><button className={styles.primaryAction} onClick={startGame}>Start match <ArrowRight size={17}/></button>{!!game?.placements&&<p className={styles.fieldHint}>Starting a new match replaces the current board.</p>}</Dialog>}
    {dialog==='settings'&&<Dialog title="Make yourself at home" onClose={closeDialog}><div className={styles.settingRow}><div><h3>Color letters</h3><p>Identify each pawn by its letter.</p></div><input type="checkbox" role="switch" aria-label="Color letters" checked={settings.labels} onChange={e=>match.setPreferences({labels:e.target.checked})}/></div><div className={styles.settingRow}><div><h3>Placement guides</h3><p>Show dots on legal empty squares.</p></div><input type="checkbox" role="switch" aria-label="Placement guides" checked={settings.hints} onChange={e=>match.setPreferences({hints:e.target.checked})}/></div><div className={styles.workerSetting}><div><h3>AI workers</h3><output>{settings.workers}</output></div><input aria-label="AI worker count" type="range" min="1" max={match.maxWorkers} value={settings.workers} onChange={e=>match.setPreferences({workers:Number(e.target.value)})}/><p>The default leaves one browser-reported processor thread free. Lower this to use less CPU.</p><div className={styles.workerSummary}><Cpu size={16}/><span>{match.availableWorkers} of {settings.workers} workers ready · {match.maxWorkers} threads reported</span></div></div><details className={styles.searchDetails}><summary>Last search details</summary><dl><div><dt>Simulations</dt><dd>{(match.progress?.simulations??0).toLocaleString()}</dd></div><div><dt>Search nodes</dt><dd>{(match.progress?.nodes??0).toLocaleString()}</dd></div><div><dt>Reported search memory</dt><dd>{((match.progress?.memoryBytes??0)/1048576).toFixed(1)} MiB</dd></div><div><dt>Workers with simulations</dt><dd>{match.progress?.workers.filter(w=>w.simulations>0).length??0}</dd></div></dl></details><p className={styles.settingsNote}><CircleHelp size={15}/> Animations follow your device’s reduced-motion preference.</p><button className={styles.primaryAction} onClick={closeDialog}>Back to the board <ArrowRight size={17}/></button></Dialog>}
    {dialog==='restart'&&<Dialog title="Start this match again?" onClose={closeDialog}><p className={styles.dialogIntro}>Clear the board and keep your current board size, alliance, and difficulty.</p><div className={styles.confirmActions}><button onClick={closeDialog}>Keep playing</button><button className={styles.primaryAction} onClick={()=>{match.newGame(settings);closeDialog();}}>Restart match <RotateCcw size={16}/></button></div></Dialog>}
  </div>;
}
