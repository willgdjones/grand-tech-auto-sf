/** Native media component proof, paired with the recorded actual-game integration check. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { nativeMediaBrowser } from './native-media-browser.mjs';

const out = resolve(process.env.GTASF_RADIO_MEDIA_OUT ?? 'artifacts/radio/media'); await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), scope: 'Real radio/HUD modules and native media in an explicit isolated fixture; actual game integration separately recorded by founder-path/2026-10-03T0934', errors: [], requests: [], stations: [], passed: false };
await build({ stdin: { contents: `
import {createRadio} from './web/src/audio/radio';
import {createPlayableHud} from './web/src/hud/playableHud';
const hud=createPlayableHud();let radio;
function update(){const s=radio?.state;if(s)hud.update({radioStation:s.station,radioPlaying:s.playing,radioMuted:s.muted||s.volume===0,radioTicker:s.ticker});}
radio=createRadio({parent:document.querySelector('#controls'),onChange:update});update();
document.querySelector('#dispose').addEventListener('click',()=>radio.destroy());
addEventListener('pagehide',()=>{radio.destroy();hud.destroy();},{once:true});
`, resolveDir: process.cwd(), loader: 'ts', sourcefile: 'radio-media-fixture.ts' }, outfile: `${out}/app.js`, bundle: true, format: 'esm', target: 'es2022', logLevel: 'error' });
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GTASF radio native media check</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><style>body{margin:24px;background:#10241e;color:#f6e9c9;font-family:Arial,sans-serif}main{max-width:440px}h1{font-size:18px}button{padding:10px;background:#28483d;color:#fff;border:1px solid #879f90;border-radius:4px}#dispose{margin-top:20px}@media(max-width:700px){main{padding-top:235px}}</style><main><h1>Native radio component check</h1><p>Actual game integration is recorded separately.</p><div id="controls"></div><button id="dispose" type="button">Dispose radio</button></main><script type="module" src="/app.js"></script></html>`;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://fixture.local').pathname;
    if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }).end(html); return; }
    const station = /^\/audio\/radio\/(kvc-radio|lofi-hayes-valley|bart-delays-fm)\.mp3$/.exec(path);
    const file = station ? resolve('web/public', path.slice(1)) : /^\/app\.(js|css)$/.test(path) ? resolve(out, path.slice(1)) : null;
    if (!file) { res.writeHead(404).end(); return; }
    const body = await readFile(file); res.writeHead(200, { 'Content-Type': station ? 'audio/mpeg' : path.endsWith('.css') ? 'text/css' : 'text/javascript', 'Content-Length': body.length }).end(body);
  } catch { res.writeHead(500).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done)); const base = `http://127.0.0.1:${server.address().port}`;
let native, page;
try {
  native = await nativeMediaBrowser(); const { context } = native;
  await context.addInitScript(() => {
    window.__radioMedia = [];
    window.Audio = new Proxy(window.Audio, { construct(target, args) { const value = new target(...args); window.__radioMedia.push(value); return value; } });
  });
  page = native.page; await page.setViewportSize({ width: 1365, height: 900 }); page.setDefaultTimeout(20_000);
  page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/audio/radio/')) report.requests.push(new URL(request.url()).pathname); });
  const media = () => page.evaluate(() => { const a = window.__radioMedia[0]; return { time: a.currentTime, duration: a.duration, paused: a.paused, muted: a.muted, volume: a.volume, loop: a.loop, src: a.getAttribute('src') }; });
  await page.goto(base); await page.locator('.gt-radio-controls').waitFor(); assert.equal(report.requests.length, 0);
  for (const station of ['kvc-radio', 'lofi-hayes-valley', 'bart-delays-fm']) {
    await page.getByLabel('Radio station', { exact: true }).selectOption(station);
    if (await page.getByRole('button', { name: 'Play radio', exact: true }).isVisible()) await page.getByRole('button', { name: 'Play radio', exact: true }).click();
    await page.waitForFunction(id => window.__radioMedia.some(a => a.src.endsWith(`${id}.mp3`) && !a.paused && a.currentTime > .15 && a.readyState >= 3), station);
    const current = await media(); assert.ok(current.loop && current.duration > 10 && current.duration < 30); report.stations.push({ station, ...current });
    const name = await page.getByLabel('Radio station', { exact: true }).locator('option:checked').innerText();
    assert.equal(await page.locator('.gt-hud-radio').innerText(), name); assert.ok((await page.locator('.gt-hud-radio-ticker').innerText()).length > 20);
  }
  const line = await page.locator('.gt-radio-dj').innerText(); await page.waitForFunction(previous => document.querySelector('.gt-radio-dj').textContent !== previous, line); report.realTimeTicker = true;
  const beforeLoop = (await media()).time;
  await page.waitForFunction(before => { const a = window.__radioMedia[0]; return !a.paused && a.currentTime < before; }, beforeLoop); report.realLoopWrap = true;
  const volume = page.getByLabel('Radio volume', { exact: true }); await volume.focus(); await volume.press('Home');
  for (let i = 0; i < 27; i++) await volume.press('ArrowRight'); assert.equal((await media()).volume, .27);
  await page.getByRole('button', { name: 'Mute', exact: true }).click(); assert.equal((await media()).muted, true); assert.match(await page.locator('.gt-hud-radio').innerText(), /MUTED/);
  await page.getByRole('button', { name: 'Unmute', exact: true }).click(); assert.equal((await media()).muted, false);
  await page.screenshot({ path: `${out}/desktop.png` }); await page.setViewportSize({ width: 390, height: 844 });
  for (const selector of ['.gt-radio-controls', '.gt-hud-radio-ticker']) assert.equal(await page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; }), true);
  await page.screenshot({ path: `${out}/phone.png`, fullPage: true });
  const cover = await context.newPage(); await cover.goto('about:blank'); await cover.bringToFront();
  // A hidden document stops animation frames; observe native visibility with timer polling.
  await page.waitForFunction(() => document.hidden && window.__radioMedia.every(a => a.paused), undefined, { polling: 100 }); report.hiddenPause = true;
  await page.bringToFront(); await page.waitForFunction(() => !document.hidden && window.__radioMedia.some(a => !a.paused)); await cover.close(); report.returnResumes = true;
  await page.getByRole('button', { name: 'Pause radio', exact: true }).click(); assert.equal((await media()).paused, true);
  const count = report.requests.length; await page.reload(); await page.locator('.gt-radio-controls').waitFor();
  assert.equal(await page.getByLabel('Radio station', { exact: true }).inputValue(), 'bart-delays-fm'); assert.equal(await volume.inputValue(), '27');
  assert.equal(report.requests.length, count); assert.equal((await media()).src, null); assert.equal((await media()).paused, true); report.rememberedWithoutAutoplay = true;
  await page.getByRole('button', { name: 'Play radio', exact: true }).click(); await page.waitForFunction(() => window.__radioMedia[0].currentTime > .1);
  await page.getByRole('button', { name: 'Dispose radio', exact: true }).click(); assert.equal(await page.locator('.gt-radio-controls').count(), 0); assert.equal((await media()).paused, true); assert.equal((await media()).src, null); report.disposal = true;
  assert.deepEqual(report.errors, []); report.passed = true; console.log('TEST_PASSED:RadioNativeMedia');
} catch (error) {
  report.failure = String(error);
  report.nativeVisibility = await page?.evaluate(() => ({ hidden: document.hidden, state: document.visibilityState, focused: document.hasFocus(), audio: window.__radioMedia?.map(a => ({ paused: a.paused, time: a.currentTime })) })).catch(() => null);
  await page?.screenshot({ path: `${out}/failed.png` }).catch(() => {}); throw error;
} finally {
  await native?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  report.finishedAt = new Date().toISOString(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
