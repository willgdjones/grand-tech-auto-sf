/** Actual Input/Touch DOM sampling and physical gestures; output identities are not an FPS benchmark. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage = process.env.GTASF_INPUT_SAMPLING_STAGE === 'before' ? 'before' : 'after';
const out = resolve(process.env.GTASF_INPUT_SAMPLING_OUT ?? `artifacts/input-sampling/${stage}`);
const implementation = resolve(process.env.GTASF_INPUT_SAMPLING_SOURCE ?? 'web/src/input/input.ts');
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, publicDir: false, logLevel: 'warn',
  resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Input sampling</title><style>body{margin:0;background:#263f44}canvas{width:100vw;height:100vh;display:block}#hud{position:fixed;top:8px;left:8px}#name{position:fixed;top:8px;left:130px;width:130px}</style><button id="hud">HUD control</button><input id="name" aria-label="Nickname"><canvas tabindex="0"></canvas><script type="module" src="/entry.js"></script>');
await writeFile(`${out}/entry.js`, `import {Input} from '${implementation}';
import {holdFreeCursor} from '${resolve('web/src/input/cursor.ts')}';
const phone=new URLSearchParams(location.search).has('phone');
const input=new Input(document.querySelector('canvas'),{touch:phone}),touch=input.touch;
const stats={reads:0,frames:0,moves:0,looks:0,actions:0};let previous;
const read=touch.read;
touch.read=function(out){const next=read.call(this,out);stats.reads++;if(next!==previous)stats.frames++;if(next.move!==previous?.move)stats.moves++;if(next.look!==previous?.look)stats.looks++;if(next.actions!==previous?.actions)stats.actions++;previous=next;return next;};
const counts={horn:0,interact:0,map:0,chat:0,click:0};
input.actions.on('horn',()=>counts.horn++);input.actions.on('enter-exit',()=>counts.interact++);input.actions.on('map',()=>counts.map++);input.actions.on('chat',()=>counts.chat++);
document.querySelector('#hud').onclick=()=>counts.click++;
let release;
window.sampling={input,touch,counts,stats,batch:()=>{for(let i=0;i<2400;i++)input.poll(1/60);return {...stats};},
 state:()=>{input.poll(1/60);return {move:{...input.move},look:{...input.look},run:input.held('run'),throttle:input.throttle,counts:{...counts}};},
 modal:on=>{if(on)release??=holdFreeCursor();else{release?.();release=undefined;}},
 destroy:()=>{release?.();input.dispose();}};
`);
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser;
const report = { checkedAt: new Date().toISOString(), stage, scope: 'Actual Input/Touch modules; physical gestures and output identity counts, no game renderer/API or frame-time acceptance', views: [], errors: [], passed: false };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const phone of [false, true]) {
    const page = await browser.newPage({ viewport: { width: phone ? 390 : 1100, height: phone ? 844 : 720 }, hasTouch: phone, isMobile: phone });
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(`${server.resolvedUrls.local[0]}${phone ? '?phone=1' : ''}`); await page.waitForFunction(() => window.sampling);
    const sampled = await page.evaluate(() => window.sampling.batch());
    const expectedReads = stage === 'before' || phone ? 2400 : 0;
    const expectedBuffers = stage === 'before' ? 2400 : phone ? 1 : 0;
    assert.deepEqual(sampled, { reads: expectedReads, frames: expectedBuffers, moves: expectedBuffers, looks: expectedBuffers, actions: expectedBuffers });
    const cases = [stage === 'before'
      ? phone ? 'Visible touch sampling allocates a fresh output every frame' : 'Hidden desktop touch controls still allocate sampling outputs'
      : phone ? 'Visible touch sampling preserves one caller-owned output buffer' : 'Hidden desktop touch controls do not allocate sampling outputs'];
    const state = () => page.evaluate(() => window.sampling.state());
    const neutral = value => { assert.deepEqual(value.move, { x: 0, y: 0 }); assert.equal(value.run, false); assert.equal(value.throttle, 0); };
    if (!phone) {
      await page.locator('canvas').focus(); await page.keyboard.down('KeyW'); assert.equal((await state()).move.y, 1);
      await page.keyboard.down('Shift'); assert.equal((await state()).run, true);
      await page.evaluate(() => window.sampling.modal(true)); neutral(await state());
      await page.keyboard.up('KeyW'); await page.keyboard.up('Shift'); await page.evaluate(() => window.sampling.modal(false));
      await page.locator('#hud').focus(); await page.keyboard.press('NumpadEnter');
      assert.deepEqual((await state()).counts, { horn:0,interact:0,map:0,chat:0,click:1 });
      await page.getByLabel('Nickname').fill('Founder'); await page.keyboard.press('w'); neutral(await state());
      assert.equal(await page.getByLabel('Nickname').inputValue(), 'Founderw');
      await page.locator('canvas').focus(); await page.keyboard.press('NumpadEnter'); assert.equal((await state()).counts.chat, 1);
      cases.push('Keyboard running/modal release, native activation, text ownership and keypad chat remain intact');
    } else {
      await page.evaluate(() => window.sampling.touch.setMode('driver'));
      const cdp = await page.context().newCDPSession(page);
      const dispatch = (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', {type,touchPoints});
      const centre = async selector => { const box = await page.locator(selector).boundingBox(); assert.ok(box); return {x:box.x+box.width/2,y:box.y+box.height/2}; };
      const stick = await centre('.stick'), go = await centre('[data-action=throttle]');
      await dispatch('touchStart',[{x:stick.x,y:stick.y-54,id:1}]);
      let value=await state(); assert(value.move.y>.9);assert(value.run);
      await dispatch('touchStart',[{x:stick.x,y:stick.y-54,id:1},{...go,id:2}]);
      assert.equal((await state()).throttle,1);
      await page.evaluate(()=>window.sampling.modal(true)); neutral(await state()); await dispatch('touchCancel');
      await page.evaluate(()=>window.sampling.modal(false)); neutral(await state());
      cases.push('Simultaneous run/pedal input and modal cancellation preserve movement semantics');

      const horn=await centre('[data-action=horn]');
      await dispatch('touchStart',[{...horn,id:3}]); await dispatch('touchStart',[{...horn,id:3},{...horn,x:horn.x+2,id:4}]);
      assert.equal((await state()).counts.horn,1); await dispatch('touchCancel'); await state();
      await page.getByRole('button',{name:'Horn',exact:true}).tap(); assert.equal((await state()).counts.horn,2); await state();
      assert.equal((await state()).counts.horn,2);
      cases.push('Multiple pointers deduplicate a held horn and completed taps fire once');

      await page.evaluate(()=>window.sampling.touch.setMode('passenger',true));
      assert.deepEqual(await page.locator('.gtasf-touch button:visible').allTextContents(),['Exit ride','Bell','Map']);
      await dispatch('touchStart',[{x:150,y:240,id:5}]); await dispatch('touchMove',[{x:180,y:260,id:5}]);
      value=await state();assert(value.look.x>0&&value.look.y>0);neutral(value);await dispatch('touchEnd');
      assert.deepEqual((await state()).look,{x:0,y:0});
      await page.getByRole('button',{name:'Exit ride',exact:true}).tap();assert.equal((await state()).counts.interact,1);await state();
      await page.getByRole('button',{name:'Map',exact:true}).tap();assert.equal((await state()).counts.map,1);await state();
      cases.push('Passenger look consumes deltas once, while Exit and Map taps remain active');

      await page.evaluate(()=>window.sampling.touch.setMode('on-foot'));
      await dispatch('touchStart',[{x:stick.x,y:stick.y-54,id:6}]);
      const saved=await page.evaluate(()=>{window.savedTouch=window.sampling.touch.read();return window.savedTouch;});
      assert(saved.actions.includes('run')); await dispatch('touchCancel');
      const snapshots=await page.evaluate(()=>({saved:window.savedTouch,next:window.sampling.touch.read()}));
      assert.deepEqual(snapshots.saved,saved); assert.deepEqual(snapshots.next.move,{x:0,y:0});assert.deepEqual(snapshots.next.actions,[]);
      cases.push('No-argument read keeps independent snapshots after later release/read');

      await dispatch('touchStart',[{x:stick.x,y:stick.y-54,id:7}]);await state();
      await page.evaluate(()=>window.sampling.touch.show(false));neutral(await state());await dispatch('touchEnd');
      await page.evaluate(()=>window.sampling.touch.show(true));neutral(await state());
      cases.push('Hiding and restoring touch controls cannot revive an old gesture');
    }
    await page.evaluate(()=>window.sampling.destroy());await page.close();report.views.push({phone,sampled,cases});
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
} catch(error) {report.failure=String(error);throw error;}
finally {
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');
  await browser?.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));
  console.log(JSON.stringify(report));
}
