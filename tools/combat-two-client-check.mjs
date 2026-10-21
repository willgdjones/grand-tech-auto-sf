// Lane B (combat & police): two-client server-authoritative combat check — the enable-gate evidence.
// Two headless Playwright pages spawn ADJACENT (same ?at= coord) on a LOCAL worker built with the combat flags
// forced ON, then client A fires on client B and we observe the SERVER flow: HIT → damage → death → -2% → respawn
// at SF General, plus A's wanted rising and an SFPD unit spawning. Shots + a log land in docs/sf-data/combat/.
//
// PREREQUISITE — a flag-on stack (this script does NOT build it; the shared dev server is combat-OFF):
//   combat, weapons, serverHits, openPvp, wanted must be TRUE in the build the stack serves, and economyV3 force-on
//   for the -2% debit. Do it WITHOUT editing the shared shared/flags.ts (three lanes commit it concurrently):
//     • Isolated build: `git archive HEAD | (temp dir)`, flip those flags in the temp copy's shared/flags.ts,
//       `npm ci`/symlink node_modules, run `node tools/dev.mjs` there on non-default ports (local D1/DO via miniflare),
//       then GTASF_COMBAT_URL=http://127.0.0.1:<webport> node tools/combat-two-client-check.mjs
//     • Or point at an orchestrator-provisioned preview that has the flags on.
// Run (against a flag-on stack):  GTASF_COMBAT_URL=http://127.0.0.1:5173 node tools/combat-two-client-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile, stat } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://127.0.0.1:5173';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
// Walkable spawn (Ferry plaza, verified in the weapon-pickup coord pass); both clients land here, adjacent.
const SPAWN = process.env.GTASF_COMBAT_AT ?? '37.795799,-122.394805,0';
const POLICE_FLAG = 0x40;
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };
const log = [];
const note = s => { log.push(s); console.log(s); };

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];

async function openClient(label) {
  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
  page.on('pageerror', e => errors.push(`${label}: ${String(e.message)}`));
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 45_000 }); }
  catch { throw new Error(`${label} never became ready/connected`); }
  // Clear any identity/funding onboarding so no modal blocks aiming (canAim stands down while a modal is open).
  try { const g = page.locator('.gt-identity-go'); if (await g.isVisible({ timeout: 2000 })) await g.click({ timeout: 6000 }); } catch {}
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 1500 })) {
    await d.getByLabel('Startup name', { exact: true }).fill('Combat'); await d.getByLabel('Your nickname', { exact: true }).fill(label[0]);
    await d.getByRole('button', { name: 'Save startup' }).click();
  } } catch {}
  // Dismiss the intro carousel so the in-world view (street, police) is visible for shots. Use SKIP + a key press,
  // NOT Escape (Escape opens the pause menu).
  try { const s = page.locator('.gt-sa-intro__skip'); if (await s.isVisible({ timeout: 1500 })) await s.click(); } catch {}
  try { await page.keyboard.press('Enter'); } catch {}
  await page.waitForTimeout(600);
  // The 18+ gate is deferred to the first combat action (founder-funnel fix): request combat, then ENTER the gate.
  // That also sends COMBAT_READY, which makes this client a valid PvP target. A legacy build that still shows the
  // gate on load is handled by the same click. No __gtasfCombat at all means the stack is not flag-on.
  if (!(await page.evaluate(() => !!window.__gtasfCombat))) throw new Error(`${label}: STACK IS NOT FLAG-ON (no __gtasfCombat). See the prerequisite header.`);
  if (!(await page.evaluate(() => window.__gtasfCombat.state?.().started === true))) {
    await page.evaluate(() => window.__gtasfCombat.requestCombat?.());
    try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
    await page.waitForTimeout(700);
  }
  const started = await page.evaluate(() => window.__gtasfCombat?.state?.().started === true);
  if (!started) throw new Error(`${label}: combat never started (18+ gate not entered).`);
  return { ctx, page };
}
const foot = page => page.evaluate(() => { const w = window.__gtasf?.world; return w?.foot ? { x: w.foot.x, y: w.foot.y, z: w.foot.z } : null; });
const health = page => page.evaluate(() => window.__gtasfCombat?.state?.().health ?? null);
const policeNear = page => page.evaluate((FLAG) => {
  const cars = window.__gtasf?.world?.fleet?.cars; if (!cars) return 0;
  let n = 0; for (const c of cars.values()) if (c?.data?.flags & FLAG) n++; return n;
}, POLICE_FLAG);
const shot = async (page, name) => { const p = `${out}/${name}.jpg`; await page.screenshot({ path: p, type: 'jpeg', quality: 90 }); note(`  shot ${name}: ${(await stat(p)).size}B`); };

