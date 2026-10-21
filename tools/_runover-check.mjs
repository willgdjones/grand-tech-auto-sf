// Lane B: headless e2e for the run-over knockdown (flag streetCrimeWanted). Enter a parked car (Lombard spawn,
// where E boards one immediately), opt into combat, then put the moving car (6 m/s) onto the nearest street walker
// a few times. Each knockdown must topple the walker (it leaves positions()) and send COMBAT_CRIME kind 1, and the
// server must raise 'ped-kill' (>= 1 star). The car is placed, not steered, so this proves the knockdown +
// confession wiring, not driving feel.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_runover-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const SPAWN = process.env.GTASF_RUNOVER_AT ?? '37.80199520213967,-122.41963019831591,87.8';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  window.__runOvers = 0;
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 2) : null; if (b && b[0] === 0x25 && b[1] === 1) window.__runOvers++; } catch {}
    return send.call(this, d);
  };
});
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const stars = () => page.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
async function clearOnboarding() {
  for (let i = 0; i < 20; i++) {
    const b = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
      return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = page.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('q'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} }
    else if (b.id) { try { await page.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} }
    else await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    await page.waitForTimeout(500);
  }
}
let pass = false;
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  await clearOnboarding();
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(800);
  await clearOnboarding();
  if (!(await page.evaluate(() => window.__gtasfCombat?.state?.().started))) throw new Error('combat not started (stack not flag-on?)');
  for (let i = 0; i < 4 && (await page.evaluate(() => window.__gtasf.world.mode)) !== 'driver'; i++) {
    if (PHONE) { // the touch Enter / exit button (pointerdown → queued tap action)
      const b = page.locator('button[data-action="enter-exit"]').first();
      try { const box = await b.boundingBox(); if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); } catch {}
    }
    else await page.keyboard.press('KeyE');
    await page.waitForTimeout(1200);
  }
  const mode = await page.evaluate(() => window.__gtasf.world.mode);
  note(`[run-over] mode: ${mode}`);
  if (mode !== 'driver') throw new Error('could not board a car with E at the spawn');
  for (let i = 0; i < 20 && !(await page.evaluate(() => window.__gtasf.world.streetWalkers?.positions?.().length)); i++) await page.waitForTimeout(1000);
  let knocked = 0;
  for (let i = 0; i < 3; i++) {
    const r = await page.evaluate(async () => {
      const w = window.__gtasf.world, d = w.driving, sw = w.streetWalkers;
      const ps = sw?.positions?.() ?? []; if (!ps.length) return { walkers: 0 };
      let best; for (const p of ps) { const dist = Math.hypot(p.x - d.x, p.z - d.z); if (!best || dist < best.dist) best = { ...p, dist }; }
      const before = ps.length;
      d.x = best.x; d.z = best.z; d.speed = 6; // the moving car is ON the walker this frame
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const gone = !(sw.positions().some(p => Math.hypot(p.x - best.x, p.z - best.z) < 0.05));
      return { walkers: before, dist: best.dist, gone };
    });
    note(`  pass ${i}: ${JSON.stringify(r)}`);
    if (r.gone) knocked++;
    await page.waitForTimeout(1200); // past the 1/s ped-kill rate limit
  }
  await page.waitForTimeout(800);
  const sent = await page.evaluate(() => window.__runOvers), s = await stars();
  note(`[run-over] walkers knocked down: ${knocked}; COMBAT_CRIME kind 1 sent: ${sent}; stars: ${s}`);
  pass = knocked > 0 && sent >= knocked && s >= 1;
  await page.screenshot({ path: `${out}/runover-${tag}.jpg`, type: 'jpeg', quality: 85 });
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/runover-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
