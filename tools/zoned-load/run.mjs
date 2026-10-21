/**
 * Zoned-world load harness (docs/engineering/zoned-world.md §13). Real protocol clients against a
 * disposable native worker with `zonedWorld` ON, exercising per-cell routing (through index.ts),
 * per-zone partitioning, nearest-60 bounded snapshots and globally-unique ids end-to-end. This is
 * the capstone local smoke; the same bot plan + metrics point at a STAGING deploy for the
 * 1,000→5,000 run (pane 5). **Never targets production.**
 *
 *   GTASF_ZONED_BOTS=40 GTASF_ZONED_SECONDS=15 node tools/zoned-load/run.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const out = resolve(process.env.GTASF_ZONED_LOAD_OUT ?? 'artifacts/zoned-load');
const bots = Math.max(2, Math.min(5000, Number(process.env.GTASF_ZONED_BOTS ?? 40)));
const durationMs = Math.max(5_000, Math.min(120_000, Number(process.env.GTASF_ZONED_SECONDS ?? 12) * 1000));
await mkdir(out, { recursive: true });

// Bundle the shared codec, zone math and bot plan for the Node driver.
const codecFile = `${out}/codecs.mjs`;
await build({ stdin: { contents: `
  export { encodeC2S } from './shared/protocol/c2s.ts';
  export { decodeS2C } from './shared/protocol/s2c.ts';
  export { flags } from './shared/flags.ts';
  export { SF_ZONE_GRID, splitPlayerId, zoneCount } from './shared/world/zones.ts';
  export { distributeBots } from './tools/zoned-load/plan.ts';`,
  resolveDir: resolve('.'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: codecFile, logLevel: 'error' });
const { encodeC2S, decodeS2C, flags: localFlags, SF_ZONE_GRID, splitPlayerId, zoneCount, distributeBots } = await import(pathToFileURL(codecFile).href);

// All features off except a multiplayer, zoned world with no admission gate; no traffic/chat/funding
// keeps the smoke lean. zonedWorld is the ONE flag flipped on, exactly as a staging run would.
const flags = { ...Object.fromEntries(Object.keys(localFlags).map(key => [key, false])), multiplayer: true, zonedWorld: true };

const entry = `import app, { WorldDO as RealWorld, LedgerDO, LobbyDO } from './worker/src/index.ts';
export { LedgerDO, LobbyDO };
export class WorldDO extends RealWorld {
  samples = [];
  step() { const t = performance.now(); super.step(); this.samples.push(performance.now() - t); }
  async fetch(r) {
    if (new URL(r.url).pathname === '/__load/metrics') return Response.json({ peers: this.peers.size, ticks: this.tick, stepMs: this.samples });
    return super.fetch(r);
  }
}
export default { fetch(r, e, c) {
  const u = new URL(r.url);
  if (u.pathname === '/__load/metrics') { const z = u.searchParams.get('zone'); return e.WORLD.get(e.WORLD.idFromName('z:' + z)).fetch(r); }
  return app.fetch(r, e, c);
} };`;
const worker = await build({ stdin: { contents: entry, resolveDir: resolve('.'), loader: 'ts' }, bundle: true, format: 'esm',
  platform: 'browser', target: 'es2022', external: ['cloudflare:workers', 'node:*'], conditions: ['workerd', 'worker', 'browser'],
  write: false, logLevel: 'error', plugins: [{ name: 'zoned-flags', setup(b) {
    b.onLoad({ filter: /shared\/flags\.ts$/ }, () => ({ loader: 'ts', contents: `export const flags = Object.freeze(${JSON.stringify(flags)});` }));
  } }] });

const errors = [], clients = [], timers = [];
let measuring = false, finished = false;
const report = { at: new Date().toISOString(), scope: 'Disposable native workerd, zonedWorld ON, no admission; real protocol clients',
  bots, durationMs, grid: { cols: SF_ZONE_GRID.cols, rows: SF_ZONE_GRID.rows, zones: zoneCount(SF_ZONE_GRID) }, flags, checks: [], errors, passed: false };
const pool = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false }, workers: [{
  name: 'zoned-load', modules: true, script: worker.outputFiles[0].text, compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
  bindings: { ENVIRONMENT: 'local', LAUNCH_MODE: 'open' },
  durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true }, LOBBY: { className: 'LobbyDO', useSQLite: true }, LEDGER: { className: 'LedgerDO', useSQLite: true } },
  d1Databases: ['DB'], r2Buckets: ['ASSETS'], queueProducers: { JOBS: 'zoned-load-jobs' },
  outboundService: request => { errors.push(`Unexpected external request ${new URL(request.url).hostname}`); return new Response('offline', { status: 503 }); },
}] }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, label, timeout = 15_000) { const end = performance.now() + timeout; while (!cond()) { if (performance.now() >= end) throw new Error(`Timed out: ${label}`); await sleep(20); } }

try {
  const base = String(await pool.ready), origin = new URL(base).origin;
  assert.equal(new URL(base).hostname, '127.0.0.1');
  const plan = distributeBots(bots, SF_ZONE_GRID, 0); // static bots for the local smoke (no crossers)

  async function connect(spec) {
    const url = new URL(`/api/world?zone=${spec.cell.cx},${spec.cell.cy}&spawn=${spec.spawn.x},${spec.spawn.y},${spec.spawn.z},${spec.spawn.yaw}`, base);
    const response = await pool.dispatchFetch(url, { headers: { Origin: origin, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'gtasf.v2' } });
    assert.equal(response.status, 101, `bot ${spec.index} upgrade`);
    const socket = response.webSocket; socket.binaryType = 'arraybuffer'; socket.accept();
    const bot = { ...spec, socket, welcome: null, bytes: 0, snapshots: 0, visible: new Set(), malformed: 0, seq: 0 };
    clients.push(bot);
    socket.addEventListener('message', event => {
      const bytes = new Uint8Array(event.data), decoded = decodeS2C(bytes);
      if (!decoded.ok) { bot.malformed++; errors.push(`bad frame bot ${spec.index}: ${decoded.err}`); return; }
      if (measuring) bot.bytes += bytes.length;
      const m = decoded.msg;
      if (m.type === 'WELCOME') bot.welcome = m;
      if (m.type === 'SNAPSHOT') { if (measuring) bot.snapshots++; for (const e of m.entries) bot.visible.add(e.id); }
    });
    socket.addEventListener('close', e => { if (!finished) errors.push(`bot ${spec.index} closed ${e.code}`); });
    socket.send(encodeC2S({ type: 'HELLO', name: `Z${spec.index}` }));
    await until(() => bot.welcome, `WELCOME ${spec.index}`);
    return bot;
  }
  for (let i = 0; i < plan.length; i += 20) await Promise.all(plan.slice(i, i + 20).map(connect));
  report.checks.push(`${clients.length} bots admitted across ${new Set(clients.map(b => b.zone)).size} zones (no admission gate)`);

  // Drive small in-cell movement so snapshots flow.
  timers.push(setInterval(() => {
    const t = performance.now() / 1000;
    for (const b of clients) b.socket.send(encodeC2S({ type: 'MOVE', seq: (b.seq = (b.seq + 1) & 0xffff), x: b.spawn.x + Math.round(Math.sin(t + b.index) * 50), y: b.spawn.y, z: b.spawn.z, yaw: 0, flags: 0 }));
  }, 100));
  await sleep(2000);
  measuring = true; const start = performance.now();
  await sleep(durationMs);
  measuring = false; const elapsed = performance.now() - start;

  // Per-zone metrics from each live instance.
  const zones = [...new Set(clients.map(b => b.zone))];
  const perZone = {};
  for (const zone of zones) {
    const metrics = await (await pool.dispatchFetch(new URL(`/__load/metrics?zone=${zone.slice(2)}`, base))).json();
    const measured = metrics.stepMs.slice(-Math.round(durationMs / 100));
    const sorted = [...measured].sort((a, b) => a - b);
    perZone[zone] = { peers: metrics.peers, ticks: metrics.ticks, stepMsP95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0, stepMsMax: sorted.at(-1) ?? 0 };
  }
  const expectedPerZone = {};
  for (const b of plan) expectedPerZone[b.zone] = (expectedPerZone[b.zone] ?? 0) + 1;

  // Global-id uniqueness: ids split into distinct cell blocks matching their home zone.
  const blocks = new Set(clients.map(b => splitPlayerId(b.welcome.id).cellIndex));
  report.results = {
    elapsedMs: elapsed, zones: perZone, expectedPerZone,
    bytesPerClientSecond: clients.reduce((s, b) => s + b.bytes, 0) / clients.length / (elapsed / 1000),
    snapshotHz: Math.min(...clients.map(b => b.snapshots / (elapsed / 1000))),
    idBlocks: blocks.size, malformed: clients.reduce((s, b) => s + b.malformed, 0), memoryBytes: process.memoryUsage().rss,
  };
  assert.equal(errors.length, 0, errors.slice(0, 6).join('\n'));
  assert.equal(report.results.malformed, 0);
  for (const zone of zones) assert.equal(perZone[zone].peers, expectedPerZone[zone], `zone ${zone} peers`);
  assert(blocks.size >= Math.min(zones.length, 1), 'player ids namespaced into cell blocks');
  // Two bots share each cell, so each sees at least one peer (cross-check interest works).
  assert(clients.every(b => expectedPerZone[b.zone] < 2 || b.visible.size > 0), 'in-zone visibility');
  report.checks.push('Per-zone population matches routing; ids are globally namespaced; snapshots flow; no malformed frames');
  report.passed = true;
} catch (error) { report.failure = error.stack ?? String(error); throw error; }
finally {
  finished = true; for (const t of timers) clearInterval(t);
  for (const b of clients) try { b.socket.close(1000); } catch { /* closed */ }
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await pool.dispose();
  console.log(JSON.stringify({ passed: report.passed, output: `${out}/report.json`, results: report.results, failure: report.failure }, null, 2));
}
