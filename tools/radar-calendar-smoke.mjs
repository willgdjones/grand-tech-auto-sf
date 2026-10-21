/** Frozen real-DOM calendar removal regression; fixture roads, no API/World traffic. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage = process.env.GTASF_CALENDAR_STAGE === 'before' ? 'before' : 'after';
const out = resolve('artifacts/radar-calendar', stage);
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, logLevel: 'warn', resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
if (!process.argv.includes('--run-only')) {
  await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Calendar removal fixture</title><style>body{background:#263932;color:white;margin:0;font:16px Arial}</style><button id="outside">Other HUD</button><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`, `import {createRadar} from '${resolve('web/src/radar/radar.ts')}';
const graph={version:1,nodes:[{id:'a',x:0,y:0,z:0},{id:'b',x:500,y:0,z:0}],edges:[{id:'lane:fixture',from:'a',to:'b',lengthM:500,speedMps:10,lane:1,points:[[0,0,0],[500,0,0]]}]};
const original={id:'fixture-event',title:'Calendar fixture event',start:'2026-10-05T18:00:00Z',lat:37.7955,lon:-122.3907,approx:false,url:'https://example.com/event'};
const calls=[],requests=[];window.fetch=async(url)=>{requests.push(url);throw Error('Unexpected fixture request');};
const radar=createRadar({graph,routeGraph:graph,frame:{origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0},autoLoad:false,
 landmarks:[{id:'landmark',title:'Fixture landmark',x:200,y:0,z:0}],onSelect:value=>calls.push({kind:'select',value}),onHail:value=>{calls.push({kind:'hail',value});return true;}});
await radar.routingReady;radar.setEvents([original]);
let accepted=radar.setDestination({title:'Existing accepted route',x:100,y:0,z:0});
window.fixture={radar,original,calls,requests,update(events){radar.setEvents(events);},saveRoute(){accepted=radar.route;},sameRoute(){return radar.route===accepted;},keepActions(){this.oldActions=[...document.querySelectorAll('.gt-radar-card button')];},clickOld(){this.oldActions.forEach(button=>button.click());},destroy(){radar.destroy();}};
`);
  await build(config);
}
if (process.argv.includes('--build-only')) { console.log('Built '+stage+' radar calendar fixture'); process.exit(0); }
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser; const report = { stage, scope: 'Isolated DOM calendar removal; fixture roads, no native/game gate', errors: [], views: [] };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [name, width, height] of [['desktop', 1100, 720], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    page.on('websocket', socket => report.errors.push('Unexpected socket '+socket.url()));
    await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.fixture);
    const search = page.getByRole('searchbox', { name: 'Find a Tech Week event' });
    const select = page.getByRole('button', { name: 'Set destination', exact: true });
    await page.getByRole('button', { name: 'Open event map', exact: true }).click();
    await page.locator('.gt-radar-list button').click(); await select.focus();
    await page.evaluate(() => { window.fixture.keepActions(); window.fixture.update([]); });
    if (stage === 'before') {
      assert.equal(await page.locator('.gt-radar-card button').count(), 2);
      await page.evaluate(() => window.fixture.clickOld());
      assert.deepEqual(await page.evaluate(() => window.fixture.calls.map(call => call.kind)), ['select', 'hail']);
      assert.equal(await page.evaluate(() => window.fixture.sameRoute()), false);
      report.views.push({ name, staleActionsDispatched: true });
    } else {
      assert.equal(await page.locator('.gt-radar-card button').count(), 0);
      assert.match(await page.locator('.gt-radar-card').textContent(), /no longer in the current calendar/i);
      assert.equal(await search.evaluate(element => document.activeElement === element), true);
      await page.evaluate(() => window.fixture.clickOld());
      assert.equal(await page.evaluate(() => window.fixture.calls.length), 0);
      assert.equal(await page.evaluate(() => window.fixture.sameRoute()), true);
      await page.screenshot({ path: `${out}/${name}.png` });
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.fixture.radar.isExpanded), false);
      await page.evaluate(() => window.fixture.update([window.fixture.original]));
      await page.getByRole('button', { name: 'Open event map', exact: true }).click();
      await page.locator('.gt-radar-list button').click(); await select.focus();
      await page.evaluate(() => window.fixture.update([{...window.fixture.original,title:'Updated calendar title',lon:-122.3897}]));
      assert.equal(await select.evaluate(element => document.activeElement === element), true);
      assert.equal(await page.locator('.gt-radar-card h3').textContent(), 'Updated calendar title');
      await page.keyboard.press('Enter');
      const current = await page.evaluate(() => window.fixture.calls[0]);
      assert.equal(current.value.title, 'Updated calendar title'); assert.equal(current.value.event.lon, -122.3897);
      assert(current.value.x > 300); assert.equal(await page.evaluate(() => window.fixture.radar.isExpanded), false);
      await page.evaluate(() => window.fixture.saveRoute());
      await page.getByRole('button', { name: 'Open event map', exact: true }).click();
      await page.locator('.gt-radar-list button').click();
      await page.locator('#outside').focus();
      await page.evaluate(() => { window.fixture.keepActions(); window.fixture.update([{...window.fixture.original,lat:null}]); window.fixture.clickOld(); });
      assert.equal(await page.locator('#outside').evaluate(element => document.activeElement === element), true);
      assert.equal(await page.evaluate(() => window.fixture.calls.length), 1);
      assert.equal(await page.evaluate(() => window.fixture.sameRoute()), true);
      await page.getByRole('button', { name: 'Fixture landmark', exact: true }).click();
      await page.getByRole('button', { name: 'Hail robotaxi', exact: true }).click();
      const landmark = await page.evaluate(() => window.fixture.calls.at(-1));
      assert.equal(landmark.kind, 'hail'); assert.equal(landmark.value.id, 'landmark');
      assert.equal(await page.evaluate(() => window.fixture.radar.isExpanded), false);
      report.views.push({ name, removedActionsBlocked: true, focusFallback: true, currentLocationUsed: current.value.x, unlocatedBlocked: true, acceptedRoutePreserved: true, landmarkHail: true });
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
