import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localMapPlugin } from './mapLocalPlugin';
import { runtimeAssetsOnly } from './productionAssets';
import { htmlFlags } from './htmlFlags';
const root = fileURLToPath(new URL('.', import.meta.url));
// Serve the changelog page at the extensionless `/changelog` in dev/preview, matching the
// "Full changelog" link and Cloudflare Pages' clean-URL serving of changelog.html in production.
function changelogDevRoute(): Plugin {
  const rewrite = (url: string | undefined) => {
    const [path, query] = (url ?? '').split('?');
    return path === '/changelog' || path === '/changelog/' ? `/changelog.html${query ? `?${query}` : ''}` : undefined;
  };
  const middleware = (req: { url?: string }, _res: unknown, next: () => void) => { const next_url = rewrite(req.url); if (next_url) req.url = next_url; next(); };
  return {
    name: 'gtasf-changelog-dev-route',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
export default defineConfig({
  plugins: [localMapPlugin(), changelogDevRoute(), runtimeAssetsOnly(), htmlFlags(resolve(root, '../shared/flags.ts'))],
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  build: { target: 'es2022', rollupOptions: { input: {
    game: resolve(root, 'index.html'), landmarks: resolve(root, 'landmarks.html'),
    changelog: resolve(root, 'changelog.html'),
  } } },
});