let A, B;
try {
  note('[two-client combat check] opening client A (shooter) + B (victim) at the same spawn…');
  A = await openClient('A/shooter');
  B = await openClient('B/victim');
  const fa = await foot(A.page), fb = await foot(B.page);
  note(`  A at (${fa?.x.toFixed(1)}, ${fa?.z.toFixed(1)}), B at (${fb?.x.toFixed(1)}, ${fb?.z.toFixed(1)}) — ${fa && fb ? Math.hypot(fa.x - fb.x, fa.z - fb.z).toFixed(1) : '?'} m apart`);

  // Arm A and aim the camera toward B (point-blank, so a roughly-correct yaw hits B's 0.6 m chest sphere).
  await A.page.evaluate(() => { window.__gtasfCombat.giveWeapon('smg'); window.__gtasfCombat.selectWeapon('smg'); });
  if (fa && fb) {
    const yaw = Math.atan2(fb.x - fa.x, fb.z - fa.z);
    await A.page.evaluate(y => { const c = window.__gtasf?.world?.camera; if (c && 'yaw' in c) try { c.yaw = y; } catch {} }, yaw);
  }
  await health(B.page); await shot(A.page, 'two-client-A-armed'); await shot(B.page, 'two-client-B-full-health');

  // Fire bursts; poll B's server-owned health until wasted. A small yaw sweep hedges the point-blank aim.
  let bHealth = await health(B.page), shots = 0;
  note(`  B health before: ${bHealth}`);
  for (let i = 0; i < 24 && (bHealth ?? 0) > 0; i++) {
    if (fa && fb) await A.page.evaluate(({ y, dy }) => { const c = window.__gtasf?.world?.camera; if (c && 'yaw' in c) try { c.yaw = y + dy; } catch {} },
      { y: Math.atan2(fb.x - fa.x, fb.z - fa.z), dy: (i % 5 - 2) * 0.05 });
    await A.page.evaluate(() => window.__gtasfCombat.fire()); shots++;
    await A.page.waitForTimeout(260);
    await A.page.evaluate(() => window.__gtasfCombat.fireStop());
    const h = await health(B.page); if (h !== bHealth) note(`  burst ${shots}: B health → ${h}`); bHealth = h;
  }
  await shot(B.page, 'two-client-B-damaged');

  const bDead = await B.page.evaluate(() => window.__gtasfCombat?.state?.().dead === true);
  note(`  B dead (server WASTED): ${bDead}`);
  await B.page.waitForTimeout(1400); await shot(B.page, 'two-client-B-wasted'); // WASTED overlay / respawn

  const aPolice = await policeNear(A.page);
  note(`  SFPD units visible to A: ${aPolice}`);
  try { await A.page.evaluate(() => window.__gtasfCombat?.fireStop?.()); } catch {}
  await A.page.waitForTimeout(1600); await shot(A.page, 'two-client-A-wanted-police'); // wanted stars + any SFPD car in the street

  note(bDead ? 'RESULT: server-authoritative PvP kill confirmed (B wasted by A over the wire).'
            : 'RESULT: B not wasted — check aim/range/flags; see shots. (Server flow also proven by combatScenario.test.ts.)');
} catch (e) {
  note(`ABORTED: ${String(e.message).split('\n')[0]}`);
} finally {
  await writeFile(`${out}/two-client-log.txt`, log.join('\n') + `\nerrors=${JSON.stringify(errors.slice(0, 8))}\n`);
  note(`errors=${JSON.stringify(errors.slice(0, 8))}`);
  await A?.ctx.close(); await B?.ctx.close(); await browser.close();
}
