/** Isolated, offline district bake. Run through tools/heavy.sh; never activates or uploads. */
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { settings } from './src/pipeline/settings';
import { acquireInputs, atomicWrite, digest } from './src/pipeline/sources';
import { buildMap, validateMap } from './src/pipeline/build';
import { attachNeighbourhoods, writeNeighbourhoods } from './src/pipeline/neighbourhoods';
import { packMapRuntime } from './src/pipeline/runtime';

const root = resolve('tools/map/out/district-tm7m');
const reportPath = join(root, 'district-rollout.json');
const validateOnly = process.argv.includes('--validate');
if (process.argv.slice(2).some(arg => arg !== '--validate')) throw new Error('Use no arguments to bake, or --validate for an existing candidate');
const sourcePaths = execFileSync('git', ['ls-files', 'tools/map/src', 'shared/roadgraphPacked.ts', 'shared/coastline.ts'], { encoding: 'utf8' }).trim().split('\n');
async function sourceFingerprint() {
  const files = await Promise.all(sourcePaths.map(async path => ({ path, sha256: digest(await readFile(path)) })));
  return { sha256: digest(JSON.stringify(files)), files };
}
const source = await sourceFingerprint();
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const startedAt = new Date().toISOString();

if (!validateOnly) {
  const existing = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return [];
  });
  if (existing.length) throw new Error(`Candidate directory is not empty: ${root}. Inspect it before a new bake; use --validate for completed outputs.`);
  await atomicWrite(join(root, 'build-start.json'), JSON.stringify({ startedAt, sourceCommit, source }, null, 2) + '\n');
  const s = { ...settings('sf'), out: root };
  const input = await acquireInputs(s, false, false, resolve('tools/map/out/SanFrancisco.osm.pbf'));
  const neighbourhoods = await writeNeighbourhoods(s, false, false);
  await buildMap(s, input);
  await attachNeighbourhoods(s, neighbourhoods);
  await packMapRuntime(root);
  if ((await sourceFingerprint()).sha256 !== source.sha256) throw new Error('Map source changed during the bake; retain candidate for inspection but do not activate');
}

const validation = await validateMap(root);
const inventory = JSON.parse(await readFile(join(root, 'runtime-inventory.json'), 'utf8')) as {
  files: { path: string; bytes: number; gzipBytes: number; sha256: string }[];
  rawBytes: number; gzipBytes: number; maximumFileBytes: number;
};
const start = JSON.parse(await readFile(join(root, 'build-start.json'), 'utf8')) as { startedAt: string; sourceCommit: string; source: { sha256: string } };
if (source.sha256 !== start.source.sha256) throw new Error('Candidate source fingerprint differs from current source; rebuild before activation');
const manifestSha256 = digest(await readFile(join(root, 'manifest.json')));
const report = {
  sourceCommit: start.sourceCommit, sourceFingerprint: start.source.sha256,
  startedAt: start.startedAt, completedAt: new Date().toISOString(), candidate: root,
  manifestSha256, validation,
  inventory: { files: inventory.files.length, rawBytes: inventory.rawBytes, gzipBytes: inventory.gzipBytes, maximumFileBytes: inventory.maximumFileBytes },
  budgets: {
    wholeCityCompressed25MB: inventory.gzipBytes <= 25_000_000,
    mapAloneBelowProduction80MB: inventory.gzipBytes <= 80_000_000,
    individualFile25MB: inventory.maximumFileBytes <= 25_000_000,
    productionTotal: 'pending combined map + web/art inventory',
    coldReady15MB: 'pending actual browser transfer trace',
  },
  activated: false, uploaded: false, desktopPhoneLook: 'pending',
};
await atomicWrite(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
