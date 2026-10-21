// Diagnose the local dev boot stall (stuck on "Loading Ferry Building…"). Loads the target, logs
// console errors, failed network requests (status>=400 or failed), page errors, and the #world dataset,
// so we can tell a code boot regression (JS error / worker 500) from a local-stack gap (map chunk 404s).
// Run from repo root: node tools/boot-diagnose.mjs  (GTASF_URL overrides, default local :5173)
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const origin = process.env.GTASF_URL ?? 'http://127.0.0.1:5173';
let code = '';
try { code = (await readFile(process.env.GTASF_INVITE_FILE ?? 'worker/.wrangler/production/invite-code.txt', 'utf8')).trim(); } catch {}
const url = code ? `${origin}/?invite=${code}` : `${origin}/`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

const ws = [];
page.on('websocket', s => {
  ws.push(`WS open ${s.url().slice(0, 90)}`);
  let frames = 0;
  s.on('framereceived', () => { frames++; if (frames <= 2) ws.push(`  WS frame#${frames} received`); });
  s.on('close', () => ws.push(`  WS closed (received ${frames} frames)`));
  s.on('socketerror', e => ws.push(`  WS error ${String(e).slice(0, 80)}`));
});
const mapReqs = [];
page.on('requestfinished', r => { if (/map|chunk|tile|\.glb|manifest/i.test(r.url())) mapReqs.push(`ok ${r.url().slice(0, 90)}`); });

const consoleErrs = [], failed = [], pageErrs = [];
const pending = new Map(); // url -> start time; removed on finish/fail → whatever remains is hanging
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleErrs.push(`[${m.type()}] ${m.text()}`.slice(0, 300)); });
page.on('pageerror', e => pageErrs.push(String(e.message).slice(0, 300)));
page.on('request', r => pending.set(r.url(), Date.now()));
page.on('requestfinished', r => pending.delete(r.url()));
page.on('requestfailed', r => { pending.delete(r.url()); failed.push(`FAILED ${r.url().slice(0, 120)} — ${r.failure()?.errorText ?? ''}`); });
page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 120)}`); });

try { await page.goto(url, { timeout: 20_000, waitUntil: 'domcontentloaded' }); }
catch (e) { console.log('goto failed:', String(e.message).split('\n')[0]); }
await page.waitForTimeout(25_000); // let boot try to complete

const state = await page.evaluate(() => {
  const w = document.querySelector('#world'); const g = window.__gtasf || {};
  const loading = document.querySelector('.gt-loading, [class*="loading"], [class*="Loading"]');
  return {
    ready: !!g.ready,
    dataset: w?.dataset ? { connected: w.dataset.connected, events: w.dataset.events, players: w.dataset.players } : null,
    loadingText: loading ? (loading.textContent || '').trim().slice(0, 80) : null,
    worldErrors: (g.errors || []).slice(0, 5),
  };
}).catch(e => ({ evalError: String(e.message).split('\n')[0] }));

console.log('=== STATE ===', JSON.stringify(state, null, 2));
console.log('=== PAGE ERRORS (' + pageErrs.length + ') ===\n' + pageErrs.join('\n'));
console.log('=== CONSOLE err/warn (' + consoleErrs.length + ') ===\n' + consoleErrs.slice(0, 20).join('\n'));
console.log('=== FAILED / 4xx-5xx REQUESTS (' + failed.length + ') ===\n' + [...new Set(failed)].slice(0, 30).join('\n'));
const now = Date.now();
const hanging = [...pending.entries()].map(([u, t]) => `${Math.round((now - t) / 1000)}s  ${u.slice(0, 140)}`);
console.log('=== HANGING (started, never finished) (' + hanging.length + ') ===\n' + hanging.slice(0, 30).join('\n'));
console.log('=== WEBSOCKET (' + ws.length + ') ===\n' + ws.join('\n'));
console.log('=== MAP/ASSET requests OK (' + mapReqs.length + ') ===\n' + [...new Set(mapReqs)].slice(0, 15).join('\n'));
console.log('url used:', url.replace(code, '[INVITE]'));
await browser.close();
