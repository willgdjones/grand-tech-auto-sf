/** One mounted-game funding/GPS check: real inputs, real Worker time and real persistence. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import { checkRobotaxiTouch } from './robotaxi-touch-check.mjs';

const out = resolve(process.env.GTASF_FUNDING_OUT ?? `artifacts/funding-game/${new Date().toISOString().replaceAll(':', '-')}`);
const mode = process.env.GTASF_FUNDING_MODE ?? 'all';
assert.ok(['all', 'phone'].includes(mode), 'GTASF_FUNDING_MODE must be all or phone');
const eventId = 'tech-week:f9c5d885-7f83-4a7d-b9cb-9df83f93e262';
const report = { startedAt: new Date().toISOString(), mode, errors: [], httpErrors: [], checks: [], passed: false };
const responseReads = [];
await mkdir(out, { recursive: true });
let server, browser, page;
const snapshot = target => target.evaluate(() => {
  const w = window.__gtasf.world, f = w.funding, p = f.profile;
  return { foot: { ...w.foot }, state: f.status?.state, inside: f.inside, progress: f.progress, error: f.error,
    target: f.target, room: f.status?.room, serverNow: f.status?.serverNow,
    award: f.status?.award ? { id: f.status.award.id, amountCents: f.status.award.amountCents, awardedAt: f.status.award.awardedAt, eventId: f.status.award.eventId } : null,
    profile: p ? { startupName: p.startupName, nickname: p.nickname, totalCents: p.totalCents, todayCents: p.todayCents, round: p.round.id, stars: p.round.stars, rank: p.rank } : null,
    hud: document.querySelector('.gt-hud')?.innerText, roomText: w.fundingRoom?.element.innerText,
    connected: document.querySelector('#world').dataset.connected, capture: window.__gtasf.capture };
});
function recordErrors(target) {
  target.on('pageerror', error => report.errors.push(error.message));
  target.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  target.on('response', response => {
    if (response.status() < 400) return;
    const entry = { path: new URL(response.url()).pathname, status: response.status(), method: response.request().method() };
    report.httpErrors.push(entry);
    if (entry.path.startsWith('/api/funding/')) responseReads.push(response.json().then(value => { entry.error = value.error; }).catch(() => {}));
  });
}
async function ready(target, url) {
  if (process.env.GTASF_INVITE_FILE) {
    const code = (await readFile(process.env.GTASF_INVITE_FILE, 'utf8')).trim();
    const response = await target.context().request.post(new URL('/api/invite', url).href, { data: { code } });
    assert.equal(response.status(), 200, 'Invite file must authorize this browser context');
  }
  target.setDefaultTimeout(60_000); await target.goto(url);
  await target.waitForFunction(() => window.__gtasf?.ready || document.querySelector('#loading.failed'));
  const availability = await target.evaluate(() => ({ funding: !!window.__gtasf?.world?.funding, error: document.querySelector('#loading.failed #loading-detail')?.textContent }));
  assert.ok(availability.funding, availability.error ?? 'Funding main hooks and local flag must be enabled');
  await target.waitForSelector('#world[data-connected="true"]');
  await target.waitForSelector('#loading', { state: 'hidden' });
  assert.equal((await snapshot(target)).capture, false, 'Funding requires real time, never capture steps');
}
async function holdMovement(target, focus) {
  await focus.focus(); const before = (await snapshot(target)).foot;
  await target.keyboard.down('KeyW'); await target.waitForTimeout(350); await target.keyboard.up('KeyW');
  const after = (await snapshot(target)).foot;
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < .02, 'A funding modal must hold movement');
}
async function identity(target, name, phone = false) {
  const dialog = target.locator('.gt-funding-onboarding[open]'); await dialog.waitFor();
  assert.equal((await snapshot(target)).profile.totalCents, '0');
  await holdMovement(target, dialog.getByRole('button', { name: 'Save startup' }));
  await target.getByLabel('Startup name', { exact: true }).fill(name);
  await target.getByLabel('Your nickname', { exact: true }).fill(phone ? 'Smoke Phone' : 'Smoke Desktop');
  await target.screenshot({ path: `${out}/identity-${phone ? 'phone' : 'desktop'}.png` });
  await dialog.getByRole('button', { name: 'Save startup' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await snapshot(target)).profile.startupName, name);
}
async function selectEvent(target, phone = false) {
  if (phone) await target.locator('.gt-upcoming-open').tap();
  else await target.keyboard.press('KeyV');
  await target.getByRole('searchbox', { name: 'Search upcoming events' }).fill('Investor Happy Hour');
  const row = target.locator(`[data-event-id="${eventId}"]`); await row.waitFor();
  await row.getByRole('button', { name: /^Set destination:/ }).click();
  await target.waitForSelector('.gt-upcoming', { state: 'hidden' });
  await target.waitForFunction(id => window.__gtasf.world.funding.target?.eventId === id, eventId);
  return (await snapshot(target)).target;
}
async function aim(target, point) {
  // Set heading only; position and simulation time remain controlled by the normal game.
  await target.evaluate(goal => {
    const w = window.__gtasf.world, heading = Math.atan2(goal.x - w.foot.x, goal.z - w.foot.z);
    w.foot.yaw = heading; w.camera.setOrbit(heading + Math.PI, w.camera.pitch);
  }, point);
  await target.keyboard.press('KeyC'); await target.waitForTimeout(100);
}
async function walkTo(target, point, phone = false) {
  await aim(target, point);
  let cdp;
  if (phone) {
    const box = await target.locator('.gtasf-touch .stick').boundingBox(); assert.ok(box);
    cdp = await target.context().newCDPSession(target);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 56, id: 1 }] });
  } else { await target.keyboard.down('Shift'); await target.keyboard.down('KeyW'); }
  try {
    await target.waitForFunction(goal => {
      const foot = window.__gtasf.world.foot;
      return Math.hypot(foot.x - goal.x, foot.z - goal.z) < 4;
    }, point, { timeout: 20_000 });
  } finally {
    if (cdp) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); }
    else { await target.keyboard.up('KeyW'); await target.keyboard.up('Shift'); }
  }
}
async function contact(target) {
  return target.evaluate(() => {
    const w = window.__gtasf.world;
    const raisedAt = (x, z) => {
      for (const landmark of w.landmarks.children) {
        if (!landmark.visible || !landmark.userData.walkableSurfaces) continue;
        const point = landmark.position.clone().set(x, 0, z); landmark.worldToLocal(point);
        const surface = landmark.userData.walkableSurfaces.find(s => point.x >= s.minX && point.x <= s.maxX && point.z >= s.minZ && point.z <= s.maxZ);
        if (surface) return landmark.position.y + surface.y;
      }
      return null;
    };
    const measure = mesh => {
      const positions = mesh.geometry.getAttribute('position'); let count = 0, minimum = Infinity;
      for (let i = 0; i < positions.count; i++) {
        const point = mesh.position.clone().set(positions.getX(i), positions.getY(i), positions.getZ(i)); mesh.localToWorld(point);
        const height = raisedAt(point.x, point.z);
        if (height !== null) { count++; minimum = Math.min(minimum, point.y - height); }
      }
      return { count, minimum };
    };
    const ribbon = w.guidance.root.getObjectByName('GPS route ribbon');
    const ring = w.fundingRoom.root.getObjectByName('Room boundary');
    return { ribbon: measure(ribbon), fundingRing: measure(ring), marker: w.guidance.root.getObjectByName('GPS destination').position.toArray() };
  });
}
try {
  let url = process.env.GTASF_SMOKE_URL;
  if (!url) {
    const existingApp = process.env.GTASF_FUNDING_APP;
    const app = resolve(existingApp ?? resolve(out, 'app')), configFile = resolve('web/vite.config.ts');
    if (existingApp) await access(resolve(app, 'index.html'));
    else await build({ configFile, root: resolve('web'), logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
    report.app = app;
    console.log(`FUNDING_SNAPSHOT_READY:${app}`);
    server = await preview({ configFile, root: resolve('web'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
    url = server.resolvedUrls.local[0];
  }
  assert.equal(new URL(url).searchParams.has('invite'), false, 'Use GTASF_INVITE_FILE instead of an invite URL');
  report.url = url;
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const suffix = Date.now().toString(36);
  if (mode === 'all') {
    page = await browser.newPage({ viewport: { width: 1365, height: 900 } }); recordErrors(page); await ready(page, url);
    const startup = `Ferry Smoke ${suffix}`;
    await identity(page, startup);
    const origin = (await snapshot(page)).foot, selected = await selectEvent(page);
    assert.ok(Math.hypot(selected.anchor.x - origin.x, selected.anchor.z - origin.z) < 80, 'Use the actual nearby source event');
    await page.waitForFunction(() => {
      const w = window.__gtasf.world;
      return w.fundingRoom.root.visible && w.guidance.root.getObjectByName('GPS route ribbon').geometry.getAttribute('position')?.count > 0;
    });
    const ground = await contact(page);
    assert.ok(ground.ribbon.count > 0 && ground.ribbon.minimum >= .15, 'GPS ribbon stays above authored paving');
    assert.ok(ground.fundingRing.count > 0 && ground.fundingRing.minimum >= .19, 'Funding ring stays above authored paving');
    await aim(page, selected.anchor); await page.screenshot({ path: `${out}/gps-ground-desktop.png` });
    report.checks.push({ name: 'identity-modal-hold-and-source-event-contact', ground, selected });
    await walkTo(page, selected.anchor);
    await page.waitForFunction(() => window.__gtasf.world.funding.status?.state === 'working');
    await page.waitForTimeout(1800); const firstRoom = await snapshot(page);
    assert.ok(firstRoom.progress > 0 && firstRoom.progress < 1);
    await page.screenshot({ path: `${out}/room-desktop.png` });
    await walkTo(page, origin);
    await page.waitForFunction(() => !window.__gtasf.world.funding.inside && window.__gtasf.world.funding.status?.state === 'cancelled');
    assert.equal((await snapshot(page)).profile.totalCents, '0');
    report.checks.push({ name: 'leave-cancels-before-award', firstRoom, after: await snapshot(page) });
    console.log('FUNDING_CANCEL_PASSED');
    await walkTo(page, selected.anchor);
    await page.waitForFunction(() => window.__gtasf.world.funding.status?.state === 'working');
    const working = await snapshot(page), wallStart = Date.now();
    await page.evaluate(() => {
      window.__fundingSamples = [];
      window.__fundingSampler = setInterval(() => {
        const f = window.__gtasf.world.funding;
        window.__fundingSamples.push({ state: f.status?.state, progress: f.progress, total: f.profile.totalCents, serverNow: f.status?.serverNow });
      }, 400);
    });
    await page.waitForFunction(() => window.__gtasf.world.funding.status?.state === 'awarded', null, { timeout: 40_000 });
    const awarded = await snapshot(page), samples = await page.evaluate(() => { clearInterval(window.__fundingSampler); return window.__fundingSamples; });
    assert.equal(working.room.finishesAt - working.room.startedAt, 20_000);
    assert.ok(awarded.award.awardedAt - working.room.startedAt >= 20_000, 'Server held the full twenty seconds');
    assert.ok(samples.filter(sample => sample.state === 'working').every(sample => sample.progress < 1 && sample.total === '0'));
    assert.equal(awarded.award.eventId, eventId); assert.equal(awarded.profile.totalCents, awarded.award.amountCents);
    assert.ok(BigInt(awarded.profile.totalCents) >= 50_000_000n); assert.equal(awarded.profile.stars, 1);
    await page.waitForFunction(() => window.__gtasf.world.fundingHud.animatedCents === window.__gtasf.world.funding.profile.totalCents);
    assert.equal(await page.locator('.gt-hud-stars .earned').count(), 1);
    assert.match(await page.locator('.gt-funding-toast').innerText(), /PRE-SEED CLOSED/);
    await page.screenshot({ path: `${out}/award-desktop.png` });
    report.checks.push({ name: 'real-server-award-and-round-ui', wallWaitMs: Date.now() - wallStart, working, awarded, samples });
    console.log('FUNDING_REAL_AWARD_PASSED');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open earned round perks' }).click();
    assert.equal(await page.getByRole('button', { name: 'Use VC coupe', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Claim nearby HQ', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Host party here', exact: true }).isDisabled(), true);
    await page.screenshot({ path: `${out}/earned-perk-desktop.png` });
    report.checks.push({ name: 'actual-pre-seed-award-unlocks-only-car-perk' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open earned funding leaderboard' }).click();
    const board = page.locator('.gt-funding-dialog[open]');
    await board.locator('.gt-funding-mine').waitFor();
    assert.match(await board.locator('.gt-funding-mine').innerText(), new RegExp(startup));
    await holdMovement(page, board.getByRole('button', { name: 'Close ×', exact: true }));
    await page.screenshot({ path: `${out}/leaderboard-desktop.png` });
    await page.keyboard.press('Escape');
    const repeated = await page.evaluate(async id => {
      const response = await fetch('/api/funding/start', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: id }) });
      const value = await response.json(); return { status: response.status, state: value.state, totalCents: value.profile?.totalCents };
    }, eventId);
    assert.equal(repeated.status, 200); assert.equal(repeated.state, 'already-awarded'); assert.equal(repeated.totalCents, awarded.profile.totalCents);
    await ready(page, url); const persisted = await snapshot(page);
    assert.equal(persisted.profile.startupName, startup); assert.equal(persisted.profile.totalCents, awarded.profile.totalCents);
    assert.equal(await page.locator('.gt-funding-onboarding[open]').count(), 0);
    report.checks.push({ name: 'leaderboard-modal-hold-repeat-denial-and-reload-persistence', repeated, persisted });
    await page.context().close();
  }
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  page = await mobile.newPage(); recordErrors(page); await ready(page, url);
  await identity(page, `Phone Smoke ${suffix}`, true);
  const phoneOrigin = (await snapshot(page)).foot, phoneTarget = await selectEvent(page, true);
  await walkTo(page, phoneTarget.anchor, true);
  await page.waitForFunction(() => window.__gtasf.world.funding.status?.state === 'working');
  await page.waitForTimeout(1500);
  const phoneLayout = await page.locator('.gt-funding-room').evaluate(element => {
    const box = element.getBoundingClientRect(), hud = document.querySelector('.gt-hud').getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: innerWidth, height: innerHeight, visible: !element.hidden,
      hud: { left: hud.left, right: hud.right, top: hud.top, bottom: hud.bottom }, text: element.innerText };
  });
  assert.ok(phoneLayout.visible && phoneLayout.left >= 0 && phoneLayout.right <= phoneLayout.width && phoneLayout.top >= 0 && phoneLayout.bottom <= phoneLayout.height);
  assert.ok(phoneLayout.hud.left >= 0 && phoneLayout.hud.right <= phoneLayout.width);
  assert.equal(await page.locator('.gt-gps-status').isVisible(), false, 'Room progress owns its phone status position');
  await page.screenshot({ path: `${out}/room-phone.png` });
  const phoneWorking = await snapshot(page);
  await walkTo(page, phoneOrigin, true);
  await page.waitForFunction(() => window.__gtasf.world.funding.status?.state === 'cancelled');
  assert.equal((await snapshot(page)).profile.totalCents, '0');
  report.checks.push({ name: 'phone-onboarding-touch-walk-progress-and-cancel', phoneLayout, phoneWorking, after: await snapshot(page) });
  await page.getByRole('button', { name: 'Open earned funding leaderboard' }).tap();
  await page.locator('.gt-funding-dialog[open] .gt-funding-table').waitFor();
  await page.screenshot({ path: `${out}/leaderboard-phone.png` });
  report.checks.push({ name: 'phone-leaderboard-tap' });
  if (process.env.GTASF_FUNDING_TAXI === '1') {
    const taxi = await checkRobotaxiTouch(page, { url, out: `${out}/robotaxi-touch` });
    report.checks.push({ name: 'phone-robotaxi-hail-and-cancel', taxi });
  }
  await Promise.all(responseReads);
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []); report.passed = true;
  console.log(`TEST_PASSED:FundingGame → ${out}`);
} catch (error) {
  report.failure = String(error);
  report.last = page ? await snapshot(page).catch(() => null) : null;
  await page?.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  throw error;
} finally {
  await Promise.all(responseReads);
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  if (server) { server.httpServer.closeAllConnections(); await new Promise(resolveClose => server.httpServer.close(resolveClose)); }
}
