/** Real Outbid DOM and keyboard only; public snapshots are isolated fixtures. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage = process.env.GTASF_FOCUS_STAGE === 'before' ? 'before' : 'after';
const out = resolve('artifacts/outbid-focus', stage);
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, logLevel: 'warn',
  resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
if (!process.argv.includes('--run-only')) {
  await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Outbid focus fixture</title><style>body{background:#263932;color:white;margin:0}button{color:inherit;border:1px solid #66796b;cursor:pointer}#other{margin-top:140px}</style><button id="other">Other control</button><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`, `import {createOutbidPanel} from '${resolve('web/src/outbid/panel.ts')}';
const ids=Array.from({length:40},(_,i)=>i);let revision=1;
function snapshot(order=ids){return {version:1,revision,currency:'usd',mode:'test',minimumBidCents:100,checkoutAvailable:false,
 entries:order.map((id,index)=>({bidderId:'fixture-'+id,rank:index+1,name:'Company '+String(id).padStart(2,'0'),message:'Approved fixture message '+id+' · revision '+revision,url:'https://example.com/bidder/'+id,totalCents:String(100000-index*1000)}))};}
let current=snapshot();window.fetch=async url=>{if(url!=='/api/outbid')throw new Error('Unexpected fixture request '+url);return Response.json({snapshot:current});};
const panel=createOutbidPanel();
window.fixture={panel,remember(){this.active=document.activeElement;this.scroll=document.querySelector('dialog').scrollTop;this.top=this.active.getBoundingClientRect().top;},
 update(order=ids){revision++;current=snapshot(order);return panel.setSnapshot(current);},
 reorder(){const order=ids.filter(i=>i!==9);order.splice(15,0,9);this.update(order);},
 remove(){this.update(ids.filter(i=>i!==9));},empty(){this.update([]);},
 state(){const active=document.activeElement,dialog=document.querySelector('dialog');return {same:active===this.active,active:active?.textContent,href:active?.getAttribute('href'),scroll:dialog?.scrollTop,top:active?.getBoundingClientRect().top,rememberedScroll:this.scroll,rememberedTop:this.top};},
 stale(){return panel.setSnapshot({...current,revision:0});},destroy(){panel.destroy();}};
`);
  await build(config);
}
if (process.argv.includes('--build-only')) { console.log('Built '+stage+' Outbid focus fixture'); process.exit(0); }
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser;
const report = { stage, scope: 'Real DOM keyboard and isolated approved snapshot updates; no payment, server or GPU acceptance', errors: [], cases: [], views: [] };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [name, width, height] of [['desktop', 1100, 720], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.fixture && document.querySelectorAll('.gt-outbid-row').length === 40);
    await page.locator('.gt-outbid-board-button').first().click();
    await page.waitForFunction(() => document.querySelector('dialog').open);
    for (let i = 0; i < 10; i++) await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), 'https://example.com/bidder/9');
    await page.evaluate(() => { window.fixture.remember(); window.fixture.update(); });
    const content = await page.evaluate(() => window.fixture.state());
    if (stage === 'before') {
      assert.equal(content.same, false, 'The original focus-loss regression must be reproduced');
      report.views.push({ name, originalFailure: content });
      await page.screenshot({ path: `${out}/${name}.png` });
      await page.evaluate(() => window.fixture.destroy()); await page.close(); continue;
    }
    assert.equal(content.same, true); assert.equal(content.href, 'https://example.com/bidder/9');
    assert(Math.abs(content.scroll - content.rememberedScroll) <= 1, 'Content-only refresh retains scroll');
    await page.evaluate(() => { window.fixture.remember(); window.fixture.reorder(); });
    const reordered = await page.evaluate(() => window.fixture.state());
    assert.equal(reordered.same, true); assert.equal(reordered.href, 'https://example.com/bidder/9');
    assert(Math.abs(reordered.top - reordered.rememberedTop) <= 2, 'The focused bidder remains at the same visible scroll position');
    assert.equal(await page.locator('.gt-outbid-row').nth(15).locator('a').getAttribute('href'), 'https://example.com/bidder/9');
    assert.match(await page.locator('.gt-outbid-row').nth(15).textContent(), /#16/);
    await page.screenshot({ path: `${out}/${name}-reordered.png` });
    assert.equal(await page.evaluate(() => window.fixture.stale()), false);
    assert.equal(await page.evaluate(() => window.fixture.state().same), true);
    await page.evaluate(() => window.fixture.remove());
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Close Outbid');
    const bidder = page.getByLabel('Name or company'); await bidder.fill('My draft');
    await page.keyboard.press('ArrowLeft');
    const caret = await bidder.evaluate(e => e.selectionStart);
    await page.evaluate(() => { window.fixture.remember(); window.fixture.update(); });
    assert.equal(await page.evaluate(() => window.fixture.state().same), true);
    assert.equal(await bidder.inputValue(), 'My draft'); assert.equal(await bidder.evaluate(e => e.selectionStart), caret);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog').open);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'gt-outbid-board-button');
    await page.locator('.gt-outbid-message a').focus();
    await page.evaluate(() => { window.fixture.remember(); window.fixture.update(); });
    assert.equal(await page.evaluate(() => window.fixture.state().same), true, 'Winner link stays keyboard focused');
    await page.evaluate(() => window.fixture.empty());
    assert.equal(await page.evaluate(() => document.activeElement.className), 'gt-outbid-board-button');
    await page.locator('#other').focus();
    await page.evaluate(() => { window.fixture.remember(); window.fixture.update(); });
    assert.equal(await page.evaluate(() => window.fixture.state().same), true, 'Unrelated focus is not stolen');
    await page.evaluate(() => window.fixture.destroy());
    assert.equal(await page.locator('.gt-outbid-dialog,.gt-outbid-banner').count(), 0);
    assert.equal(await page.evaluate(() => document.body.classList.contains('gt-outbid-active')), false);
    report.views.push({ name, content, reordered, disposed: true }); await page.close();
  }
  assert.deepEqual(report.errors, []);
  report.cases = stage === 'before' ? ['Original update removes focused bidder link in both viewports'] : ['Content refresh retains focused link and scroll', 'Reorder retains bidder identity and visible anchor', 'Stale revision rejected', 'Removed bidder falls back to Close', 'Form draft/caret retained', 'Escape returns launcher focus', 'Banner update retains focus; empty result focuses Top50', 'Unrelated focus retained; disposal removes UI'];
  report.passed = true; console.log(JSON.stringify({ stage, passed: true, views: report.views.length, errors: report.errors }));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(r => server.httpServer.close(r));
}
