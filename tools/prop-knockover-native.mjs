/** Native prop knock-over check: frozen common app, real disposable Worker, actual keyboard/touch.
 * Run with the Node version from .nvmrc: tools/heavy.sh node --import tsx tools/prop-knockover-native.mjs
 * Named zero-balance accounts are seeded in disposable SQLite; car contact and reset use actual input and real elapsed time.
 * This does not verify identity onboarding, production deployment, real devices, or frame-rate acceptance.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build, preview } from 'vite';
import { startLocalPool } from './local-pool/pool.mjs';

const out = resolve('artifacts/prop-knockover-native', new Date().toISOString().replaceAll(':', '-'));
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'gtasf-props-chrome-'));
const clients = [], report = { checks: [], errors: [], httpErrors: [], seededFunding: false, seededIdentity: true, capture: false };
let chrome, pool, server, chromeLog = '', exited = Promise.resolve();
class CDP {
  sequence = 0; pending = new Map(); corrections = []; moves = [];
  constructor(socket, name) {
    this.socket = socket; this.name = name;
    socket.addEventListener('message', ({ data }) => {
      const m = JSON.parse(String(data));
      if (m.id) { const job = this.pending.get(m.id); this.pending.delete(m.id); m.error ? job?.reject(new Error(m.error.message)) : job?.resolve(m.result); return; }
      const p = m.params;
      if (m.method === 'Runtime.exceptionThrown') report.errors.push({ page: name, error: p.exceptionDetails.exception?.description ?? p.exceptionDetails.text });
      if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') report.errors.push({ page: name, error: p.args.map(a => a.value ?? a.description ?? '').join(' ') });
      if (m.method === 'Network.responseReceived' && p.response.status >= 400) report.httpErrors.push({ page: name, status: p.response.status, path: new URL(p.response.url).pathname });
      if (m.method === 'Network.webSocketFrameReceived' && p.response.opcode === 2) {
        const bytes = Buffer.from(p.response.payloadData, 'base64');
        if (bytes[0] === 0x89 && bytes.length === 15) this.corrections.push({ at: Date.now(), timestamp: p.timestamp,
          pose: { x: bytes.readInt32LE(1), y: bytes.readInt32LE(5), z: bytes.readInt32LE(9), yaw: bytes[13], flags: bytes[14] } });
      }
      if (m.method === 'Network.webSocketFrameSent' && p.response.opcode === 2) {
        const bytes = Buffer.from(p.response.payloadData, 'base64');
        // Pose-only diagnostics: never retain HELLO/resume credentials or chat frames.
        if (bytes[0] === 2 && bytes.length === 17) {
          this.moves.push({ timestamp: p.timestamp, seq: bytes.readUInt16LE(1), x: bytes.readInt32LE(3),
            y: bytes.readInt32LE(7), z: bytes.readInt32LE(11), flags: bytes[16] });
          if (this.moves.length > 80) this.moves.shift();
        }
      }
    });
  }
  static async connect(url, name) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    const client = new CDP(socket, name); clients.push(client); return client;
  }
  call(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.name}: ${method} timeout`)); }, 60000);
      this.pending.set(id, { resolve: x => { clearTimeout(timer); resolve(x); }, reject: x => { clearTimeout(timer); reject(x); } });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async read(expression) {
    const r = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async until(expression, label, timeout = 120000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      assert.equal(report.errors.length + report.httpErrors.length, 0, `Browser error: ${label}`);
      if (await this.read(expression)) return;
      await delay(250);
    }
    throw new Error(`${this.name}: timed out ${label}`);
  }
  async image(name) { const r = await this.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(out, name), Buffer.from(r.data, 'base64')); }
  async key(code, down) {
    const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code;
    await this.call('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key,
      windowsVirtualKeyCode: code.startsWith('Key') ? code.charCodeAt(3) : ({ ArrowUp: 38, ArrowDown: 40, ArrowRight: 39, ArrowLeft: 37, Escape: 27, Space: 32 }[code] ?? 0) });
  }
  async press(code) { await this.key(code, true); await delay(200); await this.key(code, false); }
  async touch(type, points = []) { await this.call('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ ...p, id: i + 1, radiusX: 5, radiusY: 5, force: 1 })) }); }
  async point(selector) {
    const p = await this.read(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,width:r.width,height:r.height,hit:e.contains(document.elementFromPoint(x,y))};})()`);
    assert(p?.width && p?.height && p.hit, `Visible, unobscured ${selector}`); return p;
  }
  async tap(selector) { const p = await this.point(selector); await this.touch('touchStart', [{ x: p.x, y: p.y }]); await delay(100); await this.touch('touchEnd'); }
  async click(selector) {
    const p = await this.point(selector);
    await this.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await this.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  }
}


import { projectLocation } from '../web/src/radar/projection.ts';
const frame={origin:{lat:37.7842,lon:-122.4078},gridRotationDeg:0};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const inspect=`(()=>{const h=window.__gtasf,w=h.world;return {frame:h.frame,capture:h.capture,pose:{...w.foot},cameraYaw:w.camera.yaw,
 mode:w.mode,vehicleId:w.vehicleId,speed:Number(w.foot.speed??0),source:h.input.source,input:{...h.input.move},touchAxes:{...h.input.touch.move},
 pointerLocked:Boolean(document.pointerLockElement),connected:document.querySelector('#world').dataset.connected,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.className),
 profile:w.funding.profile,status:w.funding.status,body:document.body.innerText};})()`;
const sceneProps=`(()=>{const w=window.__gtasf.world;return w.streetProps.root.children.filter(m=>m.isInstancedMesh&&/^SF (hydrant|cone|bin|newspaper|stop|trafficStop|parkingMeter) instances$/.test(m.name)).flatMap(m=>{
 const a=m.instanceMatrix.array,out=[];for(let i=0;i<m.count;i++){const o=i*16;out.push({kind:m.name.slice(3,-10),x:a[o+12],y:a[o+13],z:a[o+14],upY:a[o+5]});}return out;});})()`;
async function seed(db,id) {
 const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex'),now=Date.now();
 await db.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id,hash,`Native ${id}`,id,now,now).run();
 return token;
}

function deepLink(point,target,phone=false) {
 // Newton inversion of the same public map projection, used only to construct
 // the documented ?at link. Normal loader snapping still chooses the spawn.
 let lat=frame.origin.lat-point.z/111320,lon=frame.origin.lon+point.x/(111320*Math.cos(frame.origin.lat*Math.PI/180));
 for(let i=0;i<4;i++) {const p=projectLocation(lat,lon,frame),a=projectLocation(lat+1e-5,lon,frame),b=projectLocation(lat,lon+1e-5,frame);
  const ax=(a.x-p.x)/1e-5,az=(a.z-p.z)/1e-5,bx=(b.x-p.x)/1e-5,bz=(b.z-p.z)/1e-5,det=ax*bz-az*bx;
  lat+=((point.x-p.x)*bz-(point.z-p.z)*bx)/det;lon+=(ax*(point.z-p.z)-az*(point.x-p.x))/det;}
 const yaw=Math.atan2(target.x-point.x,target.z-point.z),heading=((180-yaw*180/Math.PI)%360+360)%360;
 return `/?at=${lat},${lon},${heading}&time=noon${phone?'&preset=low':''}`;
}
async function canvasFocus(page) {
 if(await page.read('navigator.maxTouchPoints>0')) {
  // Touch controls take focus on their own gesture. A preliminary canvas tap
  // can hit a moving peer plate between layout and dispatch, opening its table.
  await page.press('Escape');await page.until('!document.pointerLockElement','Touch surface has free pointer',10000);
  return;
 }
 const point=await page.read(`(()=>{const e=document.querySelector('#world'),r=e.getBoundingClientRect();for(const fy of [.4,.5,.6,.3])for(const fx of [.5,.6,.4]){const x=r.x+r.width*fx,y=r.y+r.height*fy;if(document.elementFromPoint(x,y)===e)return {x,y};}return null;})()`);
 assert(point,'Unobscured canvas');
 for(const type of ['mousePressed','mouseReleased']) await page.call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
}
async function walk(page,goal,{phone=false,radius=10,award=false,label='walk'}={}) {
 const started=await page.read(inspect),trace=[];let paidImage=false;
 const deadline=Date.now()+90000;
 while(Date.now()<deadline) {
  const s=await page.read(inspect);trace.push({at:Date.now(),pose:s.pose,cameraYaw:s.cameraYaw,input:s.input,touchAxes:s.touchAxes,total:s.profile.totalCents,status:s.status,source:s.source});
  if(award&&!paidImage&&BigInt(s.profile.totalCents)>BigInt(started.profile.totalCents)) {await page.image(`${label}-award.png`);paidImage=true;}
  const len=distance(s.pose,goal);if(len<=radius)break;
  const dx=goal.x-s.pose.x,dz=goal.z-s.pose.z,sin=Math.sin(s.cameraYaw),cos=Math.cos(s.cameraYaw);
  const x=(dx*cos-dz*sin)/len,z=(dx*sin+dz*cos)/len,keys=[];
  const hold=Math.max(60,Math.min(300,(len-radius)/(phone?8:4)*1000));
  // Each real input pulse releases before steering again. The game deliberately
  // retains movementYaw for held input while its chase camera turns.
  try {
   if(phone){const stick=await page.point('.gtasf-touch .stick');await page.touch('touchStart',[{x:stick.x,y:stick.y}]);await page.touch('touchMove',[{x:stick.x+x*52,y:stick.y+z*52}]);}
   else {if(x>.38)keys.push('KeyD');if(x<-.38)keys.push('KeyA');if(z>.38)keys.push('KeyS');if(z<-.38)keys.push('KeyW');for(const key of keys)await page.key(key,true);}
   await delay(hold);
  }finally{for(const key of keys)await page.key(key,false);if(phone)await page.touch('touchEnd');}
  await page.read('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 }
 const end=await page.read(inspect);report.checks.push({name:label,before:started,after:end,trace});
 assert(distance(end.pose,goal)<=radius,`${label} reaches marker with real input`);
 assert(distance(started.pose,end.pose)>1,'Native controls actually move the player');return end;
}

async function propState(page,target){return (await page.read(sceneProps)).find(p=>p.kind===target.kind&&distance(p,target)<.1);}
async function controls(page,phone,steer,pedal='throttle',ms=140){
 const keys=[];let touching=false;
 try{
  if(phone){const stick=await page.point('.gtasf-touch .stick'),button=await page.point(`.gtasf-touch [data-action="${pedal}"]`);
   await page.touch('touchStart',[{x:stick.x,y:stick.y},{x:button.x,y:button.y}]);touching=true;
   await page.touch('touchMove',[{x:stick.x+steer*52,y:stick.y},{x:button.x,y:button.y}]);
  }else{if(steer>.1)keys.push('KeyD');if(steer<-.1)keys.push('KeyA');keys.push(pedal==='handbrake'?'Space':pedal==='brake'?'KeyS':'KeyW');for(const key of keys)await page.key(key,true);}
  await delay(ms);
 }finally{if(touching)await page.touch('touchEnd');for(const key of keys)await page.key(key,false);}
 await page.read('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
}
async function drive(page,target,phone,label,{radius=1.6,maxSpeed=4,clearFrom=null}={}){
 const start=await page.read(inspect),trace=[],deadline=Date.now()+90000;
 while(Date.now()<deadline){const s=await page.read(inspect);trace.push({at:Date.now(),pose:s.pose,speed:s.speed,source:s.source});
  assert.equal(s.mode,'driver','Native car remains driven');if(clearFrom?distance(s.pose,clearFrom)>3.1:distance(s.pose,target)<=radius)break;
  const wanted=Math.atan2(target.x-s.pose.x,target.z-s.pose.z),error=Math.atan2(Math.sin(wanted-s.pose.yaw),Math.cos(wanted-s.pose.yaw));
  const steer=Math.abs(error)<.05?0:Math.max(-1,Math.min(1,-error*1.6));
  const pedal=s.speed>maxSpeed?'brake':'throttle';await controls(page,phone,steer,pedal);
 }
 const end=await page.read(inspect);report.checks.push({name:label,before:start,after:end,trace});
 assert(clearFrom?distance(end.pose,clearFrom)>3.1:distance(end.pose,target)<=radius,label+(clearFrom?' leaves prop contact area':' reaches actual prop'));assert(distance(start.pose,end.pose)>1,'Actual driving input moved the car');return end;
}
async function park(page,phone){for(let i=0;i<12;i++){const s=await page.read(inspect);if(Math.abs(s.speed)<.05)return;await controls(page,phone,0,'handbrake',200);}assert(Math.abs((await page.read(inspect)).speed)<.2,'Car stopped normally');}
async function viewProp(page,phone){
 // A normal orbit gesture exposes the prop behind the car. Never write the
 // camera or pose; the first native receipt proved the chase view occluded it.
 // On a narrow phone, the rear-side angle projects the prop behind the radar.
 // Orbit to the front side instead so the real prop is above the car in view.
 const pose=(await page.read(inspect)).pose,targetYaw=pose.yaw+(phone?-.65:Math.PI+.65),targetPitch=phone?-.9:-.65;
 for(let i=0;i<9;i++){
  const camera=await page.read('({yaw:window.__gtasf.world.camera.yaw,pitch:window.__gtasf.world.camera.pitch})');
  const yaw=Math.atan2(Math.sin(targetYaw-camera.yaw),Math.cos(targetYaw-camera.yaw)),pitch=targetPitch-camera.pitch;
  if(Math.abs(yaw)<.07&&Math.abs(pitch)<.07)break;
  if(phone){
   const p=await page.read(`(()=>{const c=document.querySelector('#world');for(const fy of [.46,.42,.5,.38])for(const fx of [.5,.4,.6]){const x=innerWidth*fx,y=innerHeight*fy;if(document.elementFromPoint(x,y)===c)return{x,y};}return null;})()`);
   assert(p,'Free canvas for native camera gesture');
   await page.touch('touchStart',[p]);
   await page.touch('touchMove',[{x:p.x-Math.max(-100,Math.min(100,yaw/.0072)),y:p.y+Math.max(-80,Math.min(80,pitch/.0072))}]);
   await page.read('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await page.touch('touchEnd');
  }else{
   const keys=[];if(Math.abs(yaw)>.07)keys.push(yaw>0?'ArrowLeft':'ArrowRight');if(Math.abs(pitch)>.07)keys.push(pitch>0?'ArrowUp':'ArrowDown');
   try{for(const key of keys)await page.key(key,true);await delay(Math.max(45,Math.min(180,Math.max(Math.abs(yaw),Math.abs(pitch))/1.68*1000)));}
   finally{for(const key of keys)await page.key(key,false);}
  }
  await delay(80);
 }
}
try{
 console.log('PROP_NATIVE_START',out);
 assert.match(await readFile('shared/flags.ts','utf8'),/propKnockover:\s*true/,'Explicit local prop candidate enabled');
 const app=process.env.GTASF_PROP_APP?resolve(process.env.GTASF_PROP_APP):join(out,'app');report.app=app;
 if(!process.env.GTASF_PROP_APP)await build({root:resolve('web'),configFile:resolve('web/vite.config.ts'),logLevel:'warn',build:{outDir:app,emptyOutDir:true,reportCompressedSize:false}});
 pool=await startLocalPool({worldRoadGraphPath:resolve('tools/map/out/sf/roadgraph.bin')});
 server=await preview({root:resolve('web'),configFile:resolve('web/vite.config.ts'),build:{outDir:app},preview:{host:'127.0.0.1',port:0,proxy:{'/api':{target:pool.url.origin,ws:true}}}});
 const base=server.resolvedUrls.local[0],db=await pool.worker.getD1Database('DB');
 chrome=spawn(process.env.GTASF_CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  `--user-data-dir=${profile}`,'--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--disable-background-timer-throttling','--disable-renderer-backgrounding','--use-angle=metal','--enable-gpu','--mute-audio','about:blank'],{stdio:['ignore','ignore','pipe']});
 chrome.stderr.on('data',v=>{chromeLog=(chromeLog+String(v)).slice(-8000);});exited=new Promise(resolve=>chrome.once('exit',resolve));
 let port;for(let i=0;i<400&&!port;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{}if(!port)await delay(150);}
 assert(port,'Chrome ready');const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json(),browser=await CDP.connect(version.webSocketDebuggerUrl,'browser');
 async function navigate(page,path){await page.call('Page.bringToFront');await page.call('Page.navigate',{url:new URL(path,base).href});
  await page.until(`window.__gtasf?.ready&&document.querySelector('#world')?.dataset.connected==='true'&&document.querySelector('#loading')?.hidden`,'READY connected',180000);
  assert.equal((await page.read(inspect)).capture,false);
  for(const [dialog,button] of [['.gt-whatsnew[open]','.gt-whatsnew-go'],['.gt-sa-intro__skip','.gt-sa-intro__skip'],['.gt-identity[open]','.gt-identity-go']])if(await page.read(`Boolean(document.querySelector(${JSON.stringify(dialog)}))`))await page.click(button);
  await page.until(`!document.querySelector('dialog[open]')`,'Gameplay available');await canvasFocus(page);
  await page.until('window.__gtasf.world.streetProps?.stats.visible>0&&!window.__gtasf.world.streetProps.stats.refreshPending','Actual street props ready',60000);
 }
 for(const phone of [false,true]){
  const name=phone?'props-phone':'props-desktop';
  if(process.env.GTASF_PROP_ONLY&&!name.includes(process.env.GTASF_PROP_ONLY))continue;
  const {browserContextId}=await browser.call('Target.createBrowserContext'),{targetId}=await browser.call('Target.createTarget',{url:'about:blank',browserContextId});
  const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),page=await CDP.connect(list.find(p=>p.id===targetId).webSocketDebuggerUrl,name);
  for(const method of ['Page.enable','Runtime.enable','Network.enable'])await page.call(method);
  await page.call('Emulation.setDeviceMetricsOverride',{width:phone?390:1440,height:phone?844:900,deviceScaleFactor:1,mobile:phone});
  await page.call('Emulation.setTouchEmulationEnabled',{enabled:phone,maxTouchPoints:2});
  await page.call('Network.setCookie',{name:'gtasf_device',value:await seed(db,name),url:base,httpOnly:true,sameSite:'Lax'});
  await navigate(page,'/?at=37.7955,-122.3937,0&time=noon'+(phone?'&preset=low':''));
  const props=await page.read(sceneProps),cars=await page.read(`[...window.__gtasf.world.fleet.cars.values()].filter(c=>['prius','tesla','subaru'].includes(c.data.kind)&&!c.data.driverId&&!(c.data.flags&0x20)).map(c=>({id:c.data.id,kind:c.data.kind,x:c.model.root.position.x,y:c.model.root.position.y,z:c.model.root.position.z,yaw:c.model.root.rotation.y}))`);
  const pose=(await page.read(inspect)).pose,pairs=[];
  for(const car of cars)for(const prop of props){const dx=prop.x-car.x,dz=prop.z-car.z,forward=dx*Math.sin(car.yaw)+dz*Math.cos(car.yaw),side=dx*Math.cos(car.yaw)-dz*Math.sin(car.yaw);
   if(forward>10&&forward<36&&Math.abs(side)<7&&distance(pose,car)<180)pairs.push({car,prop,forward,side,score:Math.abs(side)*4+forward+distance(pose,car)*.15+(prop.kind===(phone?'cone':'hydrant')?0:30)});}
  pairs.sort((a,b)=>a.score-b.score);assert(pairs.length,'Live parked car has an approachable real prop');const pair=pairs[0];report.checks.push({name:name+'-target',pair,candidates:pairs.length});
  const start={x:pair.car.x-Math.sin(pair.car.yaw)*8,z:pair.car.z-Math.cos(pair.car.yaw)*8};
  await navigate(page,deepLink(start,pair.car,phone));
  await walk(page,pair.car,{phone,radius:3.8,label:name+'-enter-approach'});
  if(phone)await page.tap('.gtasf-touch [data-action="enter-exit"]');else await page.press('KeyE');
  await page.until(`document.querySelector('#world')?.dataset.mode==='driver'`,'Native car entry and controls',15000);
  assert.equal((await page.read(inspect)).vehicleId,pair.car.id,'Entered selected real parked car');
  const before=await propState(page,pair.prop);assert(before&&before.upY>.98,'Prop starts upright');await page.image(name+'-upright.png');
  await drive(page,pair.prop,phone,name+'-contact');
  const contactAt=Date.now();let fallen;
  for(let i=0;i<160;i++){fallen=await propState(page,pair.prop);if(fallen&&fallen.upY<.2)break;await delay(100);}
  assert(fallen&&fallen.upY<.2,'Actual driver contact topples real instanced prop');
  const carPose=(await page.read(inspect)).pose,escape={x:carPose.x+Math.sin(carPose.yaw)*4.3,z:carPose.z+Math.cos(carPose.yaw)*4.3};
  await drive(page,escape,phone,name+'-leave',{clearFrom:pair.prop,maxSpeed:4});await park(page,phone);
  assert(distance((await page.read(inspect)).pose,pair.prop)>2.5,'Driver left the contact area');
  await viewProp(page,phone);const visibleFall=await propState(page,pair.prop);
  const capturedWhileFallen=Boolean(visibleFall&&visibleFall.upY<.2);
  await page.image(name+(capturedWhileFallen?'-fallen.png':'-reset-before-photo.png'));
  report.checks.push({name:name+'-visible-fall',capturedWhileFallen,prop:visibleFall,state:await page.read(inspect)});
  let reset;const resetDeadline=Date.now()+30000;
  while(Date.now()<resetDeadline){reset=await propState(page,pair.prop);if(reset&&reset.upY>.98)break;await delay(250);}
  assert(reset&&reset.upY>.98,'Prop resets through real frame updates');await viewProp(page,phone);await page.image(name+'-reset.png');
  report.checks.push({name:name+'-topple-reset',before,fallen,reset,wallMs:Date.now()-contactAt,corrections:page.corrections});
  await browser.call('Target.disposeBrowserContext',{browserContextId});console.log('PROP_NATIVE_PASS',name);
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.passed=true;console.log('PROP_NATIVE_DONE',out);
}catch(error){report.failure=String(error);report.failureStates={};for(const page of clients.filter(c=>c.name!=='browser'&&c.socket.readyState===WebSocket.OPEN)){report.failureStates[page.name]=await page.read(inspect).catch(e=>String(e));await page.image('failure-'+page.name+'.png').catch(()=>{});}throw error;
}finally{
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');for(const client of clients)client.socket.close();
 if(chrome?.exitCode===null)chrome.kill('SIGTERM');await Promise.race([exited,delay(2000)]);if(chrome?.exitCode===null){chrome.kill('SIGKILL');await exited;}
 if(server){server.httpServer.closeAllConnections();await new Promise(resolve=>server.httpServer.close(resolve));}
 await pool?.close();await rm(profile,{recursive:true,force:true});
}
