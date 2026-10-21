/** Phone-perf crowd: N real protocol clients around the Ferry spawn on a disposable local pool (never production).
 * Used by tools/phone-perf.mjs when GTASF_PHONE_BOTS=N, so the gate can also be read with a launch-day crowd. */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function startCrowdBots(pool, count) {
  const out = resolve('artifacts/phone-d6/crowd-codecs'); await mkdir(out, { recursive: true });
  const file = `${out}/codecs.mjs`;
  await build({ stdin: { contents: `export {encodeC2S} from './shared/protocol/c2s.ts'; export {decodeS2C} from './shared/protocol/s2c.ts';
export {LOCAL_SPAWN} from './worker/src/world/localSpawn.ts';`, resolveDir: resolve('.'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: file, logLevel: 'error' });
  const { encodeC2S, decodeS2C, LOCAL_SPAWN } = await import(pathToFileURL(file).href);
  const base = pool.url, origin = base.origin, worker = pool.worker, bots = [], errors = [];
  let stopped = false;
  async function api(path, body) {
    const response = await worker.dispatchFetch(new URL(path, base), { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.status !== 200) throw new Error(`${path} HTTP ${response.status}`); return response.json();
  }
  async function connect(index) {
    let grant = await api('/api/admission/enter', {});
    for (let i = 0; grant.status === 'queued' && i < 300; i++) { await sleep(100); grant = await api('/api/admission/poll', { ticket: grant.ticket }); }
    if (grant.status !== 'admitted') throw new Error(`bot ${index} not admitted`);
    // Ring of 10-60 m (wire cm) around the plaza so some are near (rigged) and most are far (silhouettes on Low).
    const angle = index * 2.399, radius = 1000 + (index * 977) % 5000;
    const pose = { x: Math.round(LOCAL_SPAWN.x + Math.cos(angle) * radius), y: LOCAL_SPAWN.y, z: Math.round(LOCAL_SPAWN.z + Math.sin(angle) * radius), yaw: (index * 37) & 255 };
    const response = await worker.dispatchFetch(new URL(`/api/world?spawn=${pose.x},${pose.y},${pose.z},${pose.yaw}`, base),
      { headers: { Origin: origin, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `gtasf.v2,gtasf.admit.${grant.grant}` } });
    if (response.status !== 101) throw new Error(`bot ${index} upgrade HTTP ${response.status}`);
    const socket = response.webSocket; socket.binaryType = 'arraybuffer'; socket.accept();
    const bot = { index, socket, pose, origin: { ...pose }, seq: 0, welcome: null };
    bot.send = message => { try { socket.send(encodeC2S(message)); } catch (error) { if (!stopped) errors.push(String(error)); } };
    socket.addEventListener('message', event => {
      const decoded = decodeS2C(new Uint8Array(event.data)); if (!decoded.ok) return;
      if (decoded.msg.type === 'WELCOME') { bot.welcome = decoded.msg; bot.pose = decoded.msg.pose; bot.origin = { ...decoded.msg.pose }; }
      if (decoded.msg.type === 'CORRECTION') bot.pose = decoded.msg.pose;
    });
    bot.send({ type: 'HELLO', name: `Crowd ${String(index + 1).padStart(2, '0')}` });
    for (let i = 0; !bot.welcome && i < 100; i++) await sleep(100);
    bots.push(bot);
  }
  for (let i = 0; i < count; i += 8) await Promise.all(Array.from({ length: Math.min(8, count - i) }, (_, j) => connect(i + j).catch(e => errors.push(e.message))));
  let tick = 0;
  const move = setInterval(() => {
    const t = performance.now() / 1000;
    for (const bot of bots) {
      // Stroll a few metres back and forth around each bot's own spawn (walk flag set).
      const pose = { ...bot.pose, x: bot.origin.x + Math.round(Math.sin(t * .5 + bot.index) * 400), z: bot.origin.z + Math.round(Math.cos(t * .4 + bot.index) * 300) };
      bot.send({ type: 'MOVE', ...pose, flags: 1, seq: ++bot.seq & 0xffff }); bot.pose = pose;
    }
    if (++tick % 10 === 0) for (const bot of bots) bot.send({ type: 'ACTIVITY' });
  }, 100);
  return { connected: bots.length, errors, async stop() { stopped = true; clearInterval(move); for (const bot of bots) try { bot.socket.close(1000, 'done'); } catch { /* closed */ } } };
}
