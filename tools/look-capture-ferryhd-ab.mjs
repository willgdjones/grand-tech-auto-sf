// A/B for ferryBuildingHd (gtasf-dtk5): the Ferry Building spawn view (arched windows + clock tower).
// The flag is geometry-only in the landmark builder, compiled from shared/flags.ts, so toggle it and
// restart dev between runs:
//   (set ferryBuildingHd:true)  FERRYHD_VARIANT=after  node tools/look-capture-ferryhd-ab.mjs
//   (set ferryBuildingHd:false) FERRYHD_VARIANT=before node tools/look-capture-ferryhd-ab.mjs
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.FERRYHD_VARIANT ?? 'after';
const out = 'docs/sf-data/ferryhd';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const errors = [];
// Both from the authored default spawn (spawn/locations.ts FERRY): Embarcadero plaza in front of the
// Ferry Building, heading 64.3 facing the clock tower. 'spawn' is level (the close arcade facade the
// player first sees); 'tower' pitches the camera up to the clock tower (matches the founder's reference
// ferry-phone-both.png). pitchUp saturates the camera pitch at its +35 deg clamp, so before/after match.
const SPOTS = [
  ['spawn', 'at=37.795229772,-122.394210973,64.2977', 7000, false],
  ['tower', 'at=37.795400,-122.394532,83', 7000, true],
];
async function pitchUp(page) {
  // look(dx,dy): positive dy pitches up (camera/thirdPerson.ts); a big downward drag saturates the clamp.
  const box = await page.locator('canvas').first().boundingBox().catch(() => null);
  if (!box) return;
  const cx = box.x + box.width / 2, cy = box.y + box.height * 0.45;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) await page.mouse.move(cx, cy + i * 18, { steps: 1 });
  await page.mouse.up();
  await page.waitForTimeout(700);
}
const DEVICES = [
  ['desktop', { viewport:{width:1600,height:900}, deviceScaleFactor:1.5 }, 'gfx=hd'],
  ['phone', { viewport:{width:393,height:873}, deviceScaleFactor:2.75, isMobile:true, hasTouch:true }, 'preset=low&touch=1'],
];
async function dismiss(page) {
  try { const s=page.locator('.gt-sa-intro__skip'); if(await s.isVisible({timeout:1000})) await s.click(); } catch {}
  try { const g=page.locator('.gt-identity-go'); await g.waitFor({state:'visible',timeout:1500}); await g.click({timeout:8000}); } catch {}
  try { const d=page.locator('.gt-funding-onboarding[open]'); if(await d.isVisible({timeout:800})){ await d.getByLabel('Startup name',{exact:true}).fill('Look'); await d.getByLabel('Your nickname',{exact:true}).fill('F'); await d.getByRole('button',{name:'Save startup'}).click(); } } catch {}
}
for (const [device, ctxOpts, extra] of DEVICES) {
  const ctx = await browser.newContext(ctxOpts);
  for (const [name, query, settleMs, doPitch] of SPOTS) {
    const page = await ctx.newPage(); page.setDefaultTimeout(90_000);
    page.on('pageerror', e => errors.push(`${device}/${name}: ${String(e.message)}`));
    try {
      await page.goto(`${base}/?${query}&time=golden&${extra}&bot=1`);
      try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
      catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
      await dismiss(page); await page.waitForTimeout(settleMs); await dismiss(page);
      if (doPitch) await pitchUp(page);
      const path = `${out}/${name}-${device}-${variant}.jpg`;
      await page.screenshot({ path, type:'jpeg', quality:92 });
      console.log(`OK ${device}/${name}: ${(await stat(path)).size}B`);
    } catch (e) { console.log(`SKIP ${device}/${name}: ${String(e.message).split('\n')[0]}`); }
    finally { await page.close(); }
  }
  await ctx.close();
}
console.log('DONE variant=' + variant + ' errors=' + JSON.stringify(errors.slice(0,5)));
await browser.close();
