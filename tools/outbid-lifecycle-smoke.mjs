/** Native dialog lifecycle with real Outbid UI; approved snapshot fixture, no API/payment traffic. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const out = resolve(process.argv[2] ?? `artifacts/outbid-lifecycle/${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(out, { recursive: true });
const entry = `
import {createOutbidPanel} from './web/src/outbid/panel';
import {flags} from './shared/flags';
if(!flags.outbidBanner||flags.outbidCheckout)throw Error('This check requires the existing banner enabled and payment checkout disabled.');
const requests=[],changes=[],snapshot={version:1,revision:1,currency:'usd',mode:'test',minimumBidCents:100,checkoutAvailable:false,entries:[{bidderId:'fixture',rank:1,name:'Lifecycle fixture',message:'Approved isolated snapshot',url:'https://example.com/fixture',totalCents:'1000'}]};
window.fetch=async url=>{requests.push(String(url));if(url!=='/api/outbid')throw Error('Unexpected isolated request '+url);return Response.json({snapshot});};
const panel=createOutbidPanel({onModalChange:open=>changes.push(open)}),dialog=document.querySelector('.gt-outbid-dialog');
window.fixture={panel,dialog,requests,changes,closeEvents:0};dialog.addEventListener('close',()=>window.fixture.closeEvents++);
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: resolve('.'), loader: 'ts' }, bundle: true,
  alias: { '@gtasf/shared': resolve('shared') }, outfile: `${out}/app.js`, write: false,
  format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'error' });
for (const file of bundle.outputFiles) await writeFile(file.path, file.contents, { flag: 'wx' });
await writeFile(`${out}/index.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><title>Outbid lifecycle check</title><style>body{margin:140px 0 0;background:#304b44;color:white;font:16px Arial}</style></head><body><p>Isolated Outbid lifecycle check · no real payments</p><button id="launcher">Game focus</button><input id="other" aria-label="Other panel input"><script type="module" src="/app.js"></script></body></html>`, { flag: 'wx' });
const server = createServer(async (req, res) => {
  const name = ({ '/': 'index.html', '/app.js': 'app.js', '/app.css': 'app.css' })[(req.url ?? '/').split('?')[0]];
  if (!name) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(name)]);
  res.end(await readFile(`${out}/${name}`));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const report = { checkedAt: new Date().toISOString(), errors: [], network: [], views: [], passed: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const viewport of [{ width: 1100, height: 760 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }); page.setDefaultTimeout(5000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    page.on('request', request => report.network.push(new URL(request.url()).pathname));
    page.on('websocket', socket => report.errors.push(`Unexpected socket: ${socket.url()}`));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => !!window.fixture && document.querySelectorAll('.gt-outbid-row').length === 1);
    const launcher = page.locator('#launcher'), other = page.locator('#other'), bidder = page.getByLabel('Name or company');
    const focused = locator => locator.evaluate(element => document.activeElement === element);
    await launcher.focus(); await page.evaluate(() => window.fixture.panel.open());
    await page.evaluate(() => { window.fixture.panel.hide(); document.querySelector('#other').focus(); });
    await page.waitForFunction(() => window.fixture.closeEvents === 1);
    const handoff = await page.evaluate(() => ({ changes: [...window.fixture.changes], active: document.activeElement.id }));
    report.views.push({ width: viewport.width, handoff });
    assert.equal(await focused(other), true, 'A queued Outbid close event must not steal focus from the next panel');
    assert.deepEqual(handoff.changes, [true, false]);

    const immediate = await page.evaluate(() => {
      const f = window.fixture; f.changes.length = 0; document.querySelector('#launcher').focus();
      f.panel.open(); f.panel.hide(); f.panel.open(true);
      return { changes: [...f.changes], open: f.panel.modalOpen };
    });
    assert.deepEqual(immediate, { changes: [true, false, true], open: true }, 'Modal callbacks must follow hide/reopen synchronously');
    await page.waitForFunction(() => window.fixture.closeEvents === 2);
    assert.deepEqual(await page.evaluate(() => window.fixture.changes), [true, false, true]);
    assert.equal(await focused(bidder), true); await bidder.fill('Keep my draft');
    await page.getByLabel('Short message', { exact: true }).fill('Draft survives closing and reopening');
    const closed = await page.evaluate(() => { const f = window.fixture; f.changes.length = 0; f.panel.hide(); f.panel.hide(); return [...f.changes]; });
    assert.deepEqual(closed, [false]); await page.waitForFunction(() => window.fixture.closeEvents === 3);
    assert.deepEqual(await page.evaluate(() => window.fixture.changes), [false]); assert.equal(await focused(launcher), true);

    await page.locator('.gt-outbid-claim').click(); assert.equal(await focused(bidder), true);
    assert.equal(await bidder.inputValue(), 'Keep my draft');
    assert.equal(await page.getByLabel('Short message', { exact: true }).inputValue(), 'Draft survives closing and reopening');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => window.fixture.closeEvents === 4);
    assert.equal(await focused(page.locator('.gt-outbid-claim')), true);
    assert.equal(await page.evaluate(() => window.fixture.panel.modalOpen), false);

    // Browser-originated close also completes exactly once; a later queued event
    // from a previous lifecycle must not release a reopened modal.
    await launcher.focus(); await page.evaluate(() => { const f=window.fixture;f.changes.length=0;f.panel.open();f.dialog.close(); });
    await page.waitForFunction(() => window.fixture.closeEvents === 5);
    assert.deepEqual(await page.evaluate(() => window.fixture.changes), [true, false]);
    await page.evaluate(() => { const f=window.fixture;f.changes.length=0;f.panel.open();f.dialog.close();f.panel.open(); });
    await page.waitForFunction(() => window.fixture.closeEvents === 6);
    assert.deepEqual(await page.evaluate(() => window.fixture.changes), [true, false, true]);
    await page.evaluate(() => window.fixture.panel.hide()); await page.waitForFunction(() => window.fixture.closeEvents === 7);
    await page.evaluate(() => { const f=window.fixture;f.changes.length=0;f.panel.open();f.panel.destroy();f.panel.destroy();document.querySelector('#other').focus(); });
    await page.waitForFunction(() => window.fixture.closeEvents === 8);
    assert.deepEqual(await page.evaluate(() => window.fixture.changes), [true, false]); assert.equal(await focused(other), true);
    await page.evaluate(() => window.fixture.panel.open());
    assert.equal(await page.locator('.gt-outbid-dialog,.gt-outbid-banner').count(), 0);
    assert.equal(await page.evaluate(() => document.body.classList.contains('gt-outbid-active')), false);
    assert.equal(await page.evaluate(() => window.fixture.requests.every(url => url === '/api/outbid')), true);
    report.views.at(-1).checks = ['Same-turn panel handoff', 'Synchronous hide/reopen and ignored stale close', 'Repeated hide emits once', 'Native Escape returns launcher focus', 'Draft fields preserved', 'Browser close emits once', 'Destroy clears state/listeners without delayed focus theft'];
    await page.close();
  }
  assert.deepEqual(report.errors, []); assert.equal(report.network.some(path => path.startsWith('/api/') || path.startsWith('/map/')), false);
  report.passed = true; console.log('TEST_PASSED:OutbidDialogLifecycle');
} catch (error) { report.failure = error.message; throw error; }
finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
}
