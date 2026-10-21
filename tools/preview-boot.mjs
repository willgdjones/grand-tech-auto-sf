// Isolation probe: does the BUILT app (vite preview, bundled — like prod) boot against the LOCAL worker
// (:8787)? If it connects + reaches ready, the local world/worker is fine and the dev stall is vite-dev
// specific. If it also stalls (no /api/world WELCOME), the local world-connect is the culprit (worker/DO).
// Run from repo root: node tools/preview-boot.mjs  (expects GTASF_FOUNDER_APP pre-built, else builds).
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const outDir = resolve(process.env.GTASF_FOUNDER_APP ?? '/tmp/claude-501/preview-app');
const server = await preview({
  configFile: resolve('web/vite.config.ts'), root: resolve('web'),
  build: { outDir },
  preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
});
const base = server.resolvedUrls.local[0];
console.log('preview at', base);

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = [], ws = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errs.push('PAGEERR ' + String(e.message).slice(0, 200)));
page.on('websocket', s => {
  ws.push(`WS ${s.url().slice(0, 70)}`); let f = 0;
  s.on('framereceived', () => { if (++f <= 2) ws.push(`  frame#${f}`); });
  s.on('close', () => ws.push(`  closed (${f} frames)`));
});
await page.goto(base, { waitUntil: 'domcontentloaded' }).catch(e => console.log('goto:', e.message));
let ready = false;
try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 45_000 }); ready = true; } catch {}
const state = await page.evaluate(() => {
  const w = document.querySelector('#world');
  return { ready: !!window.__gtasf?.ready, connected: w?.dataset?.connected ?? null, events: w?.dataset?.events ?? null };
}).catch(() => ({}));
console.log('RESULT ready=' + ready, JSON.stringify(state));
console.log('WS:\n' + ws.join('\n'));
console.log('ERRORS (' + errs.length + '):\n' + errs.slice(0, 8).join('\n'));
await browser.close();
await new Promise(r => server.httpServer.close(r));
