import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import scenarios from '../fixtures/scenarios.json' with { type: 'json' };
import type { GameState } from '../../src/types';

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('konverson-preferences', JSON.stringify({workers:2,labels:true,hints:true})));
  await page.goto('/?test');
  await expect(page.getByTestId('game-board')).toBeVisible();
  await page.waitForFunction(() => !!window.__konversonQA);
  await expect(page.getByTestId('ai-status')).toHaveAttribute('data-workers','2');
});

async function newMatch(page:Page, size=9, alliance='A + C', difficulty='Casual') {
  await page.getByRole('button',{name:'New game',exact:true}).click();
  await page.getByRole('button',{name:new RegExp(`${size} × ${size}`)}).click();
  await page.getByRole('button',{name:new RegExp(alliance.replace('+','\\+'))}).click();
  await page.getByRole('button',{name:new RegExp(`^${difficulty}`)}).click();
  await page.getByRole('button',{name:'Start match',exact:true}).click();
  await expect(page.getByTestId('game-board')).toHaveAttribute('data-size',String(size));
}

const rgb = (value:string) => value.match(/[\d.]+/g)!.slice(0,3).map(Number);
const colorDistance = (a:string,b:string) => Math.hypot(...rgb(a).map((channel,index)=>channel-rgb(b)[index]));

async function winningPathProgress(page:Page) {
  return page.getByTestId('winning-path').evaluate(node=>{
    const path=node as SVGPathElement;
    const dash=getComputedStyle(path).strokeDasharray;
    // Motion normalizes SVG paths with pathLength; inspect the rendered stroke,
    // since an SVG element can be "visible" while none of its line is drawn.
    if(dash==='none') return 1;
    const normalizedLength=Number(path.getAttribute('pathLength'))||path.getTotalLength();
    return Number.parseFloat(dash)/normalizedLength;
  });
}

