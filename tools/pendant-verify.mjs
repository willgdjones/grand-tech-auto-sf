// AI-pendant founder (meme DRIVE NPC, flag pendantQuest) look + start smoke. Local stack with memeQuests +
// founderLadder + driveQuest on. Desktop + Pixel 7: the NPC renders (rigged avatar + label, no cone); desktop: walk up
// → E → server drive-start 'started' and the HUD shows "PENDANT JOYRIDE". (The 300 m drive itself is covered by the
// generic drive-quest unit tests — a headless drive isn't scriptable.)
//
//   GTASF_VERIFY_URL=http://localhost:5319 node tools/pendant-verify.mjs
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/founder-ladder/pendant'; mkdirSync(out, { recursive: true });
const SPAWN = '37.797500,-122.394950,315'; // Embarcadero, just south-east of the pendant founder
const NAME = 'Founder-ladder meme NPC: ai-pendant-founder';
const result = { base, at: new Date().toISOString() };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const seed = () => { try {
  localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Pendant', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' }));
  localStorage.setItem('gtasf.founder.bucket.v2', 'ladder');
} catch {} };
async function clearOnboarding(p) {
  for (let i = 0; i < 20; i++) { const b = await p.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); }; return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = p.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA Pendant'); await d.getByLabel('Your nickname', { exact: true }).fill('q'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} await p.waitForTimeout(600); continue; }
    if (b.id) { try { await p.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} await p.waitForTimeout(500); continue; }
    if (b.intro) { await p.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click()); await p.waitForTimeout(500); continue; } }
  await p.waitForTimeout(800);
}
async function open(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts); await ctx.addInitScript(seed);
  const page = await ctx.newPage(); page.setDefaultTimeout(90000);
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
  await page.goto(`${base}/?at=${SPAWN}&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
  await clearOnboarding(page);
  await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 180000 }).catch(() => {});
  await clearOnboarding(page);
  // The NPC mounts async (chunk + avatar); wait until it is in the scene and visible.
  await page.waitForFunction(n => { const o = window.__gtasf.world.landmarks.getObjectByName(n); return !!o && o.visible; }, NAME, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return { ctx, page, errs };
}
const npcPos = page => page.evaluate(n => { const o = window.__gtasf.world.landmarks.getObjectByName(n); if (!o) return null; const v = o.getWorldPosition(o.position.clone()); return { x: v.x, z: v.z, visible: o.visible }; }, NAME);
try {
  const desk = await open({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  result.npc = await npcPos(desk.page);
  await desk.page.screenshot({ path: `${out}/pendant-desktop.jpg`, type: 'jpeg', quality: 80 });
  if (result.npc) {
    for (let i = 0; i < 500; i++) {
      const d = await desk.page.evaluate(({ tx, tz }) => { const f = window.__gtasf.world.foot; const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
        if (d > 2.5) { const k = Math.min(0.5, d - 2.4) / d; f.x += dx * k; f.z += dz * k; } return d; }, { tx: result.npc.x, tz: result.npc.z });
      if (d <= 2.6) break; await desk.page.waitForTimeout(110);
    }
    await desk.page.waitForTimeout(800);
    // Face the NPC (camera behind the player, looking at the NPC) for a close look shot.
    await desk.page.evaluate(({ tx, tz }) => { const w = window.__gtasf.world, f = w.foot; const yaw = Math.atan2(tx - f.x, tz - f.z); try { w.camera.recenter?.(yaw); if ('yaw' in w.camera) w.camera.yaw = yaw; } catch {} }, { tx: result.npc.x, tz: result.npc.z });
    await desk.page.waitForTimeout(1200);
    await desk.page.screenshot({ path: `${out}/pendant-close-desktop.jpg`, type: 'jpeg', quality: 80 });
    result.prompt = await desk.page.evaluate(() => document.body.innerText.match(/E · [^\n]{0,40}/)?.[0] ?? null);
    const started = desk.page.waitForResponse(r => new URL(r.url()).pathname === '/api/funding/drive-start', { timeout: 15000 }).then(r => r.json()).catch(() => null);
    await desk.page.keyboard.down('KeyE'); await desk.page.waitForTimeout(90); await desk.page.keyboard.up('KeyE');
    result.start = await started;
    await desk.page.waitForTimeout(1200);
    result.hud = await desk.page.evaluate(() => document.querySelector('.gt-drive-quest-line')?.textContent ?? null);
    result.cone = await desk.page.evaluate(() => !!window.__gtasf.world.landmarks.getObjectByName('founder-drive-cone'));
    await desk.page.screenshot({ path: `${out}/pendant-started-desktop.jpg`, type: 'jpeg', quality: 80 });
  }
  result.desktopErrors = desk.errs; await desk.ctx.close();
  const phone = await open({ ...devices['Pixel 7'] });
  result.npcPhone = await npcPos(phone.page);
  if (result.npcPhone) { // walk to ~5 m and face it (the spawn view has a lawn tree in the sightline)
    for (let i = 0; i < 500; i++) {
      const d = await phone.page.evaluate(({ tx, tz }) => { const f = window.__gtasf.world.foot; const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
        if (d > 5) { const k = Math.min(0.5, d - 4.9) / d; f.x += dx * k; f.z += dz * k; } return d; }, { tx: result.npcPhone.x, tz: result.npcPhone.z });
      if (d <= 5.1) break; await phone.page.waitForTimeout(110);
    }
    await phone.page.evaluate(({ tx, tz }) => { const w = window.__gtasf.world, f = w.foot; const yaw = Math.atan2(tx - f.x, tz - f.z); try { w.camera.recenter?.(yaw); if ('yaw' in w.camera) w.camera.yaw = yaw; } catch {} }, { tx: result.npcPhone.x, tz: result.npcPhone.z });
    await phone.page.waitForTimeout(1500);
  }
  await phone.page.screenshot({ path: `${out}/pendant-phone.jpg`, type: 'jpeg', quality: 80 });
  result.phoneErrors = phone.errs; await phone.ctx.close();
} catch (e) { result.failure = String(e?.message ?? e).slice(0, 300); }
result.checks = {
  rendersDesktop: result.npc?.visible === true, rendersPhone: result.npcPhone?.visible === true,
  promptWording: /Wear the pendant/.test(result.prompt ?? ''),
  started: result.start?.status === 'started',
  hudWording: /PENDANT JOYRIDE/.test(result.hud ?? ''),
  noConsoleErrors: ![...(result.desktopErrors ?? []), ...(result.phoneErrors ?? [])].length,
};
result.passed = Object.values(result.checks).every(Boolean);
console.log(JSON.stringify(result, null, 2));
console.log(`\nRESULT: ${result.passed ? 'PENDANT PASS ✅' : 'CHECK FAILED ❌'} ${JSON.stringify(result.checks)}`);
await browser.close();
