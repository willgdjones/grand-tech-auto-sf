/** One bounded public HTTP smoke of the reviewed, immutable map publication. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { gunzipSync } from 'node:zlib';

const base = new URL(process.argv[2] ?? 'https://gtasf.com');
assert.equal(base.protocol, 'https:', 'Public map verification requires HTTPS');
const directory = new URL('./out/publication-lombard/', import.meta.url);
const publication = JSON.parse(await readFile(new URL('publication.json', directory), 'utf8'));
const expected = await readFile(new URL(`${publication.release}/manifest.json`, directory));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { at: new Date().toISOString(), origin: base.origin, release: publication.release, checks: [] };

async function get(path, { method = 'GET', headers = {} } = {}) {
  const url = new URL(path, base);
  assert.equal(url.origin, base.origin, 'Map paths must stay on the reviewed origin');
  const result = await new Promise((resolve, reject) => {
    const req = request(url, { method, rejectUnauthorized: true, headers: { 'accept-encoding': 'gzip', ...headers } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 25_000_000) { res.destroy(new Error('Public map response exceeds file budget')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks) }));
    });
    req.setTimeout(20_000, () => req.destroy(new Error(`Map request timed out: ${url.pathname}`)));
    req.on('error', reject); req.end();
  });
  const body = result.raw.length && result.headers['content-encoding'] === 'gzip' ? gunzipSync(result.raw) : result.raw;
  report.checks.push({ path: url.pathname, method, status: result.status, bodyTransferBytes: result.raw.length,
    decodedBytes: body.length, encoding: result.headers['content-encoding'] ?? 'identity',
    contentType: result.headers['content-type'], cacheControl: result.headers['cache-control'], etag: result.headers.etag });
  return { ...result, body };
}

try {
  const stable = await get('/map/lombard/manifest.json');
  assert.equal(stable.status, 200); assert.match(stable.headers['content-type'] ?? '', /application\/json/);
  assert.equal(sha(stable.body), sha(expected), 'Stable manifest must be the exact reviewed release');
  assert.match(stable.headers['cache-control'] ?? '', /max-age=0/);
  const manifest = JSON.parse(stable.body.toString());
  assert.equal(manifest.release, publication.release);
  const identity = await get('/map/lombard/manifest.json', { headers: { 'accept-encoding': 'identity' } });
  assert.equal(identity.status, 200); assert.equal(identity.headers['content-encoding'], undefined);
  assert.equal(sha(identity.body), sha(expected));

  async function artifact(reference, mime) {
    const response = await get(reference.path);
    assert.equal(response.status, 200, reference.path);
    assert.match(response.headers['content-type'] ?? '', mime);
    assert.equal(response.headers['content-encoding'], 'gzip', reference.path);
    assert.equal(response.body.length, reference.bytes);
    assert.equal(sha(response.body), reference.sha256, reference.path);
    assert.match(response.headers['cache-control'] ?? '', /immutable/);
    return response;
  }
  for (const name of ['roadgraph-playable.json', 'roadgraph-local-play.json', 'local-play.json', 'neighbourhoods.json']) {
    const reference = manifest.runtime?.[name] ?? (name === 'neighbourhoods.json' ? manifest.neighbourhoods : undefined);
    assert(reference, `Published reference is missing: ${name}`);
    const alias = await get(`/map/lombard/${name}`);
    assert.equal(alias.status, 302); assert.equal(alias.headers.location, reference.path);
    JSON.parse((await artifact(reference, /application\/json/)).body.toString());
  }
  for (const id of ['4_-5', '-5_-8']) {
    const chunk = manifest.chunks.find(item => item.id === id); assert(chunk, `Missing ${id}`);
    const glb = await artifact(chunk.lods[0], /model\/gltf-binary/);
    assert.equal(glb.body.toString('ascii', 0, 4), 'glTF');
    assert.equal(glb.body.readUInt32LE(4), 2); assert.equal(glb.body.readUInt32LE(8), glb.body.length);
    const terrain = await artifact(chunk.terrain, /application\/octet-stream/);
    assert.equal(terrain.body.toString('ascii', 0, 4), 'GTHF'); assert.equal(terrain.body.readUInt16LE(4), 1);
    const width = terrain.body.readUInt16LE(6); assert.equal(terrain.body.length, 32 + width * width * 2);
    const head = await get(chunk.lods[0].path, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(head.raw.length, 0); assert.equal(head.headers.etag, glb.headers.etag);
    const cached = await get(chunk.lods[0].path, { headers: { 'if-none-match': glb.headers.etag } });
    assert.equal(cached.status, 304); assert.equal(cached.raw.length, 0);
  }
  report.passed = true;
  console.log(JSON.stringify({ passed: true, origin: base.origin, release: publication.release, checks: report.checks.length }));
} catch (error) {
  report.failure = String(error); throw error;
} finally {
  await writeFile(new URL(`remote-${base.hostname}.json`, directory), JSON.stringify(report, null, 2) + '\n');
}
