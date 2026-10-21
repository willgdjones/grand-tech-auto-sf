/** Native touch journey and desktop fallback. Run through tools/heavy.sh; no game-state writes. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { startLocalPool } from './local-pool/pool.mjs';

const out = resolve(process.env.GTASF_PHONE_UX_OUT ?? 'docs/perf/phone-ux-d6-2026-10-04');
const app = resolve(process.env.GTASF_PHONE_APP ?? 'artifacts/phone-ux-d6/app');
await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), errors: [], httpErrors: [], friendsRequests: [], firstVisits: [], steps: [], passed: false };
let browser, server, pool, page, cdp;
const save = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
const touch = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type,
  touchPoints: points.map((p, i) => ({ ...p, id: p.id ?? i + 1, radiusX: 5, radiusY: 5, force: 1 })) });
async function centre(locator) { const b = await locator.boundingBox(); assert(b, 'Visible touch control'); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
const button = action => page.locator(`.gtasf-touch [data-action="${action}"]`);
const state = () => page.evaluate(() => {
  const h = window.__gtasf, w = h.world, c = document.querySelector('#world');
  const car = w.fleet.nearest(w.foot, 120);
  return { foot: { ...w.foot }, mode: w.mode, frame: h.frame, yaw: w.camera.yaw,
    speed: Number(c.dataset.speed), connected: c.dataset.connected, taxi: w.taxi.state,
    nearest: car ? { id: car.data.id, x: car.model.root.position.x, z: car.model.root.position.z } : null,
    input: { source: h.input.source, throttle: h.input.throttle, steer: h.input.steer, move: { ...h.input.move } },
    mapErrors: [...w.map.stats.errors] };
});
const overlap = (a, b) => a && b && Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1
  && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
async function layout() {
  return page.evaluate(() => {
    const selectors = ['.gt-outbid-banner', '.gt-drop-banner', '.gt-sa-hint--nudge', '.gt-chat-ambient-hint', '#app>aside', '#movement-mode', '.gt-hud', '.gt-upcoming-open',
      '.gt-street-hud', '.gt-radar', '.gt-gps-status', '.gtasf-touch .stick', '.gtasf-touch .buttons'];
    const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const visible = e => e.checkVisibility({ visibilityProperty: true }) && e.getBoundingClientRect().width > 0;
    return { width: innerWidth, height: innerHeight,
      boxes: selectors.flatMap(selector => { const e = document.querySelector(selector); return e && visible(e) ? [{ selector, ...box(e) }] : []; }),
      actions: [...document.querySelectorAll('.gtasf-touch button, #play-controls button')].filter(visible).map(e => {
        const b = box(e); return { label: e.textContent, ...b, hit: e.contains(document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2)) };
      }) };
  });
}
async function check(name, action) {
  const step = { name, passed: false }; report.steps.push(step);
  try { step.detail = await action(); step.passed = true; }
  catch (error) { step.failure = String(error); console.error(`PHONE_UX:${name} ${error}`); }
  step.state = await state().catch(() => null);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 10_000 }).catch(() => {});
  await save(); return step.passed;
}
async function boot(url, touchMode = false) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#world[data-ready="true"][data-connected="true"]', { timeout: 90_000 });
  await page.locator('#loading').waitFor({ state: 'hidden' });
  const firstVisit = { kind: touchMode ? 'phone' : 'desktop', introShown: false, identitySaved: false };
  report.firstVisits.push(firstVisit);
  const intro = page.locator('.gt-sa-intro');
  if (await page.getByRole('button', { name: 'Replay tutorial', exact: true, includeHidden: true }).count()) {
    // Observe this hidden options control only as the compiled feature signal. Never Replay.
    await intro.waitFor({ state: 'visible' }); firstVisit.introShown = true;
    await page.screenshot({ path: `${out}/${firstVisit.kind}-intro.png`, scale: 'css' });
    const skip = intro.getByRole('button', { name: 'Skip', exact: true });
    if (touchMode) await skip.tap(); else await skip.click();
    await intro.waitFor({ state: 'hidden' });
    const identity = page.getByRole('dialog', { name: 'Create your founder', exact: true });
    await identity.waitFor({ state: 'visible' });
    await page.screenshot({ path: `${out}/${firstVisit.kind}-identity.png`, scale: 'css' });
    const accept = identity.getByRole('button', { name: 'Looks good', exact: true });
    if (touchMode) await accept.tap(); else await accept.click();
    await identity.waitFor({ state: 'hidden' }); firstVisit.identitySaved = true;
  }
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Gameplay unobscured');
  await save();
}
try {
  let base = process.env.GTASF_TEST_URL;
  if (!base) {
    if (!process.env.GTASF_PHONE_APP) await build({ root: resolve('web'), configFile: resolve('web/vite.config.ts'),
      logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
    pool = await startLocalPool();
    server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: app },
      preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: pool.url.origin, ws: true } } } });
    base = server.resolvedUrls.local[0];
  }
  report.app = process.env.GTASF_TEST_URL ?? app;
  browser = await chromium.launch({ headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page = await context.newPage(); page.setDefaultTimeout(15_000); cdp = await context.newCDPSession(page);
  const listen = p => {
    p.on('pageerror', e => report.errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
    p.on('request', r => { const path = new URL(r.url()).pathname; if (path.startsWith('/api/friends/')) report.friendsRequests.push(path); });
    p.on('response', r => { if (r.status() >= 400) report.httpErrors.push({ url: r.url(), status: r.status() }); });
  };
  listen(page); await boot(new URL('/?preset=low', base).href, true);
  await check('phone-ferry-layout', async () => {
    const l = await layout();
    for (const b of l.boxes) assert(b.left >= -1 && b.right <= l.width + 1 && b.top >= -1 && b.bottom <= l.height + 1, `${b.selector} fits`);
    for (let i = 0; i < l.boxes.length; i++) for (let j = i + 1; j < l.boxes.length; j++)
      assert(!overlap(l.boxes[i], l.boxes[j]), `${l.boxes[i].selector} overlaps ${l.boxes[j].selector}`);
    for (const a of l.actions) assert(a.hit, `${a.label} receives taps`);
    return l;
  });
  await check('touch-walk-release', async () => {
    const before = await state(), stick = await centre(page.locator('.gtasf-touch .stick'));
    await touch('touchStart', [{ x: stick.x + 28, y: stick.y }]);
    try { await page.waitForFunction(p => Math.hypot(window.__gtasf.world.foot.x - p.x, window.__gtasf.world.foot.z - p.z) > .5, before.foot);
      assert.equal((await state()).input.source, 'touch');
    } finally { await touch('touchCancel'); }
    await page.waitForFunction(() => window.__gtasf.input.move.x === 0 && window.__gtasf.input.move.y === 0);
    return { before: before.foot, after: (await state()).foot };
  });
  const entered = await check('touch-walk-to-car-enter', async () => {
    let s = await state(); const car = s.nearest; assert(car, 'A parked car is reachable from Ferry spawn');
    const start = Date.now(), stick = await centre(page.locator('.gtasf-touch .stick'));
    while (Math.hypot(s.foot.x - car.x, s.foot.z - car.z) > 4.8 && Date.now() - start < 35_000) {
      const dx = car.x - s.foot.x, dz = car.z - s.foot.z, d = Math.hypot(dx, dz);
      const x = (dx * Math.cos(s.yaw) - dz * Math.sin(s.yaw)) / d;
      const z = (dx * Math.sin(s.yaw) + dz * Math.cos(s.yaw)) / d;
      await touch('touchStart', [{ x: stick.x + x * 50, y: stick.y + z * 50 }]);
      await page.waitForTimeout(350); await touch('touchCancel');
      await page.waitForTimeout(50); s = await state();
    }
    assert(Math.hypot(s.foot.x - car.x, s.foot.z - car.z) < 5.5, 'Touch walk reaches parked car');
    await button('enter-exit').tap(); await page.waitForSelector('#world[data-mode="driver"]');
    return { parkedCar: car };
  });
  if (entered) await check('touch-drive-brake-exit', async () => {
    const before = await state(), go = await centre(button('throttle')), stick = await centre(page.locator('.gtasf-touch .stick'));
    await touch('touchStart', [{ ...go, id: 1 }, { x: stick.x + 18, y: stick.y, id: 2 }]);
    try { await page.waitForFunction(() => Number(document.querySelector('#world').dataset.speed) > 2); }
    finally { await touch('touchCancel'); }
    await page.waitForFunction(() => window.__gtasf.input.throttle === 0 && window.__gtasf.input.steer === 0);
    const driven = await state();
    const brake = await centre(button('handbrake')); await touch('touchStart', [brake]);
    try { await page.waitForFunction(() => Number(document.querySelector('#world').dataset.speed) === 0); }
    finally { await touch('touchCancel'); }
    assert(Math.hypot(driven.foot.x - before.foot.x, driven.foot.z - before.foot.z) > .1, 'Car physically moved');
    await button('enter-exit').tap(); await page.waitForSelector('#world[data-mode="on-foot"]');
    return { before: before.foot, after: driven.foot };
  });
  await check('touch-hail-robotaxi', async () => {
    await button('hail').tap();
    await page.waitForFunction(() => ['pickup', 'riding'].includes(window.__gtasf.world.taxi.state), null, { timeout: 20_000 });
    return { taxiState: (await state()).taxi };
  });
  await check('phone-options', async () => {
    await page.locator('#movement-mode').tap();
    const menu = page.getByRole('dialog', { name: 'Game options', exact: true }); await menu.waitFor();
    for (const selector of ['#enter-exit', '#hail', '#map-toggle', '.gt-referral-launch']) assert.equal(await menu.locator(selector).count(), 1, `Reachable ${selector}`);
    await menu.getByRole('button', { name: 'Close ×', exact: true }).tap();
    await menu.waitFor({ state: 'hidden' });
  });
  await context.close();

  // A deterministic browser denial exercises the real fallback and real mouse drags.
  const desktop = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  await desktop.addInitScript(() => { HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new DOMException('Phone UX denial fixture', 'NotAllowedError')); });
  page = await desktop.newPage(); page.setDefaultTimeout(15_000); listen(page);
  await boot(new URL('/?preset=low', base).href);
  await check('desktop-invite-clock-layout', async () => {
    const boxes = await page.evaluate(() => {
      const box = selector => { const e = document.querySelector(selector), r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, visible: e.checkVisibility() }; };
      return { invite: box('.gt-referral-launch'), clock: box('.gt-hud-clock') };
    });
    assert(boxes.invite.visible && boxes.clock.visible); assert(!overlap(boxes.invite, boxes.clock), 'Invite does not cover clock'); return boxes;
  });
  await check('desktop-pointer-denial-drag', async () => {
    await page.mouse.click(670, 550);
    await page.locator('[data-look-fallback]').waitFor({ state: 'visible' });
    const before = (await state()).yaw;
    await page.mouse.move(670, 550); await page.mouse.down(); await page.mouse.move(850, 550, { steps: 12 }); await page.mouse.up();
    await page.waitForFunction(yaw => Math.abs(window.__gtasf.world.camera.yaw - yaw) > .2, before);
    assert.equal(await page.evaluate(() => document.pointerLockElement), null);
    return { before, after: (await state()).yaw };
  });
  await desktop.close();
  report.passed = report.steps.every(s => s.passed) && !report.errors.length && !report.httpErrors.length;
} catch (error) { report.failure = error.stack ?? String(error); console.error(report.failure); }
finally {
  await browser?.close();
  if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); }
  await pool?.close(); report.finishedAt = new Date().toISOString(); await save();
  console.log(`PHONE_UX_REPORT:${out}/report.json`); if (!report.passed) process.exitCode = 1;
}
