import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'gtasf-events-'));
function wrangler(args) {
  const result = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', ...args,
    '--local', '--config', join(root, 'worker/wrangler.toml')], { cwd: root, encoding: 'utf8', maxBuffer: 8_000_000, env: { ...process.env, CI: '1' } });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write((result.stderr || result.stdout || '').slice(-6000));
    throw new Error('Local event seed failed');
  }
}
try {
  const exportSeed = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'tools/events/export-seed.ts'), '--out-dir', dir], {
    cwd: root, encoding: 'utf8', maxBuffer: 100_000,
  });
  if (exportSeed.error || exportSeed.status !== 0) throw new Error(exportSeed.stderr || 'Local event export failed');
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const path = join(dir, 'sf-tech-week.sql');
  wrangler(['migrations', 'apply', 'gtasf-local']);
  wrangler(['execute', 'gtasf-local', '--file', path]);
  console.log(`Seeded ${manifest.rows} real Tech Week events (${manifest.capturedAt}). Locations are approximate public neighborhoods.`);
} finally { await rm(dir, { recursive: true, force: true }); }
