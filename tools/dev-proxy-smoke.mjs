/** Actual dev WebSocket plus configurable HTTP cadence; no browser, fake timer or game-state override. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const base = process.env.GTASF_PROXY_URL ?? 'http://127.0.0.1:5173';
assert.equal(new URL(base).hostname, '127.0.0.1', 'This diagnostic only targets local development');
const duration = Number(process.env.GTASF_PROXY_SECONDS ?? 70) * 1000;
const interval = Number(process.env.GTASF_PROXY_INTERVAL ?? 6000);
assert.ok(duration >= 60_000 && duration <= 180_000);
assert.ok(interval >= 4000 && interval <= 20_000);
const out = resolve(process.env.GTASF_PROXY_OUT ?? `artifacts/dev-proxy/${Date.now()}`);
await mkdir(out, { recursive: true });
const compiled = await build({ stdin: { contents: `export {encodeC2S} from './shared/protocol/c2s.ts'; export {decodeS2C} from './shared/protocol/s2c.ts';`,
  resolveDir: resolve('.'), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const { encodeC2S, decodeS2C } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const report = { startedAt: new Date().toISOString(), base, durationMs: duration, intervalMs: interval, http: [], frames: 0, pongs: 0, closes: [], errors: [], passed: false };
let socket, timer, pulse, stopped = false, cookie, welcomed = false, sequence = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(path, data) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(8000), headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}),
    ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }) });
  const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
  const body = await response.json(); assert.equal(response.status, 200, `${path}: HTTP ${response.status}`); return body;
}
try {
  await request('/api/funding/profile');
  const grant = await request('/api/admission/enter', {}); assert.equal(grant.status, 'admitted');
  socket = new WebSocket(`${base.replace('http:', 'ws:')}/api/world`, ['gtasf.v2', `gtasf.admit.${grant.grant}`]);
  socket.binaryType = 'arraybuffer';
  socket.addEventListener('open', () => socket.send(encodeC2S({ type: 'HELLO', name: 'Proxy diagnostic' })));
  socket.addEventListener('message', event => {
    report.frames++; const decoded = decodeS2C(new Uint8Array(event.data));
    if (!decoded.ok) report.errors.push('Invalid native protocol frame');
    else if (decoded.msg.type === 'WELCOME') welcomed = true;
    else if (decoded.msg.type === 'PONG') report.pongs++;
  });
  socket.addEventListener('close', event => { if (!stopped) report.closes.push({ code: event.code, at: new Date().toISOString() }); });
  socket.addEventListener('error', () => { if (!stopped) report.errors.push('Native WebSocket error'); });
  const readyDeadline = Date.now() + 15_000;
  while (!welcomed && Date.now() < readyDeadline) await sleep(50);
  assert.ok(welcomed, 'Native server welcomes the diagnostic peer');
  pulse = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(encodeC2S({ type: 'PING', nonce: ++sequence, clientT: performance.now() })); }, 1000);
  let polling = false;
  async function poll() {
    if (polling || stopped) return; polling = true; const start = Date.now();
    try { await request('/api/funding/parties'); report.http.push({ at: new Date(start).toISOString(), ok: true, ms: Date.now() - start }); }
    catch (error) { report.http.push({ at: new Date(start).toISOString(), ok: false, error: error.message }); }
    finally { polling = false; }
  }
  await poll(); timer = setInterval(poll, interval);
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) {
    await sleep(250);
    assert.deepEqual(report.closes, [], 'HTTP polling must not drop the native WebSocket');
    assert.deepEqual(report.errors, []);
    assert.ok(report.http.every(result => result.ok), 'Every actual party read succeeds');
  }
  clearInterval(timer); while (polling) await sleep(25);
  assert.ok(report.http.length >= Math.floor(duration / interval) && report.pongs >= 50);
  report.passed = true; console.log('TEST_PASSED:DevProxyCadence');
} catch (error) { report.failure = String(error); console.error(report.failure); process.exitCode = 1; }
finally {
  stopped = true; clearInterval(timer); clearInterval(pulse); socket?.close(1000);
  report.finishedAt = new Date().toISOString(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`DEV_PROXY_REPORT:${out}/report.json`);
}
