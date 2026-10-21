// Lane B: headless check of Game Options → Mature content (decline → re-enable via Options → accept → gore toggle).
// Works pre/post the deferred-gate deploy. Run: URL=https://gtasf.com OUT=<dir> node tools/_mature-options-check.mjs (bot=1 device).
import { chromium } from '@playwright/test';
const base = process.env.URL ?? 'https://gtasf.com';
const out = process.env.OUT;
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const p = await ctx.newPage(); p.setDefaultTimeout(60000);
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 140)));
const r = {};
await p.goto(`${base}/?at=37.795799,-122.394805,0&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
await p.waitForTimeout(1500);
const vis = s => p.evaluate(s => { const e = document.querySelector(s); return !!(e && !e.hidden && e.checkVisibility?.()); }, s);
r.gateOnLoad = await vis('.gt-age-gate');
const sec = () => p.evaluate(() => { const s = document.querySelector('.gt-game-options-combat'); if (!s) return null;
  return [...s.querySelectorAll('button')].map(x => ({ t: x.textContent, hidden: x.hidden })); });
r.sectionInitial = await sec();
// If the gate is up on load (pre-deferral build), decline there; else request combat then decline.
if (!r.gateOnLoad) await p.evaluate(() => window.__gtasfCombat?.requestCombat?.());
await p.locator('.gt-age-gate-leave').click({ timeout: 8000 });
await p.waitForTimeout(600);
r.afterDecline = { started: await p.evaluate(() => window.__gtasfCombat?.state?.().started ?? null), section: await sec() };
// Open Game options, click Enable
await p.evaluate(() => document.querySelector('dialog.gt-game-options')?.showModal());
await p.waitForTimeout(300);
if (out) await p.screenshot({ path: `${out}/options-declined.png` });
await p.locator('.gt-game-options-combat button', { hasText: 'Enable mature content' }).click();
await p.waitForTimeout(500);
r.gateAfterEnable = await vis('.gt-age-gate');
r.dialogOpenAfterEnable = await p.evaluate(() => document.querySelector('dialog.gt-game-options')?.open);
await p.locator('.gt-age-gate-enter').click();
await p.waitForTimeout(800);
r.afterAccept = { started: await p.evaluate(() => window.__gtasfCombat?.state?.().started ?? null), section: await sec() };
await p.evaluate(() => document.querySelector('dialog.gt-game-options')?.showModal());
const gore = p.locator('.gt-game-options-combat button', { hasText: 'Blood & gore' });
r.goreBefore = await gore.textContent();
await gore.click(); await p.waitForTimeout(200);
r.goreAfter = await gore.textContent();
if (out) await p.screenshot({ path: `${out}/options-accepted.png` });
await gore.click(); // restore
r.errors = errs;
console.log(JSON.stringify(r, null, 1));
await b.close();
