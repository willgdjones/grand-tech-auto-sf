// Founder look-check captures from current main (deployed to gtasf.com). Uses the smoke's launch
// flags (--use-angle=metal --enable-gpu) so the game renders past the loading screen. Deep-links to
// each landmark, dismisses the startup + What's-New modals, waits for READY + chunk load, screenshots.
// Resilient: one unreachable deep-link (outside map coverage) won't abort the rest.
// Run from repo root with the project's Node: node tools/look-capture.mjs
import { chromium } from '@playwright/test';
import { readFile, mkdir, stat } from 'node:fs/promises';

const base = process.env.GTASF_SMOKE_URL ?? 'https://gtasf.com';
const code = (await readFile(process.env.GTASF_INVITE_FILE ?? 'worker/.wrangler/production/invite-code.txt', 'utf8')).trim();
const out = 'artifacts/look';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
// One shared context keeps the invite cookie across shots (first load sets it). But each shot gets a
// FRESH PAGE: headless Chromium loses the WebGL context when a single page is reused across goto()s,
// which blanked every screenshot after the first (gtasf-9xxk). A new page per shot = a fresh GL context.
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
const blanks = [];

async function dismissModals(page) {
  // Onboarding intro slides (SA loading-screen overlay, flags.onboarding) → click Skip so the GAME is
  // captured, not the 3-slide intro. Its keydown handler is a capturing window listener, so without
  // this the move-key (W) advances the carousel instead of driving — every shot was the intro, not the
  // city (gtasf-9xxk follow-up). Guarded by isVisible, so it's a no-op when the flag is off.
  try {
    const skip = page.locator('.gt-sa-intro__skip');
    if (await skip.isVisible({ timeout: 1000 })) {
      await skip.click();
      await page.locator('.gt-sa-intro').waitFor({ state: 'hidden', timeout: 3000 });
    }
  } catch {}
  // Founder-ID dialog (hud/identity.ts: "Who are you?" — username/startup/look/archetype, random
  // defaults pre-filled and designed so you "just hit Looks good"). Click it to accept and reveal the
  // game; the button enables once the username validates (✓ READY). No-op when absent (gtasf-9xxk).
  try {
    const go = page.locator('.gt-identity-go');
    await go.waitFor({ state: 'visible', timeout: 1500 });
    await go.click({ timeout: 8000 }); // auto-waits for enabled (async username check)
    await page.locator('dialog.gt-identity').waitFor({ state: 'hidden', timeout: 4000 });
  } catch {}
  // Startup-name onboarding dialog (first visit) → fill + save so the game view shows.
  const dlg = page.locator('.gt-funding-onboarding[open]');
  try {
    if (await dlg.isVisible({ timeout: 800 })) {
      await dlg.getByLabel('Startup name', { exact: true }).fill('Look Check');
      await dlg.getByLabel('Your nickname', { exact: true }).fill('Founder');
      await dlg.getByRole('button', { name: 'Save startup' }).click();
      await dlg.waitFor({ state: 'hidden' });
    }
  } catch {}
  // "What's new" changelog panel (once per deploy for returning profiles) → LET'S GO.
  try {
    const go = page.getByRole('button', { name: /LET'S GO/i });
    if (await go.isVisible({ timeout: 800 })) { await go.click(); await page.waitForTimeout(400); }
  } catch {}
  // "Save your startup" recovery prompt (recovery/panel.ts) pops after a funding milestone — on the
  // event cluster shot the profile closes a round and it covers the scene → Close × (gtasf-9xxk).
  try {
    const close = page.locator('.gt-recovery-close');
    if (await close.isVisible({ timeout: 800 })) {
      await close.click();
      await page.locator('dialog.gt-recovery').waitFor({ state: 'hidden', timeout: 3000 });
    }
  } catch {}
}

async function shot(name, url, { move = false } = {}) {
  const page = await ctx.newPage(); // fresh page => fresh WebGL context (gtasf-9xxk fix)
  page.setDefaultTimeout(40_000);
  page.on('pageerror', e => errors.push(String(e.message).replaceAll(code, '[INVITE]')));
  try {
    // ?bot=1: automated visit, excluded from analytics and player counts (web/src/analytics/bot.ts).
    await page.goto(`${url}${String(url).includes('?') ? '&' : '?'}bot=1`);
    await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true');
    await dismissModals(page);
    await page.waitForTimeout(5000); // chunk stream + render
    await dismissModals(page); // in case the panel appeared after the wait
    if (move) { await page.keyboard.down('KeyW'); await page.waitForTimeout(900); await page.keyboard.up('KeyW'); await page.waitForTimeout(1200); }
    const path = `${out}/latest-${name}.png`;
    await page.screenshot({ path });
    // Guard: a WebGL-lost frame saves as a tiny (~4KB) blank PNG. Flag it so a blank set is never
    // published as a real founder preview (gtasf-9xxk).
    const bytes = (await stat(path)).size;
    if (bytes < 50_000) blanks.push(`${name} (${bytes}B)`);
    console.log(`OK ${name}: ${bytes}B events=${await page.evaluate(() => document.querySelector('#world')?.dataset.events)}`);
    return true;
  } catch (e) {
    console.log(`SKIP ${name}: ${String(e.message).split('\n')[0]}`);
    return false;
  } finally {
    await page.close(); // drop this page's GL context before the next shot
  }
}

// First load sets the invite cookie (shared on ctx); dismiss modals there.
await shot('ferry', `${base}/?invite=${code}&at=37.7955,-122.3937,270`);
await shot('event-ring', `${base}/?at=37.796099,-122.392017,0`); // "Who Hosts the Hosts?" by the Ferry — 66ct event-marker-kind colours
await shot('columbus', `${base}/?at=37.8003,-122.4090,180`);
await shot('lombard', `${base}/go/lombard`);
await shot('coit-telegraph-hill', `${base}/?at=37.8024,-122.4058,230`);
await shot('hud-radar', `${base}/?at=37.7955,-122.3937,270`, { move: true });

if (blanks.length) console.log('BLANK_SHOTS=' + JSON.stringify(blanks));
console.log('SHOTS_DONE errors=' + JSON.stringify(errors.slice(0, 5)));
await browser.close();
process.exitCode = blanks.length ? 1 : 0; // non-zero if any shot blanked, so a broken set isn't published
