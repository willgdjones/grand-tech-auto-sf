import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { smokeAdmission } from './smokeAdmission.mjs';

const base = process.env.GTASF_SMOKE_URL ?? 'https://gtasf.pages.dev';
let code = '', launchMode;
const out = process.env.GTASF_DEPLOY_SMOKE_OUT ?? 'artifacts/production';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: process.env.GTASF_HEADLESS === '1', args: ['--use-angle=metal', '--enable-gpu'] });
const report = { checkedAt: new Date().toISOString(), base, errors: [], checks: [] };
const trackingRequests = [];
const redact = value => code ? String(value).replaceAll(code, '[REDACTED]') : String(value);
const contexts = [];
async function pageFor(options) {
  const context = await browser.newContext(options); contexts.push(context);
  const page = await context.newPage(); page.setDefaultTimeout(60_000);
  page.on('pageerror', error => report.errors.push(redact(error.message)));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(redact(message.text())); });
  page.on('request', request => {
    if (/(^|\.)(i\.posthog\.com|posthog\.com|ads-twitter\.com|analytics\.twitter\.com)$/.test(new URL(request.url()).hostname))
      trackingRequests.push(new URL(request.url()).origin);
  });
  return { page, context };
}
async function state(page) {
  return page.evaluate(() => ({ ...document.querySelector('#world').dataset, errors: window.__gtasf?.errors,
    foot: window.__gtasf?.world?.foot, overflow: document.documentElement.scrollWidth > innerWidth }));
}
async function arrive(page, path = '/') {
  const url = new URL(path, base); if (code) url.searchParams.set('invite', code);
  await page.goto(url.href);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true');
  // Onboarding (flags.onboarding on, deploy #5.3+): a fresh profile gets the SA intro slides then the
  // FOUNDER ID screen, which gate movement/HUD. Dismiss both so the journey checks below can run.
  // No-op when onboarding is off (neither element is present).
  const introSlides = page.locator('.gt-sa-intro');
  if (await introSlides.isVisible().catch(() => false)) {
    await page.locator('.gt-sa-intro__skip').click().catch(() => {});
    await introSlides.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  }
  const founderId = page.locator('dialog.gt-identity[open]');
  if (await founderId.isVisible().catch(() => false)) {
    // Defaults are pre-filled + validated, so confirming is enough (matches a player hitting "Looks good").
    await founderId.getByRole('button', { name: 'Looks good' }).click({ timeout: 15_000 }).catch(() => {});
    await founderId.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  }
  await page.waitForFunction(() => +document.querySelector('#world').dataset.events > 0);
  assert.equal(new URL(page.url()).searchParams.has('invite'), false);
  await page.waitForFunction(() => !!window.__gtasf?.world?.funding?.profile);
  const identity = page.locator('.gt-funding-onboarding[open]');
  if (await identity.isVisible()) {
    assert.equal(await page.evaluate(() => window.__gtasf.world.funding.profile.totalCents), '0');
    await identity.getByLabel('Startup name', { exact: true }).fill(`Release Smoke ${Date.now().toString(36)}`);
    await identity.getByLabel('Your nickname', { exact: true }).fill('Release Smoke');
    await identity.getByRole('button', { name: 'Save startup' }).click();
    await identity.waitFor({ state: 'hidden' });
  }
  const current = await state(page);
  assert.equal(current.connected, 'true'); assert.deepEqual(current.errors, []); assert.equal(current.overflow, false);
  return current;
}
try {
  const healthResponse = await fetch(`${base}/api/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json(); assert.equal(health.ok, true);
  for (const flag of ['fundingLoop','fundedStars','events','eventVisits','sun','weather','saAtmosphere','loadingArt','buildingFacades',
    'traffic','cableCars','radio','streetProps','parodyBillboards','groundTextures','roadDetails','cityLife','hazards','nightLighting','chat','eventChat'])
    assert.equal(health.flags[flag], true, `Milestone flag ${flag}`);
  // Only the real-money referral flags must stay off; `referrals`/`referralWarmIntro` are the in-game
  // funding-bonus (no money) and are allowlisted from deploy #2 (founder dropped referral payouts).
  for (const flag of ['stripe','outbidCheckout','moderation','officeClaims','officeClaimDelivery','posthogAnalytics','xAdsPixel',
    'referralCredit','referralClaims','referralCashout'])
    assert.equal(health.flags[flag], false, `Disabled external integration ${flag}`);
  report.flags = health.flags;
  report.checks.push({ name: 'milestone-flags-and-api-health', status: healthResponse.status });
  const weatherResponse = await fetch(`${base}/api/weather`, { signal: AbortSignal.timeout(15000) });
  assert.equal(weatherResponse.status, 200);
  const weather = await weatherResponse.json();
  assert.equal(weather.version, 1); assert.ok(['live', 'stale', 'fallback'].includes(weather.status));
  report.checks.push({ name: 'same-origin-nws-weather', status: weatherResponse.status, weather });
  const admissionResponse = await fetch(`${base}/api/admission`, { signal: AbortSignal.timeout(15000) });
  assert.equal(admissionResponse.status, 200);
  const admission = await smokeAdmission(await admissionResponse.json(),
    () => readFile(process.env.GTASF_INVITE_FILE ?? 'worker/.wrangler/production/invite-code.txt', 'utf8'));
  code = admission.code; launchMode = admission.mode;
  report.launchMode = launchMode;
  if (launchMode === 'invite') {
    const gate = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    let mapRequests = 0, sockets = 0;
    gate.page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/map/')) mapRequests++; });
    gate.page.on('websocket', () => sockets++);
    await gate.page.goto(base);
    await gate.page.getByRole('heading', { name: 'San Francisco is opening soon' }).waitFor();
    assert.equal(mapRequests, 0); assert.equal(sockets, 0);
    assert.equal((await (await gate.page.request.get(`${base}/api/admission`)).json()).allowed, false);
    const rejected = await gate.page.request.post(`${base}/api/invite`, { data: { code: 'invalid-smoke-code' } });
    assert.equal(rejected.status(), 403);
    await gate.page.screenshot({ path: `${out}/invite-gate-phone.png` });
    report.checks.push({ name: 'no-invite-gate', mapRequests, sockets, invalidInviteStatus: rejected.status() });
    await gate.context.close();
  } else {
    report.checks.push({ name: 'public-anonymous-admission', allowed: true });
  }

  const desktop = await pageFor({ viewport: { width: 1365, height: 900 } });
  const cdp = await desktop.context.newCDPSession(desktop.page); await cdp.send('Network.enable');
  const network = new Map();
  cdp.on('Network.responseReceived', event => {
    const url = new URL(event.response.url); url.searchParams.delete('invite');
    network.set(event.requestId, { url: url.href, status: event.response.status, type: event.type, encodedBytes: 0 });
  });
  cdp.on('Network.loadingFinished', event => { const row = network.get(event.requestId); if (row) row.encodedBytes = event.encodedDataLength; });
  const started = Date.now();
  const initial = await arrive(desktop.page);
  report.coldLoad = { readyMs: Date.now() - started, encodedBytes: [...network.values()].reduce((sum, row) => sum + row.encodedBytes, 0), requests: [...network.values()] };
  report.checks.push({ name: launchMode === 'invite' ? 'invited-desktop-ready' : 'public-desktop-ready', state: initial });
  const funding = await desktop.page.evaluate(() => {
    const f = window.__gtasf.world.funding;
    return { totalCents: f.profile.totalCents, round: f.profile.round.id, hud: document.querySelector('.gt-hud')?.innerText };
  });
  assert.equal(funding.totalCents, '0'); assert.equal(funding.round, 'bootstrapping');
  report.checks.push({ name: 'canonical-funding-profile-and-hud', ...funding });
  const cookie = (await desktop.context.cookies()).find(value => value.name === 'gtasf_invite');
  const origin = new URL(base), localHttp = origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname);
  assert.ok(origin.protocol === 'https:' || localHttp, 'Release smoke requires HTTPS except for an isolated loopback runtime');
  if (launchMode === 'invite') {
    assert.ok(cookie?.httpOnly && cookie.sameSite === 'Lax');
    assert.equal(cookie.secure, !localHttp, 'Invite cookie Secure attribute follows the actual request transport');
    report.checks.push({ name: 'signed-invite-cookie', httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, secure: cookie.secure, localHttp });
  } else {
    assert.equal(cookie, undefined, 'Public gameplay must work without an invite cookie');
    report.checks.push({ name: 'public-gameplay-without-invite-cookie' });
  }
  await desktop.page.keyboard.down('KeyW'); await desktop.page.waitForTimeout(600); await desktop.page.keyboard.up('KeyW');
  const moved = await state(desktop.page);
  assert.ok(Math.hypot(+moved.x - +initial.x, +moved.z - +initial.z) > .1, 'Real keyboard input moves the deployed player');
  report.checks.push({ name: 'keyboard-movement', distance: Math.hypot(+moved.x - +initial.x, +moved.z - +initial.z) });
  await desktop.page.waitForFunction(() => [...window.__gtasf.world.fleet.cars.values()].some(car => (car.data.flags & 0x20) && car.data.speedCmps > 0));
  const fleet = await desktop.page.evaluate(() => [...window.__gtasf.world.fleet.cars.values()].map(car => ({ kind: car.data.kind, flags: car.data.flags })));
  assert.equal(fleet.filter(car => car.kind === 'cable-car').length, 22);
  // SA-minimal HUD (#5.9): city actions live inside the pause menu, not on the street HUD.
  await desktop.page.getByRole('button', { name: 'Open pause menu', exact: true }).click();
  const pause = desktop.page.getByRole('dialog', { name: 'Pause menu', exact: true });
  await pause.waitFor({ state: 'visible' });
  await pause.getByRole('button', { name: 'Game options', exact: true }).click();
  await pause.waitFor({ state: 'hidden' });
  const options = desktop.page.getByRole('dialog', { name: 'Game options', exact: true });
  assert.equal(await options.getByRole('button', { name: /GPS to stop/ }).count(), 3);
  const cruise = options.getByRole('checkbox', { name: 'Cruise mode', exact: true });
  await cruise.check();
  await desktop.page.waitForFunction(() => window.__gtasf.world.fleet.cruiseMode && [...window.__gtasf.world.fleet.cars.values()]
    .filter(car => car.data.flags & 0x20).every(car => !car.model.root.visible));
  assert.equal(await desktop.page.evaluate(() => [...window.__gtasf.world.fleet.cars.values()].filter(car => !(car.data.flags & 0x20)).every(car => car.model.root.visible)), true);
  await desktop.page.screenshot({ path: `${out}/traffic-options-desktop.png` });
  await cruise.uncheck(); await desktop.page.keyboard.press('Escape');
  report.checks.push({ name: 'moving-native-traffic-time-derived-cable-fleet-and-cruise', cableCars: 22, stopButtons: 3 });
  await desktop.page.screenshot({ path: `${out}/ferry-desktop.png` });
  const phone = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phoneState = await arrive(phone.page);
  await desktop.page.waitForFunction(() => +document.querySelector('#world').dataset.players >= 2);
  await phone.page.waitForFunction(() => +document.querySelector('#world').dataset.players >= 2);
  report.checks.push({ name: 'two-live-world-peers', desktop: await state(desktop.page), phone: phoneState });
  await phone.page.screenshot({ path: `${out}/ferry-phone.png` });
  await desktop.context.close();
  await phone.page.goto(`${base}/go/lombard`);
  await phone.page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true');
  const lombard = await state(phone.page);
  assert.ok(Math.hypot(+lombard.x + 1041.863, +lombard.z + 1975.201) < 5);
  report.checks.push({ name: launchMode === 'invite' ? 'cookie-and-lombard-deep-link' : 'public-lombard-deep-link', state: lombard });
  await phone.page.screenshot({ path: `${out}/lombard-phone.png` });
  assert.deepEqual(trackingRequests, [], 'Analytics must remain off before consent verification');
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(`PASS: deployed ${launchMode} admission, keyboard, two live peers, phone, Lombard link`);
} catch (error) {
  report.failure = redact(error);
  console.error(report.failure); process.exitCode = 1;
} finally {
  await writeFile(`${out}/browser-report.json`, JSON.stringify(report, null, 2) + '\n');
  await Promise.allSettled(contexts.map(context => context.close())); await browser.close();
}
