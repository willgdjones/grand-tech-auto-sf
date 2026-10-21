/** Real Outbid DOM with isolated transport stalls; no game/GPU/provider acceptance. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const out = resolve('artifacts/outbid-refresh');
await mkdir(out, { recursive: true });
await writeFile(`${out}/index.html`, '<!doctype html><html><head><title>Outbid refresh fixture</title></head><body><script type="module" src="/entry.js"></script></body></html>');
await writeFile(`${out}/entry.js`, `import {createOutbidPanel} from '${resolve('web/src/outbid/panel.ts')}';
const snapshot = (revision, name) => ({ snapshot: {version:1, revision, currency:'usd', mode:'test', minimumBidCents:100, checkoutAvailable:false,
  entries:[{bidderId:'fixture',rank:1,name,message:'Confirmed fixture',url:'https://example.com/',totalCents:'1000'}] } });
let panel;
window.fixture = {
  start(stage) {
    panel?.destroy();
    this.calls=0; this.signals=[]; this.stage=stage; this.release=undefined; this.done=false; this.snapshots=[];
    window.fetch = async (url, options) => {
      if (url !== '/api/outbid') throw new Error('Unexpected fixture request: '+url);
      this.calls++; this.signals.push(options.signal);
      if (this.stage === 'headers') return new Promise(resolve => {this.release = () => resolve(Response.json(snapshot(99,'Late stale response')))});
      if (this.stage === 'body') return {ok:true, json:()=>new Promise(resolve => {this.release=()=>resolve(snapshot(99,'Late stale response'))})};
      return Response.json(snapshot(2,'Recovered leaderboard'));
    };
    panel=createOutbidPanel({onSnapshot:s=>this.snapshots.push(s.revision)});
  },
  refresh() { this.done=false; void panel.refresh().then(()=>{this.done=true}); },
  destroy() { panel.destroy(); },
};`);
const config = { configFile: false, root: out, logLevel: 'warn',
  resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
const browser = await chromium.launch({ args: ['--disable-gpu'] });
const report = { scope: 'Outbid DOM response-stall recovery only', errors: [], cases: [] };
try {
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.clock.install();
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => Boolean(window.fixture));
  await page.evaluate(() => window.fixture.start('headers'));
  await page.clock.runFor(4001);
  assert.equal(await page.locator('.gt-outbid-name').textContent(), 'Leaderboard reconnecting…');
  assert.match(await page.locator('.gt-outbid-status').textContent(), /Please try again/);
  assert.equal(await page.evaluate(() => window.fixture.signals[0].aborted), true);
  await page.evaluate(() => { window.fixture.stage='success'; window.fixture.refresh(); });
  await page.waitForFunction(() => window.fixture.done);
  assert.match(await page.locator('.gt-outbid-name').textContent(), /Recovered leaderboard/);
  assert.equal(await page.evaluate(() => window.fixture.calls), 2);
  await page.evaluate(() => window.fixture.release());
  await page.clock.runFor(1);
  assert.match(await page.locator('.gt-outbid-name').textContent(), /Recovered leaderboard/);
  report.cases.push('Header stall aborts; next explicit refresh succeeds; late response ignored');

  await page.evaluate(() => window.fixture.start('body'));
  await page.waitForFunction(() => Boolean(window.fixture.release));
  await page.evaluate(() => { for(let i=0;i<20;i++) window.fixture.refresh(); window.fixture.stage='success'; });
  assert.equal(await page.evaluate(() => window.fixture.calls), 1);
  await page.clock.runFor(4001);
  await page.waitForFunction(() => window.fixture.calls === 2 && window.fixture.snapshots.length === 1);
  assert.equal(await page.evaluate(() => window.fixture.signals[0].aborted), true);
  assert.match(await page.locator('.gt-outbid-name').textContent(), /Recovered leaderboard/);
  await page.evaluate(() => window.fixture.release());
  await page.clock.runFor(1);
  assert.deepEqual(await page.evaluate(() => window.fixture.snapshots), [2]);
  report.cases.push('JSON body stall aborts; twenty queued refreshes coalesce to one successful retry');

  await page.evaluate(() => { window.fixture.start('body'); window.fixture.refresh(); });
  await page.waitForFunction(() => Boolean(window.fixture.release));
  await page.evaluate(() => window.fixture.destroy());
  await page.waitForFunction(() => window.fixture.done);
  assert.equal(await page.evaluate(() => window.fixture.signals[0].aborted), true);
  await page.evaluate(() => window.fixture.release());
  await page.clock.runFor(4001);
  assert.equal(await page.locator('.gt-outbid-banner').count(), 0);
  assert.deepEqual(await page.evaluate(() => ({ calls:window.fixture.calls, snapshots:window.fixture.snapshots })), {calls:1,snapshots:[]});
  report.cases.push('Destroy aborts and releases pending refresh immediately, with no retry or late update');
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log('TEST_PASSED:OutbidRefreshRecovery');
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)+'\n');
  await browser.close(); server.httpServer.closeAllConnections();
  await new Promise(done => server.httpServer.close(done));
}
