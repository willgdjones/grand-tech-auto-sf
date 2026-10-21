// critique #16 (flag policePresence, needs sfpdOnFoot + policeFire): in-game check on a flags-ON stack (seed prod
// collision). Raise 2★ with raw COMBAT_CRIME frames (like _combat-gates stars mode), stand still, then record:
//  - the DISPATCH radio line on the new star and any SFPD barks (DOM observer: they're brief);
//  - an officer on foot who HOLDS at standoff range (> 5 m, stationary ≥ 2 s) instead of charging to 1.5 m;
// and screenshot the standoff (drawn pistols at the cruiser door + the bark/dispatch subtitles).
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_police-presence-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const AT = process.env.GTASF_POLICE_AT ?? '37.795570,-122.393900,270'; // Ferry Building plaza
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
const view = PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };
let pass = false;
try {
  const ctx = await browser.newContext(view);
  await ctx.addInitScript(() => { const s = WebSocket.prototype.send; WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 2) window.__ws = this; } catch {}
    return s.call(this, d); }; });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errors.push(e.message.slice(0, 120)));
  await p.goto(`${base}/?at=${AT}&preset=low&bot=1`);
  await p.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  for (let i = 0; i < 15; i++) { await p.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await p.waitForTimeout(250); }
  try { const d = p.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('cop'); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
  await p.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = p.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await p.waitForTimeout(2500);
  // Watch the subtitles (they last 2.6–4.8 s) and the officers (server positions → rendered slots).
  await p.evaluate(() => {
    window.__lines = []; const seen = new Set();
    new MutationObserver(() => { for (const el of document.querySelectorAll('.gt-police-bark, .gt-dispatch')) if (!el.hidden && el.textContent && !seen.has(el.textContent)) { seen.add(el.textContent); window.__lines.push(el.textContent); } })
      .observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
    window.__held = 0; window.__minOfficerM = Infinity; const last = new Map();
    setInterval(() => { const w = window.__gtasf.world, f = w.foot, ps = w.policeOfficers?.positions() ?? [];
      for (const [i, o] of ps.entries()) { const d = Math.hypot(o.x - f.x, o.z - f.z); window.__minOfficerM = Math.min(window.__minOfficerM, d);
        const prev = last.get(i); if (prev && Math.hypot(o.x - prev.x, o.z - prev.z) < 0.05 && d > 5) window.__held = Math.max(window.__held, (prev.still ?? 0) + 0.25);
        last.set(i, { x: o.x, z: o.z, still: prev && Math.hypot(o.x - prev.x, o.z - prev.z) < 0.05 ? (prev.still ?? 0) + 0.25 : 0 }); } }, 250);
  });
  await p.waitForTimeout(1200); // a MOVE goes out → the world socket is captured
  for (let i = 0; i < 2; i++) { await p.evaluate(() => window.__ws?.send(Uint8Array.of(0x25, 0))); await p.waitForTimeout(1100); } // 2 × 18 heat → 2★
  let shot = false;
  for (let t = 0; t < 75; t++) { // up to ~75 s for a cruiser to arrive, park at the 10 m standoff and let its officers out
    await p.waitForTimeout(1000);
    const s = await p.evaluate(() => ({ held: window.__held, n: window.__gtasf.world.policeOfficers?.positions().length ?? 0, lines: window.__lines.length,
      bark: !document.querySelector('.gt-police-bark')?.hidden, health: window.__gtasfCombat.state().health }));
    if (!shot && s.n > 0 && s.held >= 1 && s.bark) { shot = true; await p.screenshot({ path: `${out}/police-presence-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
    if (shot && s.held >= 2 && s.lines >= 2) break;
    if (s.health <= 0) { note('  (player was WASTED during the wait)'); break; }
  }
  if (!shot) await p.screenshot({ path: `${out}/police-presence-${tag}.jpg`, type: 'jpeg', quality: 85 });
  const r = await p.evaluate(() => ({ lines: window.__lines, held: window.__held, minOfficerM: window.__minOfficerM, stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length }));
  note(`[police-presence] stars ${r.stars}; officer held at standoff ${r.held.toFixed(2)} s (closest officer ${Number.isFinite(r.minOfficerM) ? r.minOfficerM.toFixed(1) : '—'} m)`);
  for (const line of r.lines) note(`  heard: ${line}`);
  pass = r.lines.some(l => l.startsWith('DISPATCH')) && r.lines.some(l => l.startsWith('SFPD')) && r.held >= 2 && errors.length === 0;
  await ctx.close();
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/police-presence-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
