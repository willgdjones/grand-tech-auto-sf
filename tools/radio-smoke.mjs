/** Real local game and native media. No autoplay bypass, media/visibility or clock stubs. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { nativeMediaBrowser } from './native-media-browser.mjs';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173', out = process.env.GTASF_RADIO_OUT ?? 'artifacts/radio/game';
await mkdir(out, { recursive: true });
const report = { at: new Date().toISOString(), scope: 'Actual local game and native media controls; not an auditory/device gate', errors: [], requests: [], stations: [], passed: false };
const native = await nativeMediaBrowser({ gpu: true }), { context, page } = native;
await page.setViewportSize({ width: 1365, height: 900 });
await context.addInitScript(() => {
  window.__radioMedia = [];
  window.Audio = new Proxy(window.Audio, { construct(target, args) { const audio = new target(...args); window.__radioMedia.push(audio); return audio; } });
});
page.setDefaultTimeout(45_000);
page.on('pageerror', error => report.errors.push(error.message)); page.on('console', msg => { if (msg.type() === 'error') report.errors.push(msg.text()); });
page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/audio/radio/')) report.requests.push(new URL(request.url()).pathname); });
const media = () => page.evaluate(() => { const a = window.__radioMedia.find(a => a.src.includes('/audio/radio/')); return a ? { src: a.src, time: a.currentTime, duration: a.duration, paused: a.paused, muted: a.muted, volume: a.volume, loop: a.loop, ready: a.readyState } : null; });
async function options() { await page.getByRole('button', { name: 'Game options', exact: true }).click(); await page.locator('.gt-radio-controls').waitFor(); }
try {
  await page.goto(base); await page.waitForSelector('#world[data-ready="true"][data-connected="true"]'); await page.waitForSelector('#loading', { state: 'hidden' });
  const identity = page.locator('.gt-funding-onboarding[open]'); await identity.waitFor();
  await page.getByLabel('Startup name', { exact: true }).fill(`Radio ${Date.now().toString(36)}`); await page.getByLabel('Your nickname', { exact: true }).fill('Radio Listener');
  await identity.getByRole('button', { name: 'Save startup', exact: true }).click(); await identity.waitFor({ state: 'hidden' });
  await options(); assert.equal(report.requests.length, 0, 'No audio request before Play');
  for (const station of ['kvc-radio', 'lofi-hayes-valley', 'bart-delays-fm']) {
    await page.getByLabel('Radio station', { exact: true }).selectOption(station);
    if (await page.getByRole('button', { name: 'Play radio', exact: true }).isVisible()) await page.getByRole('button', { name: 'Play radio', exact: true }).click();
    await page.waitForFunction(id => window.__radioMedia.some(a => a.src.endsWith(`${id}.mp3`) && !a.paused && a.currentTime > .12 && a.readyState >= 3), station);
    const current = await media(); assert.ok(current.duration > 10 && current.duration < 30 && current.loop); report.stations.push(current);
    assert.ok((await page.locator('.gt-radio-dj').innerText()).length > 20);
    const selectedName = await page.getByLabel('Radio station', { exact: true }).locator('option:checked').innerText();
    await page.waitForFunction(name => document.querySelector('.gt-hud-radio')?.textContent === name, selectedName);
    assert.ok((await page.locator('.gt-hud-radio-ticker').innerText()).length > 20);
  }
  const volume = page.getByLabel('Radio volume', { exact: true }); await volume.focus(); await volume.press('Home');
  for (let i = 0; i < 27; i++) await volume.press('ArrowRight'); assert.equal((await media()).volume, .27);
  await page.getByRole('button', { name: 'Mute', exact: true }).click(); assert.equal((await media()).muted, true);
  await page.getByRole('button', { name: 'Unmute', exact: true }).click(); assert.equal((await media()).muted, false);
  await page.screenshot({ path: `${out}/desktop-controls.png` });
  await page.keyboard.press('Escape'); await page.screenshot({ path: `${out}/desktop-ticker.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.gt-hud-radio-ticker').evaluate(el => { const r = el.getBoundingClientRect(); return !el.hidden && r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), true, 'Playing phone ticker stays on screen');
  await page.screenshot({ path: `${out}/phone-ticker.png` }); await page.setViewportSize({ width: 1365, height: 900 });
  const cover = await context.newPage(); await cover.goto('about:blank'); await cover.bringToFront();
  await page.waitForFunction(() => document.hidden && window.__radioMedia.every(a => a.paused), undefined, { polling: 100 }); report.hiddenPause = true;
  await page.bringToFront(); await page.waitForFunction(() => !document.hidden && window.__radioMedia.some(a => !a.paused)); await cover.close();
  await options(); await page.getByRole('button', { name: 'Pause radio', exact: true }).click(); assert.equal((await media()).paused, true);
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${out}/phone-controls.png` });
  assert.equal(await page.locator('.gt-radio-controls').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth; }), true);
  const requestCount = report.requests.length; await page.reload(); await page.waitForSelector('#world[data-ready="true"][data-connected="true"]'); await page.waitForSelector('#loading', { state: 'hidden' }); await options();
  assert.equal(await page.getByLabel('Radio station', { exact: true }).inputValue(), 'bart-delays-fm'); assert.equal(await page.getByLabel('Radio volume', { exact: true }).inputValue(), '27');
  assert.equal(report.requests.length, requestCount, 'Reload never requests or autoplays remembered radio');
  assert.deepEqual(report.errors, []); report.passed = true; console.log('TEST_PASSED:RadioGame');
} catch (error) { report.failure = String(error); await page.screenshot({ path: `${out}/failed.png` }).catch(() => {}); throw error;
} finally { await native.close(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
