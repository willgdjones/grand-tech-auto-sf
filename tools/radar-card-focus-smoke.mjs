/** Fifty-result GPS keyboard selection; real module, fixture roads and no backend. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage = process.env.GTASF_RADAR_FOCUS_STAGE === 'before' ? 'before' : 'after';
const out = resolve('artifacts/radar-card-focus', stage);
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, logLevel: 'warn', resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
if (!process.argv.includes('--run-only')) {
  await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>GPS card focus fixture</title><style>body{background:#263932;color:white;margin:0;font:16px Arial}</style><button id="outside">Other HUD</button><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`, `import {createRadar} from '${resolve('web/src/radar/radar.ts')}';
const graph={version:1,nodes:[{id:'a',x:0,y:0,z:0},{id:'b',x:500,y:0,z:0}],edges:[{id:'lane:fixture',from:'a',to:'b',lengthM:500,speedMps:10,lane:1,points:[[0,0,0],[500,0,0]]}]};
const events=Array.from({length:50},(_,i)=>({id:'event-'+i,title:'Event '+String(i+1).padStart(2,'0')+' from the calendar',start:'2026-10-05T18:00:00Z',lat:37.7955,lon:-122.3936+i*.00005,approx:false,url:'https://example.com/event/'+i}));
const calls=[],requests=[];window.fetch=async(url)=>{requests.push(url);throw Error('Unexpected fixture request');};
const radar=createRadar({graph,routeGraph:graph,frame:{origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0},autoLoad:false,
 landmarks:[{id:'landmark',title:'Fixture landmark',x:200,y:0,z:0}],onSelect:value=>calls.push(value)});
await radar.routingReady;radar.setEvents(events);
window.fixture={radar,calls,requests,refresh(){radar.setEvents(events.map(event=>({...event,host:'Updated host'})));},longCard(){radar.setEvents([{...events[0],title:'Detailed founder gathering '.repeat(16),host:'An extended list of community hosts '.repeat(10),venue:'Full public venue information '.repeat(10)}]);},destroy(){radar.destroy();}};
`);
  await build(config);
}
if (process.argv.includes('--build-only')) { console.log('Built '+stage+' GPS card focus fixture'); process.exit(0); }
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser; const report = { stage, scope: 'Isolated GPS DOM with fifty fixture events; no native/game gate', errors: [], views: [] };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [name, width, height] of [['desktop', 1100, 720], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.fixture);
    const open = page.getByRole('button', { name: 'Open event map', exact: true });
    const rows = page.locator('.gt-radar-list button'), drive = page.getByRole('button', { name: 'Set destination', exact: true });
    const focused = locator => locator.evaluate(element => document.activeElement === element);
    const actionVisible = () => drive.evaluate(element => {
      const rect = element.getBoundingClientRect(), panel = document.querySelector('.gt-radar-panel').getBoundingClientRect();
      return rect.top >= panel.top - 1 && rect.bottom <= panel.bottom + 1 && rect.left >= 0 && rect.right <= innerWidth;
    });
    await open.click(); assert.equal(await rows.count(), 50);
    await page.keyboard.press('Tab'); assert.equal(await focused(rows.first()), true);
    await page.keyboard.press('Enter');
    if (stage === 'before') {
      assert.equal(await focused(rows.first()), true);
      await page.keyboard.press('Tab'); assert.equal(await focused(rows.nth(1)), true);
      report.views.push({ name, resultCount: 50, focusStayedInResults: true, nextTabSelectedAnotherResult: true });
    } else {
      assert.equal(await focused(drive), true, 'Enter on a result immediately reaches its route action');
      assert.equal(await actionVisible(), true);
      await page.evaluate(() => window.fixture.refresh()); assert.equal(await focused(drive), true);
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => window.fixture.calls[0].id), 'event-0');
      assert.equal(await page.evaluate(() => window.fixture.radar.isExpanded), false);
      await open.click(); await rows.last().click();
      assert.equal(await focused(drive), true, 'Pointer selection also exposes the chosen card action');
      assert.equal(await actionVisible(), true);
      assert.match(await page.locator('.gt-radar-card h3').textContent(), /Event 50/);
      await page.screenshot({ path: `${out}/${name}.png` });
      await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => window.fixture.radar.isExpanded), false);
      await open.click(); await page.getByRole('button', { name: 'Fixture landmark', exact: true }).click();
      assert.equal(await focused(drive), true); assert.equal(await actionVisible(), true);
      await page.locator('#outside').focus(); await page.evaluate(() => window.fixture.refresh());
      assert.equal(await focused(page.locator('#outside')), true, 'Background calendar refresh leaves another owner focused');
      await drive.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => window.fixture.calls.at(-1).id), 'landmark');
      assert.equal(await page.evaluate(() => window.fixture.radar.isExpanded), false);
      await page.evaluate(() => window.fixture.longCard());
      await open.click(); await rows.first().click();
      assert.equal(await focused(drive), true); assert.equal(await actionVisible(), true, 'A tall card must keep its action visible');
      report.views.push({ name, resultCount: 50, keyboardActionReady: true, pointerCardVisible: true, landmarkActionReady: true, refreshFocusStable: true, routeAndEscape: true, tallCardActionVisible: true });
    }
    assert.deepEqual(await page.evaluate(() => window.fixture.requests), []);
    await page.evaluate(() => window.fixture.destroy()); assert.equal(await page.locator('.gt-radar').count(), 0);
    await page.close();
  }
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify({ stage, passed: true, views: report.views.length, errors: report.errors }));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
}
