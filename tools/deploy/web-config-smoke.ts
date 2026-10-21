import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from 'vite';
import { deploymentWebConfig } from '../../web/vite.staging.config';

// Resolve a tiny temporary config without building the game, loading a browser,
// writing a real deployment flag module or contacting any remote service.
const root=await mkdtemp(join(tmpdir(),'gtasf-deploy-web-'));
try{
  assert.throws(()=>deploymentWebConfig(root,''),/Reviewed deployment flags are missing/);
  const target=join(root,'worker/.wrangler/production/flags.ts');
  await mkdir(join(root,'worker/.wrangler/production'),{recursive:true});
  await writeFile(target,'export const flags=Object.freeze({bootstrapScene:false});\n');
  const config=deploymentWebConfig(root,'worker/.wrangler/production/flags.ts');
  assert.deepEqual(deploymentWebConfig(root,target),config);
  const resolved=await resolveConfig({...config,configFile:false},'build');
  assert.equal(await resolved.createResolver()('@gtasf/shared/flags'),await realpath(target));
  assert.equal(resolved.build.outDir,join(root,'web/dist-production'));
  assert.equal(resolved.root,join(root,'web'));
  assert.equal(resolved.plugins.some(plugin=>plugin.name==='gtasf-local-map'),false);
  console.log(JSON.stringify({ok:true,reviewedAlias:true,missingFlagsRejected:true,localMapMiddleware:false}));
}finally{await rm(root,{recursive:true,force:true});}
