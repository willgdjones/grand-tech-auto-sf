/** 100 real protocol clients against a disposable native WorldDO. Never targets production. */
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const out = resolve(process.env.GTASF_WORLD_LOAD_OUT ?? 'artifacts/world-systems/load');
const durationMs = Number(process.env.GTASF_WORLD_LOAD_SECONDS ?? 60) * 1000;
assert(durationMs >= 30_000 && durationMs <= 180_000, 'Load duration must be 30–180 seconds');
await mkdir(out, { recursive: true });
const cityPath = process.env.GTASF_WORLD_LOAD_GRAPH;
const cityBytes = cityPath ? await readFile(resolve(cityPath)) : undefined;
const citySha = cityBytes ? createHash('sha256').update(cityBytes).digest('hex') : undefined;
const cityKey = citySha ? `map/sf/${citySha}/roadgraph.bin` : undefined;
const codecFile = `${out}/codecs.mjs`;
await build({ stdin: { contents: `export {encodeC2S} from './shared/protocol/c2s.ts'; export {decodeS2C} from './shared/protocol/s2c.ts';
export {LOCAL_SPAWN,LOMBARD_SPAWN} from './worker/src/world/localSpawn.ts';
export {cableCarIds,sampleCableCar} from './shared/transit/cableCars.ts'; export {flags} from './shared/flags.ts';`,
  resolveDir: resolve('.'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: codecFile, logLevel: 'error' });
const { encodeC2S, decodeS2C, LOCAL_SPAWN, LOMBARD_SPAWN, cableCarIds, sampleCableCar, flags: localFlags } = await import(pathToFileURL(codecFile).href);
const baseline = JSON.parse(await readFile('artifacts/production/last-deploy.json', 'utf8')).flags;
const flags = { ...Object.fromEntries(Object.keys(localFlags).map(key => [key, false])), ...baseline, traffic: true, cableCars: true, roadRespawn: true };
const entry = `import app,{WorldDO as RealWorld,LedgerDO,LobbyDO} from './worker/src/index.ts';
export {LedgerDO,LobbyDO};
export class WorldDO extends RealWorld {
  samples=[];peakTraffic=0;peakTrips=0;
  step(){const start=performance.now();super.step();this.samples.push(performance.now()-start);this.peakTraffic=Math.max(this.peakTraffic,this.traffic?.size??0);this.peakTrips=Math.max(this.peakTrips,this.taxis.trips.size);}
  async fetch(r){if(new URL(r.url).pathname==='/__load/metrics')return Response.json({peers:this.peers.size,ticks:this.tick,traffic:this.traffic?.size??0,peakTraffic:this.peakTraffic,peakTrips:this.peakTrips,cars:this.vehicles.cars.size,occupants:this.vehicles.occupants.size,packedRoadBytes:this.recoveryRoads.retainedBytes??0,stepMs:this.samples});return super.fetch(r);}
}
export default {fetch(r,e,c){if(new URL(r.url).pathname==='/__load/metrics')return e.WORLD.get(e.WORLD.idFromName('sf')).fetch(r);return app.fetch(r,e,c);}};`;
const bundle = await build({ stdin: { contents: entry, resolveDir: resolve('.'), loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  external: ['cloudflare:workers', 'node:*'], conditions: ['workerd', 'worker', 'browser'], write: false, logLevel: 'error', plugins: [{ name: 'world-load-flags', setup(b) {
    b.onLoad({ filter: /shared\/flags\.ts$/ }, () => ({ loader: 'ts', contents: `export const flags=Object.freeze(${JSON.stringify(flags)});` }));
  } }] });
await writeFile(`${out}/worker.js`, bundle.outputFiles[0].text);
const errors = [], bots = [], timers = [];
const report = { at: new Date().toISOString(), scope: 'Disposable local native workerd WorldDO + LobbyDO, actual 10Hz timers and 100 protocol clients; no fixed clock or simulated tick',
  flags, clients: 100, durationMs, graph: cityKey ? { path: cityPath, key: cityKey, sha256: citySha, bytes: cityBytes.length } : { kind: 'bundled-corridor' }, checks: [], errors, passed: false };
let finished = false, measuring = false;
const pool = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false }, workers: [{
  name: 'world-load', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
  bindings: { ENVIRONMENT: 'local', LAUNCH_MODE: 'open', WORLD_CAPACITY: '150', ...(cityKey ? { WORLD_ROAD_GRAPH_KEY: cityKey, WORLD_ROAD_GRAPH_SHA256: citySha } : {}) },
  durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true }, LOBBY: { className: 'LobbyDO', useSQLite: true }, LEDGER: { className: 'LedgerDO', useSQLite: true } },
  d1Databases: ['DB'], r2Buckets: ['ASSETS'], queueProducers: { JOBS: 'world-load-jobs' },
  outboundService: request => { errors.push(`Unexpected external request ${new URL(request.url).hostname}`); return new Response('Offline load environment', { status: 503 }); },
}] }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition, label, timeout = 15_000) {
  const end = performance.now() + timeout;
  while (!condition()) { if (performance.now() >= end) throw new Error(`Timed out: ${label}`); await sleep(20); }
}
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return { n, mean: n ? values.reduce((a, b) => a + b, 0) / n : 0, p95: sorted[Math.ceil(n * .95) - 1] ?? 0, p99: sorted[Math.ceil(n * .99) - 1] ?? 0, max: sorted.at(-1) ?? 0 };
};
try {
  const base = String(await pool.ready), origin = new URL(base).origin;
  assert.equal(new URL(base).hostname, '127.0.0.1');
  if (cityKey) await (await pool.getR2Bucket('ASSETS')).put(cityKey, cityBytes);
  const db = await pool.getD1Database('DB');
  for (const name of (await readdir('worker/migrations')).filter(name => /^\d.*\.sql$/.test(name)).sort()) {
    // Strip line comments before splitting on ';' so a ';' inside a comment can't leave a comment-only
    // fragment (D1: "SQL code did not contain a statement"). Same fix as tools/local-pool/pool.mjs.
    const ddl = (await readFile(`worker/migrations/${name}`, 'utf8')).replace(/--[^\n]*/g, '');
    for (const sql of ddl.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
  }
  async function api(path, body) {
    const response = await pool.dispatchFetch(new URL(path, base), { headers: { Origin: origin, 'Content-Type': 'application/json' },
      method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, 200, `${path} HTTP ${response.status}`); return response.json();
  }
  async function connect(index, pose) {
    let grant = await api('/api/admission/enter', {});
    const admissionDeadline = performance.now() + 30_000;
    while (grant.status === 'queued' && performance.now() < admissionDeadline) {
      await sleep(100);
      grant = await api('/api/admission/poll', { ticket: grant.ticket });
    }
    assert.equal(grant.status, 'admitted'); assert(grant.grant);
    const response = await pool.dispatchFetch(new URL(`/api/world?spawn=${pose.x},${pose.y},${pose.z},${pose.yaw}`, base), {
      headers: { Origin: origin, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `gtasf.v2,gtasf.admit.${grant.grant}` },
    });
    assert.equal(response.status, 101, `Client ${index} admitted upgrade`);
    const socket = response.webSocket; socket.binaryType = 'arraybuffer'; socket.accept();
    const bot = { index, socket, spawn: pose, pose, seq: 0, welcome: null, mode: 'on-foot', vehicleId: 0,
      bytes: 0, frames: 0, snapshots: 0, vehicleSnapshots: 0, rtt: [], gaps: [], lastVehicleAt: 0,
      lastVehicle: null, taxi: [], seats: [], corrections: [], malformed: 0, visiblePeers: new Set(), movingNpc: false };
    bots.push(bot);
    bot.send = message => { try { socket.send(encodeC2S(message)); } catch (error) { if (!finished) errors.push(`send ${index}: ${error.message}`); } };
    socket.addEventListener('message', event => {
      const bytes = new Uint8Array(event.data), decoded = decodeS2C(bytes), now = performance.now();
      if (!decoded.ok) { bot.malformed++; errors.push(`Malformed server frame ${index}: ${decoded.err}`); return; }
      if (measuring) { bot.bytes += bytes.length; bot.frames++; }
      const m = decoded.msg;
      if (m.type === 'WELCOME') { bot.welcome = m; bot.pose = m.pose; }
      if (m.type === 'CORRECTION') { bot.pose = m.pose; bot.corrections.push(m); }
      if (m.type === 'VEHICLE_STATE' && m.playerId === bot.welcome?.id) { bot.mode = m.mode; bot.vehicleId = m.vehicleId; bot.seats.push(m); }
      if (m.type === 'ROBOTAXI_STATE') bot.taxi.push(m);
      if (m.type === 'PONG' && measuring) bot.rtt.push(now - m.clientT);
      if (m.type === 'SNAPSHOT') { if (measuring) bot.snapshots++; for (const p of m.entries) bot.visiblePeers.add(p.id); }
      if (m.type === 'VEHICLE_SNAPSHOT') {
        bot.lastVehicle = m;
        if (m.entries.some(car => (car.flags & 0x20) && car.speedCmps > 0)) bot.movingNpc = true;
        if (measuring) { bot.vehicleSnapshots++; if (bot.lastVehicleAt) bot.gaps.push(now - bot.lastVehicleAt); bot.lastVehicleAt = now; }
      }
    });
    socket.addEventListener('close', event => { if (!finished) errors.push(`Unexpected close ${index}: ${event.code} ${event.reason}`); });
    socket.addEventListener('error', () => { if (!finished) errors.push(`Socket error ${index}`); });
    bot.send({ type: 'HELLO', name: `Load ${String(index + 1).padStart(3, '0')}` });
    await until(() => bot.welcome, `HELLO ${index}`);
    return bot;
  }
  let nonce = 0, heartbeat = 0;
  timers.push(setInterval(() => {
    for (const bot of bots) if (bot.welcome) {
      bot.send({ type: 'PING', nonce: ++nonce, clientT: performance.now() });
      if (heartbeat % 3 === 0) bot.send({ type: 'ACTIVITY' });
    }
    heartbeat++;
  }, 1000));
  // Fill bounded FIFO batches together; serial admission would deliberately wait
  // for the Lobby's two-second drain window once per client.
  for (let start = 0; start < 98; start += 16) {
    await Promise.all(Array.from({ length: Math.min(16, 98 - start) }, (_, offset) => {
      const index = start + offset;
      return connect(index, index % 2 ? LOMBARD_SPAWN : LOCAL_SPAWN);
    }));
    console.log(`WORLD_LOAD:admitted ${bots.length}/100`);
  }
  bots.sort((a, b) => a.index - b.index);
  // Two more real users join at an actually stopped cable car and share the same ride.
  let boarding;
  await until(() => {
    const now = Date.now();
    boarding = cableCarIds.map(id => sampleCableCar(id, now)).find(car => car.boarding && sampleCableCar(car.entry.id, now + 4000).boarding);
    return boarding;
  }, 'a currently boarding cable car', 45_000);
  const [firstRider, secondRider] = await Promise.all([connect(98, boarding.entry), connect(99, boarding.entry)]);
  firstRider.send({ type: 'VEHICLE_ENTER', vehicleId: boarding.entry.id }); secondRider.send({ type: 'VEHICLE_ENTER', vehicleId: boarding.entry.id });
  await until(() => firstRider.mode === 'passenger' && secondRider.mode === 'passenger', 'two native cable passengers');
  const firstRidePose = { ...firstRider.pose };
  report.checks.push('100 independent users admitted through real FIFO grants and HELLO; two share a time-based cable car');
  console.log('WORLD_LOAD:100 clients connected; two cable passengers boarded');
  const driver = bots[0]; driver.send({ type: 'VEHICLE_ENTER', vehicleId: 1 });
  await until(() => driver.mode === 'driver', 'starter car enter');
  const beforeRecovery = driver.corrections.length;
  driver.send({ type: 'ROAD_RESPAWN' });
  await until(() => driver.corrections.length > beforeRecovery, 'server road recovery');
  assert.equal(driver.mode, 'driver'); assert.equal(driver.vehicleId, 1); assert.equal(driver.pose.flags & 0x40, 0x40);
  await until(() => driver.lastVehicle?.entries.find(car => car.id === 1)?.speedCmps === 0, 'recovery stopped owned car');
  driver.send({ type: 'VEHICLE_EXIT', vehicleId: 1 }); await until(() => driver.mode === 'on-foot', 'recovered driver exit');
  report.checks.push('ROAD_RESPAWN preserves server-owned car and driver seat, stops speed, then allows exit');
  timers.push(setInterval(() => {
    const time = performance.now() / 1000;
    for (const bot of bots) {
      const pose = bot.mode === 'on-foot' ? { ...bot.pose, x: bot.pose.x + Math.round(Math.sin(time + bot.index) * 10) } : bot.pose;
      bot.send({ type: 'MOVE', ...pose, flags: 0, seq: ++bot.seq & 0xffff });
      if (bot.mode === 'on-foot') bot.pose = pose;
    }
  }, 100));
  await sleep(5000);
  const before = await api('/__load/metrics');
  measuring = true; const start = performance.now();
  timers.push(setTimeout(() => {
    for (const bot of bots.slice(0, 98)) bot.send({ type: 'ROBOTAXI_HAIL', requestId: bot.index + 1,
      destination: bot.index % 2 ? LOCAL_SPAWN : LOMBARD_SPAWN });
  }, 5000));
  timers.push(setTimeout(() => { for (const bot of bots.slice(0, 49)) bot.send({ type: 'ROBOTAXI_CANCEL', requestId: bot.index + 1 }); }, Math.min(40_000, durationMs - 5000)));
  await sleep(durationMs);
  measuring = false; const elapsed = performance.now() - start, after = await api('/__load/metrics');
  const rtt = stats(bots.flatMap(b => b.rtt)), gaps = stats(bots.flatMap(b => b.gaps));
  const snapshotHz = bots.map(b => b.vehicleSnapshots / (elapsed / 1000));
  const requested = bots.slice(0, 98).filter(b => b.taxi.some(t => t.state === 'pickup')).length;
  const stepMs = stats(after.stepMs.slice(before.stepMs.length));
  report.results = { elapsedMs: elapsed, native: { ...after, stepMs: { ...stepMs, clockAdvanced: stepMs.max > 0 } }, rttMs: rtt,
    vehicleIntervalMs: gaps, vehicleHz: stats(snapshotHz), deliveredEncodedBytes: bots.reduce((sum, b) => sum + b.bytes, 0),
    encodedBytesPerClientSecond: stats(bots.map(b => b.bytes / (elapsed / 1000))),
    taxiAccepted: requested, taxiRiding: bots.filter(b => b.taxi.some(t => t.state === 'riding')).length,
    movingNpcObservers: bots.filter(b => b.movingNpc).length, malformed: bots.reduce((sum, b) => sum + b.malformed, 0),
    driverProcessMemoryBytes: process.memoryUsage().rss };
  assert.equal(after.peers, 100); assert.equal(errors.length, 0, errors.slice(0, 8).join('\n'));
  assert.equal(report.results.malformed, 0); assert(requested >= 90, `Accepted taxi dispatch ${requested}/98`);
  assert(after.peakTraffic > 0 && after.peakTraffic <= 96); assert(bots.slice(0, 98).every(b => b.movingNpc));
  assert(bots.every(b => b.visiblePeers.size > 0));
  assert(Math.min(...snapshotHz) >= 8, `Vehicle cadence minimum ${Math.min(...snapshotHz)}Hz`);
  assert(rtt.n >= 1000 && rtt.p95 < 200, `Local p95 RTT ${rtt.p95}ms`);
  assert(gaps.p95 < 200, `Local p95 snapshot interval ${gaps.p95}ms`);
  const cableNow = sampleCableCar(firstRider.vehicleId, Date.now()).entry;
  assert(Math.hypot(cableNow.x - firstRidePose.x, cableNow.z - firstRidePose.z) > 1000, 'Cable ride travelled more than10m');
  firstRider.send({ type: 'VEHICLE_EXIT', vehicleId: firstRider.vehicleId });
  await until(() => firstRider.mode === 'on-foot', 'cable exit');
  assert.equal(secondRider.mode, 'passenger');
  report.checks.push('Native cable car travels while two users ride; one exit leaves the other seated');
  report.checks.push('100 users sustain movement, activity and pings with nearby traffic and98 concurrent taxi requests; bounded population and healthy snapshot cadence');
  report.passed = true;
} catch (error) { report.failure = error.stack ?? String(error); throw error; }
finally {
  finished = true; for (const timer of timers) { clearInterval(timer); clearTimeout(timer); }
  for (const bot of bots) try { bot.socket.close(1000, 'load complete'); } catch { /* Already closed. */ }
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await pool.dispose();
  console.log(JSON.stringify({ passed: report.passed, output: `${out}/report.json`, results: report.results, failure: report.failure }));
}
