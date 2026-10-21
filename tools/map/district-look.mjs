/** Normal-renderer district arrival evidence, adapted from coastline-look.mjs.
 * tools/heavy.sh node --import tsx tools/map/district-look.mjs
 * This records local dev transfer sizes; it does not establish production or device performance.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DISTRICTS } from './src/districts/index.ts';
import { project } from './src/pipeline/settings.ts';

const base = process.env.GTASF_LOOK_URL ?? 'http://127.0.0.1:5197';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Local candidate only');
const lincoln = DISTRICTS.find(d => d.id === 'golden-gate-approach').spawn;
const extraArrivals = [
  { id: 'ferry-default', name: 'Default Ferry spawn', path: '/?time=noon' },
  { id: 'lincoln-explicit', name: 'Lincoln explicit coordinates', expected: lincoln },
  // Source lane-edge cameras supplied by the street-detail owner (gtasf-7924).
  { id: 'columbus-junction', name: 'Columbus junction', expected: { lat: 37.8001862, lon: -122.4100724, heading: 130.8435 } },
  { id: 'stockton-junction', name: 'Stockton junction', expected: { lat: 37.8024919, lon: -122.4095970, heading: 350.9021 } },
].map(arrival => ({ ...arrival, path: arrival.path ?? `/?time=noon&at=${arrival.expected.lat},${arrival.expected.lon},${arrival.expected.heading ?? 0}` }));
const wanted = process.argv.slice(2);
assert(wanted.every(id => DISTRICTS.some(d => d.id === id) || extraArrivals.some(a => a.id === id)), 'Arguments must name a district or explicit review arrival');
const districts = DISTRICTS.filter(d => !wanted.length || wanted.includes(d.id));
const out = process.env.GTASF_LOOK_OUTPUT_DIR ? resolve(process.env.GTASF_LOOK_OUTPUT_DIR)
  : resolve('artifacts/district-look', new Date().toISOString().replaceAll(':', '-'));
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'gtasf-district-chrome-'));
const child = spawn(process.env.GTASF_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  `--user-data-dir=${profile}`, '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--use-angle=metal', '--enable-gpu', '--mute-audio', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let launchError, socket, sequence = 0, chromeLog = '', current;
child.stderr.on('data', data => { chromeLog = (chromeLog + String(data)).slice(-8000); });
child.on('error', error => { launchError = error; });
const exited = new Promise(resolve => child.once('exit', resolve));
const pending = new Map(), records = [];
async function sourceSnapshot() {
  if (process.env.GTASF_LOOK_SOURCE_RECEIPT) return JSON.parse(await readFile(process.env.GTASF_LOOK_SOURCE_RECEIPT, 'utf8'));
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'web/src', 'shared', 'tools/map/src/districts'], { encoding: 'utf8' }).trim().split('\n').sort();
  const hash = createHash('sha256');
  for (const path of files) { hash.update(path); hash.update(await readFile(path)); }
  return { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceSha256: hash.digest('hex') };
}
function rpc(method, params = {}) {
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
  const end = Date.now() + 90000;
  while (Date.now() < end) { if (await evaluate(expression)) return; await delay(250); }
  throw new Error(`Timed out: ${label}`);
}
async function saveReport() {
  await writeFile(join(out, 'report.json'), JSON.stringify({ base, records, visualReviewRequired: true,
    productionBudgetAccepted: false, devicePerformanceAccepted: false }, null, 2));
}
try {
  let port;
  for (let i = 0; i < 400 && !port; i++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Chrome exited ${child.exitCode}`);
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch {}
    if (!port) await delay(150);
  }
  assert(port, 'Chrome exposed its isolated control port');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data)), p = message.params;
    if (message.id) { const job = pending.get(message.id); pending.delete(message.id); message.error ? job?.reject(new Error(message.error.message)) : job?.resolve(message.result); return; }
    if (!current) return;
    if (message.method === 'Runtime.exceptionThrown') current.errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && p.type === 'error') current.errors.push(p.args.map(a => a.value ?? a.description ?? '').join(' '));
    if (message.method === 'Network.requestWillBeSent') {
      // Retain only safe URL/timing fields, never cookies, request bodies or authorization headers.
      const url = new URL(p.request.url);
      current.requests.set(p.requestId, { path: url.pathname, protocol: url.protocol, type: p.type, started: p.timestamp,
        wallTime: p.wallTime, decodedBodyBytes: 0, received: [] });
    }
    const request = current.requests.get(p?.requestId);
    if (request && message.method === 'Network.responseReceived') Object.assign(request, {
      status: p.response.status, mimeType: p.response.mimeType, fromDiskCache: !!p.response.fromDiskCache,
      fromServiceWorker: !!p.response.fromServiceWorker,
      contentEncoding: Object.entries(p.response.headers).find(([key]) => key.toLowerCase() === 'content-encoding')?.[1] ?? 'identity',
    });
    if (request && message.method === 'Network.dataReceived') {
      request.decodedBodyBytes += p.dataLength;
      request.received.push({ timestamp: p.timestamp, encoded: p.encodedDataLength, decoded: p.dataLength });
    }
    if (request && message.method === 'Network.loadingFinished') Object.assign(request, { finished: p.timestamp, transferBytes: p.encodedDataLength });
    if (request && message.method === 'Network.loadingFailed') Object.assign(request, {
      failure: p.errorText, failedAt: p.timestamp, cancelled: !!p.canceled,
    });
  });
  await rpc('Page.enable'); await rpc('Runtime.enable'); await rpc('Network.enable');
  await rpc('Network.setCacheDisabled', { cacheDisabled: true });
  await rpc('Network.setBypassServiceWorker', { bypass: true });
  await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `
    performance.setResourceTimingBufferSize(4000);
    window.__districtReadyMark = null;
    const observeReady = new MutationObserver(() => {
      if (window.__districtReadyMark === null && document.querySelector('#world')?.dataset.ready === 'true') {
        window.__districtReadyMark = { relative: performance.now(), epoch: performance.timeOrigin + performance.now() };
        observeReady.disconnect();
      }
    });
    observeReady.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-ready'] });
  ` });
  const arrivals = districts.map(d => ({ id: d.id, name: d.name, path: `/go/${d.id}?time=noon`, expected: d.spawn }));
  for (const arrival of extraArrivals.filter(a => !wanted.length || wanted.includes(a.id))) {
    if (arrival.id === 'ferry-default') arrivals.unshift(arrival);
    else arrivals.push(arrival);
  }
  for (const arrival of arrivals) for (const mobile of [false, true]) {
    await rpc('Page.navigate', { url: 'about:blank' });
    await delay(100);
    const view = { name: `${arrival.id}-${mobile ? 'phone' : 'desktop'}`, width: mobile ? 390 : 1440,
      height: mobile ? 844 : 900, dpr: mobile ? 2.75 : 1, mobile };
    // Two genuine cold baselines, then reuse the asset cache for the visual tour.
    const coldCache = records.length < 2;
    current = { errors: [], requests: new Map() };
    const record = { ...arrival, ...view, coldCache, passed: false, sourceBefore: await sourceSnapshot() };
    try {
      await rpc('Network.setCacheDisabled', { cacheDisabled: coldCache });
      if (coldCache) await rpc('Network.clearBrowserCache');
      await rpc('Emulation.setDeviceMetricsOverride', { width: view.width, height: view.height, deviceScaleFactor: view.dpr, mobile });
      await rpc('Emulation.setTouchEmulationEnabled', { enabled: mobile });
      const url = new URL(arrival.path, base); url.searchParams.set('preset', mobile ? 'low' : 'medium');
      console.log(`Loading ${view.name}`);
      await rpc('Page.navigate', { url: url.href });
      await waitFor(`location.href===${JSON.stringify(url.href)} && (document.querySelector('#world')?.dataset.ready==='true' || Boolean(document.querySelector('#loading.failed')))`,'game READY');
      await waitFor(`document.querySelector('#world')?.dataset.connected==='true' || Boolean(document.querySelector('#loading.failed'))`,'local multiplayer connection');
      record.boot = await evaluate(`({loading:document.querySelector('#loading-detail')?.textContent, failed:Boolean(document.querySelector('#loading.failed')), state:{...document.querySelector('#world')?.dataset}, url:location.href, ready:window.__districtReadyMark})`);
      assert.equal(record.boot.failed, false, record.boot.loading);
      assert.equal(record.boot.state.ready, 'true'); assert.equal(record.boot.state.connected, 'true');
      assert(record.boot.ready, 'Recorded real READY time');
      assert(!new URL(record.boot.url).searchParams.has('capture'), 'No fixed steps');
      await waitFor(`document.querySelector('#loading')?.hidden`, 'loading card hidden');
      await delay(2500);
      await waitFor(`(() => { const s=window.__gtasf?.world?.map?.stats; return s && s.loading===0 && s.queuedUploads===0; })()`, 'nearby map streaming settled');
      record.contact = await evaluate(`(() => {
        const world = window.__gtasf?.world, foot = world?.foot, map = world?.map, camera = world?.camera?.camera;
        if (!foot || !map) return null;
        return { foot:{...foot}, mode:world.mode, spawn:{...map.spawn}, stats:{...map.stats},
          camera: camera ? { matrixWorld:camera.matrixWorld.toArray(), projectionMatrix:camera.projectionMatrix.toArray(),
            viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio} } : null,
          terrainY:map.heightAt(foot.x,foot.z), roadY:map.roadHeightAt(foot.x,foot.z,foot.y),
          surfaceY:map.surfaceHeightAt(foot.x,foot.z,foot.y),
          collides:map.collides(foot.x,foot.y,foot.z),
          nearestRoad:map.nearestRoad(foot.x,foot.z,20), locationName:map.locationNameAt(foot.x,foot.z) };
      })()`);
      assert(record.contact, 'Actual player/map contact is available');
      assert.equal(record.contact.collides, false, 'Arrival is outside building collision');
      assert.deepEqual(record.contact.stats.errors, [], 'Streamed map has no recorded errors');
      if (arrival.expected) {
        const [x,z]=project(arrival.expected.lon,arrival.expected.lat);
        record.arrivalDistanceM=Math.hypot(record.contact.foot.x-x,record.contact.foot.z-z);
        assert(record.arrivalDistanceM<2, 'District arrival stays at its sourced surface lane');
        assert(Number.isFinite(record.contact.roadY), 'District arrival has a road contact surface');
        assert(Math.abs(record.contact.foot.y-record.contact.roadY)<0.3, 'Feet meet the sourced road height');
      }
      record.resources = await evaluate(`performance.getEntriesByType('resource').map(r => ({path:new URL(r.name).pathname,startTime:r.startTime,responseEnd:r.responseEnd,transferSize:r.transferSize,encodedBodySize:r.encodedBodySize,decodedBodySize:r.decodedBodySize}))`);
      const requests = [...current.requests.values()];
      const first = requests.find(r => r.wallTime);
      const cutoff = first.started + record.boot.ready.epoch / 1000 - first.wallTime;
      const before = requests.filter(r => r.started <= cutoff && ['http:', 'https:'].includes(r.protocol));
      // Finished encodedDataLength includes headers. In-flight requests contribute only bytes received by READY.
      record.readyTransfer = { localDevOnly: true, coldCache, readyMs: record.boot.ready.relative,
        nonHttpRequestsBeforeReady: requests.filter(r => r.started <= cutoff && !['http:', 'https:'].includes(r.protocol)).map(r => ({path:r.path,protocol:r.protocol})),
        requestsStarted: before.length, inFlight: before.filter(r => !r.finished || r.finished > cutoff).map(r => r.path),
        transferBytesThroughReady: before.reduce((sum, r) => sum + (r.finished <= cutoff ? r.transferBytes : r.received.filter(c => c.timestamp <= cutoff).reduce((a, c) => a + c.encoded, 0)), 0),
        decodedBodyBytesThroughReady: before.reduce((sum, r) => sum + r.received.filter(c => c.timestamp <= cutoff).reduce((a, c) => a + c.decoded, 0), 0),
        knownCompletedBytesForRequestsStartedBeforeReady: before.reduce((sum, r) => sum + (r.transferBytes ?? 0), 0),
      };
      record.passed = true;
    } catch (error) { record.failure = String(error); }
    const image = await rpc('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    record.screenshot = `${view.name}.png`;
    await writeFile(join(out, record.screenshot), Buffer.from(image.data, 'base64'));
    record.errors = [...new Set(current.errors)];
    // The next navigation cancels old background polls. Freeze this view's evidence
    // now so those later callbacks cannot mutate its already-computed verdict.
    record.network = structuredClone([...current.requests.values()]);
    record.httpErrors = record.network.filter(r => r.status >= 400);
    record.networkFailures = record.network.filter(r => r.failure);
    record.sourceAfter = await sourceSnapshot();
    record.sourceChanged = record.sourceBefore.sourceSha256 !== record.sourceAfter.sourceSha256;
    record.passed &&= record.errors.length === 0 && record.httpErrors.length === 0 && record.networkFailures.length === 0 && !record.sourceChanged;
    records.push(record); await saveReport();
    console.log(JSON.stringify({ view: view.name, passed: record.passed, failure: record.failure, errors: record.errors,
      sourceChanged: record.sourceChanged, httpErrors: record.httpErrors.map(r => ({ path: r.path, status: r.status })),
      readyTransfer: record.readyTransfer, screenshot: join(out, record.screenshot) }));
    if (arrival.id === 'ferry-default') assert(record.passed, 'Default founder spawn failed; repair before continuing the district tour');
  }
  assert(records.every(r => r.passed), 'One or more district arrivals failed; review report and screenshots');
  console.log(`DISTRICT_LOOK_DONE ${out}`);
} catch (error) {
  await writeFile(join(out, 'failure.json'), JSON.stringify({ error: String(error), chromeLog }, null, 2));
  console.error(`DISTRICT_LOOK_FAILED ${out}`); throw error;
} finally {
  socket?.close();
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([exited, delay(2000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
  await rm(profile, { recursive: true, force: true });
}
