// gtasf-r1fpj: phone Low frame of the on-foot player on a steep block (Hyde St at Bush by default) to see whether the body
// sinks into the drawn road. BASE (local stack), AT, OUT. Read-only.
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:5319', at = process.env.AT ?? '37.7896,-122.4166', out = process.env.OUT ?? 'steep.jpg';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Founder', foundedAt: 1, billboardSeen: true, preSeedClosed: true })); } catch {} });
const page = await ctx.newPage();
await page.goto(`${base}/?at=${at}&bot=1&preset=low`);
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#loading')?.hidden, null, { timeout: 180000 });
for (let i = 0; i < 6; i++) { await page.getByRole('button', { name: /skip/i }).first().tap({ timeout: 800 }).catch(() => {}); await page.waitForTimeout(500); }
await page.waitForTimeout(6000);
const f = await page.evaluate(() => { const w = window.__gtasf.world, m = w.map, c = w.camera?.camera?.position;
  return { x: w.foot.x, z: w.foot.z, y: w.foot.y, terrain: m?.heightAt?.(w.foot.x, w.foot.z) ?? null, drawn: m?.renderedGroundHeightAt?.(w.foot.x, w.foot.z, w.foot.y) ?? null, drawnUp: m?.renderedGroundHeightAt?.(w.foot.x, w.foot.z, w.foot.y + 5) ?? null,
    cam: c ? { x: c.x, y: c.y, z: c.z, drawnAtCam: m?.renderedGroundHeightAt?.(c.x, c.z, c.y) ?? null, terrainAtCam: m?.heightAt?.(c.x, c.z) ?? null } : null }; });
const r = v => (typeof v === 'number' ? v.toFixed(2) : String(v));
console.log('foot', r(f.x), r(f.z), 'y', r(f.y), '| terrain', r(f.terrain), 'drawn', r(f.drawn), 'drawn(+5 ref)', r(f.drawnUp), '| cam y', r(f.cam?.y), 'drawn@cam', r(f.cam?.drawnAtCam), 'terrain@cam', r(f.cam?.terrainAtCam));
await page.screenshot({ path: out, type: 'jpeg', quality: 72 });
await b.close();
