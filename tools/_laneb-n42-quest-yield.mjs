// Lane B (critic N42): headless check of the questYieldsToPayout rule in hudFocus.css: the founder quest card hides while a
// payout card (.gt-funding-toast) shows and comes back after; without the flag class both draw.  node tools/_laneb-n42-quest-yield.mjs
import { chromium } from '@playwright/test'; import { readFileSync } from 'node:fs';
const css = readFileSync('web/src/hud/hudFocus.css', 'utf8');
const b = await chromium.launch({ headless: true }); const p = await b.newPage();
const vis = () => p.evaluate(() => getComputedStyle(document.querySelector('.gt-founder-quest')).visibility);
for (const cls of ['gt-hud-focus gt-quest-yields', 'gt-hud-focus']) {
  await p.setContent(`<style>${css}</style><body class="${cls}"><section class="gt-founder-quest">PITCH NOW</section><section class="gt-funding-toast" hidden>STORE ROBBED</section></body>`);
  const before = await vis(); await p.evaluate(() => { document.querySelector('.gt-funding-toast').hidden = false; });
  const during = await vis(); await p.evaluate(() => { document.querySelector('.gt-funding-toast').hidden = true; });
  console.log(`${cls.includes('yields') ? 'flag on ' : 'flag off'}: before=${before} during=${during} after=${await vis()}`);
}
await b.close();
