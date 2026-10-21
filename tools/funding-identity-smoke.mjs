/** Legacy nickname response fixture; cookies, profile saves, World and balances stay real. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

export async function checkFundingIdentity(page, options = {}) {
  const url = options.url ?? process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173/';
  const out = options.out ?? 'artifacts/funding-identity';
  const profileUrl = new URL('/api/funding/profile', url).href;
  const nickname = '雪'.repeat(24), repaired = '雪 👩‍💻';
  const report = { checkedAt: new Date().toISOString(), errors: [], httpErrors: [], checks: [], passed: false };
  await mkdir(out, { recursive: true });
  let patched = 0, posts = 0;
  const onPageError = error => report.errors.push(error.message);
  const onConsole = message => { if (message.type() === 'error') report.errors.push(message.text()); };
  const onResponse = response => { if (response.status() >= 400) report.httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); };
  const onRequest = request => { if (request.url() === profileUrl && request.method() === 'POST') posts++; };
  const legacyProfile = async route => {
    if (route.request().method() !== 'GET' || patched) { await route.continue(); return; }
    const response = await route.fetch(); assert.equal(response.status(), 200);
    const profile = await response.json(); assert.equal(profile.totalCents, '0');
    patched++;
    // Replace only this legacy field; preserve the actual device, cookie, startup and money.
    await route.fulfill({ response, json: { ...profile, nickname } });
  };
  page.on('pageerror', onPageError); page.on('console', onConsole);
  page.on('response', onResponse); page.on('request', onRequest);
  try {
    page.setDefaultTimeout(45_000);
    const current = await page.context().request.get(profileUrl); assert.equal(current.status(), 200);
    assert.equal((await current.json()).totalCents, '0', 'Use a fresh zero-funding browser context');
    const startupName = `Unicode Recovery ${Date.now().toString(36)}`;
    const seed = await page.context().request.post(profileUrl, { data: { startupName, nickname: 'Before Repair' } });
    assert.equal(seed.status(), 200);
    await page.route(profileUrl, legacyProfile);
    await page.goto(url);
    await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');
    await page.waitForSelector('#loading', { state: 'hidden' });
    const dialog = page.locator('.gt-funding-onboarding[open]');
    await dialog.waitFor(); assert.equal(patched, 1);
    assert.equal(await page.getByLabel('Startup name', { exact: true }).inputValue(), startupName);
    assert.equal(await page.getByLabel('Your nickname', { exact: true }).inputValue(), nickname);
    assert.match(await dialog.getByRole('status').innerText(), /update.*nickname|nickname.*update/i);
    await page.screenshot({ path: `${out}/legacy-repair.png` });
    report.checks.push({ name: 'Legacy invalid nickname connects and opens editable repair', patched });
    await dialog.getByRole('button', { name: 'Save startup', exact: true }).click();
    await page.waitForFunction(() => /shorter|unsupported/i.test(document.querySelector('.gt-funding-onboarding .gt-funding-status')?.textContent ?? ''));
    assert.equal(posts, 0, 'Invalid nickname is rejected before the API request');
    assert.equal(await dialog.isVisible(), true);
    report.checks.push({ name: 'Invalid legacy nickname is rejected inline without HTTP errors' });
    await page.getByLabel('Your nickname', { exact: true }).fill(repaired);
    await dialog.getByRole('button', { name: 'Save startup', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' }); assert.equal(posts, 1);
    const saved = await page.context().request.get(profileUrl); assert.equal(saved.status(), 200);
    const profile = await saved.json();
    assert.equal(profile.startupName, startupName); assert.equal(profile.nickname, repaired); assert.equal(profile.totalCents, '0');
    await page.unroute(profileUrl, legacyProfile);
    await page.reload();
    await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');
    await page.waitForSelector('#loading', { state: 'hidden' });
    assert.equal(await page.locator('.gt-funding-onboarding[open]').count(), 0);
    const after = await page.evaluate(() => ({ nickname: window.__gtasf.world.funding.profile.nickname, total: window.__gtasf.world.funding.profile.totalCents }));
    assert.deepEqual(after, { nickname: repaired, total: '0' });
    await page.screenshot({ path: `${out}/repaired-reload.png` });
    report.checks.push({ name: 'Real API repair persists and reload connects without prompt', after });
    assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []); report.passed = true;
    return report;
  } catch (error) {
    report.failure = String(error);
    await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
    throw error;
  } finally {
    await page.unroute(profileUrl, legacyProfile);
    page.off('pageerror', onPageError); page.off('console', onConsole);
    page.off('response', onResponse); page.off('request', onRequest);
    await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let browser, server;
  try {
    let url = process.env.GTASF_SMOKE_URL;
    if (!url) {
      const app = resolve(process.env.GTASF_IDENTITY_APP ?? 'artifacts/funding-identity/app');
      const configFile = resolve('web/vite.config.ts');
      if (!process.env.GTASF_IDENTITY_APP) await build({ configFile, root: resolve('web'), logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
      console.log(`IDENTITY_SNAPSHOT_READY:${app}`);
      server = await preview({ configFile, root: resolve('web'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
      url = server.resolvedUrls.local[0];
    }
    browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    console.log(JSON.stringify(await checkFundingIdentity(page, { url })));
  } finally {
    await browser?.close();
    if (server) { server.httpServer.closeAllConnections(); await new Promise(resolveClose => server.httpServer.close(resolveClose)); }
  }
}
