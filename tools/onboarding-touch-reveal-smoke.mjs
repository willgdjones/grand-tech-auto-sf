/** Actual touch controls + navigation HUD under the real progressive reveal CSS. Component check only. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const source = resolve('artifacts/onboarding-touch-reveal'), out = resolve('docs/perf/onboarding-touch-reveal');
await mkdir(source, { recursive: true }); await mkdir(out, { recursive: true });
const baselineCommit = 'e217607';
const before = execFileSync('git', ['show', `${baselineCommit}:web/src/onboarding/hudReveal.ts`], { encoding: 'utf8' });
const after = await readFile('web/src/onboarding/hudReveal.ts', 'utf8');
await writeFile(`${source}/before.ts`, before);
await writeFile(`${source}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>body{margin:0;background:#183448}canvas{position:fixed;inset:0;width:100%;height:100%}</style><canvas></canvas><script type="module" src="/entry.js"></script>');
await writeFile(`${source}/entry.js`, `
import {Group} from 'three';
import {TouchControls} from '${resolve('web/src/input/touch.ts')}';
import {createRouteGuidance} from '${resolve('web/src/navigation/guidance.ts')}';
import {applyHudReveal as before} from './before.ts';
import {applyHudReveal as after} from '${resolve('web/src/onboarding/hudReveal.ts')}';
import {freshOnboarding,panelsVisibleAt,setOnboardingStep,returningOnboarding,replayOnboarding,skipOnboarding} from '${resolve('shared/onboarding/state.ts')}';
const reveal=location.search.includes('before')?before:after;
const controls=new TouchControls(document.querySelector('canvas'),true);
const guidance=createRouteGuidance({scene:new Group(),surfaceHeightAt:()=>0,onArrive(){}});
if(!guidance)throw Error('Normal navigation switches must be enabled');
guidance.setDestination({title:'Lombard switchbacks',x:0,y:0,z:-150});
const route={points:[[0,0,0],[0,0,-150]],distanceM:150,approach:{x:0,y:0,z:-150},destinationDistanceM:0};
function stage(step,mode='on-foot'){
 const state=step==='returning'?returningOnboarding():step==='replay'?replayOnboarding(returningOnboarding()):step==='skip'?skipOnboarding(freshOnboarding()):setOnboardingStep(freshOnboarding(),step);
 reveal([...panelsVisibleAt(state)]);controls.setMode(mode);guidance.update({x:0,y:0,z:0},route,mode,false,performance.now()+1000);
}
window.fixture={stage,read:()=>controls.read(),destroy(){controls.dispose();guidance.destroy()}};
stage('walk');
`);
const config = { configFile: false, root: source, publicDir: false, logLevel: 'warn',
  resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${source}/app`, emptyOutDir: true, reportCompressedSize: false } };
await build(config); const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
const report = { at: new Date().toISOString(), scope: 'Real touch/navigation components and shared reveal state, isolated from whole-game acceptance',
  baselineCommit, beforeSha256: createHash('sha256').update(before).digest('hex'),
  afterSha256: createHash('sha256').update(after).digest('hex'), cases: [], errors: [], passed: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) report.errors.push(`HTTP ${r.status()} ${r.url()}`); });
  const map = page.locator('[data-action="map"]'), hail = page.locator('[data-action="hail"]'), gps = page.locator('.gt-gps-status');
  await page.goto(`${server.resolvedUrls.local[0]}?before`); await page.waitForFunction(() => Boolean(window.fixture));
  assert(await map.isVisible() && await hail.isVisible() && await gps.isVisible(), 'Pinned baseline reproduces early navigation controls');
  await page.screenshot({ path: `${out}/before-walk.png` });
  await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => Boolean(window.fixture));
  for (const step of ['intro', 'walk', 'drive_ring', 'identity', 'gps', 'taxi', 'done', 'returning', 'skip', 'replay']) {
    for (const mode of ['on-foot', 'driver', 'passenger']) {
      await page.evaluate(({ step, mode }) => window.fixture.stage(step, mode), { step, mode });
      const unlocked = ['gps', 'taxi', 'done', 'returning', 'skip'].includes(step);
      const result = { step, mode, map: await map.isVisible(), hail: await hail.isVisible(), gps: await gps.isVisible() };
      report.cases.push(result);
      assert.equal(result.map, unlocked); assert.equal(result.hail, unlocked && mode !== 'passenger'); assert.equal(result.gps, unlocked);
      assert(await page.locator('[data-action="enter-exit"]').isVisible(), 'Entering/exiting remains available');
      if (mode === 'driver') assert(await page.locator('[data-action="throttle"]').isVisible(), 'Orientation driving remains available');
      if (mode === 'on-foot' && ['walk', 'gps', 'replay'].includes(step)) await page.screenshot({ path: `${out}/${step}.png` });
    }
  }
  await page.evaluate(() => window.fixture.stage('gps'));
  await map.tap(); assert((await page.evaluate(() => window.fixture.read())).pressed.includes('map'), 'Revealed Map accepts real touch');
  await hail.tap(); assert((await page.evaluate(() => window.fixture.read())).pressed.includes('hail'), 'Revealed Hail accepts real touch');
  await page.evaluate(() => window.fixture.destroy());
  assert.equal(await page.locator('.gtasf-touch, .gt-gps-status').count(), 0);
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log('ONBOARDING_TOUCH_REVEAL:PASS 30 step/mode cases; GPS touch actions restored');
} catch (error) { report.failure = String(error); throw error; }
finally {
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
