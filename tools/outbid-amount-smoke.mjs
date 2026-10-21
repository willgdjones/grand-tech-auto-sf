/** Manual draft amount versus live lead quote, with no Checkout/provider traffic. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage = process.env.GTASF_AMOUNT_STAGE === 'before' ? 'before' : 'after';
const out = resolve('artifacts/outbid-amount', stage);
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, logLevel: 'warn', resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
if (!process.argv.includes('--run-only')) {
  await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Outbid amount fixture</title><style>body{background:#263932;color:white;margin:0}button{color:inherit;border:1px solid #66796b;cursor:pointer}</style><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`, `import {createOutbidPanel} from '${resolve('web/src/outbid/panel.ts')}';
let revision=1,total=1000;
const snapshot=()=>({version:1,revision,currency:'usd',mode:'test',minimumBidCents:100,checkoutAvailable:false,
 entries:[{bidderId:'fixture-leader',rank:1,name:'Fixture leader',message:'Approved isolated test snapshot',url:'https://example.com/',totalCents:String(total)}]});
const requests=[];window.fetch=async(url,options={})=>{requests.push({url,method:options.method||'GET'});if(url!=='/api/outbid'||options.method&&options.method!=='GET')throw new Error('Unexpected fixture request');return Response.json({snapshot:snapshot()});};
const panel=createOutbidPanel();window.fixture={panel,requests,update(next){total=next;revision++;panel.setSnapshot(snapshot());},destroy(){panel.destroy();}};
`);
  await build(config);
}
if (process.argv.includes('--build-only')) { console.log('Built '+stage+' Outbid amount fixture'); process.exit(0); }
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser; const report = { stage, scope: 'Isolated DOM draft amount; no payment or native World acceptance', errors: [], views: [] };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [name, width, height] of [['desktop', 1100, 720], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', e => report.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.fixture && document.querySelector('.gt-outbid-target').textContent.includes('10.01'));
    await page.locator('.gt-outbid-claim').click();
    const amount = page.getByLabel('Add to your total · USD'), bidder = page.getByLabel('Name or company');
    assert.equal(await amount.inputValue(), '10.01');
    await page.evaluate(() => window.fixture.update(2000));
    assert.equal(await amount.inputValue(), '20.01', 'Untouched default follows confirmed lead');
    await amount.fill(''); await amount.pressSequentially('7.25');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('type')), 'url');
    await bidder.fill('My draft company'); await page.keyboard.press('ArrowLeft');
    const caret = await bidder.evaluate(e => e.selectionStart);
    await page.evaluate(() => window.fixture.update(3000));
    const value = await amount.inputValue(), quote = await page.locator('.gt-outbid-quote').textContent();
    assert.match(quote, /30\.01/); assert.equal(await page.locator('.gt-outbid-submit').isDisabled(), true);
    if (stage === 'before') {
      assert.equal(value, '30.01', 'Original regression must overwrite the chosen 7.25 after blur');
      report.views.push({ name, chosen: '7.25', overwritten: value, quote });
    } else {
      assert.equal(value, '7.25'); assert.equal(await bidder.inputValue(), 'My draft company');
      assert.equal(await bidder.evaluate(e => e.selectionStart), caret);
      assert.equal(await bidder.evaluate(e => document.activeElement === e), true);
      await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog').open);
      await page.locator('.gt-outbid-claim').click(); await page.waitForFunction(() => document.querySelector('dialog').open);
      await page.evaluate(() => window.fixture.panel.refresh());
      assert.equal(await amount.inputValue(), '7.25', 'Reopening and HTTP refresh preserve the manual amount');
      await page.screenshot({ path: `${out}/${name}.png` });
      const drafts = [];
      for (const [draft, total] of [['', 4000], ['abc', 5000], ['0.50', 6000]]) {
        await amount.fill(draft); await page.keyboard.press('Shift+Tab');
        await page.evaluate(total => window.fixture.update(total), total);
        assert.equal(await amount.inputValue(), draft, 'Invalid or empty draft is not silently replaced');
        drafts.push({ draft, current: await amount.inputValue() });
      }
      report.views.push({ name, chosen: '7.25', retained: value, quote, drafts });
    }
    const requests = await page.evaluate(() => window.fixture.requests);
    assert(requests.every(r => r.url === '/api/outbid' && r.method === 'GET'));
    assert.equal(await page.locator('.gt-outbid-submit').isDisabled(), true);
    if (stage === 'before') await page.screenshot({ path: `${out}/${name}.png` });
    await page.evaluate(() => window.fixture.destroy());
    assert.equal(await page.locator('.gt-outbid-dialog,.gt-outbid-banner').count(), 0);
    await page.close();
  }
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify({ stage, passed: true, views: report.views.length, errors: report.errors }));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(r => server.httpServer.close(r));
}
