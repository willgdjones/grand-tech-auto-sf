/** One shared GPU session: canonical local API/UI, phone street HUD, isolated crown fixture. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import { checkOutbidCrown } from './outbid-crown-smoke.mjs';

const out = 'artifacts/outbid', configFile = resolve('web/vite.config.ts'), app = resolve(out, 'app');
const phoneOnly = process.argv.includes('--phone-only');
await mkdir(out, { recursive: true });
await build({ configFile, root: resolve('web'), logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
const server = await preview({ configFile, root: resolve('web'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
let page = await browser.newPage(phoneOnly ? mobile : { viewport: { width: 1365, height: 900 } });
const report = { at: new Date().toISOString(), errors: [], fixtureOnly: false, scope: phoneOnly ? 'phone-fix-and-crown-retry' : 'full' };
function recordErrors() {
  page.setDefaultTimeout(45_000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
}
recordErrors();
async function frames(count) {
  const start = await page.evaluate(() => window.__gtasf.frame);
  await page.waitForFunction(frame => window.__gtasf.frame >= frame, start + count);
}
try {
  await page.goto(base);
  await page.waitForFunction(() => window.__gtasf?.ready);
  assert.equal(await page.locator('#connection').innerText(), 'Connected');
  report.admission = await (await page.request.get(`${base}api/admission`)).json();
  if (phoneOnly) assert.equal(report.admission.enabled, true, 'Focused integration check includes enabled capacity');
  await page.waitForFunction(() => document.querySelector('.gt-outbid-name')?.textContent === 'The crown is open');
  const canonical = await (await page.request.get(`${base}api/outbid`)).json();
  assert.equal(canonical.snapshot.mode, 'test'); assert.equal(canonical.snapshot.checkoutAvailable, false);
  assert.deepEqual(canonical.snapshot.entries, []); report.canonical = canonical.snapshot;
  report.street = await page.locator('.gt-street-hud').innerText(); assert.match(report.street, /The Embarcadero/);
  report.gpu = await page.evaluate(() => { const gl = document.querySelector('#world').getContext('webgl2'), d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
  assert.equal(await page.locator('.gt-creator--hud').getAttribute('href'), 'https://x.com/willgdjones');
  if (!phoneOnly) {
  await page.screenshot({ path: `${out}/canonical-desktop.png` });
  await page.getByRole('button', { name: 'OUTBID THEM', exact: true }).click();
  assert.equal(await page.locator('.gt-outbid-submit').isDisabled(), true);
  const before = await page.evaluate(() => ({ ...window.__gtasf.world.foot }));
  await page.keyboard.down('KeyW'); await frames(5); await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => ({ ...window.__gtasf.world.foot }));
  assert.equal(after.x, before.x); assert.equal(after.z, before.z);
  await page.keyboard.press('Escape'); await page.locator('.gt-outbid-dialog').waitFor({ state: 'hidden' });
  await page.close();
  page = await browser.newPage(mobile); recordErrors();
  await page.goto(base); await page.waitForFunction(() => window.__gtasf?.ready);
  await page.waitForFunction(() => document.querySelector('.gt-outbid-name')?.textContent === 'The crown is open');
  }
  await frames(3);
  report.phone = await page.evaluate(() => {
    const bounds = node => { const r = node.getBoundingClientRect(); return { left:r.left,right:r.right,top:r.top,bottom:r.bottom }; };
    const rect = selector => bounds(document.querySelector(selector));
    return { banner:rect('.gt-outbid-banner'),street:rect('.gt-street-hud'),hud:rect('.gt-hud'),creator:rect('.gt-creator--hud'),
      eyebrow:rect('#app>header .eyebrow'),title:rect('#app>header h1'),events:rect('.gt-upcoming-open'),
      quick:[...document.querySelectorAll('#play-controls button')].map(bounds),touch:[...document.querySelectorAll('.gtasf-touch.on button')].map(bounds),
      overflow:document.documentElement.scrollWidth>innerWidth };
  });
  assert.equal(report.phone.overflow, false);
  for (const box of [report.phone.banner, report.phone.street, report.phone.hud, report.phone.creator]) assert(box.left >= 0 && box.right <= 390 && box.top >= 0 && box.bottom <= 844);
  const overlaps = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  for (const box of [report.phone.eyebrow, report.phone.title, ...report.phone.quick]) assert(!overlaps(report.phone.street,box), 'Street label overlaps header or quick actions');
  assert.equal(report.phone.touch.length, 7, 'Touch controls must actually be visible');
  for (const box of report.phone.touch) { assert(!overlaps(report.phone.events,box), 'Events overlaps touch controls'); assert(!overlaps(report.phone.creator,box), 'Creator link overlaps touch controls'); }
  await page.screenshot({ path: `${out}/canonical-phone.png` });
  await page.getByRole('button', { name: 'Top 50', exact: true }).click();
  await page.screenshot({ path: `${out}/canonical-phone-modal.png` });
  await page.getByRole('button', { name: 'Close Outbid', exact: true }).tap();

  if (!phoneOnly) {
  // A render-only fixture in this page; never sends a bid or modifies the backend.
  const fixture = { ...canonical.snapshot, revision: canonical.snapshot.revision + 10, entries: Array.from({ length: 50 }, (_, i) => ({ bidderId:`fixture-${i}`,rank:i+1,name:i===0?'SF Builders — UI fixture':`Example team ${i+1}`,message:'Build something useful for San Francisco.',url:'https://example.com/',totalCents:String(50000-i*100) })) };
  assert.equal(await page.evaluate(s => window.__gtasf.world.outbid.setSnapshot(s), fixture), true);
  assert.equal(await page.locator('.gt-outbid-row').count(), 50);
  assert.equal(await page.locator('.gt-outbid-target').innerText(), 'To lead: $500.01');
  assert.equal(await page.evaluate(s => window.__gtasf.world.outbid.setSnapshot(s), canonical.snapshot), false);
  await page.getByRole('button', { name: 'OUTBID THEM', exact: true }).click();
  await page.screenshot({ path: `${out}/fixture-phone-form.png` });
  assert.equal(await page.locator('.gt-outbid-submit').isDisabled(), true);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.getByRole('button', { name: 'Top 50', exact: true }).click();
  await page.locator('.gt-outbid-dialog').evaluate(dialog => dialog.scrollTop = 0);
  await page.screenshot({ path: `${out}/fixture-leaderboard.png` });
  assert.deepEqual(report.errors, []); report.fixtureRender = { rows: 50, paidEvidence: false };
  }
  assert.deepEqual(report.errors, []);
  await page.close(); // Release the real city's GPU resources before the isolated crown.
  report.crown = await checkOutbidCrown(browser, { skipBuild: phoneOnly });
  report.passed = true; console.log('TEST_PASSED:OutbidUIStreetAndCrown');
} catch (error) { report.failure = String(error); throw error; }
finally {
  await writeFile(`${out}/${phoneOnly ? 'phone-evidence' : 'evidence'}.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
}
