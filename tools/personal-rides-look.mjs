/** Native rides check: frozen common app, real disposable Worker, actual keyboard/touch.
 * Run with the Node version from .nvmrc: tools/heavy.sh node tools/personal-rides-look.mjs
 * Higher-tier accounts are explicitly seeded in disposable SQLite to inspect the shipped assets.
 * This does not verify earning those stages, real devices, or frame-rate acceptance.
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

const out = resolve('artifacts/personal-rides-look', new Date().toISOString().replaceAll(':', '-'));
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'gtasf-rides-chrome-'));
const clients = [], report = { stages: [], errors: [], httpErrors: [], seededFunding: true, capture: false };
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
      windowsVirtualKeyCode: code.startsWith('Key') ? code.charCodeAt(3) : ({ ArrowRight: 39, ArrowLeft: 37 }[code] ?? 0) });
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
const inspect = `(()=>{const h=window.__gtasf,w=h.world,scene=w.landmarks.parent;return {
  frame:h.frame,capture:h.capture,pose:{...w.foot},mode:w.mode,source:h.input.source,
  cameraYaw:w.camera.yaw,
  focused:document.hasFocus(),visibility:document.visibilityState,active:document.activeElement?.tagName,
  inputSuspended:h.input.suspended,keys:[...h.input.keys],queued:[...h.input.queued],held:[...h.input.down],
  dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.className),
  speed:Number(document.querySelector('#world').dataset.speed),connected:document.querySelector('#world').dataset.connected,
  round:w.funding.profile.round.id,button:document.querySelector('#ride').textContent,
  rides:scene.children.filter(o=>o.name==='personal-ride').flatMap(o=>o.children.filter(c=>c.visible).map(c=>({id:c.name,pose:c.position.toArray(),yaw:c.rotation.y})))
};})()`;
async function move(page, touch = false) {
  const before = await page.read(inspect), corrections = page.corrections.length, trace = [];
  let point;
  if (touch) { point = await page.point('.gtasf-touch .stick'); await page.touch('touchStart', [{ x: point.x, y: point.y }]); await page.touch('touchMove', [{ x: point.x, y: point.y - 58 }]); }
  else await page.key('KeyW', true);
  try {
    const end = Date.now() + 1800;
    while (Date.now() < end) { trace.push(await page.read(inspect)); await delay(80); }
  } finally { if (touch) await page.touch('touchEnd'); else await page.key('KeyW', false); }
  await delay(350);
  const after = await page.read(inspect), distance = Math.hypot(after.pose.x - before.pose.x, after.pose.z - before.pose.z);
  const result = { page: page.name, touch, distance, corrections: page.corrections.length - corrections,
    correctionFrames: page.corrections.slice(corrections), moveFrames: [...page.moves], before, after, trace };
  // Preserve a failing movement trace too; assertions must not discard its evidence.
  (report.movements ??= []).push(result);
  assert(distance > 2, `${touch ? 'Touch' : 'Keyboard'} moves mounted player`);
  assert(trace.some(s => s.source === (touch ? 'touch' : 'keyboard') && s.speed >= 13.5), 'Real input reaches ride speed');
  assert(trace.every(s => s.connected === 'true' && s.mode === 'on-foot'), 'Rider stays connected');
  assert.equal(page.corrections.length, corrections, 'No server movement correction while riding');
  return result;
}
async function mountedImage(page, name) {
  const frame = await page.read('window.__gtasf.frame');
  await page.until(`window.__gtasf.frame>=${frame + 4}`, 'Mounted model settled');
  await page.image(name);
}
async function sideImage(page, name) {
  // A player nameplate can cover the canvas centre. Send the real wheel event
  // to an exposed canvas point rather than through that interactive overlay.
  const point = await page.read(`(()=>{const e=document.querySelector('#world'),r=e.getBoundingClientRect();for(const fy of [.4,.35,.55,.6])for(const fx of [.5,.4,.6]){const x=r.x+r.width*fx,y=r.y+r.height*fy;if(document.elementFromPoint(x,y)===e)return {x,y};}return null;})()`);
  assert(point, 'Exposed canvas point for camera wheel');
  await page.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: -300 });
  const frame = await page.read('window.__gtasf.frame');
  await page.until(`window.__gtasf.frame>=${frame + 4}`, 'Camera zoom settled', 15000);
  // Camera travel must be measured in rendered frames on a contended laptop;
  // a fixed 650 ms key hold can leave a bicycle's wheels directly in line.
  const yaw = await page.read('window.__gtasf.world.camera.yaw');
  await page.key('ArrowRight', true);
  try {
    await page.until(`Math.abs(Math.atan2(Math.sin(window.__gtasf.world.camera.yaw-(${yaw})),Math.cos(window.__gtasf.world.camera.yaw-(${yaw}))))>.9`, 'Side view reached', 30000);
    // Keep actual look input held until capture; at low frame rates the chase
    // camera can otherwise resume its follow heading before the screenshot.
    await page.image(name);
  } finally { await page.key('ArrowRight', false); }
}
async function seed(db, id, cents) {
  const token = randomBytes(32).toString('hex'), hash = createHash('sha256').update(token).digest('hex'), now = Date.now();
  await db.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, hash, `Ride ${id}`, id, now, now).run();
  for (let remaining = cents, i = 0; remaining > 0; i++) {
    const amount = Math.min(10_000_000_000, remaining); remaining -= amount;
    await db.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(`${id}-${i}`, id, 'sf-tech-week-2026', 'celebrity', `ride-look-${i}`, 'Isolated ride visual check', new Date(now).toISOString().slice(0, 10), now, amount).run();
  }
  return token;
}
try {
  console.log(`RIDES_CAPTURE_START ${out}`);
  const sourceFlags = await readFile('shared/flags.ts', 'utf8');
  assert.match(sourceFlags, /personalRides:\s*true/, 'Enable source candidate before its normal native check');
  report.flagsSource = sourceFlags;
  const app = process.env.GTASF_RIDES_APP ? resolve(process.env.GTASF_RIDES_APP) : join(out, 'app');
  report.app = app;
  if (!process.env.GTASF_RIDES_APP) await build({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
  pool = await startLocalPool();
  server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: pool.url.origin, ws: true } } } });
  const base = server.resolvedUrls.local[0], db = await pool.worker.getD1Database('DB');
  report.base = base; report.eventCount = pool.eventCount;
  chrome = spawn(process.env.GTASF_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    `--user-data-dir=${profile}`, '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--use-angle=metal', '--enable-gpu', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', value => { chromeLog = (chromeLog + String(value)).slice(-8000); });
  exited = new Promise(resolve => chrome.once('exit', resolve));
  let port;
  for (let i = 0; i < 400 && !port; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch {} if (!port) await delay(150); }
  assert(port, 'Chrome control port ready');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await CDP.connect(version.webSocketDebuggerUrl, 'browser');
  async function page(name) {
    const { browserContextId } = await browser.call('Target.createBrowserContext');
    const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank', browserContextId });
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const client = await CDP.connect(list.find(p => p.id === targetId).webSocketDebuggerUrl, name);
    client.browserContextId = browserContextId;
    for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable']) await client.call(method);
    return client;
  }
  const observer = await page('observer');
  async function size(client, phone) {
    await client.call('Emulation.setDeviceMetricsOverride', { width: phone ? 390 : 1440, height: phone ? 844 : 900, deviceScaleFactor: 1, mobile: phone });
    await client.call('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 2 });
  }
  async function boot(client, token, path = '/?time=noon') {
    await client.call('Page.bringToFront');
    await client.call('Network.setCookie', { name: 'gtasf_device', value: token, url: base, httpOnly: true, sameSite: 'Lax' });
    await client.call('Page.navigate', { url: new URL(path, base).href });
    await client.until(`window.__gtasf?.ready&&document.querySelector('#world')?.dataset.connected==='true'&&document.querySelector('#loading')?.hidden`, 'READY connected');
    assert.equal((await client.read(inspect)).capture, false, 'Normal real-time renderer');
    if (await client.read(`Boolean(document.querySelector('.gt-whatsnew[open]'))`)) {
      await client.click('.gt-whatsnew-go');
      await client.until(`!document.querySelector('.gt-whatsnew')?.open`, 'Let us go dialog dismissed');
    }
    if (await client.read(`Boolean(document.querySelector('.gt-sa-intro__skip'))`)) {
      await client.click('.gt-sa-intro__skip');
      await client.until(`!document.querySelector('.gt-sa-intro')`, 'Visible intro Skip completed');
    }
    if (await client.read(`Boolean(document.querySelector('.gt-identity[open]'))`)) {
      await client.click('.gt-identity-go');
      await client.until(`!document.querySelector('.gt-identity')?.open`, 'Founder identity saved');
    }
    await client.until(`!document.querySelector('dialog[open]')`, 'Gameplay controls available');
    // Native close/focus events can arrive after dialog.open changes. Click the
    // actual canvas and wait for normal frames before testing a gameplay key.
    await client.click('#world');
    const frame = await client.read('window.__gtasf.frame');
    await client.until(`document.hasFocus()&&window.__gtasf.frame>=${frame + 2}`, 'Canvas focused and normal frames resumed');
    console.log(`RIDES_READY ${client.name}`);
  }
  await size(observer, false); await boot(observer, await seed(db, 'Observer', 0));
  // Stand beside the arrival point through real walking input so the two avatar
  // rigs do not overlap during the mounted silhouette captures.
  const observerStart = await observer.read(inspect);
  await observer.key('KeyW', true);
  try {
    await observer.until(`Math.hypot(window.__gtasf.world.foot.x-${observerStart.pose.x},window.__gtasf.world.foot.z-(${observerStart.pose.z}))>=4`, 'Observer walks clear of rider', 60000);
  } finally { await observer.key('KeyW', false); }
  report.observerPosition = await observer.read(inspect);
  for (const [round, id, cents] of [['bootstrapping', 'scooter', 0], ['seed', 'skateboard', 300_000_000], ['series-a', 'ebike', 1_500_000_000], ['series-d', 'onewheel', 2_500_000_000], ['unicorn', 'segway', 110_000_000_000]]) {
    // Keep the real second player active with a native camera key between stages;
    // an idle observer otherwise correctly leaves the city after five minutes.
    await observer.call('Page.bringToFront'); await observer.press('KeyC');
    const record = { round, id }; report.stages.push(record);
    const rider = await page(`rider-${id}`), token = await seed(db, id, cents);
    await size(rider, false); await boot(rider, token);
    assert.equal((await rider.read(inspect)).round, round, 'Real funding profile supplies expected stage');
    // Observe native delivery without dispatching events or altering gameplay state.
    await rider.read(`window.__rideKeyEvents=[];window.addEventListener('keydown',e=>window.__rideKeyEvents.push({code:e.code,trusted:e.isTrusted,prevented:e.defaultPrevented,target:e.target?.tagName}));true`);
    record.beforeMount = await rider.read(inspect);
    await rider.press('KeyG');
    record.afterKey = await rider.read(inspect);
    try { await rider.until(`document.querySelector('#ride').textContent.includes('Hop off')`, 'Keyboard mount', 15000); }
    catch (error) {
      record.keyboardFailure = await rider.read(inspect);
      record.keyEvents = await rider.read('window.__rideKeyEvents');
      // Diagnose the same entry point through its real button, retaining the
      // keyboard failure even if the button works. Never turn this into a pass.
      await rider.click('#ride').catch(() => {});
      await delay(500);
      record.buttonDiagnostic = await rider.read(inspect);
      await rider.image(`${id}-button-diagnostic.png`);
      throw error;
    }
    await observer.until(`(${inspect}).rides.some(r=>r.id===${JSON.stringify(id)})`, 'Remote sees mounted tier', 15000);
    // At spawn the ride is clear of the nearby parked car. Retain this view
    // before the travel check, which can put that car between camera and rider.
    await mountedImage(rider, `${id}-mounted-desktop.png`);
    record.desktop = await move(rider);
    await sideImage(rider, `${id}-desktop.png`); await observer.image(`${id}-remote.png`);
    record.remote = await observer.read(inspect);
    await rider.press('KeyG'); await rider.until(`!document.querySelector('#ride').textContent.includes('Hop off')`, 'Keyboard dismount', 15000);
    await observer.until(`(${inspect}).rides.length===0`, 'Remote hides dismounted ride', 15000);
    await observer.call('Page.bringToFront'); await observer.press('KeyC');
    await size(rider, true); await boot(rider, token, '/?time=noon&preset=low');
    await rider.tap('#movement-mode'); await rider.until(`document.querySelector('.gt-game-options')?.open`, 'Phone options');
    if (id === 'scooter') {
      record.unlocks = await rider.read(`document.querySelector('.gt-ride-unlocks').textContent`);
      for (const label of ['Scooter', 'Pre-seed', 'Series A', 'Series D', 'Unicorn']) assert(record.unlocks.includes(label), `Required stage visible: ${label}`);
      await rider.read(`document.querySelector('.gt-ride-unlocks').scrollIntoView({block:'center'})`);
      await rider.image('phone-ride-unlocks.png');
    }
    await rider.read(`document.querySelector('#ride').scrollIntoView({block:'center'})`);
    await rider.tap('#ride');
    await rider.until(`!document.querySelector('.gt-game-options')?.open&&document.querySelector('#ride').textContent.includes('Hop off')`, 'Phone mount', 15000);
    await mountedImage(rider, `${id}-mounted-phone.png`);
    record.phone = await move(rider, true); await sideImage(rider, `${id}-phone.png`);
    await rider.tap('#movement-mode'); await rider.until(`document.querySelector('.gt-game-options')?.open`, 'Phone options for dismount');
    await rider.read(`document.querySelector('#ride').scrollIntoView({block:'center'})`); await rider.tap('#ride');
    await rider.until(`!document.querySelector('#ride').textContent.includes('Hop off')`, 'Phone dismount', 15000);
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`RIDES_TIER_PASS ${id}`);
    await browser.call('Target.disposeBrowserContext', { browserContextId: rider.browserContextId });
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []);
  console.log(`RIDES_CAPTURE_DONE ${out}`);
} catch (error) {
  report.failure = String(error); report.chromeLog = chromeLog;
  report.failureStates = {};
  for (const client of clients.filter(c => c.name !== 'browser' && c.socket.readyState === WebSocket.OPEN)) report.failureStates[client.name] = await client.read(inspect).catch(error => String(error));
  for (const client of clients.filter(c => c.name !== 'browser' && c.socket.readyState === WebSocket.OPEN)) await client.image(`failure-${client.name}.png`).catch(() => {});
  throw error;
} finally {
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  for (const client of clients) client.socket.close();
  if (chrome?.exitCode === null) chrome.kill('SIGTERM');
  await Promise.race([exited, delay(2000)]);
  if (chrome?.exitCode === null) { chrome.kill('SIGKILL'); await exited; }
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
  await pool?.close(); await rm(profile, { recursive: true, force: true });
}
