/** One isolated DOM smoke with the real HUD modules/CSS. No Playwright, WebGL, API or game-state writes.
 * Run behind the shared CPU lock: tools/heavy.sh node tools/phone-notice-layout-smoke.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';

const out = resolve('artifacts/phone-notice-layout', new Date().toISOString().replaceAll(':', '-'));
await mkdir(out, { recursive: true });
const report = { scope: 'Real DOM modules with explicit notice/layout fixtures; no game, service, performance or device acceptance', errors: [], httpErrors: [], steps: [], passed: false };
const entry = `
import './web/src/style.css';
import './web/src/theme/saTheme.css';
import { createPlayableHud } from './web/src/hud/playableHud';
import { createStreetHud } from './web/src/hud/streetHud';
import { createGameOptions } from './web/src/hud/gameOptions';
import { createPhoneHud } from './web/src/hud/phoneHud';
import { createUpcomingEvents } from './web/src/events/upcoming';
import { createEventSubmit } from './web/src/hud/eventSubmit';
import { createDropBanner } from './web/src/drops/banner';
import './web/src/outbid/outbid.css';
const menu = createGameOptions({ launcher: document.querySelector('#movement-mode'), tankControls: () => false, toggleMovement() {}, onModalChange() {} });
const submit = createEventSubmit({ buttonParent: document.querySelector('#play-controls'), onModalChange(open) { if (open) menu.hide(); } });
const originalSubmit = document.querySelector('.gt-eventsubmit-open');
const hud = createPlayableHud(); hud.update({ now: Date.UTC(2026, 9, 4, 6, 40), fundingCents: 0 });
const upcoming = createUpcomingEvents({ frame: { origin: { lat: 37.7955, lon: -122.3937 }, gridRotationDeg: 0 }, enabled: true, onSelect() {}, onHail() {} });
upcoming.setEvents([]);
const street = createStreetHud(); street.update({ neighbourhood: 'NOE VALLEY', street: '24TH STREET' });
const drop = createDropBanner();
if (!submit || !drop) throw new Error('This smoke requires the existing local eventSubmission and fundDrops flags.');
const phone = createPhoneHud({ parent: menu.content, closeOptions: () => menu.hide(), enabled: true });
const now = Date.UTC(2026, 9, 4, 6, 40);
window.fixture = {
  originalSubmit,
  notice(mode) {
    const active = mode === 'none' ? [] : [{ id: 'layout-fixture', slot: 0, fundName: 'SAFE Note Syndicate',
      tagline: mode === 'short' ? 'Come pitch!' : 'SAFE Note Syndicate announces a new fund — come pitch!',
      closesAt: now + 603000, capacity: 50, claimed: 0, remaining: 50, yourClaim: null }];
    const upcoming = mode === 'long' ? { fundName: 'Fog City Ventures', location: { label: 'Washington Square, North Beach' }, opensAt: now + 120000 } : null;
    drop.update({ nearest: active[0] ? { drop: active[0], compass: 'NE', distance: 5700 } : null, active, state: { upcoming } }, now);
  },
  destroyPhone() { phone.destroy(); },
};
window.fixture.notice('none');
`;
await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'js', sourcefile: 'phone-notice-fixture.js' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: join(out, 'fixture.js'), logLevel: 'warning' });
// Surrounding shell markup matches the real app; the changed controls, banner, dialogs and HUD are real modules.
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated phone HUD fixture</title><link rel="stylesheet" href="/fixture.css"></head>
<body class="gt-outbid-active"><main id="app"><header><h1>San Francisco</h1></header><aside><span class="status-dot"></span><span>Connected</span><span id="population">1 player</span></aside>
<nav id="play-controls"><button id="movement-mode">Game options</button><button id="map-toggle">Map</button></nav></main>
<section class="gt-outbid-banner"><span class="gt-outbid-badge">OUTBID</span><div class="gt-outbid-winner"><div class="gt-outbid-name">The crown is open</div><div class="gt-outbid-message">Be the first to put your name over San Francisco.</div></div><span class="gt-outbid-target">First bid: $1.00</span><button class="gt-outbid-claim">OUTBID THEM</button><button class="gt-outbid-board-button">Top 50</button></section>
<script type="module" src="/fixture.js"></script></body></html>`;
await writeFile(join(out, 'fixture.html'), html);
const assets = new Map([['/', ['text/html', html]], ['/fixture.js', ['text/javascript', await readFile(join(out, 'fixture.js'))]], ['/fixture.css', ['text/css', await readFile(join(out, 'fixture.css'))]]]);
const server = createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const asset = assets.get(req.url);
  res.writeHead(asset ? 200 : 404, { 'Content-Type': asset?.[0] ?? 'text/plain' }); res.end(asset?.[1] ?? 'Not found');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;
const profile = await mkdtemp(join(tmpdir(), 'gtasf-phone-notice-'));
const child = spawn(process.env.GTASF_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [`--user-data-dir=${profile}`, '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-gpu', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let launchError, socket, sequence = 0, chromeLog = '';
child.stderr.on('data', data => { chromeLog = (chromeLog + String(data)).slice(-8000); });
child.on('error', error => { launchError = error; });
const exited = new Promise(done => child.once('exit', done));
const pending = new Map();
async function rpc(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 60000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression, label) {
  const until = Date.now() + 15000;
  while (Date.now() < until) { if (await evaluate(expression)) return; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}
async function settled() { await evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))'); }
async function click(selector) {
  const p = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'nearest'}); const r=e.getBoundingClientRect(), x=r.x+r.width/2,y=r.y+r.height/2; return {x,y,visible:r.width>0&&r.height>0,hit:e.contains(document.elementFromPoint(x,y))}; })()`);
  assert(p?.visible && p.hit, `Unobscured action: ${selector}`);
  await rpc('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
}
const overlap = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
async function record(name) {
  await settled();
  const state = await evaluate(`(() => {
    const selectors=['.gt-outbid-banner','.gt-drop-banner','#app>aside','#movement-mode','.gt-hud','.gt-upcoming-open','.gt-street-hud'];
    return { width:innerWidth, height:innerHeight, reserved:parseFloat(document.body.style.getPropertyValue('--gt-phone-notice-height'))||0,
      boxes:selectors.map(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return {selector,visible:e.checkVisibility(),left:r.left,right:r.right,top:r.top,bottom:r.bottom};}).filter(b=>b.visible),
      sameSubmit:document.querySelector('.gt-eventsubmit-open')===window.fixture.originalSubmit,
      submitInMenu:!!document.querySelector('.gt-phone-menu .gt-eventsubmit-open') };
  })()`);
  for (const b of state.boxes) {
    assert(b.left >= -1 && b.right <= state.width + 1 && b.top >= -1 && b.bottom <= state.height + 1, `${name}: ${b.selector} fits viewport`);
  }
  for (let i = 0; i < state.boxes.length; i++) for (let j = i + 1; j < state.boxes.length; j++)
    assert(!overlap(state.boxes[i], state.boxes[j]), `${name}: ${state.boxes[i].selector} overlaps ${state.boxes[j].selector}`);
  assert(state.sameSubmit && state.submitInMenu, 'Original Add event action lives in phone menu');
  report.steps.push({ name, ...state });
  const shot = await rpc('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(out, `${name}.png`), Buffer.from(shot.data, 'base64'));
  return state;
}
try {
  let port;
  for (let i = 0; i < 400 && !port; i++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Chrome exited ${child.exitCode}`);
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch {}
    if (!port) await delay(150);
  }
  assert(port, 'Isolated Chrome control port');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data)), p = message.params;
    if (message.id) { const job = pending.get(message.id); pending.delete(message.id); message.error ? job?.reject(new Error(message.error.message)) : job?.resolve(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') report.errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && p.type === 'error') report.errors.push(p.args.map(a => a.value ?? a.description ?? '').join(' '));
    if (message.method === 'Network.responseReceived' && p.response.status >= 400) report.httpErrors.push({ url: p.response.url, status: p.response.status });
  });
  await rpc('Page.enable'); await rpc('Runtime.enable'); await rpc('Network.enable');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await rpc('Page.navigate', { url }); await waitFor('Boolean(window.fixture)', 'fixture mounted');
  const empty = await record('phone-390-no-drop'); assert.equal(empty.reserved, 0);
  await evaluate('window.fixture.notice("short")'); const short = await record('phone-390-short');
  await evaluate('window.fixture.notice("long")'); const long = await record('phone-390-long');
  assert(long.reserved > short.reserved, 'A wrapping title/teaser reserves its larger height');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
  await record('phone-320-long');
  await click('#movement-mode'); await waitFor('document.querySelector(".gt-game-options").open', 'options opened');
  await click('.gt-phone-menu .gt-eventsubmit-open');
  await waitFor('document.querySelector(".gt-eventsubmit").open && !document.querySelector(".gt-game-options").open', 'original Add event handler opens its dialog');
  assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'), 1);
  assert.equal(await evaluate('document.activeElement.className'), 'gt-eventsubmit-input');
  await click('.gt-eventsubmit-close'); await waitFor('document.activeElement.id === "movement-mode"', 'visible focus restored');
  report.steps.push({ name: 'original-add-event-handler-and-focus', passed: true });
  await evaluate('window.fixture.notice("none")'); const hidden = await record('phone-320-hidden'); assert.equal(hidden.reserved, 0);
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await settled();
  assert.equal(await evaluate('document.querySelector("#play-controls .gt-eventsubmit-open") === window.fixture.originalSubmit && !document.body.classList.contains("gt-phone-hud")'), true);
  await click('#play-controls .gt-eventsubmit-open'); await waitFor('document.querySelector(".gt-eventsubmit").open', 'desktop action retained'); await click('.gt-eventsubmit-close');
  report.steps.push({ name: 'desktop-original-action-restored', passed: true });
  await rpc('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate('window.fixture.notice("long")'); await record('phone-390-return');
  await evaluate('window.fixture.destroyPhone(); window.fixture.notice("short")'); await settled();
  assert.equal(await evaluate('!document.body.classList.contains("gt-phone-hud") && !document.body.style.getPropertyValue("--gt-phone-notice-height") && !document.querySelector(".gt-phone-menu") && document.querySelector("#play-controls .gt-eventsubmit-open") === window.fixture.originalSubmit'), true);
  report.steps.push({ name: 'observer-and-controls-cleanup', passed: true });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []);
  report.passed = true; console.log(`PHONE_NOTICE_LAYOUT_PASS ${out}`);
} catch (error) {
  report.failure = String(error); report.chromeLog = chromeLog;
  if (socket?.readyState === WebSocket.OPEN) {
    const shot = await rpc('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).catch(() => null);
    if (shot) await writeFile(join(out, 'failure.png'), Buffer.from(shot.data, 'base64'));
  }
  throw error;
} finally {
  socket?.close();
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([exited, delay(2000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
  await rm(profile, { recursive: true, force: true });
  server.closeAllConnections(); await new Promise(done => server.close(done));
  await writeFile(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
