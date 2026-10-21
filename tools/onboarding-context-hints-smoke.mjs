/** Real onboarding flow + DOM adapter, with an isolated saved profile and context inputs. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const source = resolve('artifacts/onboarding-context-hints');
const out = resolve('docs/perf/onboarding-context-hints');
await mkdir(source, { recursive: true }); await mkdir(out, { recursive: true });
await writeFile(`${source}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Contextual onboarding hints</title><style>body{margin:0;background:#183448}canvas{position:fixed;inset:0;width:100%;height:100%}</style><canvas></canvas><script type="module" src="/entry.js"></script>');
await writeFile(`${source}/entry.js`, `
import '${resolve('web/src/theme/saTheme.css')}';
import {setupOnboarding} from '${resolve('web/src/onboarding/integrate.ts')}';
import {returningOnboarding} from '${resolve('shared/onboarding/state.ts')}';
import {TouchControls} from '${resolve('web/src/input/touch.ts')}';
const query=new URLSearchParams(location.search),isTouch=query.has('touch');
const controls=new TouchControls(document.querySelector('canvas'),isTouch);
const saved=returningOnboarding(query.has('labels')?[]:['touchControls']), writes=[];
const fetcher=async(_url,init)=>{
 if(init?.method==='POST'){
  const body=JSON.parse(init.body);if(Object.keys(body).join(',')!=='state')throw Error('Wrong save envelope');
  const state=JSON.parse(body.state);writes.push(state);return Response.json({state});
 }
 return Response.json({state:saved});
};
const flow=await setupOnboarding({isTouch,fetcher,revealPanels(){},requestIdentity(){}});
if(!flow)throw Error('The normal onboarding and HUD switches must be enabled');
const base={nearCar:false,nearAngel:false,nearPlayer:false,firstDrop:false,firstRumour:false,
 firstRound:false,firstFriendRequest:false,idleMs:0,isTouch};
window.fixture={tick:ctx=>flow.tickHints({...base,...ctx}),replay:()=>flow.replay(),
 mode:value=>controls.setMode(value),
 get state(){return flow.state},get writes(){return writes}};
`);
const config = { configFile: false, root: source, publicDir: false, logLevel: 'warn',
  resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${source}/app`, emptyOutDir: true, reportCompressedSize: false } };
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
const report = { at: new Date().toISOString(), scope: 'Actual flow/API adapter/hint DOM; isolated saved profile and context, no whole-game or device gate', errors: [], cases: [], passed: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const isTouch of [true, false]) {
    const name = isTouch ? 'phone' : 'desktop';
    const context = await browser.newContext({ viewport: isTouch ? { width: 390, height: 844 } : { width: 1365, height: 900 },
      isMobile: isTouch, hasTouch: isTouch });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) report.errors.push(`HTTP ${r.status()} ${r.url()}`); });
    // Replay uses the actual shipped poster, without copying the whole public payload.
    await page.route('**/art/loading/*.webp', async route => {
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({ contentType: 'image/webp', body: await readFile(resolve(`web/public${path}`)) });
    });
    await page.goto(`${server.resolvedUrls.local[0]}${isTouch ? '?touch' : ''}`);
    await page.waitForFunction(() => Boolean(window.fixture));
    const tick = ctx => page.evaluate(ctx => window.fixture.tick(ctx), ctx);
    const writes = () => page.evaluate(() => window.fixture.writes.length);
    const prompt = page.locator('.gt-sa-hint--prompt');
    const result = { name, prompts: [] };
    for (const [signal, touchText, desktopText, key] of [
      ['nearCar', 'Tap Enter / exit to get in the car.', 'to get in the car', 'E'],
      ['nearAngel', 'Tap Enter / exit to pitch this angel.', 'to pitch this angel', 'E'],
      ['nearPlayer', 'Tap Chat to say hello.', 'to chat', 'T'],
    ]) {
      const before = await writes();
      await tick({ [signal]: true }); await prompt.waitFor({ state: 'visible' });
      assert.equal(await prompt.locator('.gt-sa-hint__text').textContent(), isTouch ? touchText : desktopText);
      assert.equal(await prompt.locator('.gt-sa-hint__key').isVisible(), !isTouch);
      if (!isTouch) assert.equal(await prompt.locator('.gt-sa-hint__key').textContent(), key);
      const box = await prompt.boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width, `${name} prompt fits`);
      if (signal === 'nearCar') await page.screenshot({ path: `${out}/${name}-near-car.png` });
      assert.equal(await writes(), before + 1, 'Only showing a new hint persists');
      await tick({}); await prompt.waitFor({ state: 'detached' });
      assert.equal(await writes(), before + 1, 'Losing context does not write profile');
      await tick({ [signal]: true }); assert.equal(await prompt.count(), 0, 'A shown hint does not repeat');
      assert.equal(await writes(), before + 1);
      result.prompts.push({ signal, copy: isTouch ? touchText : desktopText, cleared: true, repeated: false });
    }
    const nudge = page.locator('.gt-sa-hint--nudge');
    await tick({ idleMs: 30000, nearestEventM: 420 }); await nudge.waitFor({ state: 'visible' });
    assert.equal(await nudge.locator('.gt-sa-hint__text').textContent(), `Nearest event 400 m → ${isTouch ? 'tap Map' : 'press M'}`);
    await tick({}); await nudge.waitFor({ state: 'detached' });
    await tick({ firstDrop: true }); await nudge.waitFor({ state: 'visible' });
    await page.evaluate(() => window.fixture.replay());
    await page.locator('.gt-sa-hint').waitFor({ state: 'detached' });
    await page.locator('.gt-sa-intro').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.fixture.state.hints.includes('enterCar')), true, 'Replay preserves one-time hint history');
    result.idleCleared = result.replayCleared = true;
    report.cases.push(result); await context.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.goto(`${server.resolvedUrls.local[0]}?touch&labels`);
  await page.waitForFunction(() => Boolean(window.fixture));
  await page.evaluate(() => window.fixture.tick({}));
  const label = page.locator('.gt-sa-hint--touch'); await label.waitFor({ state: 'visible' });
  const placement = [];
  const labelCase = { name: 'touch-label', placement, clearedOnDriving: false };
  report.cases.push(labelCase);
  for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
    await page.setViewportSize({ width, height }); await page.evaluate(() => window.fixture.tick({}));
    const box = await label.boundingBox(), stick = await page.locator('.gtasf-touch .stick').boundingBox();
    placement.push({ width, height, label: box, stick });
    await page.screenshot({ path: `${out}/touch-label-${width}.png` });
    assert(box && stick && box.x >= 12 && box.x + box.width <= width - 12 && box.y >= 12, `Touch label fits: ${JSON.stringify(placement.at(-1))}`);
    assert(box.y + box.height <= stick.y - 7, 'Touch label stays above its actual stick');
  }
  const steadyLayoutReads = await page.evaluate(() => {
    const elements = [document.querySelector('.gt-sa-hint--touch'), document.querySelector('.gtasf-touch .stick')];
    const originals = elements.map(el => el.getBoundingClientRect); let reads = 0;
    elements.forEach((el, i) => { el.getBoundingClientRect = function () { reads++; return originals[i].call(this); }; });
    try { for (let i = 0; i < 60; i++) window.fixture.tick({}); }
    finally { elements.forEach((el, i) => { el.getBoundingClientRect = originals[i]; }); }
    return reads;
  });
  assert.equal(steadyLayoutReads, 0, 'Steady context ticks do not measure control layout');
  const beforeMode = await page.evaluate(() => window.fixture.writes.length);
  await page.evaluate(() => { window.fixture.mode('driver'); window.fixture.tick({}); });
  await label.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.fixture.writes.length), beforeMode);
  labelCase.steadyLayoutReads = steadyLayoutReads; labelCase.clearedOnDriving = true;
  await page.close();
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log('ONBOARDING_CONTEXT_HINTS:PASS phone/desktop context loss, copy, once-only writes, activity and Replay');
} catch (error) { report.failure = String(error); throw error; }
finally {
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