async function restartMatch(page:Page) {
  await page.getByRole('button',{name:'Restart match',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Restart match',exact:true}).click();
  await expect(page.getByTestId('game-board')).toHaveAttribute('data-presenting','false');
}

test('opening, AI response, and the two-placement exclusion rule', async ({page}) => {
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  await expect(page.getByRole('heading',{level:1})).toHaveText('Your move.');
  await page.locator('[data-index="0"]').click({force:true});
  await expect(page.getByTestId('game-board').locator('[data-cell="9"]')).toHaveCount(0);
  await page.locator('[data-index="60"]').click();
  await expect(page.getByTestId('game-board').locator('[data-cell="10"]')).toHaveCount(2);
  await expect(page.getByRole('heading',{level:1})).toHaveText('Your move.');
  const square=page.locator('[data-legal="true"][data-cell="0"]').first();
  await square.click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('One more pawn.');
  const state=await page.evaluate(()=>window.__konversonQA!.snapshot()!);
  expect(state.stage).toBe(1); expect(state.active).toBe(3);
  const allowed=await page.locator('[data-legal="true"]').evaluateAll(cells=>cells.map(cell=>Number(cell.getAttribute('data-index'))));
  expect(allowed.every(i=>Math.max(Math.abs(Math.floor(i/state.size)-Math.floor(state.first!/state.size)),Math.abs(i%state.size-state.first!%state.size))>=3)).toBe(true);
  expect(errors).toEqual([]);
});

test('all board sizes, keyboard navigation, preferences and readable rules',async({page})=>{
  for(const size of [9,11,13,15]){
    await newMatch(page,size);
    await expect(page.getByRole('gridcell')).toHaveCount(size*size);
  }
  await newMatch(page,9);
  await page.locator('[data-index="40"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-index="41"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-index="41"]')).toHaveAttribute('data-cell','9');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('switch',{name:'Color letters'}).uncheck();
  await page.getByRole('switch',{name:'Placement guides'}).uncheck();
  await page.getByRole('slider',{name:'AI worker count'}).focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('slider',{name:'AI worker count'})).toHaveValue('1');
  await page.getByRole('button',{name:'Back to the board'}).click();
  await expect(page.getByTestId('ai-status')).toHaveAttribute('data-workers','1');
  await page.getByRole('button',{name:'How to play'}).click();
  await expect(page.getByRole('heading',{name:'Close a pincer. Change their color.'})).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Corners never count');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('conversion colors unfold for over a second while mouse and keyboard placement stay locked',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  const ongoing=scenarios.fixtures[0];
  await page.evaluate(state=>window.__konversonQA!.load(state as GameState),ongoing.state);
  const farPawn=page.locator('[data-index="50"]').getByTestId('pawn');
  const oldColor=await farPawn.evaluate(node=>getComputedStyle(node).backgroundColor);
  await page.locator(`[data-index="${ongoing.moveIndex}"]`).click();
  const early=await farPawn.evaluate(node=>({
    origin:performance.now(),color:getComputedStyle(node).backgroundColor,radius:getComputedStyle(node).borderRadius,
    presenting:document.querySelector('[data-testid="game-board"]')?.getAttribute('data-presenting'),
    converting:node.getAttribute('data-converting'),
  }));
  expect(colorDistance(early.color,oldColor)).toBeLessThan(8);
  expect(early.radius).toBe('50%');
  expect(early.presenting).toBe('true');
  expect(early.converting).toBe('true');

  // Attempt real input immediately, while no deliberate waiting has elapsed.
  const second=page.locator('[data-legal="true"][data-cell="0"]').first();
  await expect(second).toHaveAttribute('aria-disabled','true');
  await second.click({force:true});
  await second.focus();
  await page.keyboard.press('Enter');

  // Keep both paint samples on the browser clock, so automation round trips
  // cannot accumulate into extra delays that outlast the presentation gate.
  const samples=await page.evaluate(async origin=>{
    const stateAfterAttempts=window.__konversonQA!.snapshot();
    const sample=()=>({
      elapsed:performance.now()-origin,
      color:getComputedStyle(document.querySelector('[data-index="50"] [data-testid="pawn"]')!).backgroundColor,
      presenting:document.querySelector('[data-testid="game-board"]')?.getAttribute('data-presenting'),
    });
    const waitUntil=(elapsed:number)=>new Promise<void>(resolve=>setTimeout(resolve,Math.max(0,origin+elapsed-performance.now())));
    await waitUntil(750);
    const middle=sample();
    await waitUntil(1050);
    return {stateAfterAttempts,middle,later:sample()};
  },early.origin);
  expect(samples.stateAfterAttempts).toEqual(ongoing.expectedState);
  expect(samples.middle.presenting).toBe('true');
  expect(samples.later.presenting).toBe('true');
  for(const index of ongoing.expectedEvents.find(e=>e.kind==='converted')!.indices){
    await expect(page.locator(`[data-index="${index}"] [data-posture="old"]`)).toHaveCount(1);
  }

  const rayEndpoints=await page.getByTestId('conversion-ray').first().evaluate(node=>{
    const ray=node as SVGPathElement;
    const start=ray.getPointAtLength(0),end=ray.getPointAtLength(ray.getTotalLength());
    return {start:[start.x,start.y],end:[end.x,end.y]};
  });
  expect(rayEndpoints).toEqual({start:[2.5,5.5],end:[6.5,5.5]});
  await expect(page.getByTestId('game-board')).toHaveAttribute('data-presenting','false');
  const finalColor=await farPawn.evaluate(node=>getComputedStyle(node).backgroundColor);
  expect(colorDistance(samples.middle.color,oldColor)).toBeGreaterThan(1);
  expect(colorDistance(samples.middle.color,finalColor)).toBeGreaterThan(8);
  expect(colorDistance(samples.later.color,finalColor)).toBeLessThan(colorDistance(samples.middle.color,finalColor));
  expect(colorDistance(oldColor,finalColor)).toBeGreaterThan(50);
  await expect(second).toHaveAttribute('aria-disabled','false');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForTimeout(100);
  await expect(page.getByTestId('conversion-ray')).toHaveCount(0);
  await expect(second).toHaveAttribute('aria-disabled','false');
});

