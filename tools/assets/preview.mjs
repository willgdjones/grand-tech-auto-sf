/** Short-lived, single-browser contact sheet. Exits after capture; no watch process. */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
const root = fileURLToPath(new URL('../../', import.meta.url));
const types = { '.js': 'text/javascript', '.html': 'text/html', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  try { const bytes = await readFile(path); res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(bytes); }
  catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/assets/preview.html`);
  await page.waitForFunction(() => window.reviewReady, undefined, { timeout: 30_000 });
  if (errors.length) throw new Error(errors.join('\n'));
  const out = resolve(root, 'artifacts/gtasf-1h3'); await mkdir(out, { recursive: true });
  await page.screenshot({ path: resolve(out, 'assets.png') });
  const review = await page.evaluate(() => window.review);
  await writeFile(resolve(out, 'asset-review.json'), JSON.stringify(review, null, 2) + '\n');
  console.log(JSON.stringify(review));
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
