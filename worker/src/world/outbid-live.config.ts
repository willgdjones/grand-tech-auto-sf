import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve:{alias:{'@gtasf/shared/flags':fileURLToPath(new URL('./outbid-live.flags.ts',import.meta.url))}},
  plugins:[cloudflareTest({main:'./worker/src/world/test-worker.ts',miniflare:{
    compatibilityDate:'2026-09-28',compatibilityFlags:['nodejs_compat'],
    durableObjects:{WORLD:{className:'WorldDO',useSQLite:true}},bindings:{LAUNCH_MODE:'open'},
  }})],
  test:{include:['worker/src/world/outbid-live.do.ts'],maxWorkers:1,testTimeout:15000,hookTimeout:15000},
});
