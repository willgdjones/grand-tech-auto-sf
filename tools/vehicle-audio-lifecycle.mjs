/** Isolated real Web Audio/DOM evidence. Fleet fixtures are explicit; this is not mounted-game acceptance. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { nativeMediaBrowser } from './native-media-browser.mjs';

const out = process.env.GTASF_AUDIO_LIFECYCLE_OUT ?? 'artifacts/vehicle-audio-lifecycle';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), evidence: 'isolated real AudioContext; explicit fleet fixtures; no world/backend', errors: [], steps: [], passed: false };
const owned = await nativeMediaBrowser(), { context, page } = owned;
await page.setViewportSize({ width: 390, height: 844 }); page.setDefaultTimeout(10_000);
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) report.errors.push('Unexpected backend request'); });
await page.route('**/__vehicle-audio-check', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Isolated vehicle sound check</title>
<style>body{background:#152319;color:#fff;font:16px sans-serif;margin:20px}button{padding:12px;margin:4px}</style>
<main id="controls"></main><div id="fixture"></div>
<script type="module">
import {createVehicleAudio} from '/src/audio/vehicles.ts';
const car={data:{id:1,kind:'subaru',speedCmps:800},model:{root:{position:{x:-8,y:0,z:0},visible:true}}};
const fleet=new Map([[1,car]]), listener={x:0,y:0,z:0,yaw:0}; let occupied=0,speed=0;
const audio=createVehicleAudio({enabled:true,parent:document.querySelector('#controls')});
const frame=()=>{audio.update(fleet,listener,occupied,speed)}; const timer=setInterval(frame,30);
const controls={Right:()=>{car.model.root.position.x=8},Accelerate:()=>{car.data.speedCmps=1800},Far:()=>{car.model.root.position.x=90},
Idle:()=>{car.model.root.position.x=0;car.data.speedCmps=0;occupied=1;speed=0},Horn:()=>audio.horn(1),
Hide:()=>{car.model.root.visible=false},Show:()=>{car.model.root.visible=true},
Bell:()=>{car.data.kind='cable-car';car.data.speedCmps=500;occupied=0;frame();setTimeout(()=>{car.data.speedCmps=0},180)},
Destroy:()=>{clearInterval(timer);audio.destroy()}};
for(const [label,action] of Object.entries(controls)){const button=document.createElement('button');button.textContent=label;button.onclick=action;document.querySelector('#fixture').append(button)}
window.check={get state(){return audio.state}};
</script>` }));
const state = () => page.evaluate(() => ({ ...window.check.state, hidden: document.hidden, visibility: document.visibilityState }));
async function record(name) { const data = await state(); report.steps.push({ name, data }); console.log(`AUDIO_LIFECYCLE:${name}`); return data; }
try {
  await page.goto(new URL('/__vehicle-audio-check', base).href); await page.waitForFunction(() => window.check);
  assert.equal((await state()).context, 'not-started');
  await page.getByRole('button', { name: 'Enable vehicle sounds', exact: true }).click();
  await page.waitForFunction(() => window.check.state.peak > .00001);
  const left = await record('audible-left'); assert.equal(left.voices[0].pan, -1);
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await page.waitForFunction(() => window.check.state.voices[0]?.pan === 1); await record('audible-right');
  await page.getByRole('button', { name: 'Accelerate', exact: true }).click();
  await page.waitForFunction(hz => window.check.state.voices[0]?.frequency > hz, left.voices[0].frequency); await record('accelerated');
  await page.getByRole('button', { name: 'Far', exact: true }).click();
  await page.waitForFunction(() => window.check.state.voices.length === 0); await record('outside-range');
  await page.getByRole('button', { name: 'Idle', exact: true }).click();
  await page.waitForFunction(() => window.check.state.voices.length === 1);
  await page.getByRole('button', { name: 'Horn', exact: true }).click();
  assert.equal((await state()).hornCount, 1); await record('horn');
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await page.waitForFunction(() => window.check.state.voices.length === 0); await record('cruise-hidden');
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  await page.getByRole('button', { name: 'Bell', exact: true }).click();
  await page.waitForFunction(() => window.check.state.bellCount === 1); await record('arrival-bell');
  await page.getByRole('button', { name: 'Mute effects', exact: true }).click();
  await page.waitForFunction(() => window.check.state.context === 'suspended'); assert.equal((await state()).shots, 0);
  await page.getByRole('button', { name: 'Unmute effects', exact: true }).click();
  await page.waitForFunction(() => window.check.state.context === 'running'); await record('unmuted');
  const background = await context.newPage(); await background.goto('about:blank'); await background.bringToFront();
  await page.waitForFunction(() => document.hidden && window.check.state.context === 'suspended', undefined, { polling: 100 }); await record('hidden');
  await page.bringToFront(); await background.close();
  await page.waitForFunction(() => !document.hidden && window.check.state.context === 'running');
  await page.screenshot({ path: `${out}/phone-controls.png` });
  await page.getByRole('button', { name: 'Destroy', exact: true }).click();
  await page.waitForFunction(() => window.check.state.context === 'closed'); await record('disposed');
  assert.equal((await state()).voices.length, 0); assert.equal((await state()).shots, 0); assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error); report.failedState = await state().catch(() => null); await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  process.exitCode = 1; console.error(report.failure);
} finally {
  report.finishedAt = new Date().toISOString(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await owned.close(); console.log(`AUDIO_LIFECYCLE_REPORT:${out}/report.json`);
}
