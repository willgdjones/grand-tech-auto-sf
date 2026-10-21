/** Isolated DOM fixture: real modules, fake API responses, no live payments or email. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, preview } from 'vite';

const out = resolve('artifacts/referrals-ui'), root = resolve('.'); await mkdir(out, { recursive: true });
await writeFile(`${out}/index.html`, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Referral DOM smoke fixture</title></head><body style="margin:0;padding-top:180px;background:#314737;color:white;font-family:system-ui"><p>Isolated referral UI fixture</p><script type="module" src="/entry.js"></script></body></html>');
await writeFile(`${out}/entry.js`, `import {createReferralPanel} from '${root}/web/src/referrals/panel.ts';
import {createOutbidPanel} from '${root}/web/src/outbid/panel.ts';
import {referralShareUrl} from '${root}/web/src/referrals/client.ts';
window.fixture={modal:false,share:referralShareUrl};
createReferralPanel({onModalChange:open=>window.fixture.modal=open});createOutbidPanel();`);
const config = { configFile: false, root: out, logLevel: 'warn', resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  plugins: [{ name: 'isolated-referral-flags', transform(code, id) {
    if (id !== resolve('shared/flags.ts')) return;
    return code.replace(/\b(referrals|referralClaims|referralCredit|outbidCheckout): false/g, '$1: true');
  } }], build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
const base = server.resolvedUrls.local[0], browser = await chromium.launch();
const report = { scope: 'DOM-only fixture; no provider, game or deployment acceptance', errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  const profile = { code: 'a'.repeat(24), clicks: 24, players: 8, pendingCents: '12345', availableCents: '6500', debtCents: '0', claimed: true, claimEnabled: false, creditEnabled: true, cashoutEnabled: false };
  let claims = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/referrals/profile') return route.fulfill({ json: profile });
    if (path === '/api/referrals/claim') { assert.deepEqual(route.request().postDataJSON(), { email: 'test@example.com' }); claims++; return route.fulfill({ json: { message: 'Verification link sent. Open it in this browser within 30 minutes.' } }); }
    if (path === '/api/outbid/credit-quote') return route.fulfill({ json: { grossCents: 10000, creditCents: 6500, cashCents: 3500, claimed: true } });
    if (path === '/api/outbid') return route.fulfill({ json: { snapshot: { version: 1, revision: 1, currency: 'usd', mode: 'test', minimumBidCents: 100, checkoutAvailable: true,
      entries: [{ bidderId: 'fixture-owner', rank: 1, name: 'Fog Computing', message: 'Shipping above the clouds', url: 'https://example.com/', totalCents: '10000' }] }, viewer: { bidderId: 'fixture-owner', totalCents: '10000' } } });
    throw new Error(`Unexpected API ${path}`);
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'Share and earn 20%', exact: true }).click();
  await page.getByText('$123.45', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixture.modal), true);
  await page.getByRole('button', { name: 'Copy my link', exact: true }).click();
  assert.equal(new URL(await page.evaluate(() => navigator.clipboard.readText())).searchParams.get('ref'), profile.code);
  const urls = await page.evaluate(async () => Promise.all(['/go/company?x=1', '/go/event', '/?at=37.8,-122.4', '/#referral-claim=secret', 'https://example.com/event'].map(value => window.fixture.share(value))));
  for (const url of urls.slice(0, 4)) { assert.equal(new URL(url).searchParams.get('ref'), profile.code); assert.equal(new URL(url).hash, ''); }
  assert.equal(urls[4], 'https://example.com/event');
  await page.screenshot({ path: `${out}/panel-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/panel-phone.png` });
  assert.equal(await page.locator('.gt-referral-panel').evaluate(el => { const r=el.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && el.scrollWidth<=el.clientWidth; }), true);
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => window.fixture.modal), false);
  profile.claimed = false;
  await page.getByRole('button', { name: 'Share and earn 20%', exact: true }).click();
  await page.getByText('Email delivery is not available yet.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Send verification link' }).isDisabled(), true);
  await page.keyboard.press('Escape'); profile.claimEnabled = true;
  await page.getByRole('button', { name: 'Share and earn 20%', exact: true }).click();
  await page.getByRole('button', { name: 'Send verification link' }).waitFor();
  await page.getByLabel('Claim your earnings with email').fill('test@example.com');
  await page.getByRole('button', { name: 'Send verification link' }).click();
  await page.getByText('Verification link sent.', { exact: false }).waitFor(); assert.equal(claims, 1);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Top 50', exact: true }).click();
  await page.getByRole('button', { name: 'Share my Salesforce crown' }).click();
  const crown = await page.evaluate(() => navigator.clipboard.readText()); assert.match(crown, /I just took the Salesforce crown/); assert.match(crown, /\/go\/salesforce-tower\?ref=aaaaaaaaaaaaaaaaaaaaaaaa/);
  await page.getByLabel('Add to your total · USD', { exact: true }).fill('100.00');
  await page.getByLabel('Use available referral credit', { exact: true }).check();
  await page.getByText('$100.00 bid − $65.00 credit = $35.00 at Checkout.', { exact: false }).waitFor();
  await page.getByText('$100.00 bid − $65.00 credit = $35.00 at Checkout.', { exact: false }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/credit-phone.png` });
  assert.equal(await page.locator('.gt-outbid-dialog').evaluate(el => { const r=el.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && el.scrollWidth<=el.clientWidth; }), true);
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log('TEST_PASSED:ReferralPanels desktop/phone, modal, copy, claim availability, shares and credit quote');
} finally { await writeFile(`${out}/report.json`, JSON.stringify(report,null,2)+'\n'); await browser.close(); await new Promise(done => server.httpServer.close(done)); }
