/** Real event-card DOM keyboard check; isolated event data and sharing callback. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage = process.env.GTASF_CARD_STAGE === 'before' ? 'before' : 'after';
const out = resolve('artifacts/event-card-keyboard', stage);
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, logLevel: 'warn', resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
if (!process.argv.includes('--run-only')) {
  await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Event details keyboard fixture</title><style>*{box-sizing:border-box}body{background:#263932;color:white;margin:0;font:16px Arial}button{min-height:32px}</style><button id="launch">Show event</button><button id="outside">Other HUD</button><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`, `import {createPlayableHud} from '${resolve('web/src/hud/playableHud.ts')}';
const event={id:'keyboard-event',title:'Founder event keyboard fixture',host:'Isolated test host',venue:'Ferry Building',start:'2026-10-05T18:00:00Z',lat:37.7955,lon:-122.3937,approx:false,url:'https://example.com/event'};
const changes=[],requests=[];let finishShare;
window.fetch=async(url)=>{requests.push(url);throw Error('Unexpected request');};
const hud=createPlayableHud({onCardChange:open=>changes.push(open),onShareEvent:()=>new Promise(resolve=>{finishShare=resolve;})});
document.querySelector('#launch').onclick=()=>hud.showEvent(event,2);
window.fixture={hud,event,changes,requests,finishShare:()=>finishShare?.(),update(value){hud.showEvent({...event,...value},3);},destroy(){hud.destroy();}};
`);
  await build(config);
}
if (process.argv.includes('--build-only')) { console.log('Built '+stage+' event card fixture'); process.exit(0); }
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser; const report = { stage, scope: 'Isolated event-details DOM, no native/game or sharing-provider acceptance', errors: [], views: [] };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [name, width, height] of [['desktop', 1100, 720], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.fixture);
    const launch = page.locator('#launch'), outside = page.locator('#outside'), card = page.locator('.gt-event-card');
    const close = page.getByRole('button', { name: 'Close event details' }), share = page.getByRole('button', { name: 'Share event', exact: true });
    const link = page.getByRole('link', { name: 'View event & RSVP ↗' });
    const focused = locator => locator.evaluate(element => document.activeElement === element);
    const contained = () => card.evaluate(element => element.contains(document.activeElement));
    await launch.focus(); await page.keyboard.press('Enter'); assert.equal(await focused(close), true);
    if (stage === 'before') {
      await page.keyboard.press('Shift+Tab'); assert.equal(await contained(), false);
      await share.focus(); await page.keyboard.press('Tab'); assert.equal(await contained(), false);
      await outside.focus(); await page.evaluate(() => window.fixture.hud.hideEvent());
      assert.equal(await focused(launch), true, 'Original close steals focus from the other HUD');
      report.views.push({ name, tabEscaped: true, closeStoleFocus: true });
    } else {
      assert.equal(await card.getAttribute('aria-modal'), 'true');
      await page.keyboard.press('Shift+Tab'); assert.equal(await focused(share), true);
      await page.keyboard.press('Tab'); assert.equal(await focused(close), true);
      await page.keyboard.press('Tab'); assert.equal(await focused(link), true);
      await page.evaluate(() => window.fixture.update({ title: 'Updated event title' }));
      assert.equal(await focused(link), true, 'A content update keeps the current usable control');
      await page.keyboard.press('Tab'); assert.equal(await focused(share), true);
      await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelector('.gt-event-share').disabled);
      await page.keyboard.press('Tab'); assert.equal(await focused(close), true);
      await page.keyboard.press('Shift+Tab'); assert.equal(await focused(link), true);
      await page.evaluate(() => window.fixture.finishShare()); await page.waitForFunction(() => !document.querySelector('.gt-event-share').disabled);
      await page.screenshot({ path: `${out}/${name}.png` });
      await page.keyboard.press('Escape'); assert.equal(await card.isVisible(), false); assert.equal(await focused(launch), true);
      await launch.click(); await outside.focus(); await page.evaluate(() => window.fixture.hud.hideEvent());
      assert.equal(await focused(outside), true, 'Closing after a HUD handoff preserves the new owner');
      await launch.click(); await share.focus();
      await page.evaluate(() => window.fixture.update({ lat: null, lon: null, url: 'invalid' }));
      assert.equal(await focused(close), true, 'A control hidden by an update falls back to Close');
      assert.equal(await page.locator('.gt-event-share').isVisible(), false);
      assert.equal(await page.locator('.gt-event-link').isVisible(), false);
      await page.keyboard.press('Tab'); assert.equal(await focused(close), true);
      await page.keyboard.press('Shift+Tab'); assert.equal(await focused(close), true);
      await page.keyboard.press('Escape'); assert.equal(await focused(launch), true);
      await launch.click(); await page.evaluate(() => { document.querySelector('#launch').hidden = true; });
      await page.keyboard.press('Escape'); assert.equal(await focused(launch), false, 'Hidden return targets must not receive focus');
      await page.evaluate(() => { document.querySelector('#launch').hidden = false; });
      await launch.click(); await page.evaluate(() => window.fixture.destroy());
      assert.equal(await focused(launch), true);
      await page.keyboard.press('Tab'); assert.equal(await focused(outside), true, 'No trap remains after destroy');
      report.views.push({ name, forwardReverseWrap: true, currentFocusPreserved: true, disabledHiddenSkipped: true, escapeReturn: true, otherHudPreserved: true, cleanDestroy: true });
    }
    assert.deepEqual(await page.evaluate(() => window.fixture.requests), []);
    await page.evaluate(() => window.fixture.destroy()); assert.equal(await page.locator('.gt-event-card,.gt-hud').count(), 0);
    await page.close();
  }
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify({ stage, passed: true, views: report.views.length, errors: report.errors }));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
}
