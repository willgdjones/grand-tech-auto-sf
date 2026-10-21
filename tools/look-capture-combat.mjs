// Lane B (combat & police) look evidence: 18+ gate, health/armour HUD, WASTED/BUSTED, weapon wheel + firing.
// Runs against the shared :5173 dev server with flags.combat + flags.weapons flipped true (reverted after). Headless.
//   node tools/look-capture-combat.mjs
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
const PHONE = { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };
const URL = `${base}/?preset=low&time=golden&touch=1&bot=1`;

async function dismissOnboarding(page) {
  try { const s = page.locator('.gt-sa-intro__skip'); if (await s.isVisible({ timeout: 800 })) await s.click(); } catch {}
  try { const g = page.locator('.gt-identity-go'); await g.waitFor({ state: 'visible', timeout: 1200 }); await g.click({ timeout: 6000 }); } catch {}
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('Combat'); await d.getByLabel('Your nickname', { exact: true }).fill('C'); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
}
async function shot(page, name) { const p = `${out}/${name}.jpg`; await page.screenshot({ path: p, type: 'jpeg', quality: 90 }); console.log(`OK ${name}: ${(await stat(p)).size}B`); }

async function run(label, device) {
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage(); page.setDefaultTimeout(90_000);
  page.on('pageerror', e => errors.push(`${label}: ${String(e.message)}`));
  try {
    await page.goto(URL);
    await page.locator('.gt-age-gate').waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(400); await shot(page, `gate-${label}`);
    await page.locator('.gt-age-gate-enter').click();
    try { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 60_000 }); } catch {}
    await dismissOnboarding(page);
    await page.locator('.gt-combat-hud').waitFor({ state: 'visible', timeout: 20_000 });
    await page.evaluate(() => window.__gtasfCombat?.addArmour(60));
    await page.waitForTimeout(2500); await shot(page, `hud-${label}`);

    // Weapon wheel.
    await page.evaluate(() => window.__gtasfCombat?.openWheel());
    await page.locator('.gt-weapon-wheel').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400); await shot(page, `wheel-${label}`);
    await page.keyboard.press('Escape');

    // Firing: give + select the SMG (automatic), hold the trigger, screenshot mid-burst (tracer + crosshair + flash).
    await page.evaluate(() => { window.__gtasfCombat?.giveWeapon('smg'); window.__gtasfCombat?.selectWeapon('smg'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__gtasfCombat?.fire());
    await page.waitForTimeout(120); // within the SMG cadence / tracer life
    await shot(page, `firing-${label}`);
    await page.evaluate(() => window.__gtasfCombat?.fireStop());

    // WASTED / BUSTED.
    await page.evaluate(() => window.__gtasfCombat?.kill('wasted'));
    await page.waitForTimeout(1600); await shot(page, `wasted-${label}`);
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__gtasfCombat?.kill('busted'));
    await page.waitForTimeout(1600); await shot(page, `busted-${label}`);
  } catch (e) { console.log(`SKIP ${label}: ${String(e.message).split('\n')[0]}`); }
  finally { await ctx.close(); }
}

await run('phone', PHONE);
await run('desktop', DESKTOP);
console.log('DONE errors=' + JSON.stringify(errors.slice(0, 8)));
await browser.close();
