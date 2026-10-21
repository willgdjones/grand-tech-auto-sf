import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { startPreview } from '../preview.mjs';

// One short HTTP/native smoke, no browser or full web build. Port 0 avoids the
// shared npm run dev and any pane's preview at 4173.
const preview = await startPreview({ port: 0 });
const pool = preview.pool;
try {
  const health = await fetch(`${preview.url}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).environment, 'local');
  const events = await (await pool.worker.dispatchFetch(new URL('/api/events', pool.url))).json();
  assert.equal(events.enabled, true);
  assert.equal(events.dataSource, 'd1');
  assert.equal(events.events.length, pool.eventCount);
  assert(events.events.length >= 300);
  // Exercise real admission instead of bypassing the live capacity gate.
  const admission = await fetch(`${preview.url}/api/admission/enter`, {
    method: 'POST', headers: { Origin: preview.url, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(admission.status, 200);
  let grant = await admission.json();
  const deadline = Date.now() + 10_000;
  while (grant.status === 'queued' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 200));
    grant = await fetch(`${preview.url}/api/admission/poll`, {
      method: 'POST', headers: { Origin: preview.url, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: grant.ticket }),
    }).then(response => response.json());
  }
  assert.equal(grant.status, 'admitted');
  assert(grant.grant);
  const upgrade = await pool.worker.dispatchFetch(new URL('/api/world', pool.url), {
    headers: { Origin: pool.url.origin, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `gtasf.v2,gtasf.admit.${grant.grant}` },
  });
  assert.equal(upgrade.status, 101);
  upgrade.webSocket.accept();
  upgrade.webSocket.close(1000, 'local pool smoke complete');
  const assets = await pool.worker.getR2Bucket('ASSETS');
  await assets.put('local-pool-smoke', 'ok');
  assert.equal(await (await assets.get('local-pool-smoke')).text(), 'ok');
  // The Vite preview must serve the selected source bake, not an empty R2 bucket.
  const map = await fetch(`${preview.url}/map/lombard/manifest.json`);
  assert.equal(map.status, 200);
  const manifest = await map.json();
  const arrival = manifest.chunks.find(chunk => chunk.id === '4_-5') ?? manifest.chunks[0];
  assert(arrival, 'Selected map has a streamed chunk');
  for (const asset of [manifest.roadGraph, arrival.lods[0], arrival.terrain, arrival.collision]) {
    const response = await fetch(new URL(asset.path, `${preview.url}/map/lombard/`), {
      method: 'HEAD', headers: { 'Accept-Encoding': 'identity' },
    });
    assert.equal(response.status, 200, asset.path);
    assert.equal(Number(response.headers.get('content-length')), asset.bytes, asset.path);
  }
  const bundleSha256 = createHash('sha256').update(await readFile(pool.bundlePath)).digest('hex');
  console.log(JSON.stringify({ health: true, events: events.events.length, dataSource: events.dataSource,
    admission: grant.status, websocket: upgrade.status, r2: true, mapArea: manifest.area, mapChunk: arrival.id,
    bundleSha256, migrations: pool.migrations.length, disposable: true }));
} finally { await preview.close(); }
await assert.rejects(access(pool.bundlePath), 'Owned temporary Worker bundle is removed on close');
