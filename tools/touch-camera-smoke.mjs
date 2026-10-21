/** Real phone camera gestures and browser ownership; no renderer/FPS claim. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build,preview} from 'vite';
import {chromium} from '@playwright/test';
const out=resolve(process.env.GTASF_PHONE_CAMERA_OUT??'artifacts/touch-camera/check');
await mkdir(out,{recursive:true});
const config={configFile:false,root:out,publicDir:false,logLevel:'warn',resolve:{alias:{'@gtasf/shared':resolve('shared')}},build:{target:'es2022',outDir:`${out}/app`,emptyOutDir:true,reportCompressedSize:false}};
await writeFile(`${out}/index.html`,'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><button id="options-launcher" style="position:fixed;top:10px;right:10px;z-index:10">Options</button><canvas id="world" tabindex="0"></canvas><script type="module" src="/entry.js"></script>');
await writeFile(`${out}/entry.js`,`import '${resolve('web/src/style.css')}';
import {Input} from '${resolve('web/src/input/input.ts')}';
import {ThirdPersonCamera} from '${resolve('web/src/camera/thirdPerson.ts')}';
import {createGameOptions} from '${resolve('web/src/hud/gameOptions.ts')}';
import {holdFreeCursor} from '${resolve('web/src/input/cursor.ts')}';
const canvas=document.querySelector('canvas');canvas.style.visibility='visible';
const query=new URLSearchParams(location.search);
if(query.has('original'))canvas.style.setProperty('touch-action','pan-y','important');
const input=new Input(canvas,{touch:!query.has('hidden')});
const camera=new ThirdPersonCamera({walkable:{heightAt:()=>0},occluders:{sphereCast:()=>Infinity},activity:{camera(){}}});
camera.resize(innerWidth,innerHeight);camera.setOrbit(Math.PI,-.22);
let released,zoomEvents=[],cancelled=0;
const options=createGameOptions({launcher:document.querySelector('#options-launcher'),tankControls:()=>false,toggleMovement(){},onModalChange(on){if(on)released??=holdFreeCursor();else{released?.();released=undefined}}});
for(let i=0;i<35;i++){const row=document.createElement('p');row.textContent='City information '+(i+1);options.content.append(row)}
canvas.addEventListener('pointercancel',()=>cancelled++);
input.actions.on('look',v=>camera.look(v.dx,v.dy));input.actions.on('zoom',n=>{zoomEvents.push(n);camera.zoom(n)});
window.phoneCamera={input,camera,poll(){input.poll(1/60);camera.update(1/60,{x:0,y:0,z:0});return {look:{...input.look},move:{...input.move},boom:camera.boom,yaw:camera.yaw,pitch:camera.pitch,zoomEvents:[...zoomEvents],cancelled,scale:visualViewport.scale,scroll:[scrollX,scrollY],touchAction:getComputedStyle(canvas).touchAction}},release(){input.release()},modal(on){if(on)released??=holdFreeCursor();else{released?.();released=undefined}},options,style(){return {value:canvas.style.getPropertyValue('touch-action'),priority:canvas.style.getPropertyPriority('touch-action'),computed:getComputedStyle(canvas).touchAction}},destroy(){options.destroy();released?.();input.dispose()}};`);
await build(config);const server=await preview({...config,preview:{host:'127.0.0.1',port:0}});let browser;
const report={checkedAt:new Date().toISOString(),scope:'Physical phone gestures with actual production Input, ThirdPersonCamera and stylesheet; renderer disabled',cases:[],diagnostics:[],errors:[],failures:[],passed:false};
const check=async(name,run)=>{try{const evidence=await run();report.cases.push({name,passed:true,...evidence})}catch(error){report.cases.push({name,passed:false,failure:String(error)});report.failures.push(name)}};
try{
 browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-webgl']});
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});
 await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.phoneCamera);
 const cdp=await page.context().newCDPSession(page);
 let activeTouches=false;
 const touch=async(type,touchPoints=[])=>{if((type==='touchCancel'||type==='touchEnd')&&!activeTouches)return;await cdp.send('Input.dispatchTouchEvent',{type,touchPoints});activeTouches=type!=='touchCancel'&&touchPoints.length>0;};
 // CDP may acknowledge a touch before Chromium dispatches its coalesced pointermove.
 // Sample on a browser frame, as the game does, after that delivery has settled.
 const poll=()=>page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return window.phoneCamera.poll()});
 const reset=async query=>{await touch('touchCancel');await page.goto(server.resolvedUrls.local[0]+(query??''));await page.waitForFunction(()=>window.phoneCamera);return poll()};
 await check('Every sustained camera drag step remains active',async()=>{
  const before=await poll();await touch('touchStart',[{x:130,y:300,id:1}]);const samples=[];
  for(let i=1;i<=6;i++){await touch('touchMove',[{x:130+i*20,y:300,id:1}]);samples.push(await poll())}
  await touch('touchEnd');const after=await poll();
  report.diagnostics.push({name:'sustained drag',before,samples,after});
  assert(samples.every(s=>s.look.x>0));assert(samples.every(s=>s.cancelled===0&&s.scale===1));
  assert.deepEqual(after.look,{x:0,y:0});assert.deepEqual(after.move,{x:0,y:0});assert(after.yaw<before.yaw);
  return {before,samples,after};
 });
 await check('Two canvas fingers keep the browser viewport stable',async()=>{
  const before=await reset();await touch('touchStart',[{x:140,y:300,id:1}]);await touch('touchStart',[{x:140,y:300,id:1},{x:250,y:300,id:2}]);const samples=[];
  for(let i=1;i<=5;i++){await touch('touchMove',[{x:140-i*10,y:300,id:1},{x:250+i*10,y:300,id:2}]);samples.push(await poll())}
  await touch('touchEnd');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const after=await poll();
  report.diagnostics.push({name:'two fingers',before,samples,after});
  assert.equal(after.scale,1);assert.equal(after.cancelled,0);assert.deepEqual(after.scroll,[0,0]);assert.deepEqual(after.look,{x:0,y:0});
  return {before,samples,after};
 });
 await check('Simultaneous joystick and sustained camera drag stay independent',async()=>{
  await reset();const b=await page.locator('.stick').boundingBox();assert.ok(b);const stick={x:b.x+b.width/2,y:b.y+b.height/2-50,id:1};
  await touch('touchStart',[stick]);await touch('touchStart',[stick,{x:150,y:300,id:2}]);const samples=[];
  for(let i=1;i<=4;i++){await touch('touchMove',[stick,{x:150+i*20,y:300,id:2}]);samples.push(await poll())}
  assert(samples.every(s=>s.move.y>.8&&s.look.x>0&&s.cancelled===0));await touch('touchCancel');const cancelled=await poll();
  assert.deepEqual(cancelled.move,{x:0,y:0});assert.deepEqual(cancelled.look,{x:0,y:0});return {samples,cancelled};
 });
 await check('Options release input and retain native touch scrolling',async()=>{
  await reset();await touch('touchStart',[{x:140,y:300,id:1}]);await touch('touchMove',[{x:160,y:300,id:1}]);await poll();await touch('touchEnd');
  await page.locator('#options-launcher').tap();const neutral=await poll();assert.deepEqual(neutral.look,{x:0,y:0});
  const dialog=page.getByRole('dialog',{name:'Game options'});const before=await dialog.evaluate(e=>({scroll:e.scrollTop,action:getComputedStyle(e).touchAction}));
  await touch('touchStart',[{x:210,y:600,id:1}]);for(let i=1;i<=5;i++)await touch('touchMove',[{x:210,y:600-i*40,id:1}]);await touch('touchEnd');
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const after=await dialog.evaluate(e=>({scroll:e.scrollTop,action:getComputedStyle(e).touchAction}));
  assert(after.scroll>before.scroll);assert.equal(after.action,'auto');assert.equal((await poll()).look.x,0);return {before,after};
 });
 await check('Hide and disposal restore the exact prior canvas declaration',async()=>{
  await reset('?original');const initial=await page.evaluate(()=>window.phoneCamera.style());assert.equal(initial.value,'none');
  await page.evaluate(()=>{window.phoneCamera.input.touch.show(true);window.phoneCamera.input.touch.show(false)});
  const hidden=await page.evaluate(()=>window.phoneCamera.style());assert.equal(hidden.value,'pan-y');assert.equal(hidden.priority,'important');
  await page.evaluate(()=>window.phoneCamera.input.touch.show(true));assert.equal((await poll()).touchAction,'none');
  await page.evaluate(()=>window.phoneCamera.destroy());const disposed=await page.evaluate(()=>window.phoneCamera.style());assert.deepEqual(disposed,hidden);
  return {initial,hidden,disposed};
 });
 await check('Hidden controls leave browser gestures unchanged until shown',async()=>{
  await reset('?hidden');const initial=await page.evaluate(()=>window.phoneCamera.style());assert.equal(initial.value,'');assert.equal(initial.computed,'auto');
  await page.evaluate(()=>window.phoneCamera.input.touch.show(true));assert.equal((await poll()).touchAction,'none');
  await touch('touchStart',[{x:140,y:300,id:1}]);await touch('touchMove',[{x:170,y:300,id:1}]);assert((await poll()).look.x>0);
  await page.evaluate(()=>window.phoneCamera.input.touch.show(false));await touch('touchMove',[{x:200,y:300,id:1}]);assert.equal((await poll()).look.x,0);await touch('touchEnd');
  const restored=await page.evaluate(()=>window.phoneCamera.style());assert.deepEqual(restored,initial);return {initial,restored};
 });
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.failures,[]);report.passed=true;
 await page.evaluate(()=>window.phoneCamera.destroy());await cdp.detach();await page.close();
}catch(error){report.failure=String(error);throw error}
finally{await browser?.close();server.httpServer.closeAllConnections();await new Promise(r=>server.httpServer.close(r));await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))}
