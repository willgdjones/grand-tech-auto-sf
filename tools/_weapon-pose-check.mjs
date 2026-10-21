// Lane D: in-game check for weaponPoses (critic #7) on a flags-ON combat stack (tools/combat-stack.sh with COMBAT_FLAGS
// including weapons + weaponPoses). Enters combat (18+ gate), then for each weapon: equip, fire a short burst, and
// screenshot inside the 1.5 s aim window from a three-quarter rear camera, plus one lowered (not firing) frame.
//   GTASF_COMBAT_URL=http://localhost:5391 [PHONE=1] OUT=docs/sf-data/weapon-poses node tools/_weapon-pose-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5391';
const out = process.env.OUT ?? 'docs/sf-data/weapon-poses';
const SPAWN = process.env.AT ?? '37.7955,-122.3937'; // open Ferry plaza (no trees between camera and player)
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const WEAPONS = (process.env.WEAPONS ?? 'pistol,smg,rifle,bat').split(',');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));
async function clearOnboarding() {
  for (let i = 0; i < 20; i++) {
    const b = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
      return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = page.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('q'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} }
    else if (b.id) { try { await page.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} }
    else await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    await page.waitForTimeout(500);
  }
}
const shots = [];
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=${PHONE ? 'low' : 'hd'}&bot=1&time=${process.env.TIME ?? 'noon'}`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120_000 });
  await clearOnboarding();
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(1000);
  await clearOnboarding();
  for (const weapon of WEAPONS) {
    await page.evaluate(w => { window.__gtasfCombat.giveWeapon(w); window.__gtasfCombat.selectWeapon(w); }, weapon);
    // Three-quarter rear camera, a little to the right: the arms, the weapon and the aim line are all in frame.
    // Leave the chase camera alone (forcing setOrbit fought its follow logic and framed the player off-screen); the
    // default spawn is the open Ferry plaza and aiming turns the body to the camera's forward, so this is the
    // over-the-shoulder view.
    await page.waitForTimeout(900);
    console.log('AVATAR ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world; let scene = [...w.fleet.cars.values()][0]?.model.root ?? w.streetWalkers?.root; while (scene?.parent) scene = scene.parent;
      const found = []; scene?.traverse(o => { if (o.name === 'on-foot-avatar' && !/Street walker|Crowd/.test(o.parent?.name ?? '')) { const wp = o.getWorldPosition(o.position.clone());
        let meshes = 0, visibleMeshes = 0, minOpacity = 1; o.traverse(m => { if (m.isMesh) { meshes++; let v = true; for (let q = m; q; q = q.parent) if (!q.visible) v = false; if (v) visibleMeshes++; const mats = Array.isArray(m.material) ? m.material : [m.material]; for (const mt of mats) minOpacity = Math.min(minOpacity, mt.opacity ?? 1); } });
        found.push({ dist: +Math.hypot(wp.x - w.foot.x, wp.z - w.foot.z).toFixed(1), parent: o.parent?.name || o.parent?.type, visible: o.visible, children: o.children.map(c => c.name || c.type).slice(0, 8), meshes, visibleMeshes, minOpacity, scale: o.scale.x, y: +o.position.y.toFixed(2), footY: +w.foot.y.toFixed(2) }); } });
      const c = w.camera.camera, v = c.position.clone().set(w.feet.x, w.feet.y + 1, w.feet.z).project(c);
      found.push({ screen: { x: +((v.x + 1) / 2).toFixed(2), y: +((1 - v.y) / 2).toFixed(2), z: +v.z.toFixed(3) }, near: c.near, far: c.far, layers: c.layers.mask });
      let fig = null; scene.traverse(o => { if (o.name === 'on-foot-avatar' && !/Street walker|Crowd/.test(o.parent?.name ?? '')) o.traverse(m => { if (m.isSkinnedMesh && !fig) fig = { frustumCulled: m.frustumCulled, layers: m.layers.mask, radius: m.geometry.boundingSphere?.radius ?? null, scale: m.getWorldScale(m.position.clone()).toArray().map(n => +n.toFixed(3)), matVisible: (Array.isArray(m.material) ? m.material : [m.material]).map(q => q.visible) }; }); });
      found.push({ fig });
      scene.traverse(o => { if (o.name === 'Held weapon') { const hp = o.getWorldPosition(o.position.clone()); let wr = null, names = [];
        o.parent?.traverse(b => { if (b.isBone && names.length < 60) names.push(b.name); if (!wr && /^Wrist\.?R$/.test(b.name)) wr = b.getWorldPosition(b.position.clone()); });
        found.push({ inputs: o.parent?.userData?.heldWeapon ?? null, holder: { visible: o.visible, kids: o.children.length, child: o.children[0]?.name, pos: hp.toArray().map(n => +n.toFixed(2)), toFeet: +Math.hypot(hp.x - w.feet.x, hp.z - w.feet.z).toFixed(2), dy: +(hp.y - w.feet.y).toFixed(2) },
          wrist: wr ? { toHolder: +wr.distanceTo(hp).toFixed(3) } : null, bones: names.filter(n => /Arm|Wrist|Hand/i.test(n)).slice(0, 12) }); } });
      return found; })));
    console.log('CAM ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world, c = w.camera, p = c.camera.position;
      return { len: c.actualLength, opacity: c.avatarOpacity, mode: w.mode, foot: { x: +w.foot.x.toFixed(1), z: +w.foot.z.toFixed(1) }, cam: { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) }, d: +Math.hypot(p.x - w.foot.x, p.z - w.foot.z).toFixed(1) }; })));
    await page.screenshot({ path: `${out}/${weapon}-lowered-${tag}.jpg`, quality: 82, type: 'jpeg' }); shots.push(`${weapon}-lowered`);
    if (weapon !== 'bat') {
      // AIM_HOLD=1: hold the right mouse button on the canvas (lane B's aim-hold) so the shoulder boom fully engages before the shot.
      if (process.env.AIM_HOLD === '1') { const vp = page.viewportSize(); await page.mouse.move(vp.width * .5, vp.height * .45); await page.mouse.down({ button: 'right' }); await page.waitForTimeout(1200); }
      await page.evaluate(() => { window.__gtasfCombat.fire(); setTimeout(() => window.__gtasfCombat.fireStop(), 250); });
      await page.waitForTimeout(450);
      if (process.env.AIM_HOLD === '1') console.log('AIMCAM ' + JSON.stringify(await page.evaluate(() => { const c = window.__gtasf.world.camera; return { len: +c.actualLength.toFixed(2), opacity: +c.avatarOpacity.toFixed(2) }; })));
      await page.screenshot({ path: `${out}/${weapon}-aim-${tag}.jpg`, quality: 82, type: 'jpeg' }); shots.push(`${weapon}-aim`);
      if (process.env.AIM_HOLD === '1') await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(1800);
    }
  }
  const state = await page.evaluate(() => window.__gtasfCombat.state());
  console.log('HARNESS ' + JSON.stringify(await page.evaluate(() => ({ status: window.__gtasf?.status, frame: window.__gtasf?.frame, errors: (window.__gtasf?.errors ?? []).slice(0, 4) }))));
  await writeFile(`${out}/weapon-pose-${tag}.json`, JSON.stringify({ base, tag, shots, state, errors }, null, 2) + '\n');
  console.log(`WEAPON_POSE ${tag} shots=${shots.length} errors=${errors.length} weapon=${state.weapon} started=${state.started}`);
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); }
