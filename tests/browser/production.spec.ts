import { test, expect } from '@playwright/test';

test('production assets, genuine worker gameplay and absent development fixture API',async({page})=>{
  const errors:string[]=[];
  const wasmTypes:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.url().endsWith('.wasm'))wasmTypes.push(response.headers()['content-type']??'');});
  await page.addInitScript(()=>localStorage.setItem('konverson-preferences',JSON.stringify({workers:2})));
  await page.goto('/?test');
  await expect(page.getByTestId('game-board')).toBeVisible();
  await expect(page.getByTestId('ai-status')).toHaveAttribute('data-workers','2');
  expect(await page.evaluate(()=>typeof window.__konversonQA)).toBe('undefined');
  await page.locator('[data-index="60"]').click();
  await expect(page.locator('[data-cell="10"]')).toHaveCount(2);
  expect(Number(await page.getByTestId('ai-status').getAttribute('data-simulations'))).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(wasmTypes.length).toBeGreaterThan(0);
  expect(wasmTypes.every(type=>type.includes('application/wasm'))).toBe(true);
  expect(errors).toEqual([]);
});
