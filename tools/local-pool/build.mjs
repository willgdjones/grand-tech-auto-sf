import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Call previews/checks through tools/heavy.sh. Each pool owns its fresh bundle
 * directory so another preview cannot overwrite a running Worker's modules. */
export async function buildLocalWorker() {
  const parent = join(root, 'worker/.wrangler');
  await mkdir(parent, { recursive: true });
  const outdir = await mkdtemp(join(parent, 'preview-worker-'));
  const dispose = () => rm(outdir, { recursive: true, force: true });
  const build = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'),
    'deploy', '--dry-run', '--config', join(root, 'worker/wrangler.toml'), '--outdir', outdir],
  { cwd: root, encoding: 'utf8', maxBuffer: 8_000_000, env: { ...process.env, CI: '1' } });
  if (build.error || build.status !== 0) {
    await dispose();
    process.stderr.write((build.stderr || build.stdout || '').slice(-6000));
    throw build.error ?? new Error('Local Worker bundle failed; use the Node version in .nvmrc');
  }
  return { path: join(outdir, 'index.js'), dispose };
}
