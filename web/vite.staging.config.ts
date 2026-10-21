import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, type UserConfig } from 'vite';
import { runtimeAssetsOnly } from './productionAssets';
import { htmlFlags } from './htmlFlags';

const repository=fileURLToPath(new URL('../',import.meta.url));

/** The deploy owner supplies the same reviewed module to the Worker bundler. */
export function deploymentWebConfig(repoRoot=repository,flagsFile=process.env.GTASF_FLAGS_FILE):UserConfig {
  const reviewedFlags=resolve(repoRoot,flagsFile||'worker/.wrangler/staging/flags.ts');
  let exists=false;
  try{exists=statSync(reviewedFlags).isFile();}catch{/* Report one actionable build error below. */}
  if(!exists)throw new Error(`Reviewed deployment flags are missing: ${reviewedFlags}. Generate and review the Worker flags first; set GTASF_FLAGS_FILE to that same module.`);
  const webRoot=resolve(repoRoot,'web');
  return {
    root:webRoot,
    plugins:[runtimeAssetsOnly(),htmlFlags(reviewedFlags)],
    // Exact match prevents a prefix alias from swallowing unrelated shared code.
    resolve:{alias:[{find:/^@gtasf\/shared\/flags$/,replacement:reviewedFlags}]},
    build:{target:'es2022',outDir:resolve(webRoot,'dist-production'),emptyOutDir:true,
      rollupOptions:{input:{game:resolve(webRoot,'index.html'),changelog:resolve(webRoot,'changelog.html')}}},
  };
}

// Separate entry deliberately excludes the local filesystem map middleware.
export default defineConfig(()=>deploymentWebConfig());
