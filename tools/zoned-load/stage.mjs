/** Staging-only 1k→2k→5k protocol driver. Run through tools/heavy.sh, coordinated by pane 5.
 * Client results never claim the CPU/global-invariant acceptance gate: attach CF per-zone telemetry. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';

const count = Number(process.env.GTASF_ZONED_BOTS ?? 1000);
const durationMs = Number(process.env.GTASF_ZONED_SECONDS ?? 60) * 1000;
const crossEvery = Number(process.env.GTASF_ZONED_CROSS_EVERY ?? 5);
const connectBatch = Number(process.env.GTASF_ZONED_CONNECT_BATCH ?? 25);
assert(Number.isInteger(count) && count >= 40 && count <= 5000, '40–5000 clients');
assert(durationMs >= 30_000 && durationMs <= 600_000, '30–600 seconds');
assert(Number.isInteger(crossEvery) && crossEvery >= 2, 'At least one watcher per crosser');
assert(Number.isInteger(connectBatch) && connectBatch >= 1 && connectBatch <= 100, 'Batch 1–100');
const out = resolve(process.env.GTASF_ZONED_LOAD_OUT ?? `artifacts/zoned-load/staging-${count}-${Date.now()}`);
await mkdir(out, { recursive: true });
const codecFile = `${out}/codecs.mjs`;
await build({ stdin: { contents: `
  export {encodeC2S} from './shared/protocol/c2s.ts';
  export {decodeS2C} from './shared/protocol/s2c.ts';
  export {SF_ZONE_GRID, zoneId, zoneView} from './shared/world/zones.ts';
  export {observerProtocols} from './shared/world/observers.ts';
  export {distributeBots, countRejoinGlitches, updateVisibility, clientLoadPassed, zoneQuery, walkToward} from './tools/zoned-load/plan.ts';
  export {assertStagingTarget, assertStagingHealth} from './tools/zoned-load/target.ts';`,
  resolveDir: resolve('.'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: codecFile, logLevel: 'error' });
const { encodeC2S, decodeS2C, SF_ZONE_GRID: grid, zoneId, zoneView, distributeBots, countRejoinGlitches,
  updateVisibility, clientLoadPassed, zoneQuery, walkToward, assertStagingTarget, assertStagingHealth, observerProtocols } = await import(pathToFileURL(codecFile).href);
const target = assertStagingTarget(process.env.GTASF_ZONED_STAGING_URL,
  (process.env.GTASF_ZONED_EXTRA_PROD_MARKERS ?? '').split(',').filter(Boolean));
// No redirects and no WebSockets until the actual deployment proves it is staging.
const healthResponse = await fetch(`${target.httpOrigin}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
assert.equal(healthResponse.status, 200, 'staging health');
const health = await healthResponse.json(); assertStagingHealth(health);
const plans = distributeBots(count, grid, crossEvery);
const bots = [], errors = [], timers = [], sockets = new Set(), expectedClose = new WeakSet();
const report = { at: new Date().toISOString(), target: target.wsOrigin, environment: health.environment,
  flags: health.flags, bots: count, durationMs, crossEvery, passed: false, clientPassed: false,
  cpuPerZone: null, acceptancePending: ['Cloudflare CPU per zone', 'global funding/drop/outbid invariants'], errors };
let finished = false, measuring = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stats = values => { const s = [...values].sort((a, b) => a - b), n = s.length;
  return { n, mean: n ? values.reduce((a, b) => a + b, 0) / n : 0, p50: s[Math.ceil(n * .5) - 1] ?? 0,
    p95: s[Math.ceil(n * .95) - 1] ?? 0, max: s.at(-1) ?? 0 }; };
const close = ws => { if (ws) { expectedClose.add(ws); try { ws.close(1000); } catch {} } };
function send(ws, message) { if (ws?.readyState === WebSocket.OPEN) ws.send(encodeC2S(message)); }
function dial(bot, zone, observe = false, spawn, resumeToken) {
  const q = new URLSearchParams({ zone: zoneQuery(zone) });
  if (spawn) q.set('spawn', `${spawn.x},${spawn.y},${spawn.z},${spawn.yaw}`);
  if (observe) q.set('observe', '1');
  const [cx, cy] = zoneQuery(bot.homeZone).split(',').map(Number);
  const protocols = observe ? observerProtocols({ id: bot.id, token: bot.token, home: { cx, cy } }) : 'gtasf.v2';
  const ws = new WebSocket(`${target.wsOrigin}/api/world?${q}`, protocols);
  ws.binaryType = 'arraybuffer'; sockets.add(ws);
  ws.addEventListener('open', () => {
    if (!observe) send(ws, { type: 'HELLO', name: `Z${String(bot.index).padStart(4, '0')}`, ...(resumeToken ? { resumeToken } : {}) });
  });
  ws.addEventListener('message', event => {
    if (finished || expectedClose.has(ws)) return;
    const bytes = new Uint8Array(event.data), decoded = decodeS2C(bytes), now = performance.now();
    if (!decoded.ok) { bot.malformed++; errors.push(`Malformed ${bot.index}`); return; }
    if (measuring) { bot.bytes += bytes.length; bot.frames++; }
    const m = decoded.msg, isHome = !observe;
    if (isHome && m.type === 'WELCOME') {
      if (bot.id !== null && bot.id !== m.id) errors.push(`Identity changed ${bot.index}`);
      if (bot.pending === ws) { for (const observer of bot.observers.values()) close(observer); bot.observers.clear(); close(bot.home); bot.home = ws; bot.pending = undefined; bot.homeZone = zone; bot.handoffs++; }
      bot.id = m.id; bot.token = m.resumeToken; bot.pose = m.pose; bot.seq = m.lastMoveSeq; bot.ready = true;
      syncObservers(bot);
    }
    if (isHome && m.type === 'CORRECTION') { bot.pose = m.pose; bot.corrections++; }
    if (isHome && m.type === 'ZONE_HANDOFF' && !bot.pending) {
      bot.pending = dial(bot, zoneId(m.cx, m.cy), false, undefined, m.token);
    }
    if (m.type === 'PONG' && measuring) bot.rtt.push(now - m.clientT);
    if (m.type === 'SNAPSHOT' && measuring && isHome) {
      bot.snapshots++; if (bot.lastSnapAt) bot.gaps.push(now - bot.lastSnapAt); bot.lastSnapAt = now;
    }
    updateVisibility(bot.visible, m, now);
  });
  ws.addEventListener('close', event => {
    sockets.delete(ws);
    // A prepare/claim intentionally retires the source before destination WELCOME.
    if (!finished && !expectedClose.has(ws) && !(bot.pending && ws === bot.home && event.code === 4006))
      errors.push(`${observe ? 'Observer' : 'Home'} close ${bot.index} ${zone}: ${event.code}`);
  });
  ws.addEventListener('error', () => { if (!finished && !expectedClose.has(ws)) errors.push(`Socket error ${bot.index} ${zone}`); });
  return ws;
}
function syncObservers(bot) {
  if (!bot.ready) return;
  const view = zoneView(grid, bot.pose.x / 100, bot.pose.z / 100);
  const want = new Set([view.home, ...view.observers].map(c => zoneId(c.cx, c.cy)).filter(z => z !== bot.homeZone));
  for (const [zone, ws] of bot.observers) if (!want.has(zone)) { close(ws); bot.observers.delete(zone); }
  for (const zone of want) if (!bot.observers.has(zone)) bot.observers.set(zone, dial(bot, zone, true, bot.pose));
  for (const ws of bot.observers.values()) send(ws, { type: 'MOVE', seq: 0, ...bot.pose, flags: 0 });
}
try {
  console.log(`ZONED_STAGE: ${count} clients at ${target.wsOrigin}`);
  let nonce = 0;
  timers.push(setInterval(() => { for (const bot of bots) if (bot.ready && !bot.pending) {
    send(bot.home, { type: 'PING', nonce: ++nonce, clientT: performance.now() }); send(bot.home, { type: 'ACTIVITY' });
  } }, 1000));
  for (let start = 0; start < count; start += connectBatch) {
    for (const plan of plans.slice(start, start + connectBatch)) {
      const bot = { ...plan, pose: { ...plan.spawn }, seq: 0, id: null, token: null, ready: false, bytes: 0, frames: 0,
        snapshots: 0, rtt: [], gaps: [], lastSnapAt: 0, malformed: 0, corrections: 0, handoffs: 0,
        visible: new Map(), presence: [], missingSamples: 0, homeZone: plan.zone, observers: new Map() };
      bots.push(bot); bot.home = dial(bot, bot.homeZone, false, bot.pose);
    }
    await sleep(100);
  }
  const deadline = performance.now() + 60000;
  while (bots.some(b => !b.ready) && performance.now() < deadline) await sleep(100);
  assert(bots.every(b => b.ready), 'Every client must reach WELCOME');
  await sleep(2000);
  measuring = true; const start = performance.now(); let previous = start;
  timers.push(setInterval(() => {
    const now = performance.now(), elapsed = now - previous; previous = now;
    for (const bot of bots) {
      if (!bot.ready || bot.pending) continue;
      if (bot.crossTo) bot.pose = walkToward(bot.pose, bot.crossTo, elapsed);
      send(bot.home, { type: 'MOVE', ...bot.pose, flags: 0, seq: bot.seq = (bot.seq + 1) & 65535 });
      syncObservers(bot);
    }
  }, 100));
  const crossers = bots.filter(b => b.crossTo);
  timers.push(setInterval(() => {
    const now = performance.now();
    for (const crosser of crossers) {
      const watcher = bots[crosser.watcherIndex];
      const seen = crosser.id !== null && now - (watcher?.visible.get(crosser.id) ?? -Infinity) <= 1500;
      crosser.presence.push(seen);
      if (!seen) crosser.missingSamples++;
    }
  }, 100));
  await sleep(durationMs);
  measuring = false;
  const elapsed = (performance.now() - start) / 1000;
  const rtt = stats(bots.flatMap(b => b.rtt));
  const acceptance = { bots: count, welcomed: bots.filter(b => b.ready).length, expectedCrossers: crossers.length,
    completedHandoffs: crossers.reduce((n, b) => n + b.handoffs, 0), observedCrossers: crossers.filter(b => b.presence.some(Boolean)).length,
    glitches: crossers.reduce((n, b) => n + countRejoinGlitches(b.presence), 0),
    missingSamples: crossers.reduce((n, b) => n + b.missingSamples, 0), malformed: bots.reduce((n, b) => n + b.malformed, 0),
    errors: errors.length, rttSamples: rtt.n };
  const byZone = new Map();
  for (const bot of bots) { const list = byZone.get(bot.homeZone) ?? []; list.push(bot.bytes / elapsed); byZone.set(bot.homeZone, list); }
  report.results = { elapsedS: elapsed, acceptance, encodedBytesPerClientSecond: stats(bots.map(b => b.bytes / elapsed)),
    rttMs: rtt, snapshotIntervalMs: stats(bots.flatMap(b => b.gaps)), snapshotHz: stats(bots.map(b => b.snapshots / elapsed)),
    corrections: bots.reduce((n, b) => n + b.corrections, 0), bytesByZone: [...byZone].map(([zone, values]) => ({ zone, bytesPerSec: stats(values) })) };
  report.clientPassed = clientLoadPassed(acceptance);
  if (!report.clientPassed) process.exitCode = 1;
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally {
  finished = true; for (const timer of timers) clearInterval(timer);
  for (const ws of sockets) close(ws);
  await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ clientPassed: report.clientPassed, acceptancePending: report.acceptancePending, output: `${out}/report.json`, failure: report.failure }));
}
