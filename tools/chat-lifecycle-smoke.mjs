/** Actual Chat/Radar DOM lifecycle. No game renderer, network API or clock overrides. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage = process.env.GTASF_CHAT_LIFECYCLE_STAGE === 'before' ? 'before' : 'after';
const out = resolve(process.env.GTASF_CHAT_LIFECYCLE_OUT ?? `artifacts/chat-lifecycle/${stage}`);
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, publicDir: false, logLevel: 'warn',
  resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
if (!process.argv.includes('--run-only')) {
  await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Chat lifecycle fixture</title><style>body{background:#263932;color:white;margin:20px;font:16px Arial}</style><input id="other" aria-label="Other HUD field"><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`, `import {createChat} from '${resolve('web/src/chat/client.ts')}';
import {createRadar} from '${resolve('web/src/radar/radar.ts')}';
import {holdFreeCursor,needsFreeCursor} from '${resolve('web/src/input/cursor.ts')}';
const changes=[],requests=[],sent=[];let release,connected=true,chat;
window.fetch=async(url)=>{requests.push(String(url));throw Error('Unexpected fixture request');};
chat=createChat({connected:()=>connected,send:message=>{sent.push(message);return connected;},onModalChange:open=>{changes.push(open);if(open)release??=holdFreeCursor();else{release?.();release=undefined;}}});
if(!chat)throw Error('Chat flag is disabled');
const graph={version:1,nodes:[{id:'a',x:0,y:0,z:0},{id:'b',x:500,y:0,z:0}],edges:[{id:'lane:fixture',from:'a',to:'b',lengthM:500,speedMps:10,lane:1,points:[[0,0,0],[500,0,0]]}]};
const radar=createRadar({graph,routeGraph:graph,frame:{origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0},autoLoad:false,onSelect:()=>{},onExpandedChange:open=>{if(open)chat.hide();}});
await radar.routingReady;radar.setEvents([]);radar.update({x:0,y:0,z:0},0);
const dialog=document.querySelector('.gt-chat-dialog');
const map=document.createElement('button');map.textContent='Open event map from chat';map.onclick=()=>radar.toggleMap(true);dialog.append(map);
window.fixture={chat,radar,dialog,changes,requests,sent,needsFreeCursor,setConnected:value=>connected=value,closeEvents:0};
dialog.addEventListener('close',()=>window.fixture.closeEvents++);
`);
  await build(config);
}
if (process.argv.includes('--build-only')) { console.log(`Built ${stage} Chat lifecycle fixture`); process.exit(0); }
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
const report = { checkedAt: new Date().toISOString(), stage, scope: 'Actual Chat/Radar DOM and cursor ownership with fixture roads; no game renderer or API', views: [], errors: [], passed: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [name, width, height] of [['desktop', 1100, 720], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    const launcher = page.getByRole('button', { name: 'Chat · Enter', exact: true });
    const message = page.getByLabel('Your message', { exact: true });
    const search = page.getByLabel('Find a Tech Week event', { exact: true });
    const cases = [];
    const reset = async () => { await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.fixture); };
    const waitClose = count => page.waitForFunction(count => window.fixture.closeEvents === count, count);
    const focused = locator => locator.evaluate(element => document.activeElement === element);
    const state = () => page.evaluate(() => ({ open: window.fixture.chat.modalOpen, changes: [...window.fixture.changes], freeCursor: window.fixture.needsFreeCursor() }));

    await reset(); await launcher.click(); await message.fill('Keep this draft');
    await page.getByRole('button', { name: 'Open event map from chat', exact: true }).click(); await waitClose(1);
    assert.equal(await page.evaluate(() => window.fixture.radar.isExpanded), true);
    assert.equal(await focused(stage === 'before' ? launcher : search), true);
    assert.deepEqual(await state(), { open: false, changes: [true, false], freeCursor: true });
    cases.push(stage === 'before' ? 'Delayed chat close steals event-map search focus' : 'Event-map search keeps focus after chat handoff');
    if (stage === 'after') {
      await page.keyboard.type('Founders'); assert.equal(await search.inputValue(), 'Founders');
      await page.keyboard.press('Escape'); await launcher.click();
      assert.equal(await message.inputValue(), 'Keep this draft'); assert.equal(await focused(message), true);
    }

    await reset(); await launcher.click(); await message.fill('Still composing');
    const immediate = await page.evaluate(() => { const f=window.fixture;f.chat.hide();f.chat.open();return {changes:[...f.changes],freeCursor:f.needsFreeCursor()}; });
    assert.deepEqual(immediate, { changes: stage === 'before' ? [true, true] : [true, false, true], freeCursor: true });
    await waitClose(1);
    assert.deepEqual(await state(), { open: true, changes: stage === 'before' ? [true, true, false] : [true, false, true], freeCursor: stage !== 'before' });
    assert.equal(await message.inputValue(), 'Still composing');
    if (stage === 'after') assert.equal(await focused(message), true);
    cases.push(stage === 'before' ? 'Queued close releases reopened chat cursor ownership' : 'Immediate hide/reopen keeps current cursor ownership and draft');

    await reset(); await launcher.click();
    await page.evaluate(() => { const f=window.fixture;f.dialog.close();f.chat.open(); }); await waitClose(1);
    assert.deepEqual(await state(), { open: true, changes: stage === 'before' ? [true, true, false] : [true, false, true], freeCursor: stage !== 'before' });
    cases.push(stage === 'before' ? 'Native close/reopen also releases current ownership' : 'Native close/reopen reconciles the previous opening exactly once');

    if (stage === 'after') {
      await reset(); await launcher.click(); await message.fill('hello city');
      await page.keyboard.press('NumpadEnter');
      assert.deepEqual(await page.evaluate(() => window.fixture.sent.map(({type,eventId,text})=>({type,eventId,text}))), [{type:'CHAT',eventId:0,text:'hello city'}]);
      assert.equal(await message.inputValue(), ''); assert.equal(await focused(message), true);
      await message.fill('first line'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('second line');
      assert.equal(await message.inputValue(), 'first line\nsecond line');
      await page.evaluate(() => window.fixture.setConnected(false)); await page.keyboard.press('Enter');
      assert.equal(await message.inputValue(), 'first line\nsecond line');
      assert.equal(await page.evaluate(() => window.fixture.sent.length), 1);
      await page.getByRole('status').filter({hasText:'Chat is reconnecting. Your message is still here.'}).waitFor();
      await page.keyboard.press('Escape'); await waitClose(1);
      assert.equal(await focused(launcher), true); assert.deepEqual(await state(), {open:false,changes:[true,false],freeCursor:false});
      cases.push('Keypad sends, Shift+Enter composes, disconnected draft survives and Escape returns focus');

      await launcher.click();
      const closed = await page.evaluate(() => { const f=window.fixture;f.chat.hide();f.chat.hide();return {changes:[...f.changes],freeCursor:f.needsFreeCursor()}; });
      assert.deepEqual(closed, { changes:[true,false,true,false], freeCursor:false }); await waitClose(2);
      assert.deepEqual(await state(), {open:false,changes:[true,false,true,false],freeCursor:false});
      cases.push('Repeated hide closes and releases exactly once');

      await launcher.click(); await page.evaluate(() => window.fixture.dialog.close()); await waitClose(3);
      assert.deepEqual(await state(), {open:false,changes:[true,false,true,false,true,false],freeCursor:false});
      await launcher.click();
      await page.evaluate(() => { const f=window.fixture;f.chat.destroy();f.chat.destroy();document.querySelector('#other').focus(); });
      await waitClose(4); assert.equal(await focused(page.locator('#other')), true);
      assert.deepEqual(await state(), {open:false,changes:[true,false,true,false,true,false,true,false],freeCursor:false});
      await page.evaluate(() => window.fixture.chat.open()); assert.equal(await page.locator('.gt-chat-dialog').count(), 0);
      cases.push('Native closure and repeated disposal release ownership without stealing another field');
    }
    assert.deepEqual(await page.evaluate(() => window.fixture.requests), []);
    await page.evaluate(() => { window.fixture.radar.destroy(); window.fixture.chat.destroy(); });
    await page.close(); report.views.push({name,cases});
  }
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = String(error); throw error; }
finally {
  await writeFile(`${out}/report.json`, `${JSON.stringify(report,null,2)}\n`);
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done=>server.httpServer.close(done));
  console.log(JSON.stringify(report));
}
