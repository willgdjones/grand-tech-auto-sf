// LANE E (scratch): does a deep link reach READY+connected? One fresh bot context per URL query; 90 s budget each.
//   node tools/_qa-deeplink-probe.mjs "at=37.7838,-122.4140" "at=37.789100,-122.409600,90&gfx=hd" ...
import { chromium } from '@playwright/test';
const BASE = process.env.GTASF_QA_URL ?? 'https://gtasf.com';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const q of process.argv.slice(2)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const bad = [];
  page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on('pageerror', e => bad.push(`pageerror ${e.message.slice(0, 120)}`));
  page.on('websocket', ws => { const u = new URL(ws.url()); if (!u.pathname.startsWith('/api/world')) return; bad.push(`ws open ${u.search.slice(0, 80)}`);
    let n = 0; ws.on('framereceived', f => { if (n++ < 3) bad.push(`rx 0x${(typeof f.payload === 'string' ? f.payload.charCodeAt(0) : f.payload[0]).toString(16)}/${f.payload.length}`); });
    ws.on('close', () => bad.push(`ws close after ${n} frames`)); });
  page.on('console', m => { if (process.env.ALLCONSOLE ? m.type() !== 'debug' : /world|spawn|connect|relocat/i.test(m.text())) bad.push(`console ${m.type()}: ${m.text().slice(0, 160)}`); });
  const pending = new Map(); page.on('request', r => pending.set(r, Date.now())); page.on('requestfinished', r => pending.delete(r)); page.on('requestfailed', r => { bad.push(`FAILED ${r.failure()?.errorText} ${new URL(r.url()).pathname}`); pending.delete(r); });
  const t0 = Date.now(); await page.goto(q.startsWith('/') ? `${BASE}${q}?bot=1` : `${BASE}/?${q}&bot=1`, { waitUntil: 'domcontentloaded' }); // q: 'at=…' or a path like /go/lombard
  const ok = await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 90000 }).then(() => true).catch(() => false);
  const st = await page.evaluate(() => ({ ready: !!window.__gtasf?.ready, conn: document.querySelector('#world')?.dataset.connected, foot: window.__gtasf?.world?.foot ? [Math.round(window.__gtasf.world.foot.x), Math.round(window.__gtasf.world.foot.z)] : null })).catch(() => null);
  console.log(`${ok ? 'READY' : 'STUCK'} ${((Date.now() - t0) / 1000).toFixed(0)}s  ?${q}  ${JSON.stringify(st)}  ${bad.slice(0, process.env.ALLCONSOLE ? 60 : 14).join(' | ')}`);
  if (!ok) { const stale = [...pending].filter(([, t]) => Date.now() - t > 20000).map(([r, t]) => `${((Date.now() - t) / 1000).toFixed(0)}s ${r.method()} ${new URL(r.url()).pathname}`);
    console.log(`  pending >20s (${stale.length}): ${stale.slice(0, 12).join(' | ')}`);
    console.log(`  state: ${JSON.stringify(await page.evaluate(() => ({ status: window.__gtasf?.status, detail: window.__gtasf?.detail, errors: window.__gtasf?.errors, step: window.__gtasf?.step, marks: performance.getEntriesByType('mark').map(m => `${m.name.replace('gtasf:', '')}@${Math.round(m.startTime)}`) })).catch(e => String(e)))}`);
    console.log(`  loading: ${await page.evaluate(() => document.querySelector('#loading')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200)).catch(() => null)}`); }
  await ctx.close();
}
await browser.close();
