// Lane D: serve a built app (argv[2]) on a fixed port (argv[3]) with /api proxied to the local pool, until killed - e.g. to
// point tools/qa-prod-playtest.mjs (GTASF_QA_URL) at a local flags-on build. Run from the repo root.
import { preview } from 'vite';
import { resolve } from 'node:path';
import { startLocalPool } from './local-pool/pool.mjs';
const pool = await startLocalPool();
const server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: resolve(process.argv[2]) },
  preview: { host: '127.0.0.1', port: +process.argv[3], strictPort: true, proxy: { '/api': { target: pool.url.origin, ws: true } } } });
console.log('SERVING', server.resolvedUrls.local[0]);
process.on('SIGTERM', async () => { await server.close(); await pool.close(); process.exit(0); });
