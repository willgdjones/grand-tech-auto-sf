/** Real funding dialogs, deferred fixture saves, no API and no game rendering. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage = process.env.GTASF_IDENTITY_STAGE === 'before' ? 'before' : 'after';
const out = resolve('artifacts/identity-save', stage);
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, logLevel: 'warn', resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
if (!process.argv.includes('--run-only')) {
  await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Identity save fixture</title><style>body{background:#263932;color:white;margin:0;font:16px Arial}</style><button id="outside">Other HUD</button><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`, `import {createFundingHud} from '${resolve('web/src/funding/hud.ts')}';
import {fundingRound} from '${resolve('shared/funding.ts')}';
let canonical={deviceId:'identity-fixture',startupName:'Original Startup',nickname:'Original Founder',totalCents:'0',todayCents:'0',round:fundingRound('0'),rank:null,todayRank:null,lastAwardAt:null,streak:0};
const pending=[],displays=[],modals=[],requests=[];
window.fetch=async(url)=>{requests.push(String(url));throw Error('Unexpected fixture request');};
const hud=createFundingHud({enabled:true,onSaveIdentity:(startupName,nickname)=>new Promise((resolve,reject)=>pending.push({resolve,reject,startupName,nickname})),
onRefreshLeaderboard:async()=>({you:canonical,week:[],today:[],serverNow:Date.now()}),onDisplayChange:value=>displays.push(value),onModalChange:value=>modals.push(value)});
hud.setProfile(canonical);
window.fixture={hud,pending,displays,modals,requests,async settle(ok=true){const request=pending.shift();if(!request)throw Error('No save pending');if(ok){canonical={...canonical,startupName:request.startupName,nickname:request.nickname};request.resolve(canonical);}else request.reject(new Error('Earlier save failed'));await Promise.resolve();await Promise.resolve();},get canonical(){return canonical;}};
`);
  await build(config);
}
if (process.argv.includes('--build-only')) { console.log('Built '+stage+' identity save fixture'); process.exit(0); }
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser; const report = { stage, scope: 'Deferred-save native DOM dialogs only; no API, ledger or native game gate', errors: [], views: [] };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [name, width, height] of [['desktop', 1100, 720], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    const startup = page.getByLabel('Startup name', { exact: true }), nickname = page.getByLabel('Your nickname', { exact: true });
    const identity = page.locator('.gt-funding-onboarding'), board = page.locator('.gt-funding-dialog:not(.gt-funding-onboarding)');
    const status = identity.locator('[role=status]'), save = page.getByRole('button', { name: 'Save startup', exact: true });
    const focused = locator => locator.evaluate(element => document.activeElement === element);
    const reset = async () => { await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.fixture); };
    const openIdentity = () => page.getByRole('button', { name: 'Edit startup name and nickname', exact: true }).click();
    const beginSave = async () => {
      await openIdentity(); await startup.fill('Submitted Startup'); await nickname.fill('Submitted Founder'); await save.click();
      assert.equal(await save.isDisabled(), true); assert.equal(await page.evaluate(() => window.fixture.pending.length), 1);
    };
    const settle = ok => page.evaluate(ok => window.fixture.settle(ok), ok);
    const cases = [];

    await reset(); await beginSave(); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open earned funding leaderboard', exact: true }).click();
    const boardClose = board.getByRole('button', { name: 'Close ×', exact: true });
    assert.equal(await focused(boardClose), true); await settle(true);
    assert.equal(await board.evaluate(element => element.open), stage === 'after');
    if (stage === 'after') assert.equal(await focused(boardClose), true);
    assert.equal(await page.getByRole('button', { name: 'Edit startup name and nickname', exact: true }).getAttribute('title'), 'Submitted Startup · Submitted Founder');
    cases.push(stage === 'before' ? 'late success closes newer board' : 'newer board and its focus survive success');

    await reset(); await beginSave(); await page.keyboard.press('Escape'); await openIdentity();
    await startup.fill('Reopened New Draft'); await nickname.fill('New Founder'); await startup.focus();
    await startup.evaluate(element => element.setSelectionRange(3, 3)); await settle(true);
    assert.equal(await identity.evaluate(element => element.open), stage === 'after');
    if (stage === 'after') {
      assert.equal(await startup.inputValue(), 'Reopened New Draft'); assert.equal(await nickname.inputValue(), 'New Founder');
      assert.equal(await focused(startup), true); assert.equal(await startup.evaluate(element => element.selectionStart), 3);
      assert.equal(await status.textContent(), ''); assert.equal(await save.isDisabled(), false);
    }
    cases.push(stage === 'before' ? 'late success closes reopened form' : 'reopened draft, focus and caret survive');

    await reset(); await beginSave(); await startup.fill('Edited During Save'); await startup.focus();
    await startup.evaluate(element => element.setSelectionRange(5, 5)); await settle(true);
    assert.equal(await identity.evaluate(element => element.open), stage === 'after');
    if (stage === 'after') {
      assert.equal(await startup.inputValue(), 'Edited During Save'); assert.equal(await focused(startup), true);
      assert.equal(await startup.evaluate(element => element.selectionStart), 5); assert.match(await status.textContent(), /earlier names were saved/i);
      assert.equal(await save.isDisabled(), false); await page.screenshot({ path: `${out}/${name}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await save.click(); await settle(true); assert.equal(await identity.evaluate(element => element.open), false);
      assert.equal(await page.evaluate(() => window.fixture.canonical.startupName), 'Edited During Save');
    }
    cases.push(stage === 'before' ? 'late success closes edited current form' : 'same-view draft survives and saves on retry');

    await reset(); await beginSave(); await page.keyboard.press('Escape'); await openIdentity();
    await startup.fill('New Session Draft'); await settle(false);
    assert.equal(await identity.evaluate(element => element.open), true);
    assert.equal(await status.textContent(), stage === 'before' ? 'Earlier save failed' : '');
    assert.equal(await startup.inputValue(), 'New Session Draft');
    cases.push(stage === 'before' ? 'old error contaminates new form' : 'old-view error ignored');

    if (stage === 'after') {
      await reset(); await beginSave(); await settle(true);
      assert.equal(await identity.evaluate(element => element.open), false); assert.equal(await page.evaluate(() => window.fixture.hud.isOpen), false);
      assert.equal(await page.evaluate(() => window.fixture.canonical.startupName), 'Submitted Startup');
      cases.push('unchanged normal save still closes');

      await reset(); await beginSave(); await settle(false);
      assert.equal(await identity.evaluate(element => element.open), true); assert.equal(await status.textContent(), 'Earlier save failed');
      assert.equal(await save.isDisabled(), false); await save.click(); await settle(true);
      assert.equal(await identity.evaluate(element => element.open), false);
      cases.push('current-view error is visible and retry works');

      await reset(); await beginSave();
      const counts = await page.evaluate(() => { window.fixture.hud.destroy(); return [window.fixture.displays.length, window.fixture.modals.length]; });
      await settle(true);
      assert.deepEqual(await page.evaluate(() => [window.fixture.displays.length, window.fixture.modals.length]), counts);
      assert.equal(await page.locator('.gt-funding-dialog').count(), 0);
      cases.push('disposed completion has no DOM or callback effects');
    }
    assert.deepEqual(await page.evaluate(() => window.fixture.requests), []);
    await page.evaluate(() => window.fixture.hud.destroy()); await page.close(); report.views.push({ name, cases });
  }
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify({ stage, passed: true, views: report.views.length, errors: report.errors }));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
}
