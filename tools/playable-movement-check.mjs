/** One short real-input check against the already-running local playable build. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Explicit showcase spawn beside the parked Lombard Prius. The default game remains Ferry plaza.
const url = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173/?at=37.80199520213967,-122.41963019831591,87.8';
const out = 'artifacts/playable-movement';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { url, checkedAt: new Date().toISOString(), errors: [], checkpoints: [] };
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(url);
  await page.waitForSelector('#world[data-ready="true"]', { timeout: 30_000 });
  const mode = expected => page.waitForFunction(value => document.querySelector('#world')?.dataset.mode === value, expected, { timeout: 20_000 });
  const checkpoint = async name => {
    const state = await page.locator('#world').evaluate(canvas => ({ ...canvas.dataset }));
    await page.screenshot({ path: `${out}/${name}.png` });
    report.checkpoints.push({ name, state });
    console.log(`${name}: ${JSON.stringify(state)}`);
    return state;
  };
  await mode('on-foot');
  const spawn = await checkpoint('spawn');
  await page.keyboard.down('KeyW'); await page.waitForTimeout(200); await page.keyboard.up('KeyW');
  const walked = await checkpoint('walked');
  const distance = (a, b) => Math.hypot(Number(a.x) - Number(b.x), Number(a.z) - Number(b.z));
  assert.ok(distance(spawn, walked) > .15, 'Walking must move the real player pose');
  await page.keyboard.press('KeyE');
  await mode('driver');
  const boarded = await checkpoint('boarded');
  await page.keyboard.down('KeyW'); await page.waitForTimeout(900); await page.keyboard.up('KeyW');
  await page.keyboard.down('Space'); await page.waitForTimeout(500); await page.keyboard.up('Space');
  const driven = await checkpoint('driven');
  assert.ok(distance(boarded, driven) > .5, 'Throttle must advance the occupied car');
  await page.keyboard.press('KeyE');
  await mode('on-foot');
  await checkpoint('exited');
  await page.keyboard.press('KeyH');
  await mode('passenger');
  const taxi = await checkpoint('taxi-boarded');
  await page.waitForTimeout(1500);
  const riding = await checkpoint('taxi-riding');
  assert.ok(distance(taxi, riding) > 1, 'Taxi must drive itself without player throttle');
  assert.deepEqual(report.errors, [], 'Runtime and console errors fail the playable smoke');
  report.passed = true;
} catch (error) {
  report.failure = String(error);
  await page?.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
