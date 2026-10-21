/** Actual Input frame identities and keyboard semantics; no game/FPS acceptance. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage=process.env.GTASF_INPUT_FRAMES_STAGE==='before'?'before':'after';
const out=resolve(process.env.GTASF_INPUT_FRAMES_OUT??`artifacts/input-frames/${stage}`);
const source=resolve(process.env.GTASF_INPUT_FRAMES_SOURCE??'web/src/input/input.ts');
await mkdir(out,{recursive:true});
const config={configFile:false,root:out,publicDir:false,logLevel:'warn',
  resolve:{alias:{'@gtasf/shared':resolve('shared')}},
  build:{target:'es2022',outDir:`${out}/app`,emptyOutDir:true,reportCompressedSize:false}};
await writeFile(`${out}/index.html`,'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>canvas{display:block;width:600px;height:400px}button,input{margin:8px}</style><button id="hud">HUD</button><input aria-label="Nickname"><canvas tabindex="0"></canvas><script type="module" src="/entry.js"></script>');
await writeFile(`${out}/entry.js`, `import {Input,emptyFrame,readGamepads} from '${source}';
import {holdFreeCursor} from '${resolve('web/src/input/cursor.ts')}';
const input=new Input(document.querySelector('canvas'),{touch:false});
const counts={horn:0,enter:0,map:0,chat:0,hud:0},moves=new Set(),looks=new Set(),sets=new Set();
input.actions.on('move',v=>moves.add(v));input.actions.on('look',v=>looks.add(v));
input.actions.on('horn',()=>counts.horn++);input.actions.on('enter-exit',()=>counts.enter++);
input.actions.on('map',()=>counts.map++);input.actions.on('chat',()=>counts.chat++);
document.querySelector('button').onclick=()=>counts.hud++;
let free;
window.frameSmoke={
  batch(){moves.clear();looks.clear();sets.clear();for(let i=0;i<2400;i++){input.poll(1/60);sets.add(input.down);}return {moves:moves.size,looks:looks.size,sets:sets.size};},
  state(){input.poll(1/60);return {move:{...input.move},look:{...input.look},run:input.held('run'),horn:input.held('horn'),hornPressed:input.pressed('horn'),throttle:input.throttle,counts:{...counts}};},
  release(){input.release();},modal(open){if(open)free??=holdFreeCursor();else{free?.();free=undefined;}},
  virtual(value){input.virtual=value;},
  pads(){
    const buttons=Array.from({length:16},(_,i)=>({pressed:i===2,touched:false,value:i===7?.7:i===6?.3:0}));
    const pad={connected:true,axes:[.1,-.5,.5,0],buttons},out=emptyFrame(),ids=new Set(),actionIds=new Set();
    for(let i=0;i<2400;i++){const value=readGamepads([pad],.1,out);ids.add(value);actionIds.add(value.actions);}
    const first=readGamepads([pad],.1),saved={move:{...first.move},look:{...first.look},actions:[...first.actions],throttle:first.throttle,brake:first.brake};
    const next=readGamepads([],0),buffer=readGamepads([pad],.1,out),sameBuffer=buffer===out;
    const active={move:{...buffer.move},look:{...buffer.look},actions:[...buffer.actions],throttle:buffer.throttle,brake:buffer.brake};
    const cleared=readGamepads([],0,out);
    return {outputs:ids.size,actions:actionIds.size,sameBuffer,active,cleared:{move:cleared.move,look:cleared.look,actions:[...cleared.actions],throttle:cleared.throttle,brake:cleared.brake},independent:first!==next&&first.actions!==next.actions,preserved:JSON.stringify(saved)===JSON.stringify({move:first.move,look:first.look,actions:[...first.actions],throttle:first.throttle,brake:first.brake})};
  },
  destroy(){free?.();input.dispose();},
};
`);
await build(config);
const server=await preview({...config,preview:{host:'127.0.0.1',port:0}});
let browser;
const report={checkedAt:new Date().toISOString(),stage,scope:'Actual Input DOM; physical keyboard and device snapshot API, no renderer/server/FPS claim',cases:[],errors:[],passed:false};
try {
  browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-webgl']});
  const page=await browser.newPage({viewport:{width:900,height:650}});page.setDefaultTimeout(5000);
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.frameSmoke);
  const state=()=>page.evaluate(()=>window.frameSmoke.state());
  const neutral=value=>{assert.deepEqual(value.move,{x:0,y:0});assert.deepEqual(value.look,{x:0,y:0});assert.equal(value.throttle,0);assert.equal(value.run,false);};
  await page.locator('canvas').focus();await page.keyboard.down('KeyW');await page.keyboard.down('Shift');await page.keyboard.down('ArrowRight');await page.keyboard.down('KeyF');
  report.identities=await page.evaluate(()=>window.frameSmoke.batch());
  assert.deepEqual(report.identities,stage==='before'?{moves:2400,looks:2400,sets:2400}:{moves:1,looks:1,sets:2});
  let value=await state();assert.equal(value.move.y,1);assert.equal(value.run,true);assert(value.look.x>0);assert(value.horn);assert.equal(value.hornPressed,false);assert.equal(value.counts.horn,1);
  await page.keyboard.up('KeyF');assert.equal((await state()).horn,false);
  await page.keyboard.press('KeyF');value=await state();assert(value.hornPressed);assert.equal(value.counts.horn,2);
  assert.equal((await state()).hornPressed,false);
  await page.keyboard.up('KeyW');await page.keyboard.up('Shift');await page.keyboard.up('ArrowRight');neutral(await state());
  report.cases.push('2400 held polls preserve movement/run/look with one horn edge, then a completed tap fires once');

  await page.keyboard.press('KeyE');assert.equal((await state()).counts.enter,1);await state();
  await page.keyboard.down('KeyW');await page.keyboard.down('Shift');await page.evaluate(()=>window.frameSmoke.modal(true));neutral(await state());
  await page.keyboard.up('KeyW');await page.keyboard.up('Shift');await page.evaluate(()=>window.frameSmoke.modal(false));neutral(await state());
  await page.getByLabel('Nickname').fill('Founder');await page.keyboard.press('w');neutral(await state());assert.equal(await page.getByLabel('Nickname').inputValue(),'Founderw');
  await page.getByRole('button',{name:'HUD',exact:true}).focus();await page.keyboard.press('NumpadEnter');assert.equal((await state()).counts.hud,1);assert.equal((await state()).counts.chat,0);
  await page.locator('canvas').focus();await page.keyboard.press('NumpadEnter');assert.equal((await state()).counts.chat,1);
  report.cases.push('Queued interaction, modal cancellation, text ownership and native keypad activation remain intact');

  await page.keyboard.down('KeyW');await page.evaluate(()=>window.frameSmoke.virtual({}));neutral(await state());
  await page.evaluate(()=>window.frameSmoke.virtual({move:{x:.5,y:.5},look:{x:.2,y:-.1},actions:['horn'],throttle:.4}));
  value=await state();assert.deepEqual(value.move,{x:.5,y:.5});assert.deepEqual(value.look,{x:.2,y:-.1});assert.equal(value.throttle,.4);assert(value.hornPressed);assert.equal(value.counts.horn,3);
  assert.equal((await state()).hornPressed,false);
  await page.evaluate(()=>window.frameSmoke.virtual(null));value=await state();assert.equal(value.move.y,1);assert.equal(value.horn,false);
  await page.keyboard.up('KeyW');await page.evaluate(()=>window.frameSmoke.release());neutral(await state());
  report.cases.push('Virtual neutral/replacement preserves physical resume, action edges and explicit release');

  report.gamepads=await page.evaluate(()=>window.frameSmoke.pads());
  assert.equal(report.gamepads.outputs,stage==='before'?2400:1);assert.equal(report.gamepads.actions,stage==='before'?2400:1);assert.equal(report.gamepads.sameBuffer,stage!=='before');
  assert.equal(report.gamepads.independent,true);assert.equal(report.gamepads.preserved,true);
  assert.deepEqual(report.gamepads.active.move,{x:0,y:.5});assert.equal(report.gamepads.active.throttle,.7);assert.equal(report.gamepads.active.brake,.3);assert(report.gamepads.active.actions.includes('enter-exit'));
  assert.deepEqual(report.gamepads.cleared,{move:{x:0,y:0},look:{x:0,y:0},actions:[],throttle:0,brake:0});
  report.cases.push('Gamepad output reuse clears all values/actions; calls without an output buffer remain independent snapshots');
  // Retain this separate suspected edge diagnostic without changing its behavior
  // as part of buffer reuse: distinct taps in adjacent polls have no neutral poll.
  const adjacentStart=(await state()).counts.horn;
  await page.keyboard.press('KeyF');const adjacentFirst=(await state()).counts.horn;
  await page.keyboard.press('KeyF');const adjacentSecond=(await state()).counts.horn;
  report.adjacentTapDeltas=[adjacentFirst-adjacentStart,adjacentSecond-adjacentFirst];
  await page.evaluate(()=>window.frameSmoke.destroy());await page.close();assert.deepEqual(report.errors,[]);report.passed=true;
} catch(error){report.failure=String(error);throw error;}
finally {
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');
  await browser?.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));
  console.log(JSON.stringify(report));
}
