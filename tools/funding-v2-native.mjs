/** Native funding check: frozen common app, real disposable Worker, actual keyboard/touch.
 * Run with the Node version from .nvmrc: tools/heavy.sh node --import tsx tools/funding-v2-native.mjs
 * Named zero-balance accounts are seeded in disposable SQLite; every cheque is earned normally.
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

const out = resolve('artifacts/funding-v2-native', new Date().toISOString().replaceAll(':', '-'));
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'gtasf-funding-chrome-'));
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
      windowsVirtualKeyCode: code.startsWith('Key') ? code.charCodeAt(3) : ({ ArrowRight: 39, ArrowLeft: 37, Escape: 27 }[code] ?? 0) });
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

import { LocalRoads } from '../worker/src/world/localRoads.ts';
import { fundingAnchor } from '../worker/src/funding/anchors.ts';
import { projectLocation } from '../web/src/radar/projection.ts';
import { PackedRoads } from '../worker/src/world/packedRoads.ts';
import { decodePackedRoadGraph } from '../shared/roadgraphPacked.ts';
import { focusVenues, venueKey } from '../web/src/events/venues.ts';
const phase=process.env.GTASF_FUNDING_PHASE??'events';
assert(['events','cheques','focused'].includes(phase),'Known funding scenario');report.phase=phase;
const markerLook=process.env.GTASF_MARKER_LOOK==='1';report.markerLook=markerLook;
const frame = { origin: { lat: 37.7842, lon: -122.4078 }, gridRotationDeg: 0 };
const distance = (a, b) => Math.hypot(a.x-b.x,a.z-b.z);
const inspect = `(()=>{const h=window.__gtasf,w=h.world,f=w.funding;return {
 frame:h.frame,capture:h.capture,pose:{...w.foot},cameraYaw:w.camera.yaw,mode:w.mode,
 connected:document.querySelector('#world').dataset.connected,source:h.input.source,input:{...h.input.move},touchAxes:{...h.input.touch.move},pointerLocked:Boolean(document.pointerLockElement),
 dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.className),
 profile:f.profile,status:f.status,error:f.error,body:document.body.innerText,
 toasts:[...document.querySelectorAll('.gt-funding-toast,.gt-toast')].filter(e=>!e.hidden).map(e=>e.innerText)
};})()`;
async function api(page,path) {
 const result=await page.read(`fetch(${JSON.stringify(path)},{headers:{Accept:'application/json'}}).then(async r=>({status:r.status,body:await r.json()}))`);
 assert.equal(result.status,200,`Read ${path}`); return result.body;
}
async function markerReceipt(page,target,label,collected=false) {
 const query=`(()=>{const w=window.__gtasf.world;let scene=w.landmarks;while(scene.parent)scene=scene.parent;
  const root=scene.getObjectByName('Tech Week event markers');return (root?.children??[]).map(m=>{
   const sprite=m.children.find(c=>c.isSprite),rings=m.children.filter(c=>c.geometry?.type==='RingGeometry');
   const at=m.position.clone().project(w.camera.camera);return {name:m.name,x:m.position.x,y:m.position.y,z:m.position.z,
    screen:{x:(at.x*.5+.5)*innerWidth,y:(.5-at.y*.5)*innerHeight,z:at.z},
    label:sprite?{visible:sprite.visible,width:sprite.material.map?.image?.width,height:sprite.material.map?.image?.height}:null,
    rings:rings.map(r=>({color:r.material.color.getHexString(),opacity:r.material.opacity})),
    pillars:m.children.filter(c=>c.geometry?.type==='CylinderGeometry').map(c=>({visible:c.visible,opacity:c.material.opacity}))};});})()`;
 // A dense cluster deliberately hides farther overlapping labels. Verify the
 // intended marker's state plus an actually visible panel, without requiring
 // the culled farther label to violate that readability policy.
 await page.until(`(()=>{const markers=${query};return markers.some(m=>m.name.startsWith(${JSON.stringify('Event '+target.event.id)})&&m.label?.width${collected?"&&m.rings.every(r=>r.color==='8c8c86')":''})&&markers.some(m=>m.label?.visible${collected?"&&m.rings.every(r=>r.color==='8c8c86')":''});})()`,'Real visible '+(collected?'collected':'unpaid')+' marker',15000);
 if(collected)await page.until(`document.querySelector('.gt-funding-toast')?.hidden!==false`,'Award card clears the collected marker',15000);
 const markers=await page.read(query);report.checks.push({name:label,markers,collected});
 await page.image(label+'.png');
 const png=await page.read(`(()=>{let scene=window.__gtasf.world.landmarks;while(scene.parent)scene=scene.parent;return scene.getObjectByName('Tech Week event markers')?.children.find(m=>m.name.startsWith(${JSON.stringify('Event '+target.event.id)}))?.children.find(c=>c.isSprite)?.material.map.image.toDataURL('image/png');})()`);
 assert(png,'Actual marker label texture');await writeFile(join(out,label+'-label.png'),Buffer.from(png.split(',')[1],'base64'));
}
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
async function capTable(page,label,phone=false) {
 await page.call('Page.bringToFront');
 // Native pointer lock keeps desktop clicks at the reticle. Leave it through
 // the actual Escape key before clicking a DOM launcher.
 await page.press('Escape');await page.until('!document.pointerLockElement','Pointer released',10000);
 if(!await page.read(`document.querySelector('.gt-game-options')?.open`))await page.click('#movement-mode');
 await page.until(`document.querySelector('.gt-game-options')?.open`,'Options open',15000);
 await page.read(`document.querySelector('.gt-captable-launch').scrollIntoView({block:'center'})`);
 if(phone)await page.tap('.gt-captable-launch');else await page.click('.gt-captable-launch');
 await page.until(`document.querySelector('.gt-captable')?.open&&document.querySelector('.gt-captable-group')`,'Funded cap table');
 const body=await page.read(`document.querySelector('.gt-captable').innerText`);await page.image(`${label}-captable.png`);
 const data=await api(page,'/api/funding/captable');report.checks.push({name:`${label}-captable`,body,data});
 await page.click('.gt-captable-close');
 if(await page.read(`document.querySelector('.gt-game-options')?.open`))await page.press('Escape');
 await canvasFocus(page);return data;
}
try {
 console.log(`FUNDING_NATIVE_START ${out}`);
 if(markerLook) {
  const sourceFlags=await readFile('shared/flags.ts','utf8');
  report.markerFlags=Object.fromEntries(['floatingEventNames','dimCollectedMarkers','checkpointPillars'].map(name=>[name,new RegExp(name+':\\s*true').test(sourceFlags)]));
  assert(Object.values(report.markerFlags).every(Boolean),'Explicit local marker candidates enabled');
 }
 const worldRoadGraphPath=process.env.GTASF_FUNDING_CITY_GRAPH?resolve(process.env.GTASF_FUNDING_CITY_GRAPH):undefined;
 const graphBytes=worldRoadGraphPath?await readFile(worldRoadGraphPath):null;
 const roads=graphBytes?new PackedRoads(decodePackedRoadGraph(new Uint8Array(graphBytes))):new LocalRoads();
 report.worldRoadGraph=graphBytes?{path:worldRoadGraphPath,bytes:graphBytes.length,sha256:createHash('sha256').update(graphBytes).digest('hex')}:null;
 if(phase==='focused')assert(graphBytes,'Focused visible-marker journey uses the real city graph');
 const source=JSON.parse(await readFile('worker/src/events/data/sf-tech-week.json','utf8'));
 const groups=focusVenues(source.events),groupFor=new Map(groups.flatMap(g=>g.focus.map(v=>[v.event.id,g])));
 const anchored=source.events.map(event=>({event,anchor:fundingAnchor(event,roads)})).filter(x=>x.anchor);
 const ferry=projectLocation(37.795229772,-122.394210973,frame);
 const candidates=anchored.filter(x=>distance(x.anchor,ferry)<(graphBytes?5000:1800)).map(x=>{
  const snap=roads.snap({x:x.anchor.x*100,y:x.anchor.y*100,z:x.anchor.z*100},1),route=snap?roads.approach(snap,32):[];
  if(!route.length||route.reduce((sum,s)=>sum+s.length,0)<31)return null;
  const [sx,sy,sz]=route[0].from,start={x:sx,y:sy,z:sz};
  if(distance(start,x.anchor)<28)return null; // reject large bends; lane subdivisions and shallow bends are fine
  const hits=anchored.filter(y=>distance(x.anchor,y.anchor)<.1);
  const group=groupFor.get(x.event.id),marker=group?fundingAnchor(group,roads):null;
  const focused=Boolean(group&&marker&&distance(marker,x.anchor)<8);
  const sameVenue=hits.every(h=>venueKey(h.event)===venueKey(x.event));
  const nearby=anchored.filter(y=>distance(x.anchor,y.anchor)<18);
  const startHits=anchored.filter(y=>distance(start,y.anchor)<15);
  if(startHits.length)return null;
  return {...x,start,focused,focusCount:group?.focus.length??0,sameVenue,marker,venueKey:group?.key,hits:hits.map(h=>({id:h.event.id,title:h.event.title,venue:h.event.venue})),nearby:nearby.length,distance:distance(x.anchor,ferry)};
 }).filter(Boolean).sort((a,b)=>a.distance-b.distance);
 const focusedAnchors=markerLook?groups.map(group=>fundingAnchor(group,roads)).filter(Boolean):[];
 const density=c=>focusedAnchors.filter(anchor=>distance(anchor,c.anchor)<180).length;
 // The marker look uses a real dense cluster to expose label collisions, while
 // ordinary funding checks keep their isolated single-event target.
 const single=markerLook?candidates.filter(c=>c.focused&&c.focusCount===1&&c.hits.length===1).sort((a,b)=>density(b)-density(a)||a.distance-b.distance)[0]
  :candidates.find(c=>c.nearby===1&&(!graphBytes||c.focused));
 const combined=candidates.find(c=>c.hits.length>1&&c.sameVenue);
 if(phase==='events')assert(single&&combined,'Real calendar has isolated single and shared-venue approaches');
 if(phase==='focused')assert(single,'Real calendar has a visible focus-window event approach');
 report.candidates={single,combined};console.log('FUNDING_REAL_TARGETS',JSON.stringify({single:single?.event.title,combined:combined?.hits}));
 const app=process.env.GTASF_FUNDING_APP?resolve(process.env.GTASF_FUNDING_APP):join(out,'app');report.app=app;
 if(!process.env.GTASF_FUNDING_APP)await build({root:resolve('web'),configFile:resolve('web/vite.config.ts'),logLevel:'warn',build:{outDir:app,emptyOutDir:true,reportCompressedSize:false}});
 pool=await startLocalPool({worldRoadGraphPath});
 server=await preview({root:resolve('web'),configFile:resolve('web/vite.config.ts'),build:{outDir:app},preview:{host:'127.0.0.1',port:0,proxy:{'/api':{target:pool.url.origin,ws:true}}}});
 const base=server.resolvedUrls.local[0],db=await pool.worker.getD1Database('DB');report.eventCount=pool.eventCount;
 chrome=spawn(process.env.GTASF_CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  `--user-data-dir=${profile}`,'--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--disable-background-timer-throttling','--disable-renderer-backgrounding','--use-angle=metal','--enable-gpu','--mute-audio','about:blank'],{stdio:['ignore','ignore','pipe']});
 chrome.stderr.on('data',v=>{chromeLog=(chromeLog+String(v)).slice(-8000);});exited=new Promise(resolve=>chrome.once('exit',resolve));
 let port;for(let i=0;i<400&&!port;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{}if(!port)await delay(150);}
 assert(port,'Chrome ready');const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json(),browser=await CDP.connect(version.webSocketDebuggerUrl,'browser');
 async function page(name,token,phone,path) {
  const {browserContextId}=await browser.call('Target.createBrowserContext');
  const {targetId}=await browser.call('Target.createTarget',{url:'about:blank',browserContextId});
  const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),client=await CDP.connect(list.find(p=>p.id===targetId).webSocketDebuggerUrl,name);client.browserContextId=browserContextId;
  for(const method of ['Page.enable','Runtime.enable','Network.enable'])await client.call(method);
  await client.call('Emulation.setDeviceMetricsOverride',{width:phone?390:1440,height:phone?844:900,deviceScaleFactor:1,mobile:phone});
  await client.call('Emulation.setTouchEmulationEnabled',{enabled:phone,maxTouchPoints:2});
  await client.call('Network.setCookie',{name:'gtasf_device',value:token,url:base,httpOnly:true,sameSite:'Lax'});
  await navigate(client,path);return client;
 }
 async function navigate(client,path) {
  await client.call('Page.bringToFront');await client.call('Page.navigate',{url:new URL(path,base).href});
  await client.until(`window.__gtasf?.ready&&document.querySelector('#world')?.dataset.connected==='true'&&document.querySelector('#loading')?.hidden`,'READY connected',180000);
  assert.equal((await client.read(inspect)).capture,false);
  if(await client.read(`Boolean(document.querySelector('.gt-whatsnew[open]'))`))await client.click('.gt-whatsnew-go');
  if(await client.read(`Boolean(document.querySelector('.gt-sa-intro__skip'))`))await client.click('.gt-sa-intro__skip');
  if(await client.read(`Boolean(document.querySelector('.gt-identity[open]'))`))await client.click('.gt-identity-go');
  await client.until(`!document.querySelector('dialog[open]')`,'Gameplay available');await canvasFocus(client);
  console.log(`FUNDING_READY ${client.name}`);
 }
 for(const [label,target,phone] of (phase==='cheques'?[]:phase==='focused'?[[`${phase}-single-desktop`,single,false],[`${phase}-single-phone`,single,true]]:[[`${phase}-single-desktop`,single,false],[`${phase}-combined-phone`,combined,true]])) {
  if(process.env.GTASF_FUNDING_ONLY&&!label.includes(process.env.GTASF_FUNDING_ONLY))continue;
  const client=await page(label,await seed(db,label),phone,deepLink(target.start,target.anchor,phone));
  const anchor=await api(client,`/api/funding/event?id=${encodeURIComponent(target.event.id)}`);
  assert(distance(anchor.anchor,target.anchor)<.1,'Read API and source agree on actual marker');
  const initial=await client.read(inspect);assert(distance(initial.pose,target.anchor)>13,'Public deep link begins outside payout ring');
  await client.image(`${label}-before.png`);
  if(markerLook)await markerReceipt(client,target,`${label}-marker-unpaid`);
  await walk(client,target.anchor,{phone,award:true,label});
  if(markerLook) {
   // Dense venues can pay another cheque before the next status poll. The
   // collected ledger, rather than the last toast, establishes the target paid.
   let collected=[];const deadline=Date.now()+30000;
   while(Date.now()<deadline){collected=(await api(client,'/api/funding/collected')).collectedEventIds??[];if(target.hits.every(h=>collected.includes(h.id)))break;await delay(500);}
   assert(target.hits.every(h=>collected.includes(h.id)),'Selected marker has a real collected receipt');
  } else await client.until(`(()=>{const f=window.__gtasf.world.funding;return BigInt(f.profile.totalCents)>BigInt(${JSON.stringify(initial.profile.totalCents)})&&${JSON.stringify(target.hits.map(h=>h.id))}.includes(f.status?.award?.eventId);})()`,'Selected event server payout reaches client',30000);
  const paid=await client.read(inspect);await client.image(`${label}-paid.png`);
  report.checks.push({name:`${label}-payout`,paid});
  const table=await capTable(client,label,phone),group=table.groups.find(g=>g.source==='event');
  assert(group?.entries.some(e=>e.label===target.event.title),'Collected event in rendered cap table');
  for(const hit of target.hits)assert(group.entries.some(e=>e.label===hit.title),'Each intended event has an actual receipt');
  if(target.hits.length>1){const cheque=report.checks.find(c=>c.name===label)?.trace.find(s=>/^[2-9][0-9]* events$/.test(s.status?.award?.eventTitle));assert(cheque||/^[2-9][0-9]* events$/.test(paid.status?.award?.eventTitle),'A combined N-event cheque was observed');}
  const targetEntries=group.entries.filter(e=>target.hits.some(h=>h.title===e.label));
  await navigate(client,deepLink(target.start,target.anchor,phone));
  if(markerLook)await markerReceipt(client,target,`${label}-marker-collected`,true);
  await walk(client,target.anchor,{phone,label:`${label}-repeat`});
  await delay(2500);const repeat=await api(client,'/api/funding/captable');
  for(const hit of target.hits)assert.deepEqual(repeat.groups.find(g=>g.source==='event').entries.filter(e=>e.label===hit.title),targetEntries.filter(e=>e.label===hit.title),'Once ever receipts unchanged across reload and re-entry');
  report.checks.push({name:`${label}-once-ever`,before:targetEntries,after:repeat});
  await browser.call('Target.disposeBrowserContext',{browserContextId:client.browserContextId});
  console.log(`FUNDING_NATIVE_PASS ${label}`);
 }

 if(phase==='cheques') {
  const home=projectLocation(37.7965,-122.403,frame),approach={x:home.x-12,z:home.z};
  const founder=await page('cheque-founder',await seed(db,'cheque-founder'),false,deepLink(approach,home));
  await walk(founder,home,{radius:1.8,label:'angel-approach'});
  await founder.until(`window.__gtasf.world.angels.nearest(window.__gtasf.world.foot)?.npc.id==='ron-conway'`,'Native pitch within real reach',30000);
  await founder.press('KeyE');
  await founder.until(`window.__gtasf.world.funding.status?.award?.source==='celebrity'`,'Authoritative angel cheque',30000);
  await founder.until(`document.querySelector('.gt-funding-toast-title')?.textContent==='ANGEL CHEQUE'`,'Angel cheque identity survives stage-up',10000);
  await founder.image('angel-cheque.png');
  report.checks.push({name:'native-angel-cheque',state:await founder.read(inspect)});
  const angelTable=await capTable(founder,'angel-desktop');
  assert(angelTable.groups.find(g=>g.source==='celebrity')?.entries.some(e=>e.label.includes('Ron Conway')),'Real angel in cap table');
  const referral=await api(founder,'/api/referrals/profile');
  let founderPose=(await founder.read(inspect)).pose;
  const friendStart={x:founderPose.x-6,z:founderPose.z};
  const friend=await page('NativeFriend',await seed(db,'NativeFriend'),true,deepLink(friendStart,founderPose,true)+`&ref=${referral.code}`);
  const warmStart=Date.now(),deadline=warmStart+300000;let qualified=null;
  // Server-observed real elapsed play, never a clock/played_ms write. A short
  // native touch walk keeps the friend engaged while both tabs stay connected.
  while(Date.now()<deadline) {
   qualified=await db.prepare('SELECT played_ms,joined_at,warm_intro_at FROM referral_players WHERE buyer_device_id=?').bind('NativeFriend').first();
   if(qualified?.warm_intro_at)break;
   console.log('FUNDING_WARM_PLAY',JSON.stringify({wallMs:Date.now()-warmStart,observedMs:qualified?.played_ms??0}));
   await friend.call('Page.bringToFront');
   const point=await friend.point('.gtasf-touch .stick');
   await friend.touch('touchStart',[{x:point.x,y:point.y}]);
   await friend.touch('touchMove',[{x:point.x,y:point.y-38}]);await delay(350);await friend.touch('touchEnd');
   await founder.call('Page.bringToFront');await founder.press('KeyC');
   await delay(8000);
  }
  assert(qualified?.played_ms>=120000&&qualified?.warm_intro_at,'Warm intro credited after actual qualified play');
  assert(Date.now()-qualified.joined_at>=120000,'At least two real minutes since referral join');
  report.checks.push({name:'observed-referral-play',wallMs:Date.now()-warmStart,qualified});
  const warmTable=await capTable(founder,'warm-intro-desktop');
  assert(warmTable.groups.find(g=>g.source==='warm-intro')?.entries.some(e=>e.label==='Warm intro: NativeFriend'),'Named warm intro displayed');
  const welcome=await capTable(friend,'welcome-phone',true);
  assert(welcome.groups.find(g=>g.source==='warm-intro')?.entries.some(e=>e.label.includes('Welcome cheque')),'Friend earned welcome cheque');
  // A scheduled VC drop is another actual source; walking through its current
  // anchor changes its first-50 counter and supplies the grouped backer row.
  const drops=await api(founder,'/api/drops/state'),drop=drops.active.find(d=>d.closesAt-drops.serverNow>90000);
  assert(drop,'Live drop has time for a real approach');
  const snap=roads.snap({x:drop.anchor.x*100,y:drop.anchor.y*100,z:drop.anchor.z*100},2),route=roads.approach(snap,30),[dx,dy,dz]=route[0].from;
  await navigate(founder,deepLink({x:dx,y:dy,z:dz},drop.anchor));
  await walk(founder,drop.anchor,{label:'vc-drop-approach',radius:8});
  let afterDrop=null;const dropDeadline=Date.now()+30000;
  while(Date.now()<dropDeadline){afterDrop=await api(founder,'/api/drops/state');if(afterDrop.recentClaim?.dropId===drop.id)break;await delay(1000);}
  assert.equal(afterDrop?.recentClaim?.dropId,drop.id,'Actual first-50 claim persisted');
  await founder.until(`document.body.innerText.includes('CHEQUE SECURED')`,'Rendered drop cheque',15000);
  await founder.image('vc-drop-cheque.png');
  assert.equal(afterDrop.active.find(d=>d.id===drop.id)?.remaining,drop.remaining-1,'Actual first-50 count falls by one');
  report.checks.push({name:'vc-drop-counter',before:drop,after:afterDrop});
  const grouped=await capTable(founder,'all-backers-desktop');
  for(const source of ['celebrity','warm-intro','vc-drop'])assert(grouped.groups.some(g=>g.source===source),'Earned grouped '+source);
  // Open that same founder's table through the second player's actual plate.
  founderPose=(await founder.read(inspect)).pose;
  await navigate(friend,deepLink({x:dx,y:dy,z:dz},founderPose,true));
  await walk(friend,founderPose,{phone:true,radius:8,label:'peer-approach'});
  await friend.until(`[...document.querySelectorAll('.gt-nameplate')].some(e=>e.innerText.includes('CHEQUE-FOUNDER')&&e.getBoundingClientRect().width>0)`,'Funded peer nameplate',30000);
  const index=await friend.read(`[...document.querySelectorAll('.gt-nameplate')].findIndex(e=>e.innerText.includes('CHEQUE-FOUNDER'))`);
  await friend.tap(`.gt-nameplate:nth-child(${index+1})`);
  await friend.until(`document.querySelector('.gt-captable')?.open&&document.querySelector('.gt-captable-startup')?.textContent==='Native cheque-founder'`,'Peer cap table opens',15000);
  const peerText=await friend.read(`document.querySelector('.gt-captable').innerText`);
  assert(peerText.includes('Ron Conway')&&peerText.includes('Warm intro: NativeFriend'),'Peer sees earned sources');
  await friend.image('peer-captable-phone.png');report.checks.push({name:'peer-captable',body:peerText});
  report.chequesPassed=true;
 }
 report.remaining=phase==='events'?['Peer cap table','Celebrity pitch cheque','Warm intro after observed play','Visible focused marker']:['Single and combined event pass-through in separate events receipt','Visible focused marker'];
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.phasePassed=true;
 report.completedEventScenarios=report.checks.filter(c=>c.name.endsWith('-once-ever')).map(c=>c.name);
 console.log(`FUNDING_NATIVE_DONE ${out}`);
}catch(error){
 report.failure=String(error);report.failureStates={};
 for(const client of clients.filter(c=>c.name!=='browser'&&c.socket.readyState===WebSocket.OPEN)){
  report.failureStates[client.name]=await client.read(inspect).catch(e=>String(e));await client.image(`failure-${client.name}.png`).catch(()=>{});}
 throw error;
}finally{
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');for(const client of clients)client.socket.close();
 if(chrome?.exitCode===null)chrome.kill('SIGTERM');await Promise.race([exited,delay(2000)]);if(chrome?.exitCode===null){chrome.kill('SIGKILL');await exited;}
 if(server){server.httpServer.closeAllConnections();await new Promise(resolve=>server.httpServer.close(resolve));}
 await pool?.close();await rm(profile,{recursive:true,force:true});
}
