// Lane B (critic N38 chase playtest, local combat stack): commit a street crime (1 star), then either WALK AWAY along the
// street (SCENARIO=walk) or stand in a parking garage (SCENARIO=hideout, Vallejo Street Garage), sampling each second:
// stars, nearest SFPD car (m), the escape phase. Run it on two stacks, flags on vs OFF_FLAGS="escapeWaitsForSighting
// dispatchTracksUntilSighted", to compare. Local caveat: no collision, so any unit within sight range sees you (no
// building-blocked sight); the hideout's 12 m spot range still applies.
//   GTASF_URL=http://localhost:5393 SCENARIO=walk node tools/_laneb-n38-chase.mjs
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 360_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5393';
const scenario = process.env.SCENARIO ?? 'walk';
const at = scenario === 'hideout' || scenario === 'seenhide' || scenario === 'prehide' ? '37.79870,-122.40870,0' : '37.80199520213967,-122.41963019831591,87.8';
const SECONDS = Number(process.env.SECONDS ?? 45);
// PHONE=1: phone viewport + touch. STARS=1|2|3: crimes confessed (kind 0 = ped kill 18 heat; kind 2 = cop hit 24). OUT: frames.
const PHONE = process.env.PHONE === '1', STARS = Number(process.env.STARS ?? 1), OUT = process.env.OUT ? resolve(process.env.OUT) : null;
if (OUT) await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext(PHONE ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => { const W = window.WebSocket; window.WebSocket = class extends W { constructor(...a) { super(...a); if (/\/api\/world/.test(String(a[0]))) window.__worldSocket = this; } }; });
const page = await context.newPage(); page.setDefaultTimeout(120_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
await page.goto(`${base}/?at=${at}&preset=low&bot=1`);
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 180_000 });
for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(400); }
await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(600);
if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(1200); }
await page.waitForTimeout(2000);
// SCENARIO=seenhide (reviewer 11:0x): start at the garage, walk ~70 m out into the open, commit the crime there, wait to
// be SEEN (a car within sight range), then walk back into the garage; report the time from contact to clear.
const garage = await page.evaluate(() => ({ x: window.__gtasf.world.foot.x, z: window.__gtasf.world.foot.z, yaw: window.__gtasf.world.foot.yaw ?? 0 }));
if (scenario === 'seenhide' || scenario === 'prehide') {
  await page.evaluate(g => new Promise(done => { const w = window.__gtasf.world; let n = 0;
    const id = setInterval(() => { w.foot.x += Math.sin(g.yaw) * 0.5; w.foot.z += Math.cos(g.yaw) * 0.5; if (++n >= 140) { clearInterval(id); done(); } }, 110); }), garage);
  await page.waitForTimeout(800);
}
for (const kind of STARS >= 3 ? [2, 2] : STARS === 2 ? [2] : [0]) { await page.evaluate(k => window.__worldSocket?.send(Uint8Array.of(0x25, k)), kind); await page.waitForTimeout(1500); } // confess street crimes (streetCrimeWanted)
// The walker runs in the page; the sampler runs here (once a second) so a phase change can be photographed.
await page.evaluate(walk => {
  const w = window.__gtasf.world, yaw = w.foot.yaw ?? 0;
  window.__walked = 0;
  if (walk) window.__walker = setInterval(() => { w.foot.x += Math.sin(yaw) * 0.5; w.foot.z += Math.cos(yaw) * 0.5; window.__walked += 0.5; }, 110);
}, scenario === 'walk');
let contactAt = null, homing = false;
const samples = []; let lastPhase = ''; // SCENARIO=prehide: crime ~70 m out, then straight back into the garage (no contact)
for (let t = 0; t < SECONDS; t++) {
  const s = await page.evaluate(() => {
    const w = window.__gtasf.world;
    let best = Infinity; for (const c of w.fleet?.cars?.values() ?? []) if (c.data.flags & 0x40) { const p = c.model?.root?.position ?? c.data; best = Math.min(best, Math.hypot(p.x - w.foot.x, p.z - w.foot.z)); }
    const row = document.querySelector('.gt-combat-escape');
    const st = window.__gtasfCombat?.state?.();
    return { stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length, copM: Number.isFinite(best) ? Math.round(best) : null,
      phase: row && !row.hidden ? (document.querySelector('.gt-combat-escape-label')?.textContent ?? '').trim() : '', hp: st?.health ?? null, dead: st?.dead ?? false };
  });
  if (scenario === 'seenhide' && contactAt === null && s.copM !== null && s.copM <= 55) contactAt = t;
  if ((scenario === 'seenhide' && contactAt !== null || scenario === 'prehide') && !homing) { homing = true; // prehide: back into the garage at once, before any contact // seen: run back into the garage
    await page.evaluate(g => { const w = window.__gtasf.world; window.__home = setInterval(() => { const dx = g.x - w.foot.x, dz = g.z - w.foot.z, d = Math.hypot(dx, dz);
      if (d < 1) { clearInterval(window.__home); return; } w.foot.x += dx / d * Math.min(0.5, d); w.foot.z += dz / d * Math.min(0.5, d); }, 110); }, garage); }
  const homeM = await page.evaluate(g => Math.round(Math.hypot(g.x - window.__gtasf.world.foot.x, g.z - window.__gtasf.world.foot.z)), garage);
  samples.push({ t, ...s, homeM });
  const kind = s.phase.split(' ')[0] || (s.stars ? 'SEEN' : 'CLEAR');
  if (OUT && kind !== lastPhase) { await page.screenshot({ path: resolve(OUT, `${PHONE ? 'phone' : 'desktop'}-${STARS}star-${String(t).padStart(2, '0')}s-${kind}.jpg`), quality: 80 }); lastPhase = kind; }
  await page.waitForTimeout(1000);
}
await page.evaluate(() => clearInterval(window.__walker));
const peak = Math.max(0, ...samples.map(s => s.stars));
const firstStar = samples.find(s => s.stars > 0), cleared = firstStar ? samples.find(s => s.t > firstStar.t && s.stars === 0) : undefined;
const firstNear = samples.find(s => s.copM !== null && s.copM <= 55);
console.log(`${PHONE ? 'phone' : 'desktop'} STARS=${STARS} (peak ${peak}) scenario ${scenario}: star at ${firstStar?.t ?? '-'} s; first SFPD car within 55 m at ${firstNear?.t ?? 'never'} s; stars cleared at ${cleared?.t ?? 'not within ' + SECONDS + ' s'}`);
if (scenario === 'seenhide' || scenario === 'prehide') console.log(`contact (car within 55 m) at ${contactAt ?? 'never'} s; in the garage (<30 m) at ${samples.find(x => contactAt !== null && x.t >= contactAt && x.homeM < 30)?.t ?? '-'} s; contact -> clear ${contactAt !== null && cleared ? cleared.t - contactAt : '-'} s`);
console.log(samples.map(s => `${s.t}s:${s.stars}*${s.copM ?? '-'}m${scenario === 'seenhide' ? `/g${s.homeM}` : ''}${s.phase ? `(${s.phase})` : ''}${s.hp !== null && s.hp < 100 ? `hp${s.hp}` : ''}${s.dead ? 'DEAD' : ''}`).join(' '));
console.log(`DONE errors=${JSON.stringify(errors)}`);
await browser.close();
