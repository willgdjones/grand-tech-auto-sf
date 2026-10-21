/** Run real-input checks against a disposable, pinned production configuration. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--snapshot', '--out', '--mode', '--port'].includes(args[i]) && args[i + 1], 'Usage: --snapshot PATH [--out PATH] [--mode all|founder|boot|runtime] [--port 8897]');
  options[args[i].slice(2)] = args[i + 1];
}
assert.ok(options.snapshot, '--snapshot must be the isolated directory from npm run deploy -- --dry-run');
const snapshot = await realpath(options.snapshot);
assert.ok(snapshot !== root && !snapshot.startsWith(root + sep), 'Never mutate the shared checkout for acceptance');
const receipt = JSON.parse(await readFile(join(root, 'artifacts/production/last-deploy.json'), 'utf8'));
assert.equal(await realpath(receipt.snapshot), snapshot, 'Snapshot must match the recorded production build');
const out = resolve(options.out ?? 'artifacts/production/pre-playtest/local');
const mode = options.mode ?? 'all', port = Number(options.port ?? 8897);
assert.ok(['all', 'founder', 'boot', 'runtime'].includes(mode));
assert.ok(Number.isInteger(port) && port > 1024 && port < 65000);
await mkdir(out, { recursive: true });
const manifest = JSON.parse(await readFile(join(snapshot, 'worker/.wrangler/production/manifest.json'), 'utf8'));
const config = JSON.parse(await readFile(join(snapshot, 'worker/wrangler.production.jsonc'), 'utf8'));
assert.equal(config.vars.ENVIRONMENT, 'production');
assert.equal(config.vars.LAUNCH_MODE, 'open');
assert.equal(config.vars.WORLD_CAPACITY, '150');
// Production follows the published manifest's graph (gtasf-u4al); local acceptance has no publication,
// so the Worker keeps its embedded corridor. A pinned hash would make a missing graph fatal instead.
assert.ok([undefined, 'map/lombard/manifest.json'].includes(config.vars.WORLD_ROAD_GRAPH_KEY) && !config.vars.WORLD_ROAD_GRAPH_SHA256, 'Road graph follows the published manifest');
const persist = join(snapshot, '.acceptance-state');
const inviteFile = join(out, 'local-invite.txt');
const code = randomBytes(24).toString('base64url');
await writeFile(inviteFile, code + '\n', { mode: 0o600 });
// The archive initially receives development secrets for public build settings.
// A local acceptance Worker must receive only its own invite, never local-city bindings.
await writeFile(join(snapshot, 'worker/.dev.vars'), `INVITE_CODE=${code}\n`, { mode: 0o600 });
const env = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1', CI: 'true', WRANGLER_SEND_METRICS: 'false' };
const log = createWriteStream(join(out, 'runtime.log'));
const children = new Set();
function start(command, commandArgs, extra = {}) {
  const child = spawn(command, commandArgs, { cwd: snapshot, env: { ...env, ...extra }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.once('exit', () => children.delete(child));
  return child;
}
async function run(command, commandArgs, extra = {}) {
  const child = start(command, commandArgs, extra);
  await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', status => status === 0 ? done() : fail(new Error(`${commandArgs[0] ?? command} failed (${status}); see runtime.log`)));
  });
}
const wrangler = commandArgs => run(join(snapshot, 'node_modules/.bin/wrangler'), commandArgs);
const db = ['DB', '--local', '--persist-to', persist, '--config', 'worker/wrangler.production.jsonc'];
const report = { startedAt: new Date().toISOString(), commit: receipt.commit, snapshot, mode, mapRelease: null, flags: manifest.flags, passed: false };
// Harness fixes must not rebuild or mutate a candidate's application bytes.
// Record the independently executed check sources alongside its pinned SHA.
report.harness = {};
for (const path of ['tools/deploy/production/smoke.mjs', 'tools/founder-path-smoke.mjs'])
  report.harness[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
let server, stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  if (server) {
    server.httpServer.closeAllConnections();
    await new Promise(done => server.httpServer.close(done));
  }
  const running = [...children];
  for (const child of running) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  if (running.length) await delay(1000);
  for (const child of running) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  log.end();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().finally(() => process.exit(130)); });
try {
  const publication = JSON.parse(await readFile(join(root, 'tools/map/out/publication-lombard/publication.json'), 'utf8'));
  assert.equal(publication.area, 'lombard');
  const objects = new Map();
  for (const object of publication.objects) {
    const bytes = await readFile(object.file);
    assert.equal(bytes.length, object.bytes, `Published length ${object.key}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), object.sha256, `Published hash ${object.key}`);
    objects.set('/' + object.key, { ...object, bytes });
  }
  const index = objects.get('/map/lombard/manifest.json'); assert.ok(index);
  const map = JSON.parse(gunzipSync(index.bytes));
  report.mapRelease = publication.release;
  await wrangler(['d1', 'migrations', 'apply', ...db]);
  await run(join(snapshot, 'node_modules/.bin/tsx'), ['tools/events/export-seed.ts']);
  await wrangler(['d1', 'execute', ...db, '--file', 'artifacts/events-seed/sf-tech-week.sql']);
  const backend = start(join(snapshot, 'node_modules/.bin/wrangler'), ['dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(port + 1), '--persist-to', persist, '--config', 'worker/wrangler.production.jsonc', '--show-interactive-dev-session', 'false']);
  let health;
  for (let attempt = 0; attempt < 60; attempt++) {
    assert.equal(backend.exitCode, null, 'Acceptance Worker must remain alive');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { health = await response.json(); break; }
    } catch {}
    await delay(500);
  }
  assert.ok(health?.ok, 'Isolated production Worker is healthy');
  assert.deepEqual(health.flags, manifest.flags, 'Worker exposes the exact production flags');
  server = await preview({ configFile: false, root: join(snapshot, 'web'), build: { outDir: join(snapshot, 'web/dist-production') },
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: `http://127.0.0.1:${port}`, ws: true } } },
    plugins: [{ name: 'frozen-published-map', configurePreviewServer(previewServer) {
      previewServer.middlewares.use((request, response, next) => {
        const path = new URL(request.url, 'http://127.0.0.1').pathname;
        if (!path.startsWith('/map/')) return next();
        const alias = /^\/map\/lombard\/(roadgraph(?:-playable|-local-play)?\.json|local-play\.json|neighbourhoods\.json)$/.exec(path);
        if (alias) {
          const target = map.runtime?.[alias[1]]?.path ?? (alias[1] === 'roadgraph.json' ? map.roadGraph?.path : map.neighbourhoods?.path);
          if (target && objects.has(target)) { response.writeHead(302, { Location: target }); response.end(); return; }
        }
        const object = objects.get(path);
        if (!object) { response.writeHead(404); response.end('Published map object missing'); return; }
        response.writeHead(200, { 'Content-Type': object.contentType, 'Content-Encoding': object.contentEncoding,
          'Content-Length': object.bytes.length, 'Cache-Control': object.cacheControl });
        response.end(request.method === 'HEAD' ? undefined : object.bytes);
      });
    } }],
  });
  const base = server.resolvedUrls.local[0].replace(/\/$/, ''); report.base = base;
  const gate = await (await fetch(new URL('/api/admission', base))).json();
  assert.equal(gate.allowed, false);
  await writeFile(join(out, 'runtime.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`ACCEPTANCE_READY ${base} (${publication.release}, ${Object.values(manifest.flags).filter(Boolean).length} flags)`);
  const checkEnv = { GTASF_SMOKE_URL: base, GTASF_INVITE_FILE: inviteFile,
    GTASF_FOUNDER_OUT: join(out, 'founder'), GTASF_DEPLOY_SMOKE_OUT: join(out, 'boot') };
  if (mode === 'all' || mode === 'boot') await run(process.execPath, [join(root, 'tools/deploy/production/smoke.mjs')], checkEnv);
  if (mode === 'all' || mode === 'founder') await run(process.execPath, [join(root, 'tools/founder-path-smoke.mjs')], checkEnv);
  report.passed = true;
  console.log(`ACCEPTANCE_PASS ${mode}`);
} catch (error) {
  report.failure = String(error).replaceAll(code, '[REDACTED]');
  console.error(report.failure); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(out, 'runtime.json'), JSON.stringify(report, null, 2) + '\n');
  await stop();
}
