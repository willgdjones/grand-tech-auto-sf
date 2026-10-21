/** Physical V from real native Game options into real Events search; no APIs. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
const stage = process.env.GTASF_EVENTS_HANDOFF_STAGE === 'before' ? 'before' : 'after';
const out = resolve('artifacts/events-modal-handoff', stage);
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, logLevel: 'warn', resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
if (!process.argv.includes('--run-only')) {
  await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Events handoff fixture</title><style>body{background:#263932;color:white;margin:20px;font:16px Arial}</style><button id="launcher">Game options</button><input id="other" aria-label="Other HUD field"><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`, `import {createGameOptions} from '${resolve('web/src/hud/gameOptions.ts')}';
import {createUpcomingEvents} from '${resolve('web/src/events/upcoming.ts')}';
const requests=[],changes=[];window.fetch=async(url)=>{requests.push(String(url));throw Error('Unexpected fixture request');};
const options=createGameOptions({launcher:document.querySelector('#launcher'),tankControls:()=>false,toggleMovement:()=>{},onModalChange:open=>changes.push(['options',open])});
let closeDuringOpen=false;
const events=createUpcomingEvents({enabled:true,frame:{origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0},now:()=>Date.parse('2026-10-05T17:00:00Z'),onSelect:()=>{},onHail:()=>{},onOpenChange:open=>{changes.push(['events',open]);if(open){options.hide();if(closeDuringOpen)events.toggle(false);}}});
const calendar=[{id:'founders',title:'Founders on the waterfront',start:'2026-10-05T18:00:00Z',end:'2026-10-05T20:00:00Z',lat:37.7955,lon:-122.3937,approx:false,url:'https://example.com/founders'},{id:'coffee',title:'Coffee in the city',start:'2026-10-05T19:00:00Z',end:'2026-10-05T20:00:00Z',lat:37.79,lon:-122.4,approx:false,url:'https://example.com/coffee'}];
events.setEvents(calendar);
window.fixture={options,events,requests,changes,refresh(){events.setEvents(calendar.map(value=>({...value,host:'Updated host'})));},closeDuringOpen(){closeDuringOpen=true;},destroy(){events.destroy();options.destroy();}};
`);
  await build(config);
}
if (process.argv.includes('--build-only')) { console.log('Built '+stage+' Events modal handoff fixture'); process.exit(0); }
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser; const report = { checkedAt: new Date().toISOString(), stage, scope: 'Real Events and Game options DOM, fixture calendar; no native game/API gate', errors: [], views: [], passed: false };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [name, width, height] of [['desktop', 1100, 720], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.fixture);
    const launcher = page.locator('#launcher'), search = page.getByLabel('Search upcoming events', { exact: true }), eventButton = page.locator('.gt-upcoming-open');
    const focused = locator => locator.evaluate(element => document.activeElement === element);
    await launcher.click(); assert.equal(await page.evaluate(() => window.fixture.options.modalOpen), true);
    await page.keyboard.press('v'); await page.waitForFunction(() => window.fixture.events.isOpen && !window.fixture.options.modalOpen);
    assert.equal(await focused(stage === 'before' ? launcher : search), true);
    const cases = [stage === 'before' ? 'native modal handoff leaves Events search unfocused' : 'V from native dialog focuses Events search after close'];
    if (stage === 'after') {
      await page.keyboard.type('Founders'); assert.equal(await search.inputValue(), 'Founders');
      assert.match(await page.locator('.gt-upcoming-list').textContent(), /Founders on the waterfront/);
      assert.doesNotMatch(await page.locator('.gt-upcoming-list').textContent(), /Coffee in the city/);
      await search.evaluate(element => element.setSelectionRange(3, 3)); await page.evaluate(() => window.fixture.refresh());
      assert.equal(await focused(search), true); assert.equal(await search.evaluate(element => element.selectionStart), 3);
      await page.screenshot({ path: `${out}/${name}.png` });
      await page.keyboard.press('Escape'); assert.equal(await focused(eventButton), true);
      assert.equal(await page.evaluate(() => window.fixture.events.isOpen), false);
      cases.push('immediate typing filters, background refresh preserves caret, Escape reaches visible event launcher');
      await eventButton.click(); assert.equal(await focused(search), true);
      await page.keyboard.press('Escape'); await launcher.focus(); await page.keyboard.press('v'); assert.equal(await focused(search), true);
      await page.keyboard.press('Escape'); cases.push('ordinary launcher and V opening retain search focus');
      await page.locator('#other').focus(); await page.keyboard.press('v'); assert.equal(await page.evaluate(() => window.fixture.events.isOpen), false);
      cases.push('typing V in another text field does not open Events');
      await page.evaluate(() => { window.fixture.closeDuringOpen(); window.fixture.events.toggle(true); });
      assert.equal(await page.evaluate(() => window.fixture.events.isOpen), false); assert.equal(await focused(search), false);
      cases.push('integration callback that closes immediately is respected');
    }
    assert.deepEqual(await page.evaluate(() => window.fixture.requests), []);
    await page.evaluate(() => window.fixture.destroy()); assert.equal(await page.locator('.gt-upcoming,.gt-game-options').count(), 0);
    await page.close(); report.views.push({ name, cases });
  }
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify({ stage, passed: true, views: report.views.length, errors: report.errors }));
} catch (error) { report.failure = error.message; throw error; }
finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
}
