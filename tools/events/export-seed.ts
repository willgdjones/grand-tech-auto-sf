import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderEventSeed } from './seed';

// Intentionally no remote/local D1 flags, database names, credentials or network calls.
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--out-dir' || !args[1])) {
  throw new Error('Usage: npx tsx tools/events/export-seed.ts [--out-dir DIRECTORY]');
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = resolve(root, args[1] ?? 'artifacts/events-seed');
const source = await readFile(new URL('../../worker/src/events/data/sf-tech-week.json', import.meta.url), 'utf8');
const { sql, manifest } = renderEventSeed(source);
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'sf-tech-week.sql'), sql);
await writeFile(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ ...manifest, sqlFile: resolve(directory, 'sf-tech-week.sql'), manifestFile: resolve(directory, 'manifest.json') }, null, 2));
