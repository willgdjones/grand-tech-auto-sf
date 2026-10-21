/** Bounded component gallery. Pane 6 runs through heavy.sh; no city/device gate claim. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { build, preview } from 'vite';
import { nativeMediaBrowser } from './native-media-browser.mjs';

const out = resolve('artifacts/avatar-appearance', new Date().toISOString().replaceAll(':', '-'));
await mkdir(join(out, 'public'), { recursive: true });
await copyFile('web/public/assets/avatars/hoodie.glb', join(out, 'public/hoodie.glb'));
const inputs = ['web/src/avatar/appearance.ts', 'web/src/avatar/founderStatus.ts', 'web/src/avatar/riggedAvatar.ts', 'web/src/avatar/ridingPoses.ts', 'shared/content/cosmetics.ts', 'shared/funding.ts', 'shared/flags.ts', 'web/public/assets/avatars/hoodie.glb'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFlags = await readFile('shared/flags.ts', 'utf8');
const sources = Object.fromEntries(await Promise.all(inputs.map(async path => [path, hash(path === 'shared/flags.ts' ? sourceFlags : await readFile(path))])));
const report = { startedAt: new Date().toISOString(), scope: 'Actual avatar renderer and shipped GLB in an isolated gallery; no game integration, production, FPS or device acceptance',
  sources, fixtureFlags: { characterLooks: true, personalRides: true }, cases: [], errors: [], passed: false };
await writeFile(join(out, 'index.html'), `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>GTASF appearance component review</title>
<style>html,body{margin:0;width:100%;height:100%;background:#7f949a;color:#fff;font:15px system-ui}canvas{position:fixed;inset:0;width:100%;height:100%}#cells{position:absolute;inset:0;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(3,1fr)}article{position:relative;border:1px solid #c8d1ca33}h2{position:absolute;top:8px;left:8px;margin:0;font-size:15px;text-shadow:0 1px 2px #111}p{position:absolute;bottom:5px;left:8px;margin:0;font-size:12px;text-shadow:0 1px 2px #111}body[data-single=true] #cells{grid-template:1fr/1fr}body[data-single=true] h2{top:22px;left:16px;font-size:23px}body[data-single=true] p{bottom:24px;left:16px;font-size:17px}</style></head>
<body><canvas></canvas><main id="cells"></main><script type="module" src="/entry.js"></script></body></html>`);
await writeFile(join(out, 'entry.js'), `
import { Scene, Color, HemisphereLight, DirectionalLight, Mesh, PlaneGeometry, MeshLambertMaterial, PerspectiveCamera, WebGLRenderer, SRGBColorSpace } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createAvatarTemplate } from ${JSON.stringify(resolve('web/src/avatar/riggedAvatar.ts'))};
import { withFounderStatus } from ${JSON.stringify(resolve('web/src/avatar/founderStatus.ts'))};
import { avatarLookChoices } from ${JSON.stringify(resolve('web/src/avatar/appearance.ts'))};
import { FOUNDER_ARCHETYPES, LOOK_TIERS, defaultAppearance, resolveLook } from ${JSON.stringify(resolve('shared/content/cosmetics.ts'))};
const renderer=new WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});
renderer.outputColorSpace=SRGBColorSpace; renderer.setPixelRatio(Math.min(devicePixelRatio,2.75));
const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/hoodie.glb');
const template=createAvatarTemplate(gltf), cells=document.querySelector('#cells');
let items=[], frame=0,last=performance.now(), clip='idle', rear=false, sky=false;
function select(mode='archetypes',only=null){
 for(const item of items){item.avatars.forEach(a=>a.dispose());item.ground.geometry.dispose();item.ground.material.dispose();}items=[];cells.replaceChildren();
 const configs=mode==='status'?LOOK_TIERS.slice(4).map(tier=>({label:tier.label+' · '+tier.companion,archetype:'serial',tier:tier.index,outfit:0,hair:2,accessory:1})):mode==='archetypes'?FOUNDER_ARCHETYPES.map((arch,i)=>({label:arch.label,archetype:arch.id,tier:0,outfit:i%8,hair:0,accessory:0})):mode==='tiers'?LOOK_TIERS.map((tier,i)=>({label:tier.label+' · '+tier.outfit,archetype:'serial',tier:i,outfit:0,hair:2,accessory:i>2?1:0})):avatarLookChoices.hair.map((hair,i)=>({label:hair.label+' · '+avatarLookChoices.accessory[i].label,archetype:'growth',tier:0,outfit:i,hair:i,accessory:i}));
 const visible=only===null?configs:[configs[only]];document.body.dataset.single=String(only!==null);
 if(only===null){cells.style.gridTemplateColumns='repeat('+ (mode==='tiers'?3:4)+',1fr)';cells.style.gridTemplateRows='repeat('+Math.ceil(visible.length/(mode==='tiers'?3:4))+',1fr)';}else{cells.style.gridTemplateColumns='1fr';cells.style.gridTemplateRows='1fr';}
 for(const config of visible){
  const el=document.createElement('article'),title=document.createElement('h2'),caption=document.createElement('p');title.textContent=config.label;caption.textContent='Male / Female · '+(rear?'back':'front')+' · '+clip;el.append(title,caption);cells.append(el);
  const scene=new Scene();scene.background=new Color(0x7f949a);scene.add(new HemisphereLight(0xdcefff,0x6c7160,2.2));const sun=new DirectionalLight(0xffeccb,2);sun.position.set(3,6,4);scene.add(sun);
  const ground=new Mesh(new PlaneGeometry(12,12),new MeshLambertMaterial({color:0x858678}));ground.rotation.x=-Math.PI/2;ground.position.y=-.004;scene.add(ground);
  const status=mode==='status',factory=status?withFounderStatus(template,{scene,heightAt(){return 0;},collides(){return false;},isLoaded(){return true;}}):template;
  const avatars=(status?['female']:['male','female']).map((sex,i)=>{const look=resolveLook({...defaultAppearance(sex,config.archetype),outfit:config.outfit,hair:config.hair,hairColor:mode==='hair'?config.hair:0,accessory:config.accessory},{id:LOOK_TIERS[config.tier].unlockRoundId});
   if(look.tier.index!==config.tier)throw new Error('Tier contract mismatch '+config.label);
   const avatar=factory.createInstance(0,look);avatar.root.position.x=status?0:i===0?-.40:.40;scene.add(avatar.root);return avatar;});
  const camera=new PerspectiveCamera(35,1,.05,30);items.push({el,caption,scene,camera,avatars,ground});
 }
 window.gallery.mode=mode;window.gallery.only=only;
}
window.gallery={ready:false,frame:0,mode:null,only:null,select,setRear(value){rear=value;},setSky(value){sky=value;},setClip(value){clip=value;},snapshot(){return {mode:this.mode,only:this.only,frame,clip,rear,sky,avatars:items.reduce((n,i)=>n+i.avatars.length,0),status:items.map(item=>{const root=item.scene.getObjectByName('founder-status');return root?root.children.map(c=>({name:c.name,visible:c.visible})):[];}),renderer:renderer.info.render};}};
select();window.gallery.ready=true;
function draw(now){const dt=Math.max(0,Math.min(.1,(now-last)/1000));last=now;renderer.setSize(innerWidth,innerHeight,false);renderer.setScissorTest(true);
 for(const item of items){const b=item.el.getBoundingClientRect();renderer.setViewport(b.x,innerHeight-b.bottom,b.width,b.height);renderer.setScissor(b.x,innerHeight-b.bottom,b.width,b.height);item.camera.aspect=b.width/b.height;
  const status=window.gallery.mode==='status';const distance=status?9:innerWidth<600?4.1:3.75;item.camera.position.set(rear?-.65:.65,status?2.5:1.22,rear?-distance:distance);item.camera.lookAt(0,.96,0);
  item.avatars.forEach(avatar=>{if(status)avatar.root.position.z=clip==='walk'?Math.sin(now/1500)*2:0;avatar.update(dt,clip);});
  const jet=item.scene.getObjectByName('founder-jet');if(sky&&jet){item.camera.position.copy(jet.position).add({x:8,y:5,z:10});item.camera.lookAt(jet.position);}
  item.camera.updateProjectionMatrix();item.caption.textContent=(status?'Founder status':'Male / Female')+' · '+(sky?'flyover':rear?'back':'front')+' · '+clip;renderer.render(item.scene,item.camera);
 }window.gallery.frame=++frame;requestAnimationFrame(draw);}
requestAnimationFrame(draw);
`);
const config = { configFile: false, root: out, logLevel: 'warn', resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  plugins: [{ name: 'explicit-appearance-gallery-flags', enforce: 'pre', load(id) {
    if (id === resolve('shared/flags.ts')) return sourceFlags.replace(/characterLooks:\s*false/, 'characterLooks: true').replace(/personalRides:\s*false/, 'personalRides: true');
  } }], build: { outDir: join(out, 'app'), emptyOutDir: true, reportCompressedSize: false, target: 'es2022' } };
await build(config);
for (const path of inputs) assert.equal(hash(await readFile(path)), sources[path], `Source changed while bundling: ${path}`);
report.sourceStableAtBuild = true;
report.assets = await Promise.all((await readdir(join(out, 'app/assets'))).map(async name => ({ name, sha256: hash(await readFile(join(out, 'app/assets', name))) })));
if (process.argv.includes('--build-only')) { await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(`APPEARANCE_GALLERY_BUILT ${out}`); }
else {
  const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
  let native;
  try {
    native = await nativeMediaBrowser({ gpu: true });
    const { page } = native;
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) report.errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
    const cdp = await native.context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.gallery?.ready, undefined, { timeout: 90000 });
    async function capture(name, mode, only = null, rear = false, clip = 'idle', sky = false) {
      const before = await page.evaluate(({ mode, only, rear, clip, sky }) => { window.gallery.setRear(rear); window.gallery.setSky(sky); window.gallery.setClip(clip); window.gallery.select(mode, only); return window.gallery.frame; }, { mode, only, rear, clip, sky });
      await page.waitForFunction(frame => window.gallery.frame >= frame + 8, before, { timeout: 60000 });
      report.cases.push({ name, ...await page.evaluate(() => window.gallery.snapshot()) });
      await page.screenshot({ path: join(out, `${name}.png`) });
      assert.deepEqual(report.errors, []);
    }
    await capture('desktop-archetypes-front', 'archetypes');
    await capture('desktop-archetypes-back', 'archetypes', null, true);
    await capture('desktop-tiers', 'tiers');
    await capture('desktop-hair-accessories', 'hair');
    await capture('desktop-assistant', 'status', 0, false, 'walk');
    await capture('desktop-entourage', 'status', 1, false, 'walk');
    await capture('desktop-jet', 'status', 1, false, 'idle', true);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2.75, mobile: true });
    for (const [name, mode, index, clip] of [
      ['phone-hacker-walk', 'archetypes', 0, 'walk'], ['phone-biotech', 'archetypes', 6, 'idle'],
      ['phone-climate-back', 'archetypes', 7, 'idle'], ['phone-couture', 'tiers', 5, 'idle'],
      ['phone-bob', 'hair', 5, 'idle'], ['phone-riding-scooter', 'archetypes', 0, 'scooter'],
    ]) await capture(name, mode, index, name.includes('-back'), clip);
    await capture('phone-entourage', 'status', 1, false, 'walk');
    await capture('phone-status-riding', 'status', 1, false, 'scooter');
    // These screenshots use the immutable bundle above. Later edits in another
    // pane are recorded separately, rather than mislabelling the captured build.
    report.sourceDriftAfterBuild = [];
    for (const path of inputs) if (hash(await readFile(path)) !== sources[path]) report.sourceDriftAfterBuild.push(path);
    report.passed = true;
  } catch (error) { report.failure = String(error?.stack ?? error); throw error; }
  finally {
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
    await native?.close(); await new Promise(done => server.httpServer.close(done));
    console.log(`APPEARANCE_GALLERY_DONE ${out} passed=${report.passed}`);
  }
}
