import { preview } from 'vite';
import { fileURLToPath } from 'node:url';
import { startLocalPool } from './local-pool/pool.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
/** No watchers: serves the existing web build, local map middleware and a freshly
 * bundled disposable Worker. Run through tools/heavy.sh with the repo's Node. */
export async function startPreview({ port = 4173 } = {}) {
  const pool = await startLocalPool();
  let server;
  try {
    server = await preview({ root: `${root}web`, configFile: `${root}web/vite.config.ts`,
      preview: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': { target: pool.url.origin, ws: true }, '/claim': { target: pool.url.origin } } } });
    const address = server.httpServer.address();
    return {
      url: `http://127.0.0.1:${address.port}`, pool,
      async close() { server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve)); await pool.close(); },
    };
  } catch (error) { if (server) server.httpServer.close(); await pool.close(); throw error; }
}
