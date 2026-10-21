import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildLocalWorker } from './build.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Disposable real workerd/SQLite bindings for one-shot integration previews, never remote state. */
export async function startLocalPool({ bundlePath, seedEvents = true, worldRoadGraphPath, extraBindings = {} } = {}) {
  // A native city journey may supply the exact ordinary roadpack served to its
  // browser. Exercise normal immutable R2 loading; never rewrite graph flags.
  const graphBytes = worldRoadGraphPath ? await readFile(worldRoadGraphPath) : null;
  const graphHash = graphBytes ? createHash('sha256').update(graphBytes).digest('hex') : null;
  const graphKey = graphHash ? `map/releases/${graphHash}/roadgraph.bin` : null;
  const bundle = bundlePath ? { path: bundlePath, dispose: async () => {} } : await buildLocalWorker();
  let worker;
  try {
    worker = new Miniflare(convertV4MiniflareOptions({
      host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false }, workers: [{
        name: 'gtasf-preview', modules: true, scriptPath: bundle.path,
        compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
        // extraBindings: local secrets for one-shot checks (e.g. ELEVENLABS_API_KEY from worker/.dev.vars); never logged.
        bindings: { ...extraBindings, ENVIRONMENT: 'local', LAUNCH_MODE: 'open', WORLD_CAPACITY: '150',
          ...(graphKey ? { WORLD_ROAD_GRAPH_KEY: graphKey, WORLD_ROAD_GRAPH_SHA256: graphHash } : {}) },
        durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true }, LEDGER: { className: 'LedgerDO', useSQLite: true },
          LOBBY: { className: 'LobbyDO', useSQLite: true } },
        d1Databases: ['DB'], r2Buckets: ['ASSETS'], queueProducers: { JOBS: 'gtasf-jobs-local' },
      }],
    }));
    const url = await worker.ready;
    if (graphKey) await (await worker.getR2Bucket('ASSETS')).put(graphKey, graphBytes);
    const db = await worker.getD1Database('DB');
    const migrations = (await readdir(join(root, 'worker/migrations'))).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    for (const name of migrations) {
      const sql = await readFile(join(root, 'worker/migrations', name), 'utf8');
      // Current migrations are plain DDL. Strip line comments BEFORE splitting on ';' so a ';' inside
      // a comment (several migrations have them, e.g. "keyed by id; pitch_count ...") can neither split
      // a real statement nor leave a comment-only fragment (D1: "SQL code did not contain a statement").
      const ddl = sql.replace(/--[^\n]*/g, '');
      for (const statement of ddl.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    let eventCount = 0;
    if (seedEvents) {
      const snapshot = JSON.parse(await readFile(join(root, 'worker/src/events/data/sf-tech-week.json'), 'utf8'));
      const sql = `INSERT INTO events(id,title,host,starts_at,ends_at,venue,address,url,lat,lon,approximate,source,tags_json,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      for (let i = 0; i < snapshot.events.length; i += 50) {
        await db.batch(snapshot.events.slice(i, i + 50).map(e => db.prepare(sql).bind(
          e.id,e.title,e.host,e.start,e.end,e.venue,e.address,e.url,e.lat,e.lon,Number(e.approx),e.source,JSON.stringify(e.tags),snapshot.capturedAt,
        )));
      }
      eventCount = snapshot.events.length;
    }
    return { worker, url, migrations, eventCount, bundlePath: bundle.path, worldRoadGraphHash: graphHash,
      async close() { try { await worker.dispose(); } finally { await bundle.dispose(); } } };
  } catch (error) {
    try { await worker?.dispose(); } finally { await bundle.dispose(); }
    throw error;
  }
}
