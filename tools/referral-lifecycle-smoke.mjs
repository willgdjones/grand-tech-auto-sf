/** Referral dialog lifecycle; real panel with inert profile functions and no external requests. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage = process.env.GTASF_REFERRAL_STAGE === 'before' ? 'before' : 'after';
const out = resolve('artifacts/referral-lifecycle', stage);
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, logLevel: 'warn', resolve: { alias: [
  { find: './client', replacement: `${out}/client.js` }, { find: '@gtasf/shared', replacement: resolve('shared') },
] }, build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
if (!process.argv.includes('--run-only')) {
  await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Referral dialog fixture</title><style>body{background:#263932;color:white;margin:20px;font:16px Arial}button,input{font:inherit}</style><button id="game">Game control</button><input id="other" aria-label="Another panel field"><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/client.js`, `export async function initReferrals(){};
export async function refreshReferralProfile(){return {clicks:3,players:2,pendingCents:'200',availableCents:'100',debtCents:'0',claimed:false,claimEnabled:false};}
export async function referralShareUrl(){return 'https://example.com/?ref=isolated';}
export function referralClaimMessage(){return '';}
export async function referralAction(){throw Error('No claim action belongs in this lifecycle fixture');}
`);
  await writeFile(`${out}/entry.js`, `import {createReferralPanel} from '${resolve('web/src/referrals/panel.ts')}';
const changes=[],requests=[];window.fetch=async(url)=>{requests.push(String(url));throw Error('Unexpected fixture request');};
const panel=createReferralPanel({onModalChange:open=>changes.push(open)}),dialog=document.querySelector('.gt-referral-panel');
window.fixture={panel,dialog,changes,requests,closeEvents:0};dialog.addEventListener('close',()=>window.fixture.closeEvents++);
`);
  await build(config);
}
if (process.argv.includes('--build-only')) { console.log('Built '+stage+' referral lifecycle fixture'); process.exit(0); }
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser; const report = { stage, scope: 'Native referral DOM dialog with inert profile functions; no API, provider, payment or game gate', errors: [], views: [] };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [name, width, height] of [['desktop', 1100, 720], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    page.on('websocket', () => report.errors.push('Unexpected fixture WebSocket'));
    const game = page.locator('#game'), other = page.locator('#other'), launch = page.locator('.gt-referral-launch');
    const dialog = page.locator('.gt-referral-panel'), email = page.getByLabel('Claim your earnings with email', { exact: true });
    const focused = locator => locator.evaluate(element => document.activeElement === element);
    const reset = async () => { await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.fixture); };
    const waitClose = count => page.waitForFunction(count => window.fixture.closeEvents === count, count);
    const cases = [];

    await reset(); await game.focus();
    await page.evaluate(() => { const f=window.fixture;f.panel.open();f.panel.hide();document.querySelector('#other').focus(); });
    await waitClose(1);
    assert.equal(await focused(stage === 'before' ? game : other), true);
    assert.deepEqual(await page.evaluate(() => window.fixture.changes), [true, false]);
    cases.push(stage === 'before' ? 'queued close steals next-panel focus' : 'next-panel focus survives queued close');

    await reset(); await game.focus();
    const immediate = await page.evaluate(() => { const f=window.fixture;f.panel.open();f.panel.hide();f.panel.open();return [...f.changes]; });
    assert.deepEqual(immediate, stage === 'before' ? [true, true] : [true, false, true]);
    await waitClose(1);
    assert.deepEqual(await page.evaluate(() => window.fixture.changes), stage === 'before' ? [true, true, false] : [true, false, true]);
    assert.equal(await page.evaluate(() => window.fixture.panel.modalOpen), true);
    cases.push(stage === 'before' ? 'reopened dialog incorrectly announces closed' : 'hide and reopen callbacks remain synchronous');

    await reset(); await game.focus();
    await page.evaluate(() => { const f=window.fixture;f.panel.open();f.dialog.close();f.panel.open(); }); await waitClose(1);
    assert.deepEqual(await page.evaluate(() => window.fixture.changes), stage === 'before' ? [true, true, false] : [true, false, true]);
    assert.equal(await page.evaluate(() => window.fixture.panel.modalOpen), true);
    cases.push(stage === 'before' ? 'native close and reopen has stale callback' : 'native close and reopen reconciles previous state');

    if (stage === 'after') {
      await reset(); await launch.click(); await email.fill('draft@example.com');
      await page.keyboard.press('Escape'); await waitClose(1); assert.equal(await focused(launch), true);
      assert.equal(await page.evaluate(() => window.fixture.panel.modalOpen), false);
      await launch.click(); assert.equal(await email.inputValue(), 'draft@example.com');
      await email.focus(); await page.screenshot({ path: `${out}/${name}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const changes = await page.evaluate(() => { const f=window.fixture;f.changes.length=0;f.panel.hide();f.panel.hide();return [...f.changes]; });
      assert.deepEqual(changes, [false]); await waitClose(2); assert.deepEqual(await page.evaluate(() => window.fixture.changes), [false]);
      cases.push('physical Escape restores native launcher and retains email draft');
      cases.push('duplicate hide announces close once');

      await page.evaluate(() => { const f=window.fixture;f.changes.length=0;f.panel.open();f.dialog.close(); }); await waitClose(3);
      assert.deepEqual(await page.evaluate(() => window.fixture.changes), [true, false]);
      cases.push('browser-originated close announces once');
      await page.evaluate(() => { const f=window.fixture;f.changes.length=0;f.panel.open();f.panel.destroy();f.panel.destroy();document.querySelector('#other').focus(); });
      await waitClose(4); assert.deepEqual(await page.evaluate(() => window.fixture.changes), [true, false]);
      assert.equal(await focused(other), true); await page.evaluate(() => window.fixture.panel.open());
      assert.equal(await dialog.count(), 0); assert.equal(await launch.count(), 0);
      cases.push('destroy announces once without later focus theft or reopening');
    }
    assert.deepEqual(await page.evaluate(() => window.fixture.requests), []);
    await page.evaluate(() => window.fixture.panel.destroy()); await page.close(); report.views.push({ name, cases });
  }
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify({ stage, passed: true, views: report.views.length, errors: report.errors }));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
}
