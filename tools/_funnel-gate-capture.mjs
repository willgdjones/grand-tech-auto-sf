// Evidence for the founder-funnel fix (gtasf-funnel-gate): the 18+ gate is DEFERRED from load. Captures, per
// form factor, (A) on load — the founder ladder "Found your startup" flow is up with NO 18+ gate overlaying it,
// and (B) after the first combat action (__gtasfCombat.requestCombat(), the exact path a weapon pickup / gun shop
// / robbery / weapon-wheel key hits) — the 18+ gate now appears. Asserts the gate's absence on load and presence
// after the action, so the shots can't silently regress. Run against a combat-flags-ON stack (tools/combat-stack.sh).
//   GTASF_GATES_URL=http://localhost:5374 node tools/_funnel-gate-capture.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.GTASF_GATES_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
// Plain-URL default spawn (Ferry Building plaza) — the real new-player experience. Deliberately NOT ?at= a
// weapon-pickup/store coord: spawning on a combat trigger (e.g. the bat pickup at 37.795799,-122.394805) would
// correctly open the gate, which is what we want to show happens ON ACTION, not on load.
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const log = []; const note = s => { log.push(s); console.log(s); };
const gateVisible = p => p.evaluate(() => { const e = document.querySelector('.gt-age-gate'); return !!(e && e.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true })); });

async function capture(form, viewport, dsr) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsr });
  const p = await ctx.newPage(); p.setDefaultTimeout(90000);
  const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0,140)));
  await p.goto(`${base}/?bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  await p.waitForTimeout(1500);
  // (A) ON LOAD: founder flow up (the funding "Found your startup" onboarding), gate must be ABSENT.
  const loadGate = await gateVisible(p);
  const founderUp = await p.evaluate(() => !!document.querySelector('.gt-funding-onboarding[open], .gt-founder-hud, .gt-hud-money'));
  await p.screenshot({ path: `${out}/funnel-load-${form}.jpg`, type: 'jpeg', quality: 90 });
  note(`[${form}] on load: 18+ gate visible=${loadGate} (want false), founder flow present=${founderUp} (want true)`);
  // Clear onboarding so the gate renders cleanly, then fire the FIRST combat action.
  for (let i=0;i<16;i++){ const b=await p.evaluate(()=>{const v=s=>{const e=document.querySelector(s);return !!(e&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));};return{intro:v('.gt-sa-intro')||v('.gt-sa-intro__skip'),id:v('.gt-identity-go'),fund:!!document.querySelector('.gt-funding-onboarding[open]')};});
    if(!b.intro&&!b.id&&!b.fund)break;
    if(b.fund){try{const d=p.locator('.gt-funding-onboarding[open]');await d.getByLabel('Startup name',{exact:true}).fill('QA');await d.getByLabel('Your nickname',{exact:true}).fill('q');await d.getByRole('button',{name:'Save startup'}).click({timeout:3000});}catch{}await p.waitForTimeout(500);continue;}
    if(b.id){try{await p.locator('.gt-identity-go').click({timeout:3000});}catch{}await p.waitForTimeout(500);continue;}
    if(b.intro){await p.evaluate(()=>{const s=document.querySelector('.gt-sa-intro__skip');if(s)s.click();});await p.waitForTimeout(500);continue;} }
  await p.waitForTimeout(600);
  // (B) FIRST COMBAT ACTION: requestCombat is exactly what a weapon pickup/gun-shop/robbery/weapon-wheel hits.
  await p.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  let shown = false; try { await p.locator('.gt-age-gate').waitFor({ state: 'visible', timeout: 8000 }); shown = true; } catch {}
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/funnel-gate-on-action-${form}.jpg`, type: 'jpeg', quality: 90 });
  const btn = await p.evaluate(() => document.querySelector('.gt-age-gate-leave')?.textContent ?? null);
  note(`[${form}] after first combat action: 18+ gate visible=${shown} (want true), decline button="${btn}" errs=${errs.length}`);
  await ctx.close();
  return { form, loadGate, founderUp, actionGate: shown, declineBtn: btn, errs };
}

const results = [];
results.push(await capture('desktop', { width: 1280, height: 800 }, 2));
results.push(await capture('phone', { width: 1080, height: 2400 }, 2.75));
const pass = results.every(r => r.loadGate === false && r.founderUp && r.actionGate === true && r.declineBtn === 'Play without combat' && !r.errs.length);
note(`\nRESULT: ${pass ? 'PASS ✅ gate deferred (absent on load, present on first combat action), button renamed' : 'CHECK ❌'}`);
await writeFile(`${out}/funnel-gate-log.txt`, log.join('\n') + '\n');
await browser.close();
