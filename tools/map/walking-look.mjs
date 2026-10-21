/** Native coffee walk with read-only mounted-world inspection and real keyboard input. No Playwright, fixed-step mode or performance claims.
 * Run: tools/heavy.sh node tools/map/walking-look.mjs
 * Set GTASF_WALK_FROZEN=1 for an isolated web build and real disposable Worker; use Node from .nvmrc.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { startLocalPool } from '../local-pool/pool.mjs';

let base=process.env.GTASF_LOOK_URL??'http://127.0.0.1:5173';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Use the existing local dev server');
const out=resolve('artifacts/walking-look',new Date().toISOString().replaceAll(':','-'));
await mkdir(out,{recursive:true});
console.log(`WALK_CAPTURE_START ${out}`);
const profile=await mkdtemp(join(tmpdir(),'gtasf-walking-chrome-'));
const chrome=process.env.GTASF_CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let child, server, pool, exited=Promise.resolve(), launchError, socket, sequence=0, chromeLog='';
const pending=new Map(),records=[];
let errors=[],httpErrors=[],coastResponses=[];
async function rpc(method,params={}) {
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},60000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression) {
  const result=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression,label,timeout=120000) {
  const until=Date.now()+timeout;
  while(Date.now()<until){if(errors.length||httpErrors.length)throw new Error(`Browser error while waiting for ${label}`);if(await evaluate(expression))return;await delay(250);}
  throw new Error(`Timed out: ${label}`);
}
async function click(selector) {
  const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();if(!r.width||!r.height)return null;const x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,blocked:!e.contains(hit)};})()`);
  assert(point,`Visible control: ${selector}`);
  assert.equal(point.blocked,false,`Unobscured control: ${selector}`);
  await rpc('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
  await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
}
try {
  if(process.env.GTASF_WALK_FROZEN==='1') {
    const app=join(out,'app');
    await build({root:resolve('web'),configFile:resolve('web/vite.config.ts'),logLevel:'warn',
      build:{outDir:app,emptyOutDir:true,reportCompressedSize:false}});
    pool=await startLocalPool();
    server=await preview({root:resolve('web'),configFile:resolve('web/vite.config.ts'),build:{outDir:app},
      preview:{host:'127.0.0.1',port:0,proxy:{'/api':{target:pool.url.origin,ws:true}}}});
    base=server.resolvedUrls.local[0];
    records.push({preview:'frozen common source; real disposable workerd/SQLite',base,eventCount:pool.eventCount,
      flagsSource:await readFile('shared/flags.ts','utf8')});
  }
  child=spawn(chrome,[`--user-data-dir=${profile}`,'--headless=new','--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check',
    '--disable-background-networking','--use-angle=metal','--enable-gpu','--mute-audio','about:blank'],{stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',data=>{chromeLog=(chromeLog+String(data)).slice(-8000);});
  child.on('error',error=>{launchError=error;});
  exited=new Promise(resolve=>child.once('exit',resolve));
  let port;
  for(let i=0;i<400&&!port;i++) {
    if(launchError)throw launchError;
    if(child.exitCode!==null)throw new Error(`Chrome exited ${child.exitCode}`);
    try {port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{}
    if(!port)await delay(150);
  }
  assert(port,'Chrome exposed its isolated control port');
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',({data})=>{
    const message=JSON.parse(String(data));
    if(message.id){const job=pending.get(message.id);pending.delete(message.id);message.error?job?.reject(new Error(message.error.message)):job?.resolve(message.result);return;}
    const p=message.params;
    if(message.method==='Runtime.exceptionThrown')errors.push(p.exceptionDetails.exception?.description??p.exceptionDetails.text);
    if(message.method==='Runtime.consoleAPICalled'&&p.type==='error')errors.push(p.args.map(a=>a.value??a.description??'').join(' '));
    if(message.method==='Network.responseReceived') {
      const url=new URL(p.response.url);
      if(p.response.status>=400)httpErrors.push({path:url.pathname,status:p.response.status});
      if(url.pathname.endsWith('/coastline.json'))coastResponses.push({path:url.pathname,status:p.response.status});
    }
  });
  await rpc('Page.enable');await rpc('Runtime.enable');await rpc('Network.enable');
  await rpc('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await rpc('Page.navigate',{url:new URL('/?time=noon',base).href});
  await waitFor(`window.__gtasf?.ready&&document.querySelector('#world')?.dataset.connected==='true'`,'game READY and connected');
  assert.equal(await evaluate('window.__gtasf.capture'),false,'Normal real-time renderer');
  await waitFor(`document.querySelector('#loading')?.hidden`,'loading card hidden');
  console.log('WALK_GAME_READY');
  await delay(2000);
  await click('#movement-mode');
  await waitFor(`document.querySelector('.gt-game-options')?.open`,'Game options');
  await evaluate(`document.querySelector('.gt-coffee-controls button').scrollIntoView({block:'center'})`);
  await click('.gt-coffee-controls button');
  await waitFor(`!document.querySelector('.gt-game-options')?.open`,'Coffee selected');
  const inspect=()=>evaluate(`(()=>{const h=window.__gtasf,w=h.world;return {pose:{...w.foot},cameraYaw:w.camera.yaw,mode:w.mode,inputSource:h.input?.source,route:w.radar.route,coffee:w.coffeeQueue.destination(),arrived:w.guidance.arrived,taxiActive:w.taxi.active,connected:document.querySelector('#world').dataset.connected};})()`);
  const capture=async name=>{const p=await rpc('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,name),Buffer.from(p.data,'base64'));};
  const before=await inspect();
  await capture('before-walk.png');
  records.push({before});
  assert.equal(before.route?.mode,'walk','Nearby coffee uses walking directions');
  assert(before.route.distanceM<96,'Coffee avoids the former 515m vehicle detour');
  console.log(`WALK_ROUTE ${before.route.distanceM.toFixed(2)}m`);
  const points=before.route.points,trace=[];
  let index=0,held=new Set(),controlYaw=before.cameraYaw;
  const key=async(code,down)=>rpc('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:code.slice(3).toLowerCase(),windowsVirtualKeyCode:code.charCodeAt(3)});
  const release=async()=>{for(const code of held)await key(code,false);held.clear();};
  try {
    const deadline=Date.now()+150000;
    while(Date.now()<deadline){
      let state=await inspect();
      trace.push({at:Date.now(),pose:state.pose,mode:state.mode,inputSource:state.inputSource});
      assert.equal(state.mode,'on-foot');assert.equal(state.connected,'true');
      if(Math.hypot(state.pose.x-before.coffee.x,state.pose.z-before.coffee.z)<1.3)break;
      while(index<points.length-1&&Math.hypot(state.pose.x-points[index][0],state.pose.z-points[index][2])<.25)index++;
      const aim=points[index],dx=aim[0]-state.pose.x,dz=aim[2]-state.pose.z;
      const choose=yaw=>{const x=dx*Math.cos(yaw)-dz*Math.sin(yaw),z=dx*Math.sin(yaw)+dz*Math.cos(yaw),m=Math.max(Math.abs(x),Math.abs(z));return new Set([...(Math.abs(x)>m*.4?[x>0?'KeyD':'KeyA']:[]),...(Math.abs(z)>m*.4?[z>0?'KeyS':'KeyW']:[])]);};
      let wanted=choose(controlYaw);
      if([...held].some(k=>!wanted.has(k))||[...wanted].some(k=>!held.has(k))){
        await release();
        const releasedFrame=await evaluate('window.__gtasf.frame');
        await waitFor(`window.__gtasf.frame>${releasedFrame}`,'Keyboard release observed',10000);
        state=await inspect();controlYaw=state.cameraYaw;wanted=choose(controlYaw);
        for(const code of wanted)await key(code,true);held=wanted;
      }
      await delay(Math.max(25,Math.min(90,Math.hypot(dx,dz)/4*600)));
    }
  } finally {await release();}
  await delay(300);
  const after=await inspect();records.push({after,trace});
  await capture('coffee-arrival.png');
  assert(Math.hypot(after.pose.x-before.coffee.x,after.pose.z-before.coffee.z)<1.5,'Native keyboard walk reaches coffee counter');
  assert(Math.abs(after.pose.y-before.coffee.y)<.5,'Feet remain on the coffee plaza level');
  assert.equal(after.arrived,true,'GPS accepts the arrival');
  assert(trace.some(p=>p.inputSource==='keyboard'),'Movement is real keyboard input');
  // The same authored destination must revert to lane routing when a taxi is active.
  await key('KeyH',true);await delay(80);await key('KeyH',false);
  await waitFor(`window.__gtasf.world.taxi.active&&Boolean(window.__gtasf.world.radar.route)&&window.__gtasf.world.radar.route.mode!=='walk'`,'Taxi uses source road directions',15000);
  const taxi=await inspect();records.push({taxi});
  await key('KeyH',true);await delay(80);await key('KeyH',false);
  const report={records,errors:[...new Set(errors)],httpErrors,priorCoffeeRoadDistanceM:515,visualReviewRequired:true};
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
  assert.deepEqual(report.errors,[],'No browser console/runtime errors');assert.deepEqual(httpErrors,[],'No HTTP errors');
  console.log(JSON.stringify({distanceM:before.route.distanceM,walkSamples:trace.length,arrival:after.pose,taxiMode:taxi.mode,errors:report.errors,out}));
  console.log(`LOOK_CAPTURE_DONE ${out}`);
} catch(error) {
  await writeFile(join(out,'failure.json'),JSON.stringify({error:String(error),chromeLog,errors,httpErrors,coastResponses,records},null,2));
  if(socket?.readyState===WebSocket.OPEN) {
    const image=await rpc('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).catch(()=>null);
    if(image)await writeFile(join(out,'failure.png'),Buffer.from(image.data,'base64'));
  }
  console.error(`LOOK_CAPTURE_FAILED ${out}`);throw error;
} finally {
  socket?.close();
  if(child?.exitCode===null)child.kill('SIGTERM');
  await Promise.race([exited,delay(2000)]);
  if(child?.exitCode===null){child.kill('SIGKILL');await exited;}
  if(server)await new Promise(resolve=>server.httpServer.close(resolve));
  await pool?.close();
  await rm(profile,{recursive:true,force:true});
}
