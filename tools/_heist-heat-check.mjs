// gtasf-b9o9q (critic N47) real-run check on a local combat stack: the heist's heat lands only after the player leaves 50 m
// of the grab (heistHeatOnLeave, server), and the escape names a getaway car (heistGetaway, client). Desktop.
//   COMBAT_FLAGS="<lane B combat set> missions founderLadder pitching heistHeatOnLeave heistGetaway" SNAP=... tools/combat-stack.sh up
//   tools/heavy.sh node tools/_heist-heat-check.mjs     (OUT=docs/sf-data/heist-heat)
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
setTimeout(() => { console.log('RESULT: HEIST HEAT CHECK FAILED (watchdog)'); process.exit(2); }, 6 * 60_000).unref();
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319', out = process.env.OUT ?? 'docs/sf-data/heist-heat'; mkdirSync(out, { recursive: true });
const H = { lat: 37.782190, lon: -122.402980 }; // shared/founder/missions.ts steal-pitch-deck start
const r = { notes: [], toasts: [], stars: {} }, errs = [];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try {
  localStorage.setItem('gtasf.opener.v1', 'skipped'); localStorage.setItem('gtasf.combat.age18.v1', 'ok'); localStorage.setItem('gtasf.founder.bucket.v1', 'ladder');
  localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Heist', foundedAt: 1, billboardSeen: true, preSeedClosed: true }));
} catch {} });
await ctx.addInitScript(() => { window.__gtSeen = []; const seen = new Set(); setInterval(() => {
  for (const el of document.querySelectorAll('.gt-toast, .gt-mission-line')) { const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t && !el.hidden && !seen.has(t)) { seen.add(t); window.__gtSeen.push(`${Math.round(performance.now())} ${t.slice(0, 140)}`); } } }, 200); });
const page = await ctx.newPage(); page.setDefaultTimeout(60000); page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
page.on('response', async res => { if (/mission-(start|complete)/.test(res.url())) r.notes.push(`${res.url().split('/').pop()} ${res.status()} ${(await res.text().catch(() => '')).slice(0, 120)}`); });
const stars = () => page.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
const shot = name => page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 78 });
const step = async (dx, dz) => { await page.evaluate(({ dx, dz }) => { const f = window.__gtasf.world.foot; f.x += dx; f.z += dz; }, { dx, dz }); await page.waitForTimeout(110); };

await page.goto(`${base}/?at=${H.lat},${H.lon},0&bot=1`);
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 180000 });
await page.waitForTimeout(5000);
r.named = await page.evaluate(async () => (await fetch('/api/funding/profile', { method: 'POST', credentials: 'same-origin',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startupName: 'QA Heist', nickname: 'QA' }) })).status);
await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE');
await page.waitForTimeout(3500); r.stars.atGrab = await stars(); await shot('01-grab-escape');
// Walk away from the office in a straight line, sampling stars at 30 m and past 50 m.
const start = await page.evaluate(() => ({ x: window.__gtasf.world.foot.x, z: window.__gtasf.world.foot.z }));
const dist = () => page.evaluate(s => Math.hypot(window.__gtasf.world.foot.x - s.x, window.__gtasf.world.foot.z - s.z), start);
while (await dist() < 30) await step(0.5, 0);
await page.waitForTimeout(2500); r.stars.at30m = await stars(); await shot('02-at-30m');
while (await dist() < 60) await step(0.5, 0);
await page.waitForTimeout(3500); r.stars.at60m = await stars(); await shot('03-past-50m');
r.toasts = await page.evaluate(() => window.__gtSeen); r.errors = errs;
writeFileSync(`${out}/result.json`, JSON.stringify(r, null, 1)); console.log(JSON.stringify(r, null, 1));
const pass = r.stars.atGrab === 0 && r.stars.at30m === 0 && r.stars.at60m > 0;
console.log(`RESULT: HEIST HEAT ${pass ? 'PASS ✅' : 'CHECK'} grab=${r.stars.atGrab} 30m=${r.stars.at30m} 60m=${r.stars.at60m}`);
await browser.close(); process.exit(pass ? 0 : 1);
