// A/B for pier39Sign: the 'PIER 39' entrance sign read from the Embarcadero approach. PV_VARIANT=before|after.
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.PV_VARIANT ?? 'after';
const out = `docs/sf-data/pier39/${variant}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
// 'PIER 39' sign ~37.80875,-122.41006 (local z=142.3 end), world y~10, faces +z (S) toward the Embarcadero approach.
const CAM = process.env.PV_CAM ?? '37.80808,-122.41000,10,37.80875,-122.41007';
const SPOTS = [['sign', `at=37.8082,-122.4100&aerial=${CAM}`, 8000, ['desktop', 'phone']]];
const DEVICES = {
  desktop: [{ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 }, 'gfx=hd'],
  phone: [{ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }, 'preset=low&touch=1'],
};
async function dismiss(page) {
  try { const s = page.locator('.gt-sa-intro__skip'); if (await s.isVisible({ timeout: 1000 })) await s.click(); } catch {}
  try { const g = page.locator('.gt-identity-go'); await g.waitFor({ state: 'visible', timeout: 1500 }); await g.click({ timeout: 8000 }); } catch {}
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('Look'); await d.getByLabel('Your nickname', { exact: true }).fill('F'); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
}
for (const [name, query, settleMs, devs] of SPOTS) {
  for (const device of devs) {
    const [ctxOpts, extra] = DEVICES[device];
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage(); page.setDefaultTimeout(90_000);
    page.on('pageerror', e => errors.push(`${device}/${name}: ${String(e.message)}`));
    try {
      await page.goto(`${base}/?${query}&time=golden&${extra}&bot=1`);
      try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
      catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
      await dismiss(page); await page.waitForTimeout(settleMs); await dismiss(page);
      const path = `${out}/${name}-${device}.jpg`;
      await page.screenshot({ path, type: 'jpeg', quality: 91 });
      console.log(`OK ${name}/${device}: ${(await stat(path)).size}B`);
    } catch (e) { console.log(`SKIP ${name}/${device}: ${String(e.message).split('\n')[0]}`); }
    finally { await page.close(); await ctx.close(); }
  }
}
console.log('DONE ' + variant + ' errors=' + JSON.stringify(errors.slice(0, 5)));
await browser.close();
