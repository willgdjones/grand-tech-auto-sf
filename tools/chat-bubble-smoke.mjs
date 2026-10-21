/** Explicit DOM/projection fixture; no WebGL, server or whole-game acceptance. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const out = resolve(process.env.GTASF_CHAT_BUBBLE_OUT ?? 'artifacts/chat/bubbles'); await mkdir(out, { recursive: true });
const report = { scope: 'Actual chat DOM and camera projection with explicit viewport and bottom-HUD fixtures; not game/network acceptance', views: [], passed: false };
await build({ stdin: { contents: `
import {PerspectiveCamera,Vector3} from 'three';
import {createChat} from './web/src/chat/client';
const camera=new PerspectiveCamera(50,innerWidth/innerHeight,.1,100),chat=createChat({connected:()=>true,send:()=>true});
let corner=[.94,.92],sequence=0;
function place(x,y){corner=[x,y];chat.receive({type:'CHAT_BROADCAST',messageId:++sequence,senderId:1,eventId:0,serverT:Date.now(),name:'Ferry founder',text:'Meet us at the Ferry Building. The next round starts here — bring your ideas, a warm layer, and a friend. See you by the clock tower!'});}
document.querySelector('#upper').onclick=()=>place(.94,.92);document.querySelector('#lower').onclick=()=>place(-.94,-.92);
const hud=[...document.querySelectorAll('[data-hud]')],room=document.querySelector('.gt-funding-room');
document.querySelector('#hud').onclick=()=>{for(const el of hud)el.hidden=false;place(.18,-.47);};
document.querySelector('#grow').onclick=()=>{room.style.height='150px';};
document.querySelector('#hide').onclick=()=>{for(const el of hud)el.hidden=true;};
function frame(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();camera.updateMatrixWorld();const p=new Vector3(...corner,0).unproject(camera);chat.update(camera,2,[{id:1,x:p.x,y:p.y-2.2,z:p.z}]);requestAnimationFrame(frame);}frame();
`, resolveDir: process.cwd(), loader: 'ts' }, outfile: `${out}/app.js`, bundle: true, format: 'esm', target: 'es2022', logLevel: 'error' });
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><style>
body{margin:0;background:#203b35;color:white;font:14px Arial}main{position:fixed;left:30%;top:15%;width:200px}button{padding:12px}
[data-hud]{position:fixed;box-sizing:border-box;border:2px solid #d5b967;padding:6px;background:#11251f;z-index:40}[hidden]{display:none!important}
.gt-funding-room{right:12px;bottom:264px;width:180px;height:64px}.gt-gps-status{right:12px;bottom:264px;width:180px;height:44px;visibility:hidden}
#app>footer{right:12px;bottom:224px;width:180px;height:40px}.gt-radar{left:12px;bottom:210px;width:128px;height:128px}
.gtasf-touch .buttons{right:16px;bottom:24px;width:140px;height:204px}.gtasf-touch .stick{left:24px;bottom:28px;width:144px;height:144px}
</style><main><p>Chat projection / explicit HUD fixture</p><button id="upper">Upper right</button><button id="lower">Lower left</button><button id="hud">Show HUD</button><button id="grow">Grow room notice</button><button id="hide">Hide HUD</button></main>
<div id="app"><footer data-hud hidden>Nearby notice</footer></div><div class="gt-funding-room" data-hud hidden>Work the room progress</div><div class="gt-gps-status" data-hud hidden>Hidden GPS</div><div class="gt-radar" data-hud hidden>Radar</div><div class="gtasf-touch on"><div class="buttons" data-hud hidden>Touch controls</div><div class="stick" data-hud hidden>Joystick</div></div><script type="module" src="/app.js"></script>`;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://fixture.local').pathname;
  try {
    if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }).end(html); return; }
    if (!/^\/app\.(js|css)$/.test(path)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': path.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(await readFile(resolve(out, path.slice(1))));
  } catch { res.writeHead(500).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] }), page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for (const [width, height] of [[390, 844], [1365, 900]]) {
    await page.setViewportSize({ width, height });
    for (const name of ['Upper right', 'Lower left', 'Show HUD', 'Grow room notice', 'Hide HUD']) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.locator('.gt-chat-bubble:not([hidden])').waitFor(); await page.waitForTimeout(70);
      const bounds = await page.locator('.gt-chat-bubble').evaluate(el => {
        const r = el.getBoundingClientRect();
        const obstacles = [...document.querySelectorAll('[data-hud]')].filter(el => !el.hidden && getComputedStyle(el).visibility !== 'hidden').map(el => { const b=el.getBoundingClientRect();return {name:el.className||el.tagName,left:b.left,top:b.top,right:b.right,bottom:b.bottom}; });
        return { left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,visible:getComputedStyle(el).visibility === 'visible',obstacles,overlaps:obstacles.filter(b=>r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top).map(b=>b.name) };
      });
      report.views.push({ name, ...bounds });
      await page.screenshot({ path: `${out}/${width}-${name.replaceAll(' ', '-')}.png` });

    }
  }
  assert.ok(report.views.every(v=>v.visible), 'All bubbles remain readable');
  assert.ok(report.views.every(v=>v.left>=7&&v.top>=7&&v.right<=v.width-7&&v.bottom<=v.height-7), 'Full bubbles stay inside both viewports');
  assert.deepEqual(report.views.filter(v=>v.overlaps.length).map(v=>({view:v.name,width:v.width,overlaps:v.overlaps})), [], 'Visible bubbles stay clear of bottom HUD, including resized notices');
  assert.deepEqual(errors, []); report.passed = true; console.log('TEST_PASSED:ChatBubbleBounds');
} catch (error) { report.failure = String(error); throw error; }
finally { await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
