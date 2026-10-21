/* V2 drive-through funding smoke (PLAN-v2 decision 1): a real mounted game, real Worker, real D1.
 * Unlike the v1 funding-game-smoke (20s "work the room"), this asserts the pass-through model: a
 * NAMED founder who walks through an event marker is paid once ever by the server tick (no room, no
 * 20s hold), the balance rises, and the award shows on the cap table. Desktop-only, focused on the
 * decision-1 loop (b4wh). Requires driveThroughFunding + capTable ON (the shipped flags) and a local
 * worker on :8787. Run: node tools/funding-drivethrough-smoke.mjs  (GTASF_FUNDING_APP reuses a build). */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, preview } from 'vite';

const out = resolve(process.env.GTASF_DT_OUT ?? `artifacts/funding-drivethrough/${new Date().toISOString().replaceAll(':', '-')}`);
const eventId = process.env.GTASF_DT_EVENT ?? 'tech-week:f9c5d885-7f83-4a7d-b9cb-9df83f93e262';
const report = { startedAt: new Date().toISOString(), errors: [], httpErrors: [], checks: [], passed: false };
const responseReads = [];
await mkdir(out, { recursive: true });
let server, browser, page;

const snapshot = target => target.evaluate(() => {
  const w = window.__gtasf.world, f = w.funding, p = f.profile;
  return { foot: { ...w.foot }, state: f.status?.state, inside: f.inside, error: f.error, target: f.target,
    award: f.status?.award ? { amountCents: f.status.award.amountCents, eventId: f.status.award.eventId, eventTitle: f.status.award.eventTitle, source: f.status.award.source } : null,
    profile: p ? { startupName: p.startupName, nickname: p.nickname, totalCents: p.totalCents, round: p.round.id, stars: p.round.stars } : null,
    connected: document.querySelector('#world').dataset.connected, capture: window.__gtasf.capture };
});
function recordErrors(target) {
  target.on('pageerror', error => report.errors.push(error.message));
  target.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  target.on('response', response => {
    if (response.status() < 400) return;
    const entry = { path: new URL(response.url()).pathname, status: response.status(), method: response.request().method() };
    report.httpErrors.push(entry);
    if (entry.path.startsWith('/api/funding/')) responseReads.push(response.json().then(v => { entry.error = v.error; }).catch(() => {}));
  });
}
async function ready(target, url) {
  target.setDefaultTimeout(60_000); await target.goto(url);
  await target.waitForFunction(() => window.__gtasf?.ready || document.querySelector('#loading.failed'));
  const avail = await target.evaluate(() => ({ funding: !!window.__gtasf?.world?.funding, error: document.querySelector('#loading.failed #loading-detail')?.textContent }));
  assert.ok(avail.funding, avail.error ?? 'Funding hooks + local flag must be enabled');
  await target.waitForSelector('#world[data-connected="true"]');
  await target.waitForSelector('#loading', { state: 'hidden' });
}
async function identity(target, name) {
  // The post-redesign onboarding flow shows the name screen AFTER the first payout, not on boot, so
  // a fresh founder has no startup dialog to fill. Set identity through the server API (authoritative);
  // the client picks it up on its next status poll. This keeps the drive-through test deterministic and
  // decoupled from the in-flux onboarding UI.
  const res = await target.evaluate(async n => {
    const r = await fetch('/api/funding/profile', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startupName: n, nickname: 'DT Smoke' }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, name);
  assert.equal(res.status, 200, `identity save failed: ${JSON.stringify(res.body)}`);
  await target.waitForFunction(n => window.__gtasf.world.funding.profile?.startupName === n, name, { timeout: 20_000 });
}
async function eventAnchor(target, id) {
  // Road-snapped anchor straight from the server (bypasses the in-flux V-panel selection UI); the
  // drive-through pays on proximity to this anchor, no GPS/UI needed.
  const res = await target.evaluate(async eid => {
    const r = await fetch(`/api/funding/event?id=${encodeURIComponent(eid)}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, id);
  assert.equal(res.status, 200, `event fetch failed: ${JSON.stringify(res.body)}`);
  assert.ok(res.body?.anchor && Number.isFinite(res.body.anchor.x), `event has no anchor: ${JSON.stringify(res.body)}`);
  return res.body; // { eventId, title, anchor, radiusM, approx, quote, alreadyAwarded }
}
async function aim(target, point) {
  await target.evaluate(goal => {
    const w = window.__gtasf.world, heading = Math.atan2(goal.x - w.foot.x, goal.z - w.foot.z);
    w.foot.yaw = heading; w.camera.setOrbit(heading + Math.PI, w.camera.pitch);
  }, point);
  await target.keyboard.press('KeyC'); await target.waitForTimeout(100);
}
async function walkTo(target, point) {
  await aim(target, point);
  await target.keyboard.down('Shift'); await target.keyboard.down('KeyW');
  try {
    await target.waitForFunction(goal => Math.hypot(window.__gtasf.world.foot.x - goal.x, window.__gtasf.world.foot.z - goal.z) < 4, point, { timeout: 25_000 });
  } finally { await target.keyboard.up('KeyW'); await target.keyboard.up('Shift'); }
}
try {
  let url = process.env.GTASF_SMOKE_URL;
  if (!url) {
    const app = resolve(process.env.GTASF_FUNDING_APP ?? resolve(out, 'app')), configFile = resolve('web/vite.config.ts');
    if (process.env.GTASF_FUNDING_APP) await access(resolve(app, 'index.html'));
    else await build({ configFile, root: resolve('web'), logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
    console.log(`DT_SNAPSHOT_READY:${app}`);
    server = await preview({ configFile, root: resolve('web'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
    url = server.resolvedUrls.local[0];
  }
  report.url = url;
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  page = await browser.newPage({ viewport: { width: 1365, height: 900 } }); recordErrors(page); await ready(page, url);
  const startup = `DriveThru ${Date.now().toString(36)}`;
  await identity(page, startup);
  const origin = (await snapshot(page)).foot, selected = await eventAnchor(page, eventId);
  assert.ok(Math.hypot(selected.anchor.x - origin.x, selected.anchor.z - origin.z) < 120, `source event is nearby (dist ${Math.round(Math.hypot(selected.anchor.x - origin.x, selected.anchor.z - origin.z))}m)`);

  // Decision 1: walking THROUGH the marker pays immediately via the server tick — no 20s room.
  await walkTo(page, selected.anchor);
  await page.waitForFunction(() => window.__gtasf.world.funding.status?.state === 'awarded', null, { timeout: 30_000 });
  const awarded = await snapshot(page);
  assert.ok(BigInt(awarded.profile.totalCents) > 0n, 'drive-through paid on pass-through');
  assert.equal(awarded.award.source, 'event');
  await page.screenshot({ path: `${out}/drivethrough-award.png` });
  report.checks.push({ name: 'pass-through-pays-without-a-room', awarded });
  console.log('DRIVE_THROUGH_AWARD_PASSED');

  // Once ever (PLAN-v2 decision 1): leaving and re-entering the same marker does not pay again.
  await walkTo(page, origin);
  await walkTo(page, selected.anchor);
  await page.waitForTimeout(2500);
  const reentered = await snapshot(page);
  assert.equal(reentered.profile.totalCents, awarded.profile.totalCents, 'once-ever: re-entry does not pay twice');
  report.checks.push({ name: 'once-ever-no-double-pay', reentered });
  console.log('DRIVE_THROUGH_ONCE_EVER_PASSED');

  // Cap table (decision 5): the drive-through event appears as a backer with the right total.
  await page.keyboard.press('Escape');
  const cap = await page.evaluate(async () => {
    const r = await fetch('/api/funding/captable', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    return { status: r.status, body: await r.json() };
  });
  assert.equal(cap.status, 200);
  const eventGroup = cap.body.groups.find(g => g.source === 'event');
  assert.ok(eventGroup && BigInt(eventGroup.totalCents) > 0n, 'cap table lists the drive-through event as a backer');
  assert.equal(cap.body.totalCents, awarded.profile.totalCents, 'cap table total matches the profile total');
  report.checks.push({ name: 'cap-table-lists-the-event-backer', eventGroup, total: cap.body.totalCents });
  console.log('DRIVE_THROUGH_CAPTABLE_PASSED');

  await Promise.all(responseReads);
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []); report.passed = true;
  console.log(`TEST_PASSED:FundingDriveThrough → ${out}`);
} catch (error) {
  report.failure = String(error);
  report.last = page ? await snapshot(page).catch(() => null) : null;
  await page?.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  throw error;
} finally {
  await Promise.all(responseReads);
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  if (server) { server.httpServer.closeAllConnections(); await new Promise(r => server.httpServer.close(r)); }
}
