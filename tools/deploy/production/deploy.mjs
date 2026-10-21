import { mkdtemp, mkdir, readdir, symlink, copyFile, chmod, readFile, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cloudflare, ACCOUNT } from './api.mjs';
import { waitForReleaseChunks } from './releaseGate.mjs';
import { runPreview } from '../preview.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
// Preview is a separate, fail-closed path. Never fall through to production preparation.
if (args.includes('--preview')) {
  await runPreview(args, root);
} else {
const supported = new Set(['--dry-run', '--skip-map', '--skip-seed', '--commit']);
let revision = 'HEAD';
for (let i = 0; i < args.length; i++) {
  if (!supported.has(args[i])) throw new Error(`Unknown deploy option: ${args[i]}`);
  if (args[i] === '--commit') { revision = args[++i]; if (!revision || revision.startsWith('-')) throw new Error('--commit requires a revision'); }
}
const commit = execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
const snapshot = await mkdtemp(join(tmpdir(), 'gtasf-production-'));
// Each snapshot is ~3 GB (source + build outputs); 82 retained runs once filled 146 GB of disk. Remove it however the
// deploy ends (success, thrown failure, Ctrl-C/kill). A successful --dry-run keeps its snapshot for local-acceptance.mjs
// (recorded in last-deploy.json) and drops the previously recorded one, so at most one is ever retained.
// GTASF_KEEP_SNAPSHOT=1 keeps a failed run's snapshot to debug.
let deployed = false, keep = false;
process.once('exit', () => {
  if (keep) return;
  if (!deployed && process.env.GTASF_KEEP_SNAPSHOT === '1') { console.error(`Snapshot retained at ${snapshot}`); return; }
  try { rmSync(snapshot, { recursive: true, force: true }); } catch (error) { console.error(`Could not remove ${snapshot}: ${error}`); }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => process.exit(130));
const environment = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '1', CLOUDFLARE_ACCOUNT_ID: 'YOUR_CLOUDFLARE_ACCOUNT_ID', CI: 'true' };
async function run(command, commandArgs, cwd = snapshot) {
  await new Promise((done, fail) => {
    const child = spawn(command, commandArgs, { cwd, env: environment, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', fail);
    child.once('exit', code => code === 0 ? done() : fail(new Error(`${commandArgs[0] ?? command} failed (${code}) in ${snapshot}`)));
  });
}
console.log(`Production source: ${commit}\nIsolated build: ${snapshot}`);
execFileSync('git', ['archive', '--format=tar', `--output=${join(snapshot, 'source.tar')}`, commit], { cwd: root });
await run('tar', ['-xf', 'source.tar']);
await mkdir(join(snapshot, 'node_modules/@gtasf'), { recursive: true });
// Do not link the whole node_modules directory: workspace links must resolve to
// the pinned snapshot rather than the concurrently edited shared checkout.
for (const entry of await readdir(join(root, 'node_modules'))) {
  if (entry === '@gtasf') continue;
  await symlink(join(root, 'node_modules', entry), join(snapshot, 'node_modules', entry));
}
for (const workspace of ['shared', 'web', 'worker', 'tools']) {
  const metadata = JSON.parse(await readFile(join(snapshot, workspace, 'package.json'), 'utf8'));
  await symlink(join(snapshot, workspace), join(snapshot, 'node_modules', metadata.name));
}
// Nested installs (e.g. tools/map has its own node_modules with pngjs) must resolve in the snapshot too,
// or the pre-deploy test gate fails to load their suites.
for (const nested of ['web', 'worker', 'tools', 'tools/map', 'shared']) {
  const source = join(root, nested, 'node_modules');
  const target = join(snapshot, nested, 'node_modules');
  try { await readdir(source); } catch { continue; }
  try { await readdir(target); continue; } catch { /* absent in the archive: link it */ }
  await symlink(source, target);
}
await copyFile(join(root, 'worker/.dev.vars'), join(snapshot, 'worker/.dev.vars'));
await chmod(join(snapshot, 'worker/.dev.vars'), 0o600);
const bin = name => join(snapshot, 'node_modules/.bin', name);
const wrangler = commandArgs => run(bin('wrangler'), commandArgs);
// Transient Cloudflare API blips (D1 7403 "account not authorized", 5xx, dropped connections) have
// aborted deploys before (see DEPLOY.md #3b/#5 — a manual retry then succeeded). D1 migration apply
// and the seed execute are idempotent, so retry them a few times with linear backoff; a genuine
// migration/SQL error still surfaces after the attempts are exhausted.
async function wranglerRetry(commandArgs, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try { return await wrangler(commandArgs); }
    catch (error) {
      if (attempt >= attempts) throw error;
      const waitMs = attempt * 8000;
      console.warn(`wrangler ${commandArgs.slice(0, 2).join(' ')} attempt ${attempt}/${attempts} failed (${error.message}); retrying in ${waitMs / 1000}s…`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
}
// Pre-deploy test gate (founder, Oct 5): agents merge with typechecks only; the FULL vitest suite runs
// here, once per deploy, on the pinned snapshot. Known failures live in known-test-failures.txt (one
// "file > test name" per line); any NEW failure aborts before anything remote is touched.
{
  const report = join(snapshot, 'vitest-report.json');
  try { await run(bin('vitest'), ['run', '--reporter=dot', '--reporter=json', `--outputFile.json=${report}`]); }
  catch { /* failures are judged against the known list below */ }
  const results = JSON.parse(await readFile(report, 'utf8'));
  const failed = results.testResults.flatMap(file => file.assertionResults.filter(t => t.status === 'failed')
    .map(t => `${file.name.replace(snapshot + '/', '')} > ${t.fullName}`));
  const suiteErrors = results.testResults.filter(file => file.status === 'failed' && file.assertionResults.length === 0).map(file => `${file.name.replace(snapshot + '/', '')} > (suite failed to load)`);
  const known = new Set((await readFile(join(snapshot, 'tools/deploy/production/known-test-failures.txt'), 'utf8').catch(() => ''))
    .split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')));
  const fresh = [...failed, ...suiteErrors].filter(name => !known.has(name));
  console.log(`Test gate: ${results.numPassedTests} passed, ${failed.length} failed (${failed.length - fresh.filter(n => !n.endsWith('(suite failed to load)')).length} known), ${suiteErrors.length} suite load errors.`);
  if (fresh.length) {
    console.error('NEW test failures (deploy aborted):\n  ' + fresh.join('\n  '));
    throw new Error(`Test gate failed: ${fresh.length} new failure(s); rerun with GTASF_KEEP_SNAPSHOT=1 to keep ${snapshot}`);
  }
}
await run(bin('tsx'), ['tools/deploy/production/prepare.ts', 'YOUR_D1_DATABASE_ID']);
await wrangler(['deploy', '--dry-run', '--config', 'worker/wrangler.production.jsonc', '--outdir', 'worker/.wrangler/production/bundle']);
await run(process.execPath, ['tools/deploy/production/build-web.mjs']);
const manifest = JSON.parse(await readFile(join(snapshot, 'worker/.wrangler/production/manifest.json'), 'utf8'));
const enabledFlags = Object.entries(manifest.flags).filter(([, enabled]) => enabled).map(([name]) => name);
console.log(`Production flags: ${enabledFlags.join(', ')}`);
if (!args.includes('--dry-run')) {
  await wranglerRetry(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', 'worker/wrangler.production.jsonc']);
  if (!args.includes('--skip-seed')) {
    await run(bin('tsx'), ['tools/events/export-seed.ts']);
    await wranglerRetry(['d1', 'execute', 'DB', '--remote', '--config', 'worker/wrangler.production.jsonc', '--file', 'artifacts/events-seed/sf-tech-week.sql']);
  }
  if (!args.includes('--skip-map')) {
    // The publication command verifies every baked object/hash before upload.
    // Publish the whole-city (sf) bake under the client's stable map/lombard/ alias so deep links
    // anywhere in SF resolve a chunk instead of "Spawn is outside the map" (gtasf-o0cb/v62k). Every
    // chunk/runtime URL is release-pinned, so the alias only moves the stable manifest; zero client change.
    // gtasf-0k01: derive roadgraph-near.bin (spawn-area subset) from the baked graph and add
    // manifest.roadGraphNear before publishing. Post-process only (decode + repack, seconds), no rebake.
    await run(join(root, 'tools/map/node_modules/.bin/tsx'), [join(root, 'tools/map/roadgraph-subset.mts'), `--root=${join(root, 'tools/map/out/sf')}`], root);
    await run(join(root, 'tools/map/node_modules/.bin/tsx'), [join(root, 'tools/map/src/pack/publication.ts'), `--root=${join(root, 'tools/map/out/sf')}`, '--alias=lombard', '--target=production', `--config=${join(snapshot, 'worker/wrangler.production.jsonc')}`, '--upload'], root);
  } else if (enabledFlags.includes('nearRoadGraph')) {
    // gtasf-0k01: a --skip-map deploy keeps the live city map but still ships the near-spawn graph: cut it from the
    // same bake and patch only the stable alias manifest (refused unless the bake's roadGraph is the one live).
    await run(join(root, 'tools/map/node_modules/.bin/tsx'), [join(root, 'tools/map/roadgraph-subset.mts'), `--root=${join(root, 'tools/map/out/sf')}`], root);
    await run(join(root, 'tools/map/node_modules/.bin/tsx'), [join(root, 'tools/map/publish-near-graph.mts'), `--root=${join(root, 'tools/map/out/sf')}`, '--alias=lombard', '--target=production', `--config=${join(snapshot, 'worker/wrangler.production.jsonc')}`, '--upload'], root);
  }
  await wrangler(['deploy', '--config', 'worker/wrangler.production.jsonc']);
  const privateDirectory = join(root, 'worker/.wrangler/production');
  await mkdir(privateDirectory, { recursive: true });
  const inviteFile = join(privateDirectory, 'invite-code.txt');
  try { await readFile(inviteFile); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(inviteFile, randomBytes(24).toString('base64url') + '\n', { mode: 0o600, flag: 'wx' });
  }
  await copyFile(inviteFile, join(snapshot, 'worker/.wrangler/production/invite-code.txt'));
  await chmod(join(snapshot, 'worker/.wrangler/production/invite-code.txt'), 0o600);
  await run(process.execPath, ['tools/deploy/production/secrets.mjs']);
  // Pages discovers only wrangler.{json,jsonc,toml}; its CLI rejects --config.
  const pagesConfig = JSON.parse(await readFile(join(snapshot, 'web/wrangler.production.jsonc'), 'utf8'));
  delete pagesConfig.account_id;
  // Stale-chunk fallback (pages-worker.js serveAsset): the release being replaced keeps serving its /assets/* for 24 h,
  // so a tab still on the old HTML/module graph loads instead of hanging on index.html-as-JS. Best effort: without it
  // a stale chunk 404s and the client's one-shot reload guard (web/index.html) picks up the new release.
  try {
    const live = await cloudflare(`/accounts/${ACCOUNT}/pages/projects/gtasf`);
    const previousOrigin = live?.canonical_deployment?.url;
    if (previousOrigin) pagesConfig.vars = { ...pagesConfig.vars, PREVIOUS_DEPLOYMENT_ORIGIN: previousOrigin, PREVIOUS_DEPLOYMENT_UNTIL: String(Date.now() + 86_400_000) };
  } catch (error) { console.warn(`Previous Pages deployment lookup failed (stale chunks will 404): ${error instanceof Error ? error.message : error}`); }
  await writeFile(join(snapshot, 'web/wrangler.jsonc'), JSON.stringify(pagesConfig, null, 2) + '\n');
  await run(bin('wrangler'), ['pages', 'deploy', 'dist-production', '--project-name', 'gtasf', '--branch', 'main', '--commit-hash', commit], join(snapshot, 'web'));
  const projectPath = `/accounts/${ACCOUNT}/pages/projects/gtasf`;
  const project = await cloudflare(projectPath);
  const deployment_configs = {};
  for (const name of ['production', 'preview']) deployment_configs[name] = {
    env_vars: { ...(project.deployment_configs[name].env_vars ?? {}), ...Object.fromEntries(Object.entries(pagesConfig.vars).map(([key, value]) => [key, { type: 'plain_text', value }])) },
    services: { ...(project.deployment_configs[name].services ?? {}), API: { service: 'gtasf-production', environment: '' } },
  };
  await cloudflare(projectPath, { method: 'PATCH', body: { deployment_configs } });
  const health = await fetch('https://gtasf.pages.dev/api/health', { signal: AbortSignal.timeout(30_000) });
  if (health.status !== 200 || !(await health.json()).ok) throw new Error('Pages API health check failed');
  // Deploy-window gate: the live index.html must reference THIS release's hashed chunks and serve them all 200 on every
  // fresh-connection check for 60 s straight, on pages.dev AND the custom domain players use, within 5 min — else fail
  // loudly (the 'Loading the waterfront' hang when new HTML is live before its chunks; #6.22 passed one check at 9 s and
  // a fresh browser still got 404 on game-*.js ~30 s later).
  await waitForReleaseChunks({ origins: ['https://gtasf.pages.dev', 'https://gtasf.com'], expectedHtml: await readFile(join(snapshot, 'web/dist-production/index.html'), 'utf8'), log: console.log });
}
await mkdir(join(root, 'artifacts/production'), { recursive: true });
const previous = await readFile(join(root, 'artifacts/production/last-deploy.json'), 'utf8').then(text => JSON.parse(text).snapshot, () => undefined);
if (typeof previous === 'string' && previous !== snapshot && previous.startsWith(join(tmpdir(), 'gtasf-production-'))) rmSync(previous, { recursive: true, force: true });
keep = args.includes('--dry-run');
await writeFile(join(root, 'artifacts/production/last-deploy.json'), JSON.stringify({ commit, snapshot, enabledFlags, flags: manifest.flags, dryRun: args.includes('--dry-run'), completedAt: new Date().toISOString(), url: 'https://gtasf.pages.dev' }, null, 2) + '\n');
deployed = true;
console.log(args.includes('--dry-run') ? 'Production bundles verified; no remote mutation.' : 'Worker and Pages deployed. Verify invite admission, map publication, and custom-domain DNS before sharing.');

}