test('the winning connexion waits for conversions then draws slowly before announcing the result',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  const winning=scenarios.fixtures[2];
  await page.evaluate(state=>window.__konversonQA!.load(state as GameState),winning.state);
  await page.locator(`[data-index="${winning.moveIndex}"]`).click();
  expect(await page.evaluate(()=>window.__konversonQA!.snapshot())).toEqual(winning.expectedState);
  await page.waitForTimeout(900);
  expect(await winningPathProgress(page)).toBeLessThan(.01);
  expect(await page.getByRole('status').count()).toBe(0);
  await expect(page.getByTestId('game-board')).toHaveAttribute('data-presenting','true');

  await expect.poll(()=>winningPathProgress(page),{intervals:[40,80,80]}).toBeGreaterThan(.03);
  await page.waitForTimeout(1100);
  const middleProgress=await winningPathProgress(page);
  expect(middleProgress).toBeGreaterThan(.1);
  expect(middleProgress).toBeLessThan(.98);
  expect(await page.getByRole('status').count()).toBe(0);

  await expect(page.getByRole('status')).toContainText('You win');
  expect(await winningPathProgress(page)).toBeGreaterThan(.99);
  await expect(page.getByTestId('game-board')).toHaveAttribute('data-presenting','false');
  expect(winning.expectedState.result!.path).not.toContain(winning.moveIndex);
  const winningCell=page.locator(`[data-index="${winning.expectedState.result!.path[0]}"]`);
  const settledHighlight=await winningCell.evaluate(node=>getComputedStyle(node).backgroundColor);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForTimeout(100);
  expect(await winningCell.evaluate(node=>getComputedStyle(node).backgroundColor)).toBe(settledHighlight);
  expect(await winningPathProgress(page)).toBeGreaterThan(.99);
  await page.screenshot({path:`test-results/victory-${test.info().project.name}.png`,fullPage:true});
});

test('restart during an AI-bound conversion cancels its pending turn and visual effects',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  const conversion=scenarios.fixtures[1];
  await page.evaluate(state=>window.__konversonQA!.load(state as GameState),conversion.state);
  await page.locator(`[data-index="${conversion.moveIndex}"]`).click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(()=>window.__konversonQA!.snapshot()?.active)).toBe(2);
  await expect(page.getByTestId('game-board')).toHaveAttribute('data-presenting','true');
  await expect(page.getByTestId('ai-status')).not.toContainText('Considering');
  await restartMatch(page);
  await page.waitForTimeout(1800);
  await expect(page.getByTestId('pawn')).toHaveCount(0);
  await expect(page.getByTestId('conversion-ray')).toHaveCount(0);
  await expect(page.getByTestId('winning-path')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByTestId('ai-status')).not.toContainText('Considering');
  expect(await page.evaluate(()=>window.__konversonQA!.snapshot()?.placements)).toBe(0);
});

test('restart during the winning trace prevents a delayed result from returning',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  const winning=scenarios.fixtures[2];
  await page.evaluate(state=>window.__konversonQA!.load(state as GameState),winning.state);
  await page.locator(`[data-index="${winning.moveIndex}"]`).click();
  await expect.poll(()=>winningPathProgress(page),{intervals:[40,80,80]}).toBeGreaterThan(.15);
  expect(await page.getByRole('status').count()).toBe(0);
  await restartMatch(page);
  await page.waitForTimeout(2800);
  await expect(page.getByTestId('pawn')).toHaveCount(0);
  await expect(page.getByTestId('winning-path')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByTestId('game-board')).toHaveAttribute('data-presenting','false');
  expect(await page.evaluate(()=>window.__konversonQA!.snapshot()?.result)).toBeNull();
});

