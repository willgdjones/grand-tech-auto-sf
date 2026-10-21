/** Visual-only unlock fixtures in this browser. Never writes fabricated funding to D1. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, preview } from 'vite';

const out = 'artifacts/funding-perks';
await mkdir(out, { recursive: true });
const configFile = resolve('web/vite.config.ts'), app = resolve(process.env.GTASF_PERKS_APP ?? `${out}/app`);
if (!process.env.GTASF_PERKS_APP) await build({ configFile, root: resolve('web'), logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
const server = await preview({ configFile, root: resolve('web'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0,
  proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
const url = server.resolvedUrls.local[0], browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = { checkedAt: new Date().toISOString(), app, scope: 'Visual fixture only; actual party authority tested separately', errors: [], httpErrors: [], checks: [] };
let page;
const httpBodies = [];
function recordErrors(target) {
  target.on('pageerror', error => report.errors.push(error.message));
  target.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  target.on('response', response => {
    if (response.status() < 400) return;
    const failure = { status: response.status(), url: response.url(), method: response.request().method() };
    report.httpErrors.push(failure);
    httpBodies.push(response.text().then(body => { failure.body = body.slice(0, 1000); }).catch(() => {}));
  });
}
async function fixture(target) {
  let profile, party = null;
  recordErrors(target);
  // Walking may legitimately enter an event marker. Keep the real device named;
  // only the later-round balance and party presentation are visual fixtures.
  const profileUrl = new URL('/api/funding/profile', url).href;
  assert.equal((await target.request.get(profileUrl)).status(), 200);
  assert.equal((await target.request.post(profileUrl, { data: { startupName: 'Fog Computing', nickname: 'Founder' } })).status(), 200);
  await target.route('**/api/funding/profile', async route => {
    const response = await route.fetch(); assert.equal(response.status(), 200);
    profile = { ...await response.json(), startupName: 'Fog Computing', nickname: 'Founder', totalCents: '1500000000', todayCents: '1500000000', rank: 1, todayRank: 1,
      round: { id: 'series-a', label: 'Series A', stars: 3, thresholdCents: '1500000000', headline: 'Disruptive startup hires someone to explain what it does.' } };
    await route.fulfill({ response, json: profile });
  });
  await target.route('**/api/funding/leaderboard', async route => {
    await route.fulfill({ json: { week: [{ ...profile, live: true }], today: [{ ...profile, live: true }], you: profile, serverNow: Date.now() } });
  });
  await target.route('**/api/funding/parties', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); assert.deepEqual(Object.keys(body), ['hosting']);
      const anchor = await target.evaluate(() => { const { x, y, z } = window.__gtasf.world.foot; return { x, y, z }; });
      party = body.hosting ? { hostId: profile.deviceId, startupName: profile.startupName, anchor, endsAt: Date.now() + 900000 } : null;
    }
    await route.fulfill({ json: { parties: party ? [party] : [], yours: party, serverNow: Date.now() } });
  });
  target.setDefaultTimeout(60000); await target.goto(url);
  await target.waitForFunction(() => window.__gtasf?.ready && window.__gtasf.world.fundingPerks);
  await target.waitForSelector('#world[data-connected="true"]');
}
async function walkTo(target, point) {
  await target.evaluate(goal => {
    const w = window.__gtasf.world, heading = Math.atan2(goal.x - w.foot.x, goal.z - w.foot.z);
    w.foot.yaw = heading; w.camera.setOrbit(heading + Math.PI, w.camera.pitch);
  }, point);
  await target.keyboard.press('KeyC'); await target.keyboard.down('Shift'); await target.keyboard.down('KeyW');
  try { await target.waitForFunction(goal => { const foot = window.__gtasf.world.foot; return Math.hypot(foot.x - goal.x, foot.z - goal.z) < (goal.radius ?? 4); }, point, { timeout: 30000 }); }
  finally { await target.keyboard.up('KeyW'); await target.keyboard.up('Shift'); }
}
try {
  page = await browser.newPage({ viewport: { width: 1365, height: 900 } }); await fixture(page);
  await page.getByRole('button', { name: 'Open earned round perks' }).click();
  await page.getByRole('dialog', { name: 'Your round, your city' }).waitFor();
  const start = await page.evaluate(() => ({ ...window.__gtasf.world.foot }));
  await page.keyboard.down('KeyW'); await page.waitForTimeout(300); await page.keyboard.up('KeyW');
  const end = await page.evaluate(() => ({ ...window.__gtasf.world.foot }));
  assert.ok(Math.hypot(end.x - start.x, end.z - start.z) < .02);
  await page.screenshot({ path: `${out}/perks-desktop.png` });
  await page.getByRole('button', { name: 'Use VC coupe', exact: true }).click();
  await page.keyboard.press('Escape');
  const vehicle = await page.evaluate(() => {
    const w = window.__gtasf.world;
    return [...w.fleet.cars.values()].filter(car => car.data.kind !== 'robotaxi' && !car.data.driverId)
      .map(car => ({ id: car.data.id, x: car.model.root.position.x, z: car.model.root.position.z, distance: Math.hypot(w.foot.x - car.model.root.position.x, w.foot.z - car.model.root.position.z) }))
      .sort((a, b) => a.distance - b.distance)[0];
  });
  assert.ok(vehicle); if (vehicle.distance > 4) await walkTo(page, vehicle);
  await page.keyboard.press('KeyE'); await page.waitForFunction(() => window.__gtasf.world.mode === 'driver');
  await page.waitForFunction(() => { const w = window.__gtasf.world; return w.fleet.cars.get(w.vehicleId)?.model.root.getObjectByName('vc-supercar'); });
  await page.waitForTimeout(350); await page.screenshot({ path: `${out}/vc-coupe.png` });
  report.checks.push('Round-gated VC coupe visual attached to server-entered car, modal input held');
  await page.keyboard.press('KeyE'); await page.waitForFunction(() => window.__gtasf.world.mode === 'on-foot');
  // The southwest exit meets the real terrain. The direct west plaza edge has a separately tracked seam.
  await walkTo(page, { x: 1150.2477278588772, z: -1244.0340492272846, radius: .75 });
  await walkTo(page, { x: 1140.0177524579397, z: -1233.063743702997, radius: .75 });
  // Ferry is an authored landmark; the HQ sign belongs on an actual city facade.
  // Offline source GLB raycast puts the nearest eligible wall 47m from this point (105m from spawn).
  await walkTo(page, { x: 1130, z: -1210 });
  await page.getByRole('button', { name: 'Open earned round perks' }).click();
  await page.getByRole('button', { name: 'Claim nearby HQ' }).click();
  await page.waitForFunction(() => window.__gtasf.world.fundingPerks.root.getObjectByName('Earned startup HQ sign'));
  const sign = await page.evaluate(() => {
    const w = window.__gtasf.world, sign = w.fundingPerks.root.getObjectByName('Earned startup HQ sign');
    const outward = sign.getWorldDirection(w.feet.clone());
    return { x: sign.position.x, y: sign.position.y, z: sign.position.z, visible: sign.visible,
      approach: { x: sign.position.x + outward.x * 12, z: sign.position.z + outward.z * 12 } };
  });
  await walkTo(page, sign.approach);
  await page.evaluate(point => { const w = window.__gtasf.world; const heading = Math.atan2(point.x - w.foot.x, point.z - w.foot.z); w.camera.setOrbit(heading + Math.PI, -.05); }, sign);
  await page.waitForTimeout(350); await page.screenshot({ path: `${out}/startup-hq.png` }); report.checks.push({ name: 'Sign mounted on raycast building face', sign });
  await page.getByRole('button', { name: 'Open earned round perks' }).click();
  await page.getByRole('button', { name: 'Host party here', exact: true }).click();
  await page.waitForFunction(() => window.__gtasf.world.fundingPerks.root.children.some(child => child.name.startsWith('Startup party')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(350); await page.screenshot({ path: `${out}/party-marker.png` });
  report.checks.push('Canonical party snapshot renders draped ring and startup label');
  await page.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  // The phone uses real identity with no request interception; new founders remain locked.
  page = await mobile.newPage(); recordErrors(page); page.setDefaultTimeout(60000); await page.goto(url);
  await page.waitForFunction(() => window.__gtasf?.ready && window.__gtasf.world.fundingPerks);
  await page.waitForSelector('#world[data-connected="true"]');
  const phoneName = `Perks Phone ${Date.now().toString(36)}`;
  await page.getByLabel('Startup name', { exact: true }).fill(phoneName); await page.getByLabel('Your nickname', { exact: true }).fill('Phone founder');
  await page.getByRole('button', { name: 'Save startup', exact: true }).tap();
  await page.waitForSelector('.gt-funding-onboarding[open]', { state: 'hidden' });
  await page.getByRole('button', { name: 'Open earned round perks' }).tap();
  assert.equal(await page.getByRole('button', { name: 'Use VC coupe', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Claim nearby HQ', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Host party here', exact: true }).isDisabled(), true);
  const bounds = await page.getByRole('dialog', { name: 'Your round, your city' }).evaluate(element => {
    const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: innerWidth, height: innerHeight };
  });
  assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.height);
  await page.waitForTimeout(600); // Allow the browser's native tap highlight to fade.
  await page.screenshot({ path: `${out}/perks-mobile.png` }); report.checks.push({ name: '390px touch dialog and controls', bounds });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []); report.passed = true; console.log('TEST_PASSED:FundingPerksVisual');
} catch (error) {
  report.failure = String(error);
  report.last = await page?.evaluate(() => { const w = window.__gtasf?.world; return { foot: w ? { ...w.foot } : null,
    mode: w?.mode, status: document.querySelector('.gt-funding-perks-status')?.textContent }; }).catch(() => null);
  await page?.screenshot({ path: `${out}/failed.png` }).catch(() => {}); throw error;
} finally {
  await Promise.allSettled(httpBodies);
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close();
  server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve));
}
