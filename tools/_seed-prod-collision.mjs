// Lane B dev tool: seed a LOCAL combat stack's R2 (tools/combat-stack.sh snapshot) with a slice of the PUBLISHED prod
// map so server-side combat collision (police LoS, off-road steps, PvP hit LoS) can be exercised locally exactly as in
// prod: the prod road pack + a manifest with prod's absolute '/map/releases/<sha>/chunks/x_z/collision.json' paths
// for the chunks around the Ferry/Embarcadero test spots + those JSON chunk files. Read-only against prod (public map
// assets); writes only the snapshot's local R2 (wrangler --local). Run AFTER `combat-stack.sh up`, BEFORE any player
// connects (the WorldDO reads the manifest on first use):
//   node tools/_seed-prod-collision.mjs [/tmp/gtasf-combat-gates]
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SNAP = process.argv[2] ?? '/tmp/gtasf-combat-gates';
const PROD = 'https://gtasf.com';
const CENTRE = { x: 4, z: -6 }, RADIUS = 2; // chunks around the Ferry plaza + Embarcadero stores (5x5)
const WRANGLER = join(process.cwd(), 'node_modules/wrangler/bin/wrangler.js');

const tmp = await mkdtemp(join(tmpdir(), 'gtasf-seed-'));
async function download(path, name) {
  const res = await fetch(PROD + path); if (!res.ok) throw new Error(`${res.status} ${path}`);
  const file = join(tmp, name); await writeFile(file, Buffer.from(await res.arrayBuffer())); return file;
}
function put(key, file) {
  const r = spawnSync(process.execPath, [WRANGLER, 'r2', 'object', 'put', `gtasf-assets-local/${key}`, '--file', file, '--local', '--config', 'wrangler.toml'],
    { cwd: join(SNAP, 'worker'), encoding: 'utf8', maxBuffer: 4_000_000, env: { ...process.env, CI: '1' } });
  if (r.status !== 0) throw new Error(`put ${key}: ${(r.stderr || r.stdout).slice(-400)}`);
}

const manifest = await (await fetch(`${PROD}/map/lombard/manifest.json`)).json();
const graph = manifest.roadGraph;
const chunks = manifest.chunks.filter(c => Math.abs(c.x - CENTRE.x) <= RADIUS && Math.abs(c.z - CENTRE.z) <= RADIUS);
put(graph.path.replace(/^\//, ''), await download(graph.path, 'roadgraph.bin'));
for (const c of chunks) put(c.collision.path.replace(/^\//, ''), await download(c.collision.path, `${c.id}.collision.json`));
const slim = { ...(manifest.requiredFeatures ? { requiredFeatures: manifest.requiredFeatures } : {}), version: manifest.version, chunkSize: manifest.chunkSize, roadGraph: graph,
  chunks: chunks.map(c => ({ id: c.id, x: c.x, z: c.z, collision: c.collision })) };
const manifestFile = join(tmp, 'manifest.json'); await writeFile(manifestFile, JSON.stringify(slim));
put('map/lombard/manifest.json', manifestFile);
console.log(`seeded ${chunks.length} prod collision chunks + road pack into ${SNAP} local R2`);
