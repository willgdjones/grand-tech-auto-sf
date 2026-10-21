/** Actual picnic factory + shipped rig, deterministic local fixture clock; no game/GPU. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
const out = resolve('artifacts/dolores-weekend/lifecycle'); await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, publicDir: false, logLevel: 'warn', resolve: { alias: { '@gtasf/shared': resolve('shared') } }, build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
if (!process.argv.includes('--run-only')) {
  await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Dolores calendar lifecycle fixture</title><main></main><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`, `import {Group,Mesh} from 'three';
import {loadAvatarTemplate} from '${resolve('web/src/avatar/riggedAvatar.ts')}';
import {createDoloresWeekend,createDoloresWeekendClock} from '${resolve('web/src/render/doloresWeekend.ts')}';
const template=await loadAvatarTemplate(),player=template.createInstance(),scene=new Group(),selections=[],notices=[];
const playerGeometry=new Set();player.root.traverse(o=>{if(o instanceof Mesh)playerGeometry.add(o.geometry);});
let sharedDisposals=0;for(const geometry of playerGeometry)geometry.addEventListener('dispose',()=>sharedDisposals++);
let clock=Date.parse('2026-10-03T06:59:59Z'),loaded=true,height=23,blocked=false;
const view=createDoloresWeekend({enabled:true,template,parent:document.querySelector('main'),now:()=>clock,isLoaded:()=>loaded,ground:{heightAt:()=>height,collidesCircle:()=>blocked},onDestination:d=>selections.push(d),onNotice:text=>notices.push(text)});scene.add(view.root);
const destination=view.destination(),near={x:destination.x+5,y:23,z:destination.z},far={x:destination.x+200,y:23,z:destination.z};
const snapshot=()=>({visible:view.root.visible,controls:!view.controls.hidden,stats:{...view.stats},notices:[...notices],selections:selections.length});
window.fixture={view,near,far,snapshot,weekend:createDoloresWeekendClock(),get sharedDisposals(){return sharedDisposals;},
step(time,{load=true,y=23,collision=false,away=false}={}){clock=Date.parse(time);loaded=load;height=y;blocked=collision;view.update(away?far:near,1/60);return snapshot();},
frames(count){for(let i=0;i<count;i++)view.update(near,1/60);},
dispose(){view.dispose();view.dispose();player.update(.016,'idle',1);return{connected:view.controls.isConnected,children:scene.children.length,sharedDisposals,visible:view.stats.visible};},
finish(){player.dispose();template.dispose();}};
`);
  await build(config); await mkdir(`${out}/app/assets/avatars`, { recursive: true });
  await copyFile(resolve('web/public/assets/avatars/hoodie.glb'), `${out}/app/assets/avatars/hoodie.glb`);
}
if (process.argv.includes('--build-only')) { console.log('Built actual Dolores lifecycle fixture'); process.exit(0); }
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } }); let browser;
const report = { startedAt: new Date().toISOString(), scope: 'Actual module and shipped rig with an explicit fixture clock/ground; DOM lifecycle only, no game visual/device claim', errors: [], cases: [], passed: false };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] }); const page = await browser.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
  await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.fixture);
  const step = (time, options) => page.evaluate(({ time, options }) => window.fixture.step(time, options), { time, options });
  const friday = await step('2026-10-03T06:59:59Z'); assert.equal(friday.visible, false); assert.equal(friday.controls, false); assert.equal(friday.stats.visible, 0);
  const saturday = await step('2026-10-03T07:00:00Z'); assert.equal(saturday.visible, true); assert.equal(saturday.controls, true); assert.equal(saturday.stats.visible, 4); assert.match(saturday.notices[0], /Dolores picnic/);
  await page.getByRole('button', { name: 'Find the Dolores picnic' }).click(); assert.equal(await page.evaluate(() => window.fixture.snapshot().selections), 1);
  const mutations = await page.evaluate(() => { const f = window.fixture, observer = new MutationObserver(() => {}); observer.observe(f.view.controls, { attributes: true }); f.frames(120); const n = observer.takeRecords().length; observer.disconnect(); return n; }); assert.equal(mutations, 0, 'Unchanged weekend frames do not mutate the DOM');
  report.cases.push({ friday, saturday, repeatedFrameDomMutations: mutations });
  const sunday = await step('2026-10-05T06:59:59Z'), monday = await step('2026-10-05T07:00:00Z');
  assert.equal(sunday.visible, true); assert.equal(monday.visible, false); assert.equal(monday.controls, false); assert.equal(monday.stats.visible, 0);
  await page.evaluate(() => window.fixture.view.controls.querySelector('button').click()); assert.equal(await page.evaluate(() => window.fixture.snapshot().selections), 1, 'A stale weekday click does not create a route');
  report.cases.push({ sunday, monday });
  for (const time of ['2026-11-01T08:59:59Z', '2026-11-01T09:00:00Z']) assert.equal(await page.evaluate(time => window.fixture.weekend(Date.parse(time)), time), true);
  for (const options of [{ load: false }, { y: null }, { away: true }]) { const state = await step('2026-10-03T07:00:00Z', options); assert.equal(state.visible, false); assert.equal(state.stats.visible, 0); }
  const colliding = await step('2026-10-03T07:00:00Z', { collision: true }); assert.equal(colliding.stats.visible, 0);
  const restored = await step('2026-10-03T07:00:00Z'); assert.equal(restored.visible, true); assert.equal(restored.stats.visible, 4);
  const disposal = await page.evaluate(() => window.fixture.dispose()); assert.deepEqual(disposal, { connected: false, children: 0, sharedDisposals: 0, visible: 0 });
  report.cases.push({ dstRepeatedHour: true, missingGroundAndRangeHidden: true, collisionHiddenAndRestored: true, disposal });
  await page.evaluate(() => window.fixture.finish()); assert.deepEqual(report.errors, []); report.passed = true; console.log(JSON.stringify(report));
} catch (error) { report.failure = String(error); throw error; }
finally { await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); report.finishedAt = new Date().toISOString(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
