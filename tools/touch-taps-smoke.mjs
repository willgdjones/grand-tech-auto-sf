/** Physical phone taps through the actual Input module; no game/FPS claim. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const out = resolve(process.env.GTASF_TOUCH_TAPS_OUT ?? 'artifacts/touch-taps/check');
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, publicDir: false, logLevel: 'warn',
  resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><input aria-label="Nickname"><canvas tabindex="0" style="display:block;width:100vw;height:400px"></canvas><script type="module" src="/entry.js"></script>');
await writeFile(`${out}/entry.js`, `import {Input} from '${resolve(process.env.GTASF_TOUCH_TAPS_SOURCE ?? 'web/src/input/input.ts')}';
import {holdFreeCursor} from '${resolve('web/src/input/cursor.ts')}';
const input=new Input(document.querySelector('canvas'),{touch:true});
input.touch.setMode('driver');
const counts={'enter-exit':0,hail:0,map:0,horn:0};
for(const action of Object.keys(counts)) input.actions.on(action,()=>counts[action]++);
let free,pad=null;
Object.defineProperty(navigator,'getGamepads',{value:()=>pad?[pad]:[]});
window.taps={
  poll(){input.poll(1/60);return {counts:{...counts},horn:input.held('horn'),pressed:input.pressed('horn'),move:{...input.move},throttle:input.throttle,brake:input.brake};},
  release(){input.release();},
  show(value){input.touch.show(value);},
  mode(value){input.touch.setMode(value);},
  snapshot(){return input.touch.read();},
  virtual(value){input.virtual=value;},
  modal(value){if(value)free??=holdFreeCursor();else{free?.();free=undefined;}},
  pad(value){pad=value?{connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},(_,i)=>({pressed:i===4,value:i===4?1:0,touched:false}))}:null;},
  destroy(){free?.();input.dispose();}
};`);
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser;
const report = { checkedAt: new Date().toISOString(), scope: 'Actual Input and TouchControls; physical phone taps, no renderer/server', cases: [], errors: [], failures: [], passed: false };
const check = async (name, test) => {
  try { const evidence = await test(); report.cases.push({ name, passed: true, ...evidence }); }
  catch (error) { report.cases.push({ name, passed: false, failure: String(error) }); report.failures.push(name); }
};
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.taps);
  const poll = () => page.evaluate(() => window.taps.poll());
  const reset = async () => { await page.evaluate(() => { window.taps.modal(false); window.taps.pad(false); window.taps.virtual(null); window.taps.release(); window.taps.show(true); window.taps.mode('driver'); }); await page.locator('canvas').focus(); await poll(); };
  for (const [name, action] of [['Enter / exit','enter-exit'],['Hail','hail'],['Map','map'],['Horn','horn']]) {
    await check(`${name}: two adjacent completed touches each fire once`, async () => {
      await reset(); const start = (await poll()).counts[action];
      await page.getByRole('button',{name,exact:true}).tap(); const first = (await poll()).counts[action];
      await page.getByRole('button',{name,exact:true}).tap(); const second = (await poll()).counts[action];
      const deltas = [first-start, second-first]; assert.deepEqual(deltas, [1,1]);
      assert.equal((await poll()).counts[action], second); return { deltas };
    });
  }
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, touchPoints=[]) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
  const centre = async name => { const b=await page.getByRole('button',{name,exact:true}).boundingBox();assert.ok(b);return {x:b.x+b.width/2,y:b.y+b.height/2}; };
  await check('Held touch and second finger do not repeat the same action',async()=>{
    await reset();const start=(await poll()).counts.hail,point=await centre('Hail');
    await touch('touchStart',[{...point,id:1}]);assert.equal((await poll()).counts.hail,start+1);
    await touch('touchStart',[{...point,id:1},{...point,x:point.x+3,id:2}]);
    assert.equal((await poll()).counts.hail,start+1);assert.equal((await poll()).counts.hail,start+1);
    await touch('touchEnd');assert.equal((await poll()).counts.hail,start+1);
    await page.getByRole('button',{name:'Hail',exact:true}).tap();assert.equal((await poll()).counts.hail,start+2);
  });
  await check('Cancellation, release, hiding and seat changes discard unconsumed taps',async()=>{
    await reset();const start=(await poll()).counts.hail,point=await centre('Hail');
    await touch('touchStart',[{...point,id:3}]);await touch('touchCancel');assert.equal((await poll()).counts.hail,start);
    for(const action of ['release','hide','mode','modal']) {
      await page.getByRole('button',{name:'Hail',exact:true}).tap();
      await page.evaluate(action=>{if(action==='release')window.taps.release();if(action==='hide')window.taps.show(false);if(action==='mode')window.taps.mode('on-foot');if(action==='modal')window.taps.modal(true);},action);
      assert.equal((await poll()).counts.hail,start);
      await reset();
    }
  });
  await check('Driving pedals remain held controls, without queued latch',async()=>{
    await reset();await page.getByRole('button',{name:'Go',exact:true}).tap();assert.equal((await poll()).throttle,0);
    const point=await centre('Go');await touch('touchStart',[{...point,id:4}]);assert.equal((await poll()).throttle,1);
    await touch('touchEnd');assert.equal((await poll()).throttle,0);
  });
  await check('Virtual neutral consumes and suppresses completed physical taps',async()=>{
    await reset();const start=(await poll()).counts.horn;
    await page.evaluate(()=>window.taps.virtual({}));await page.getByRole('button',{name:'Horn',exact:true}).tap();
    assert.equal((await poll()).counts.horn,start);await page.evaluate(()=>window.taps.virtual(null));
    assert.equal((await poll()).counts.horn,start);
    await page.getByRole('button',{name:'Horn',exact:true}).tap();assert.equal((await poll()).counts.horn,start+1);
  });
  await check('Independent snapshots retain their completed press after later reads',async()=>{
    await reset();await page.getByRole('button',{name:'Hail',exact:true}).tap();
    const saved=await page.evaluate(()=>{window.savedTouchPress=window.taps.snapshot();return window.savedTouchPress;});
    assert.deepEqual(saved.actions,['hail']);
    const next=await page.evaluate(()=>({saved:window.savedTouchPress,next:window.taps.snapshot()}));
    assert.deepEqual(next.saved,saved);assert.deepEqual(next.next.actions,[]);
  });
  await cdp.detach();
  await page.evaluate(() => window.taps.destroy()); await page.close();
  assert.deepEqual(report.errors, []); assert.deepEqual(report.failures, []); report.passed = true;
} catch (error) { report.failure = String(error); throw error; }
finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)+'\n');
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
  console.log(JSON.stringify(report));
}
