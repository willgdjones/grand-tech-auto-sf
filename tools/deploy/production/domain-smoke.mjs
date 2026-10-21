/** Real custom-domain admission, HTTPS cookie, assets and World WebSocket smoke. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const out = process.env.GTASF_DOMAIN_SMOKE_OUT ?? 'artifacts/production/custom-domains/browser';
const code = (await readFile('worker/.wrangler/production/invite-code.txt', 'utf8')).trim();
assert(code, 'Existing production invite required');
const redact = value => String(value).replaceAll(code, '[REDACTED]');
const publicDns = process.env.GTASF_DOMAIN_PUBLIC_DNS === '1';
await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(),
  resolver: publicDns ? 'Cloudflare public DNS-over-HTTPS in disposable Chromium profile' : 'system',
  domains: [], passed: false };
let browser, profile;
try {
  const launch = { channel: 'chromium', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] };
  if (publicDns) {
    // An isolated browser resolver avoids a stale OS cache without host mappings or system changes.
    profile = await mkdtemp(join(tmpdir(), 'gtasf-domain-smoke-'));
    await writeFile(join(profile, 'Local State'), JSON.stringify({ dns_over_https: {
      mode: 'secure', templates: 'https://cloudflare-dns.com/dns-query',
    } }));
    browser = (await chromium.launchPersistentContext(profile, launch)).browser();
  } else browser = await chromium.launch(launch);
  for (const [host, phone] of [['gtasf.com', false], ['www.gtasf.com', true]]) {
    const base = `https://${host}`, row = { host, phone, errors: [], sockets: [], passed: false };
    report.domains.push(row);
    const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1365, height: 900 },
      hasTouch: phone, isMobile: phone });
    const page = await context.newPage(); page.setDefaultTimeout(60_000);
    page.on('pageerror', error => row.errors.push(redact(error.message)));
    page.on('console', message => { if (message.type() === 'error') row.errors.push(redact(message.text())); });
    page.on('response', response => { if (response.status() >= 400) row.errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    let mapRequests = 0;
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/map/')) mapRequests++; });
    page.on('websocket', socket => { const url = new URL(socket.url()); row.sockets.push({ origin: url.origin, path: url.pathname }); });
    try {
      await page.goto(base);
      row.health = await page.evaluate(async () => {
        const response = await fetch('/api/health');
        return { status: response.status, ok: (await response.json()).ok };
      });
      assert.equal(row.health.status, 200); assert.equal(row.health.ok, true);
      await page.getByRole('heading', { name: 'San Francisco is opening soon' }).waitFor();
      const admission = await page.evaluate(async () => (await fetch('/api/admission')).json());
      assert.equal(admission.allowed, false); assert.equal(admission.launchMode, 'invite');
      assert.equal(mapRequests, 0); assert.equal(row.sockets.length, 0);
      row.gate = { visible: true, mapRequests, sockets: row.sockets.length, capacity: admission.capacity };
      await page.screenshot({ path: `${out}/${host}-gate.png` });
      const invitation = await page.evaluate(async inviteCode => (await fetch('/api/invite', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: inviteCode }),
      })).status, code);
      assert.equal(invitation, 200);
      const cookie = (await context.cookies()).find(value => value.name === 'gtasf_invite');
      assert(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Lax');
      row.cookie = { secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, domain: cookie.domain };
      await page.reload();
      await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true');
      const identity = page.locator('.gt-funding-onboarding[open]'); await identity.waitFor();
      await identity.getByLabel('Startup name', { exact: true }).fill(`Domain Check ${Date.now().toString(36)}`);
      await identity.getByLabel('Your nickname', { exact: true }).fill('Domain Check');
      await identity.getByRole('button', { name: 'Save startup', exact: true }).click();
      await identity.waitFor({ state: 'hidden' });
      row.game = await page.evaluate(() => ({ ready: window.__gtasf.ready, capture: window.__gtasf.capture,
        connected: document.querySelector('#world').dataset.connected,
        appErrors: [...window.__gtasf.errors], mapErrors: [...window.__gtasf.world.map.stats.errors],
        overflow: document.documentElement.scrollWidth > innerWidth }));
      assert.equal(row.game.ready, true); assert.equal(row.game.connected, 'true');
      assert.equal(row.game.capture, false); assert.equal(row.game.overflow, false);
      assert.deepEqual(row.game.appErrors, []); assert.deepEqual(row.game.mapErrors, []);
      assert(row.sockets.some(socket => socket.origin === `wss://${host}`));
      assert(mapRequests > 0); assert.deepEqual(row.errors, []);
      await page.screenshot({ path: `${out}/${host}-connected.png` });
      row.passed = true;
    } catch (error) {
      row.failure = redact(error); await page.screenshot({ path: `${out}/${host}-failed.png` }).catch(() => {});
    } finally { await context.close(); }
  }
  report.passed = report.domains.every(row => row.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) { report.failure = redact(error); process.exitCode = 1; }
finally {
  await browser?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, out, failure: report.failure }));
}
