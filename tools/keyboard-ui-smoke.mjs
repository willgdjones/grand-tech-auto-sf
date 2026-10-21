/** Real keyboard defaults against both input binders; DOM only, with GPU disabled. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, process.env.GTASF_KEYBOARD_OUT ?? 'artifacts/keyboard-ui');
const source = resolve(out, 'source'), bundle = resolve(out, 'bundle');
await mkdir(source, { recursive: true });
await writeFile(resolve(source, 'index.html'), `<!doctype html><title>Keyboard UI smoke</title>
<button id="hud"><span>Funding board</span></button><a href="#destination">Location link</a>
<input aria-label="Nickname"><canvas tabindex="0"></canvas><script type="module" src="./scene.ts"></script>`);
await writeFile(resolve(source, 'scene.ts'), `
import {Input} from '/web/src/input/input.ts';
import {bindKeyboard} from '/web/src/input/keyboard.ts';
import {createActions} from '/web/src/input/actions.ts';
import {holdFreeCursor} from '/web/src/input/cursor.ts';
const actions=createActions(), counts={chat:0,click:0,hail:0}; let move={x:0,z:0,run:false};
actions.on('chat',()=>counts.chat++); actions.on('hail',()=>counts.hail++); actions.on('move',v=>move={...v});
document.querySelector('#hud')!.addEventListener('click',()=>counts.click++);
const legacy=new URLSearchParams(location.search).has('legacy');
const input=legacy?null:new Input(document.querySelector('canvas')!,{actions,touch:false});
const keyboard=legacy?bindKeyboard(actions):null; let free:(()=>void)|undefined;
window.keyboardSmoke={modal:(on:boolean)=>{if(on)free=holdFreeCursor();else{free?.();free=undefined;}},
  poll:()=>{input?.poll(1/60);keyboard?.poll(1/60);return {counts:{...counts},move:{...move},
    handbrake:input?.held('handbrake')??false,confirm:input?.held('confirm')??false,focus:document.activeElement?.id};}};
`);
await build({ configFile: false, root, publicDir: false, logLevel: 'warn', build: {
  outDir: bundle, emptyOutDir: true, rollupOptions: { input: resolve(source, 'index.html') },
} });
const relativeHtml = resolve(source, 'index.html').slice(root.length + 1);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
  const file = path === '/' ? resolve(bundle, relativeHtml) : resolve(bundle, `.${path}`);
  if (!file.startsWith(`${bundle}/`)) { response.writeHead(403).end(); return; }
  try { response.setHeader('Content-Type', extname(file) === '.js' ? 'application/javascript' : 'text/html'); response.end(await readFile(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const report = { checkedAt: new Date().toISOString(), checks: [], errors: [], passed: false };
let browser, page;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  for (const legacy of [false, true]) {
    page = await browser.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/${legacy ? '?legacy=1' : ''}`);
    await page.waitForFunction(() => !!window.keyboardSmoke);
    const poll = () => page.evaluate(() => window.keyboardSmoke.poll());
    await page.keyboard.press('Tab'); assert.equal((await poll()).focus, 'hud');
    await page.keyboard.press('Enter');
    let state = await poll(); report.checks.push({ legacy, name: 'Tab then native Enter', state });
    assert.equal(state.counts.click, 1, 'Enter must activate the focused HUD button');
    assert.equal(state.counts.chat, 0); assert.equal(state.confirm, false);
    await page.keyboard.down('Space'); state = await poll();
    assert.equal(state.handbrake, false); assert.equal(state.counts.click, 1);
    await page.keyboard.up('Space'); assert.equal((await poll()).counts.click, 2);
    await page.keyboard.press('NumpadEnter'); assert.equal((await poll()).counts.click, 3);
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
    assert.equal(new URL(page.url()).hash, '#destination'); assert.equal((await poll()).counts.chat, 0);
    report.checks.push({ legacy, name: 'Space/NumpadEnter activate button; Enter follows link without gameplay' });

    await page.locator('#hud').click(); await page.keyboard.down('KeyW');
    assert.equal((await poll()).move.z, -1, 'Pointer-focused HUD controls must still permit movement keys');
    await page.keyboard.up('KeyW'); assert.ok((await poll()).move.z === 0);
    await page.locator('canvas').focus(); await page.keyboard.press('Enter');
    assert.equal((await poll()).counts.chat, 1, 'Canvas Enter keeps its gameplay action');
    await page.keyboard.press('NumpadEnter');
    state = await poll();
    report.checks.push({ legacy, name: 'Both Enter keys open gameplay chat', state });
    assert.equal(state.counts.chat, 2, 'Canvas numeric-keypad Enter must also open chat');
    if (!legacy) {
      await page.keyboard.down('Space'); assert.equal((await poll()).handbrake, true);
      await page.keyboard.up('Space'); assert.equal((await poll()).handbrake, false);
    }
    await page.getByLabel('Nickname').fill('Founder'); await page.keyboard.press('h');
    assert.equal(await page.getByLabel('Nickname').inputValue(), 'Founderh');
    await page.keyboard.press('NumpadEnter');
    state = await poll(); assert.equal(state.counts.hail, 0); assert.equal(state.counts.chat, 2); assert.ok(state.move.z === 0);
    await page.locator('canvas').focus(); await page.keyboard.down('KeyW'); assert.equal((await poll()).move.z, -1);
    await page.evaluate(() => window.keyboardSmoke.modal(true)); assert.ok((await poll()).move.z === 0);
    await page.keyboard.up('KeyW'); await page.keyboard.down('KeyW'); assert.ok((await poll()).move.z === 0);
    await page.keyboard.up('KeyW'); await page.evaluate(() => window.keyboardSmoke.modal(false));
    report.checks.push({ legacy, name: 'Canvas controls, pointer focus, text editing and modal holds preserved' });
    await page.close();
  }
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) {
  report.failure = String(error);
  throw error;
} finally {
  await browser?.close(); await new Promise(resolveClose => server.close(resolveClose));
  await writeFile(resolve(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}
