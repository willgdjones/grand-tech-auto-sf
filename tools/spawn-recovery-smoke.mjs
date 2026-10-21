/** Actual place resolver over local HTTP; controlled failures, no browser/world acceptance. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const out = resolve(process.env.GTASF_SPAWN_OUT ?? 'artifacts/spawn-recovery/current');
await mkdir(out, { recursive: true });
const source = await readFile(process.env.GTASF_SPAWN_SOURCE ?? 'web/src/spawn/locations.ts', 'utf8');
await build({ stdin: { contents: source, resolveDir: resolve('web/src/spawn'), loader: 'ts' }, bundle: true,
  platform: 'node', format: 'esm', target: 'node22', outfile: `${out}/fixture.mjs`, logLevel: 'silent' });
const { resolveSpawn, FERRY } = await import(pathToFileURL(`${out}/fixture.mjs`).href);
const calendar = JSON.parse(await readFile('worker/src/events/data/sf-tech-week.json', 'utf8'));
const event = calendar.events.find(value => value.lat > 37.7 && value.lat < 37.85 && value.lon > -122.55 && value.lon < -122.33);
assert.ok(event, 'Use an unchanged located event from the public snapshot');
const office = { slug: 'controlled-office', title: 'Controlled office transport fixture', lat: 37.79, lon: -122.4 };
const nativeFetch = globalThis.fetch;
let handle, receivedHeaders = [];
const server = createServer((request, response) => handle(request, response));
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
globalThis.fetch = async (url, options) => {
  const response = await nativeFetch(new URL(url, origin), options);
  receivedHeaders.push({ url: String(url), status: response.status }); return response;
};
const json = (response, value, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' });
  response.end(JSON.stringify(value));
};
const report = { at: new Date().toISOString(), scope: 'Actual resolveSpawn over controlled local HTTP; unchanged public event, explicit office fixture',
  sourceHash: createHash('sha256').update(source).digest('hex'), eventId: event.id, cases: [], passed: false };
async function run(name, scenario) {
  receivedHeaders = [];
  try { report.cases.push({ name, passed: true, ...await scenario(), receivedHeaders }); }
  catch (error) { report.cases.push({ name, passed: false, error: String(error) }); }
}
try {
  for (const failure of ['none', '503', 'body-disconnect']) await run(`event-${failure}`, async () => {
    const calls = [];
    handle = (request, response) => {
      calls.push(request.url);
      if (request.url !== '/api/events') return json(response, {}, 404);
      if (calls.length === 1 && failure === '503') return json(response, { error: 'Controlled outage' }, 503);
      if (calls.length === 1 && failure === 'body-disconnect') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000', Connection: 'close' });
        response.write('{"events":[', () => setTimeout(() => response.destroy(), 20)); return;
      }
      json(response, { events: [event] });
    };
    const result = await resolveSpawn(new URL(`/go/${encodeURIComponent(event.id)}`, origin));
    assert.equal(result.place.eventId, event.id); assert.equal(result.place.title, event.title);
    assert.deepEqual(calls, Array(failure === 'none' ? 1 : 2).fill('/api/events'));
    if (failure === 'body-disconnect') assert.deepEqual(receivedHeaders, Array.from({ length: 2 }, () => ({ url: '/api/events', status: 200 })));
    return { calls, result };
  });
  await run('office-recovery', async () => {
    const calls = []; let officeCalls = 0;
    handle = (request, response) => {
      calls.push(request.url);
      if (request.url === '/api/events') return json(response, { events: [] });
      json(response, ++officeCalls === 1 ? {} : office, officeCalls === 1 ? 503 : 200);
    };
    assert.deepEqual(await resolveSpawn(new URL(`/go/${office.slug}`, origin)), { explicit: true, place: office });
    assert.deepEqual(calls, ['/api/events', ...Array(2).fill(`/api/gtm/spawns/${office.slug}`)]);
    return { calls };
  });
  for (const failure of ['permanent', 'malformed', 'missing']) await run(`final-error-${failure}`, async () => {
    const calls = [];
    handle = (request, response) => {
      calls.push(request.url);
      if (request.url !== '/api/events') return json(response, {}, 404);
      if (failure === 'permanent') return json(response, {}, 403);
      if (failure === 'malformed') { response.writeHead(200, { Connection: 'close' }); response.end('{'); return; }
      json(response, { events: [] });
    };
    await assert.rejects(resolveSpawn(new URL('/go/unknown-event', origin)), failure === 'missing' ? /Unknown place/ : /temporarily unavailable/);
    assert.deepEqual(calls, ['/api/events', '/api/gtm/spawns/unknown-event']);
    return { calls };
  });
  await run('landmark-and-coordinate-bypass', async () => {
    const calls = []; handle = (request, response) => { calls.push(request.url); json(response, {}, 503); };
    assert.deepEqual(await resolveSpawn(new URL('/go/ferry-building', origin)), { explicit: true, place: FERRY });
    const result = await resolveSpawn(new URL('/?at=37.79,-122.4,90', origin));
    assert.equal(result.place.heading, 90); assert.deepEqual(calls, []);
    return { calls };
  });
  await run('stalled-retry-body-falls-back-at-original-deadline', async () => {
    const calls = []; let calendarCalls = 0, stalledClosed = false;
    handle = (request, response) => {
      calls.push(request.url);
      if (request.url !== '/api/events') return json(response, office);
      if (++calendarCalls === 1) return json(response, {}, 503);
      response.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }); response.write('{"events":[');
      response.on('close', () => { stalledClosed = true; });
    };
    const started = performance.now();
    assert.deepEqual(await resolveSpawn(new URL(`/go/${office.slug}`, origin)), { explicit: true, place: office });
    const elapsedMs = performance.now() - started;
    await new Promise(done => setImmediate(done));
    assert.deepEqual(calls, ['/api/events', '/api/events', `/api/gtm/spawns/${office.slug}`]);
    assert(stalledClosed, 'The timed-out HTTP body is aborted');
    assert(elapsedMs >= 3900 && elapsedMs < 4500, `Original deadline retained: ${elapsedMs}ms`);
    return { calls, elapsedMs, stalledClosed };
  });
  report.passed = report.cases.every(value => value.passed);
} finally {
  globalThis.fetch = nativeFetch; server.closeAllConnections(); await new Promise(done => server.close(done));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(`SPAWN_RECOVERY:${report.passed ? 'PASS' : 'FAIL'}:${report.cases.filter(value => value.passed).length}/${report.cases.length}`);
assert(report.passed, report.cases.filter(value => !value.passed).map(value => `${value.name}: ${value.error}`).join('\n'));
