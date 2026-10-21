/** Focused normal-renderer look capture. No Playwright, fixed-step mode or performance claims.
 * Run: tools/heavy.sh node tools/map/coastline-look.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const base=process.env.GTASF_LOOK_URL??'http://127.0.0.1:5173';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Use the existing local dev server');
const out=resolve('artifacts/coastline-look',new Date().toISOString().replaceAll(':','-'));
await mkdir(out,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'gtasf-coastline-chrome-'));
const chrome=process.env.GTASF_CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const child=spawn(chrome,[`--user-data-dir=${profile}`,'--headless=new','--remote-debugging-port=0',
  '--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--use-angle=metal','--enable-gpu','--mute-audio','about:blank'],{stdio:['ignore','ignore','pipe']});
let launchError, socket, sequence=0, chromeLog='';
child.stderr.on('data',data=>{chromeLog=(chromeLog+String(data)).slice(-8000);});
child.on('error',error=>{launchError=error;});
const exited=new Promise(resolve=>child.once('exit',resolve));
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
  while(Date.now()<until){if(await evaluate(expression))return;await delay(250);}
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
  for(const view of [
    {name:'desktop',width:1440,height:900,dpr:1,mobile:false,path:'/',map:true},
    {name:'phone',width:390,height:844,dpr:2.75,mobile:true,path:'/',map:true},
    {name:'noe-desktop',width:1440,height:900,dpr:1,mobile:false,path:'/go/noe-valley?time=noon',map:false},
    {name:'noe-phone',width:390,height:844,dpr:2.75,mobile:true,path:'/go/noe-valley?time=noon',map:false},
  ]) {
    errors=[];httpErrors=[];coastResponses=[];
    await rpc('Emulation.setDeviceMetricsOverride',{width:view.width,height:view.height,deviceScaleFactor:view.dpr,mobile:view.mobile});
    await rpc('Emulation.setTouchEmulationEnabled',{enabled:view.mobile});
    const url=new URL(view.path,base);if(view.mobile)url.searchParams.set('preset','low');
    console.log(`Loading ${view.name}: ${url}`);
    await rpc('Page.navigate',{url:url.href});
    await waitFor(`location.href===${JSON.stringify(url.href)}&&(document.querySelector('#world')?.dataset.ready==='true'||Boolean(document.querySelector('#loading.failed')))`,'game READY');
    await waitFor(`document.querySelector('#world')?.dataset.connected==='true'||Boolean(document.querySelector('#loading.failed'))`,'local multiplayer connection');
    const boot=await evaluate(`({loading:document.querySelector('#loading-detail')?.textContent,failed:Boolean(document.querySelector('#loading.failed')),state:{...document.querySelector('#world')?.dataset},url:location.href})`);
    assert.equal(boot.failed,false,boot.loading);
    assert.equal(boot.state.connected,'true','Normal local multiplayer connection');
    assert(!new URL(boot.url).searchParams.has('capture'),'No fixed-step capture mode');
    await waitFor(`document.querySelector('#loading')?.hidden`,'loading card hidden');
    await delay(2000);
    if(view.map){
      await click(view.mobile?'button[data-action="map"]':'button[aria-label="Open event map"]');
      await waitFor(`document.querySelector('.gt-radar')?.dataset.expanded==='true'`,'map opened');
    }
    await delay(1000);
    const image=await rpc('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(out,`${view.name}.png`),Buffer.from(image.data,'base64'));
    if(view.map){
      await click('button[aria-label="Zoom in"]');
      await delay(500);
      const zoomed=await rpc('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await writeFile(join(out,`${view.name}-zoom.png`),Buffer.from(zoomed.data,'base64'));
    }
    const map=await evaluate(`({status:document.querySelector('.gt-radar-status')?.textContent,text:document.querySelector('.gt-radar')?.innerText,viewport:[innerWidth,innerHeight,devicePixelRatio]})`);
    if(view.map){
      await click('button[aria-label="Close event map"]');
      await waitFor(`document.querySelector('.gt-radar')?.dataset.expanded==='false'`,'map closed');
    }
    const record={...view,boot,map,errors:[...new Set(errors)],httpErrors,coastResponses,screenshot:`${view.name}.png`,...(view.map?{zoomScreenshot:`${view.name}-zoom.png`}:{})};
    records.push(record);await writeFile(join(out,'report.json'),JSON.stringify({records,visualReviewRequired:true},null,2));
    console.log(JSON.stringify({view:view.name,errors:record.errors,httpErrors,coastResponses,screenshot:join(out,record.screenshot)}));
    assert(coastResponses.some(r=>r.status===200),'Source coastline loaded');
    assert.deepEqual(record.errors,[],'No browser console/runtime errors');
    assert.deepEqual(httpErrors,[],'No HTTP errors');
  }
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
  if(child.exitCode===null)child.kill('SIGTERM');
  await Promise.race([exited,delay(2000)]);
  if(child.exitCode===null){child.kill('SIGKILL');await exited;}
  await rm(profile,{recursive:true,force:true});
}
