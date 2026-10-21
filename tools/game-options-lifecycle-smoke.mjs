/** Real Game options and Radar DOM handoff; no backend, renderer or provider requests. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage = process.env.GTASF_OPTIONS_STAGE === 'before' ? 'before' : 'after';
const out = resolve('artifacts/game-options-lifecycle', stage);
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, logLevel: 'warn', resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
if (!process.argv.includes('--run-only')) {
  await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Game options lifecycle fixture</title><style>body{background:#263932;color:white;margin:20px;font:16px Arial}</style><button id="launcher">Game options</button><input id="other" aria-label="Other HUD field"><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`, `import {createGameOptions} from '${resolve('web/src/hud/gameOptions.ts')}';
import {createRadar} from '${resolve('web/src/radar/radar.ts')}';
const changes=[],requests=[],recovery=[];let tank=false,outfit=0;
window.fetch=async(url)=>{requests.push(String(url));throw Error('Unexpected fixture request');};
const panel=createGameOptions({launcher:document.querySelector('#launcher'),tankControls:()=>tank,toggleMovement:()=>{tank=!tank;},outfit:{label:()=>['Original','Alternative'][outfit],next:()=>{outfit=1-outfit;}},recover:()=>recovery.push({open:panel.modalOpen,changes:[...changes]}),onModalChange:open=>changes.push(open)});
const graph={version:1,nodes:[{id:'a',x:0,y:0,z:0},{id:'b',x:500,y:0,z:0}],edges:[{id:'lane:fixture',from:'a',to:'b',lengthM:500,speedMps:10,lane:1,points:[[0,0,0],[500,0,0]]}]};
const radar=createRadar({graph,routeGraph:graph,frame:{origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0},autoLoad:false,onSelect:()=>{},onExpandedChange:open=>{if(open)panel.hide();}});
await radar.routingReady;radar.setEvents([]);radar.update({x:0,y:0,z:0},0);
const map=document.createElement('button');map.textContent='Open event map from options';map.onclick=()=>radar.toggleMap(true);panel.content.append(map);
const dialog=document.querySelector('.gt-game-options');window.fixture={panel,radar,dialog,changes,requests,recovery,closeEvents:0};dialog.addEventListener('close',()=>window.fixture.closeEvents++);
`);
  await build(config);
}
if (process.argv.includes('--build-only')) { console.log('Built '+stage+' Game options fixture'); process.exit(0); }
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser; const report = { stage, scope: 'Real Game options and Radar DOM with fixture roads; no native game/renderer/API', errors: [], views: [] };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [name, width, height] of [['desktop', 1100, 720], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    const launcher = page.locator('#launcher'), other = page.locator('#other'), search = page.getByLabel('Find a Tech Week event', { exact: true });
    const focused = locator => locator.evaluate(element => document.activeElement === element);
    const reset = async () => { await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.fixture); };
    const waitClose = count => page.waitForFunction(count => window.fixture.closeEvents === count, count);
    const cases = [];

    await reset(); await launcher.click(); await page.getByRole('button', { name: 'Open event map from options', exact: true }).click();
    await waitClose(1); assert.equal(await page.evaluate(() => window.fixture.radar.isExpanded), true);
    assert.equal(await focused(stage === 'before' ? launcher : search), true);
    cases.push(stage === 'before' ? 'options close steals real Radar search focus' : 'real Radar search keeps handoff focus');
    if (stage === 'after') { await page.keyboard.type('Founders'); assert.equal(await search.inputValue(), 'Founders'); await page.keyboard.press('Escape'); }

    await reset(); await launcher.focus();
    const immediate = await page.evaluate(() => { const f=window.fixture;f.panel.open();f.panel.hide();f.panel.open();return [...f.changes]; });
    assert.deepEqual(immediate, stage === 'before' ? [true, true] : [true, false, true]); await waitClose(1);
    assert.deepEqual(await page.evaluate(() => window.fixture.changes), stage === 'before' ? [true, true, false] : [true, false, true]);
    assert.equal(await page.evaluate(() => window.fixture.panel.modalOpen), true);
    cases.push(stage === 'before' ? 'reopened options announces closed' : 'synchronous hide and reopen with stale event ignored');

    await reset(); await launcher.focus();
    await page.evaluate(() => { const f=window.fixture;f.panel.open();f.dialog.close();f.panel.open(); }); await waitClose(1);
    assert.deepEqual(await page.evaluate(() => window.fixture.changes), stage === 'before' ? [true, true, false] : [true, false, true]);
    cases.push(stage === 'before' ? 'native close and reopen has stale state' : 'native close and reopen reconciles state');

    if (stage === 'after') {
      await reset(); await launcher.click();
      await page.getByRole('button', { name: 'On foot: camera relative', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'On foot: tank controls', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: 'Outfit: Original · O', exact: true }).click();
      await page.getByRole('button', { name: 'Outfit: Alternative · O', exact: true }).waitFor();
      await page.screenshot({ path: `${out}/${name}.png` });
      await page.keyboard.press('Escape'); await waitClose(1); assert.equal(await focused(launcher), true);
      await launcher.click(); await page.getByRole('button', { name: 'On foot: tank controls', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Outfit: Alternative · O', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Return to road · R', exact: true }).click(); await waitClose(2);
      assert.deepEqual(await page.evaluate(() => window.fixture.recovery), [{ open: false, changes: [true, false, true, false] }]);
      cases.push('movement and outfit state retained, Escape returns launcher, recovery sees closed state');
      const closed = await page.evaluate(() => { const f=window.fixture;f.changes.length=0;f.panel.open();f.panel.hide();f.panel.hide();return [...f.changes]; });
      assert.deepEqual(closed, [true, false]); await waitClose(3); assert.deepEqual(await page.evaluate(() => window.fixture.changes), [true, false]);
      cases.push('duplicate hide closes exactly once');
      await page.evaluate(() => { const f=window.fixture;f.changes.length=0;f.panel.open();f.dialog.close(); }); await waitClose(4);
      assert.deepEqual(await page.evaluate(() => window.fixture.changes), [true, false]);
      await page.evaluate(() => { const f=window.fixture;f.changes.length=0;f.panel.open();f.panel.destroy();f.panel.destroy();document.querySelector('#other').focus(); });
      await waitClose(5); assert.deepEqual(await page.evaluate(() => window.fixture.changes), [true, false]); assert.equal(await focused(other), true);
      await launcher.click(); assert.equal(await page.locator('.gt-game-options').count(), 0);
      cases.push('native close and disposal clean up callbacks and launcher');
    }
    assert.deepEqual(await page.evaluate(() => window.fixture.requests), []);
    await page.evaluate(() => { window.fixture.radar.destroy(); window.fixture.panel.destroy(); });
    await page.close(); report.views.push({ name, cases });
  }
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify({ stage, passed: true, views: report.views.length, errors: report.errors }));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
}
