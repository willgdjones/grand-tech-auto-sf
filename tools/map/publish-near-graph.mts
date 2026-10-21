/**
 * gtasf-0k01: publish only the near-spawn road graph against the LIVE map (no city re-upload). deploy.mjs runs
 * this on `--skip-map` deploys whenever nearRoadGraph is in the production allowlist.
 *   tools/map/node_modules/.bin/tsx tools/map/publish-near-graph.mts --root=tools/map/out/sf --alias=lombard \
 *     --target=production --config=worker/wrangler.production.jsonc [--live=https://gtasf.com/map/lombard/manifest.json] [--upload]
 * Run tools/map/roadgraph-subset.mts on the same bake first. Credentials: R2_S3_* in the environment.
 */
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { prepareNearPublication } from './src/pack/nearPublication';
import { validateUploadTarget } from './src/pack/publication';
import { r2Credentials, uploadToR2 } from './src/pack/r2upload';
import { digest } from './src/pipeline/sources';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const option = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const root = resolve(option('root') ?? 'tools/map/out/sf'), alias = option('alias') ?? 'lombard';
  const target = option('target') ?? 'staging', config = option('config');
  if (target !== 'staging' && target !== 'production') throw new Error('--target must be staging or production');
  const liveUrl = option('live') ?? `https://gtasf.com/map/${alias}/manifest.json`;
  const response = await fetch(liveUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Live manifest ${liveUrl} -> HTTP ${response.status}`);
  const liveBytes = Buffer.from(await response.arrayBuffer());
  const plan = await prepareNearPublication(root, liveBytes, alias, join(dirname(root), 'publication-near'));
  if (!plan) { console.log(JSON.stringify({ liveUrl, nearRoadGraph: 'already live' })); process.exit(0); }
  // Keep the manifest we are about to replace (1.2 review): restoring it puts live back on the full graph only.
  const backup = join(dirname(root), 'publication-near', `${alias}-manifest-before-${new Date().toISOString().replaceAll(':', '-')}.json`);
  await writeFile(backup, liveBytes);
  console.log(`Backed up live map/${alias}/manifest.json to ${backup}. Roll back: wrangler r2 object put gtasf-assets-production/map/${alias}/manifest.json --file ${backup} --content-type application/json --cache-control 'public, max-age=0, must-revalidate' --remote`);
  if (process.argv.includes('--upload')) {
    if (!config) throw new Error('--upload requires --config=...');
    const { accountId, bucket } = await validateUploadTarget(resolve(config), target);
    // uploadToR2 PUTs the alias manifest (last object) alone, after every near object has landed.
    await uploadToR2(r2Credentials(accountId, bucket), plan.objects, async object => {
      const buf = await readFile(object.file);
      if (digest(buf) !== object.sha256) throw new Error(`Publication bytes changed: ${object.key}`);
      return buf;
    });
  }
  console.log(JSON.stringify({ liveUrl, target, uploaded: process.argv.includes('--upload'), objects: plan.objects.map(o => ({ key: o.key, bytes: o.bytes })) }));
}
