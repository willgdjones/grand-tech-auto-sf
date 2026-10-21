// LANE E: cold prod load in WebKit (the iOS Safari engine) with an iPhone profile: does a phone reach READY, and if not,
// where does it stop? Samples the loading card every second, records page errors, console errors, failed requests,
// WebGL context loss and the gtasf:* performance marks. Fresh is_bot device per run. No CPU/network throttling
// (WebKit has no CDP), so this tests engine compatibility, not speed.
//   RUNS=3 DEVICE='iPhone 14' OUT=docs/qa/<day>/webkit-cold node tools/_qa-webkit-cold.mjs
import { webkit, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.env.OUT ?? 'docs/qa/webkit-cold'; mkdirSync(OUT, { recursive: true });
const BASE = process.env.GTASF_QA_URL ?? 'https://gtasf.com';
const DEVICE = process.env.DEVICE ?? 'iPhone 14';
const RUNS = Number(process.env.RUNS ?? 3), BUDGET = Number(process.env.BUDGET_MS ?? 120000);
const PATH = process.env.START ?? '/';
const browser = await webkit.launch({ headless: true });
const all = [];
for (let run = 1; run <= RUNS; run++) {
  const ctx = await browser.newContext({ ...devices[DEVICE] });
  await ctx.addInitScript(() => {
    window.__qaLost = 0;
    document.addEventListener('webglcontextlost', () => { window.__qaLost++; }, true);
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...a) { const c = orig.apply(this, a); if (c && !this.__qaHooked) { this.__qaHooked = true; this.addEventListener('webglcontextlost', () => { window.__qaLost++; }); } return c; };
  });
  const page = await ctx.newPage();
  const R = { run, device: DEVICE, pageErrors: [], consoleErrors: [], failed: [], http: [], stages: [] };
  page.on('pageerror', e => R.pageErrors.push(String(e.message).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') R.consoleErrors.push(m.text().slice(0, 200)); });
  page.on('requestfailed', r => { const f = r.failure()?.errorText ?? ''; if (!/cancel/i.test(f)) R.failed.push(`${f} ${new URL(r.url()).pathname}`.slice(0, 160)); });
  page.on('response', r => { if (r.status() >= 400) R.http.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const t0 = Date.now(); R.ws = [];
  page.on('websocket', ws => { if (!/\/api\/world/.test(ws.url())) return; const at = () => +((Date.now() - t0) / 1000).toFixed(1);
    R.ws.push(`open@${at()}`); let first = true;
    ws.on('framereceived', f => { if (first) { first = false; const op = typeof f.payload === 'string' ? 'text' : `0x${f.payload[0].toString(16)}`; R.ws.push(`first-rx ${op}@${at()}`); } });
    ws.on('close', () => R.ws.push(`close@${at()}`)); });
  // Per-request timing for the slow suspects (admission, funding profile, road graph).
  page.on('requestfinished', async r => { const p = new URL(r.url()).pathname; if (!/admission|funding|profile|roadgraph|graph/.test(p)) return;
    const t = r.timing(); (R.slowReqs ??= []).push(`${p.slice(0, 50)} start@${((t.startTime - t0) / 1000).toFixed(1)} took ${Math.round(t.responseEnd)}ms`); });
  await page.goto(`${BASE}${PATH}${PATH.includes('?') ? '&' : '?'}bot=1`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => R.pageErrors.push(`goto: ${e.message.slice(0, 120)}`));
  let last = '';
  while (Date.now() - t0 < BUDGET) {
    const st = await page.evaluate(() => ({ ready: !!window.__gtasf?.ready, conn: document.querySelector('#world')?.dataset.connected === 'true',
      card: (() => { const l = document.querySelector('#loading'); return l && l.checkVisibility?.() !== false && !l.hidden ? (l.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90) : null; })(),
      status: window.__gtasf?.status ?? null })).catch(e => ({ err: e.message.slice(0, 80) }));
    const label = st.err ? `eval error: ${st.err}` : st.ready && st.conn ? 'READY' : `card="${st.card}" status=${st.status}`;
    if (label !== last) { R.stages.push({ s: +((Date.now() - t0) / 1000).toFixed(1), label }); last = label; }
    if (st.ready && st.conn) break;
    await page.waitForTimeout(1000);
  }
  R.readyS = last === 'READY' ? R.stages.at(-1).s : null;
  R.marks = await page.evaluate(() => performance.getEntriesByType('mark').filter(m => m.name.startsWith('gtasf:')).map(m => `${m.name.slice(6)}@${Math.round(m.startTime)}`)).catch(() => []);
  R.webglLost = await page.evaluate(() => window.__qaLost).catch(() => null);
  R.webgl = await page.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); return g ? `webgl2 ${g.getParameter(g.VERSION)}` : c.getContext('webgl') ? 'webgl1 only' : 'NO WEBGL'; }).catch(() => null);
  await page.screenshot({ path: `${OUT}/run${run}-${R.readyS != null ? 'ready' : 'stuck'}.jpg`, type: 'jpeg', quality: 70 }).catch(() => {});
  console.log(`run ${run}: ${R.readyS != null ? `READY ${R.readyS}s` : `NOT READY in ${BUDGET / 1000}s, last: ${last}`} | pageErrors ${R.pageErrors.length} consoleErrors ${R.consoleErrors.length} failed ${R.failed.length} http ${R.http.length} lost ${R.webglLost} | ${R.webgl}`);
  console.log(`   ws: ${R.ws.join(' ')}`); for (const q of (R.slowReqs ?? []).slice(0, 8)) console.log(`   req: ${q}`);
  for (const e of R.pageErrors.slice(0, 4)) console.log(`   pageerror: ${e}`);
  for (const e of R.consoleErrors.slice(0, 4)) console.log(`   console: ${e}`);
  all.push(R); await ctx.close();
}
writeFileSync(`${OUT}/result.json`, JSON.stringify(all, null, 2));
const ok = all.filter(r => r.readyS != null).length;
console.log(`RESULT: ${ok}/${RUNS} WebKit ${DEVICE} cold loads reached READY`);
setTimeout(() => process.exit(0), 8000).unref(); await browser.close();
