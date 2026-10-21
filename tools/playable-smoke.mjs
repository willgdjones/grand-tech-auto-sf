/** One browser smoke for the local arrival, deep-link and share flow. Uses the running npm dev server. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const out = 'artifacts/playable';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const report = { checkedAt: new Date().toISOString(), base, errors: [], arrivals: [] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
async function arrive(path, name) {
  // The shared local dev server reloads under concurrent edits, which can abort an in-flight
  // navigation (net::ERR_ABORTED). Retry the goto a couple of times so the smoke measures the
  // game, not dev-server churn.
  const url = new URL(path, base).href;
  for (let attempt = 0; ; attempt++) {
    try { await page.goto(url, { waitUntil: 'load' }); break; }
    catch (error) { if (attempt >= 2) throw error; await page.waitForTimeout(600); }
  }
  await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 30_000 });
  await page.waitForFunction(() => +document.querySelector('#world').dataset.events > 0);
  const state = await page.evaluate(() => {
    const w = window.__gtasf.world;
    return { ...document.querySelector('#world').dataset, foot: { ...w.foot }, cameraSafe: w.camera.safe,
      ground: w.map.heightAt(w.foot.x, w.foot.z), collision: w.map.collides(w.foot.x, w.foot.y, w.foot.z, .35),
      loading: !document.querySelector('#loading').hidden, errors: window.__gtasf.errors };
  });
  assert.equal(state.mode, 'on-foot'); assert.equal(state.connected, 'true');
  assert.equal(state.cameraSafe, true); assert.equal(state.loading, false);
  assert.equal(state.collision, false); assert.notEqual(state.ground, null); assert.deepEqual(state.errors, []);
  report.arrivals.push({ name, state });
  await page.screenshot({ path: `${out}/${name}.png` });
  // A fresh browser gets the first-run funding onboarding modal, which showModal()-intercepts
  // input. Dismiss it the way a player does — Escape routes through the dialog's cancel handler
  // and hide(), which re-engages game-key sampling; a raw dialog.close() leaves input released so
  // later keys (e.g. M for the map) would be ignored. This smoke covers the arrival/share/deep-link
  // flow; onboarding has its own smoke.
  if (await page.evaluate(() => !!document.querySelector('dialog[open]'))) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 5_000 });
  }
  return state;
}
try {
  const ferry = await arrive('/', 'ferry');
  assert.ok(Math.hypot(+ferry.x - 1196.869, +ferry.z + 1224.309) < 1);
  await page.getByRole('button', { name: 'Share location · L', exact: true }).click();
  const buttonLink = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(new URL(buttonLink).searchParams.has('at'));
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), buttonLink);
  await arrive(buttonLink, 'shared-ferry');
  const linked = await arrive('/?at=37.801995202,-122.419630198,90', 'coordinate-lombard');
  assert.ok(Math.abs(linked.foot.yaw - Math.PI / 2) < .03, 'Compass heading survives the handshake');
  const named = await arrive('/go/lombard', 'named-lombard');
  assert.ok(Math.hypot(+named.x + 1041.863, +named.z + 1975.201) < 4);
  // 'map' is a held-key action sampled per frame (web/src/input/input.ts), so hold M briefly
  // rather than an instant press that can fall between frame samples.
  await page.keyboard.down('KeyM'); await page.waitForTimeout(120); await page.keyboard.up('KeyM');
  await page.waitForSelector('.gt-radar[data-expanded="true"]');
  const before = await page.locator('#world').evaluate(canvas => ({ ...canvas.dataset }));
  await page.keyboard.down('KeyW'); await page.waitForTimeout(250); await page.keyboard.up('KeyW');
  const after = await page.locator('#world').evaluate(canvas => ({ ...canvas.dataset }));
  assert.equal(after.x, before.x); assert.equal(after.z, before.z);
  await page.keyboard.press('Escape'); await page.waitForSelector('.gt-radar[data-expanded="false"]');
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log('TEST_PASSED:PlayableArrivalLinksShare');
} catch (error) { report.failure = String(error); throw error; }
finally { await writeFile(`${out}/arrival-report.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