test('restart during the AI opening cannot leave an identical board stalled',async({page})=>{
  await newMatch(page,9,'B + D','Deep');
  await expect(page.getByTestId('ai-status')).toContainText('Considering');
  // Restart to the same board fingerprint before the AI makes its first placement.
  await newMatch(page,9,'B + D','Deep');
  await expect(page.getByTestId('ai-status')).toContainText('Considering');
  await expect.poll(async()=>Number(await page.getByTestId('ai-status').getAttribute('data-simulations'))).toBeGreaterThan(0);
  await newMatch(page,9,'B + D','Casual');
  await expect(page.getByRole('gridcell').filter({has:page.locator('[data-posture="new"]')})).toHaveCount(1);
  await expect(page.getByRole('heading',{level:1})).toHaveText('Your move.');
  await page.getByRole('button',{name:'Restart match',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Restart match',exact:true}).click();
  await expect(page.locator('[data-cell="9"]')).toHaveCount(1);
  await newMatch(page,11,'A + C');
  await page.waitForTimeout(1250);
  await expect(page.locator('[data-posture]')).toHaveCount(0);
});

test('hidden tabs pause AI work and controls stay usable during deep searches',async({page})=>{
  await newMatch(page,9,'B + D','Deep');
  await expect.poll(async()=>Number(await page.getByTestId('ai-status').getAttribute('data-simulations'))).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Settings',exact:true}).click({timeout:2000});
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button',{name:'Back to the board'}).click();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.getByTestId('ai-status')).toContainText('Thinking paused');
  const pausedCount=await page.getByTestId('ai-status').getAttribute('data-simulations');
  await page.waitForTimeout(350);
  await expect(page.getByTestId('ai-status')).toHaveAttribute('data-simulations',pausedCount!);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.getByTestId('ai-status')).toContainText('Considering');
  await expect.poll(async()=>Number(await page.getByTestId('ai-status').getAttribute('data-simulations'))).toBeGreaterThan(0);
  await newMatch(page,9,'A + C','Casual');
  await expect(page.locator('[data-posture]')).toHaveCount(0);
});

test('mobile layout, zoom, and reduced motion',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await newMatch(page,15);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Fit board',exact:true}).click();
  await expect(page.getByTestId('game-board')).toBeVisible();
  await expect.poll(async()=>(await page.getByTestId('game-board').boundingBox())!.width).toBeLessThan(360);
  const before=await page.getByTestId('game-board').boundingBox();
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await expect.poll(async()=>(await page.getByTestId('game-board').boundingBox())!.width).toBeGreaterThan(before!.width);
  await page.getByRole('button',{name:'Fit board',exact:true}).click();
  await page.screenshot({path:`test-results/mobile-${test.info().project.name}.png`,fullPage:true});
  const fixture=scenarios.fixtures[2];
  await page.evaluate(state=>window.__konversonQA!.load(state as GameState),fixture.state);
  await page.locator(`[data-index="${fixture.moveIndex}"]`).click();
  await expect(page.getByRole('status')).toContainText('You win',{timeout:750});
  await expect(page.getByTestId('game-board')).toHaveAttribute('data-presenting','false',{timeout:750});
  expect(await winningPathProgress(page)).toBeGreaterThan(.99);
});

test('a complete human-versus-worker game reaches a legal result',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await newMatch(page,9);
  for(let placement=0;placement<82;placement++){
    await page.waitForFunction(()=>{
      const g=window.__konversonQA?.snapshot();return !!g&&(!!g.result||(g.active-1)%2===0);
    });
    const state=await page.evaluate(()=>window.__konversonQA!.snapshot()!);
    if(state.result){
      expect(state.result.winner===null||state.result.path.length>=7).toBe(true);
      await expect(page.getByRole('status')).toBeVisible();
      return;
    }
    const index=await page.evaluate(async state=>{
      const modulePath='/src/generated/konverson_engine.js';
      const engine=await import(/* @vite-ignore */modulePath);
      await engine.default({module_or_path:'/src/generated/konverson_engine_bg.wasm'});
      const search=new engine.SearchSession(JSON.stringify(state),113,10000);
      try{search.step(60);return JSON.parse(search.report()).best as number;}finally{search.free();}
    },state);
    const cell=page.locator(`[data-index="${index}"]`);
    await expect(cell).toHaveAttribute('aria-disabled','false');
    await cell.click();
  }
  throw new Error('A 9×9 match exceeded its finite placement bound.');
});
