/** Actual Outbid dialog scroll/keyboard check; isolated snapshots, no payments. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage = process.env.GTASF_OUTBID_SCROLL_STAGE === 'after' ? 'after' : 'before';
const baselineCommit = 'ded1d24';
const out = resolve('artifacts/outbid-board-scroll', stage);
const source = stage === 'before' ? `${out}/source/panel.ts` : resolve(process.env.GTASF_OUTBID_SCROLL_SOURCE ?? 'web/src/outbid/panel.ts');
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, logLevel: 'warn', resolve: { alias: {
  '@gtasf/shared': resolve('shared'), '../analytics': resolve('web/src/analytics/index.ts'),
  './analyticsReceipt': resolve('web/src/outbid/analyticsReceipt.ts'),
  '../referrals/client': resolve('web/src/referrals/client.ts'),
} }, build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
if (!process.argv.includes('--run-only')) {
  if (stage === 'before') {
    await mkdir(`${out}/source`, { recursive: true });
    for (const name of ['panel.ts', 'outbid.css']) {
      try { await writeFile(`${out}/source/${name}`, execFileSync('git', ['show', `${baselineCommit}:web/src/outbid/${name}`]), { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
  }
  await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Outbid board scroll fixture</title><style>body{margin:150px 0 0;background:#293b34;color:white;font:16px Arial}button{font:inherit;cursor:pointer}</style><button id="game">Game control</button><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`, `import {createOutbidPanel} from '${source}';
import {flags} from '@gtasf/shared/flags';
if(!flags.outbidBanner || flags.outbidCheckout)throw Error('Requires enabled Outbid banner and disabled checkout');
const ids=Array.from({length:40},(_,i)=>i),requests=[],changes=[];let revision=1;
const snapshot=()=>({version:1,revision,currency:'usd',mode:'test',minimumBidCents:100,checkoutAvailable:false,entries:ids.map((id,i)=>({bidderId:'fixture-'+id,rank:i+1,name:'Company '+String(id+1).padStart(2,'0'),message:'Approved isolated fixture '+id+' revision '+revision,url:'https://example.com/bidder/'+id,totalCents:String(100000-i*1000)}))});
let current=snapshot();window.fetch=async (url,options)=>{requests.push({url:String(url),method:options?.method??'GET'});if(url!=='/api/outbid'||(options?.method&&options.method!=='GET'))throw Error('Unexpected request');return Response.json({snapshot:current});};
const panel=createOutbidPanel({onModalChange:open=>changes.push(open)}),dialog=document.querySelector('dialog');
window.fixture={panel,dialog,requests,changes,update(){revision++;current=snapshot();panel.setSnapshot(current);},state(){const d=dialog.getBoundingClientRect(),h=dialog.querySelector('h2').getBoundingClientRect(),first=dialog.querySelector('.gt-outbid-row a').getBoundingClientRect();return{scroll:dialog.scrollTop,dialogTop:d.top,dialogBottom:d.bottom,headingTop:h.top,firstTop:first.top,firstBottom:first.bottom,closeFocused:document.activeElement===dialog.querySelector('.gt-outbid-close')};}};
`);
  await build(config);
}
if (process.argv.includes('--build-only')) { console.log('Built '+stage+' Outbid board scroll fixture'); process.exit(0); }
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
const report = { checkedAt: new Date().toISOString(), stage, baselineCommit, source, sourceSha256: createHash('sha256').update(await readFile(source)).digest('hex'), scope: 'Actual Outbid HTML dialog and keyboard with isolated snapshots; no payment/native game evidence', errors: [], network: [], views: [], passed: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [name, width, height] of [['desktop',1100,720],['phone',390,844]]) {
    const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    page.on('request', request => report.network.push(new URL(request.url()).pathname));
    page.on('websocket', socket => report.errors.push('Unexpected socket '+socket.url()));
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.fixture && document.querySelectorAll('.gt-outbid-row').length === 40);
    const top50 = page.getByRole('button',{name:'Top 50',exact:true});
    const claim = page.getByRole('button',{name:'OUTBID THEM',exact:true});
    const bidder = page.getByLabel('Name or company'), message = page.getByLabel('Short message',{exact:true});
    await top50.click();
    const initial = await page.evaluate(() => window.fixture.state());
    assert.equal(initial.scroll,0); assert(initial.firstTop>initial.dialogTop && initial.firstBottom<initial.dialogBottom);
    await page.keyboard.press('Escape'); assert.equal(await top50.evaluate(el=>el===document.activeElement),true);
    await claim.click(); assert.equal(await bidder.evaluate(el=>el===document.activeElement),true);
    await bidder.fill('Keep this draft'); await message.fill('A preserved local draft');
    const bidScroll = await page.locator('dialog').evaluate(el=>el.scrollTop); assert(bidScroll>1000);
    await page.keyboard.press('Escape'); assert.equal(await claim.evaluate(el=>el===document.activeElement),true);
    await top50.click();
    const reopened = await page.evaluate(() => window.fixture.state());
    assert.equal(reopened.closeFocused,true);
    await page.screenshot({path:`${out}/${name}-reopened.png`});
    if (stage === 'before') {
      assert(reopened.scroll>1000,'Reproduce retained bid-form scroll on Top 50 reopening');
      assert(reopened.firstBottom<reopened.dialogTop,'Reproduce hidden top-ranked bidder');
    } else {
      assert.equal(reopened.scroll,0); assert(reopened.headingTop>=reopened.dialogTop);
      assert(reopened.firstTop>reopened.dialogTop && reopened.firstBottom<reopened.dialogBottom);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('href')),'https://example.com/bidder/0');
      for(let i=0;i<15;i++)await page.keyboard.press('Tab');
      const reading = await page.evaluate(()=>{const f=window.fixture,a=document.activeElement,s=f.dialog.scrollTop;f.update();return{same:a===document.activeElement,scroll:f.dialog.scrollTop,oldScroll:s,href:a.getAttribute('href')};});
      assert(reading.oldScroll>0);assert.equal(reading.same,true);assert.equal(reading.scroll,reading.oldScroll);
      assert.equal(reading.href,'https://example.com/bidder/15');
      await page.keyboard.press('Escape'); await claim.click();
      assert.equal(await bidder.inputValue(),'Keep this draft');assert.equal(await message.inputValue(),'A preserved local draft');
      assert.equal(await bidder.evaluate(el=>el===document.activeElement),true);
      const bidVisible=await bidder.evaluate(el=>{const r=el.getBoundingClientRect(),d=document.querySelector('dialog').getBoundingClientRect();return r.top>=d.top&&r.bottom<=d.bottom;});assert.equal(bidVisible,true);
      assert.equal(await page.getByRole('button',{name:'Continue to test Checkout'}).isDisabled(),true);
      await page.screenshot({path:`${out}/${name}-bid.png`});
      await page.keyboard.press('Escape');await top50.click();assert.equal(await page.locator('dialog').evaluate(el=>el.scrollTop),0);
      await page.keyboard.press('Escape');assert.equal(await top50.evaluate(el=>el===document.activeElement),true);
    }
    assert.equal(await page.evaluate(()=>window.fixture.requests.every(r=>r.url==='/api/outbid'&&r.method==='GET')),true);
    await page.evaluate(()=>window.fixture.panel.destroy());assert.equal(await page.locator('.gt-outbid-dialog,.gt-outbid-banner').count(),0);
    report.views.push({name,initial,bidScroll,reopened});await page.close();
  }
  assert.deepEqual(report.errors,[]);assert.equal(report.network.some(path=>path.startsWith('/api/')||path.startsWith('/map/')),false);
  report.passed=true;console.log(JSON.stringify({stage,passed:true,views:report.views,errors:report.errors}));
}catch(error){report.failure=error.message;throw error;}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser?.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));}
