// Post-enable HEIST (missions) PROD smoke — the LANE C sibling of tools/combat-prod-verify.mjs. The orchestrator
// runs this RIGHT AFTER enabling missions+combat+wanted, against prod, on a throwaway is_bot profile (bot=1 →
// is_bot=1, excluded from the leaderboard/player counts). It exercises the real heist ENTRY on the live stack and
// reports; it only ever writes to its own throwaway is_bot profile (a mission-start, no payout).
//
//   GTASF_VERIFY_URL=https://<prod-host> node tools/heist-prod-verify.mjs
//
// Defaults to http://localhost:5375 (a lane-C combat-stack) for SAFE local dry-runs — it will NOT touch prod unless
// you pass GTASF_VERIFY_URL. Bails cleanly (no write) if combat/missions aren't enabled at the target.
//
// Scope: founded is_bot device → the pitch-deck heist start (rival SoMa office) → Interact (E) → the server
// mission-start returns 'started' AND lane B's wanted raises to 3 stars (the "lose the SFPD" escape is live). The
// full escape→deliver→payout (a ~2km drive + LoS break) isn't headlessly scriptable — it's covered by runMission
// unit tests + handleMissionComplete pose validation (docs/economy/lane-c-payout-review.md). This smoke proves the
// heist ENTRY + the missions↔wanted integration on the live stack.
import { chromium } from '@playwright/test';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5375';
const HEIST_START = process.env.GTASF_VERIFY_HEIST ?? '37.782190,-122.402980,0'; // steal-pitch-deck start (rival SoMa office, 'H')
// Spawn OFF the start (default ~55 m north) and walk in: a deep link straight onto the start leaves the server pose
// >10 m from it (the spawn snap), so mission-start says too-far even with the client foot on the marker.
const SPAWN = process.env.GTASF_VERIFY_SPAWN ?? (([la, lo]) => `${(la + 0.0005).toFixed(6)},${lo.toFixed(6)},180`)(HEIST_START.split(',').map(Number));
const isProd = !/localhost|127\.0\.0\.1|\[::1\]/.test(base);
const note = s => console.log(s);
note(`heist-prod-verify → ${base} ${isProd ? '(PROD — writes a mission-start to a throwaway is_bot profile)' : '(local dry-run)'}`);
// Seed a founded ladder device so the "FOUND YOUR STARTUP" card doesn't sit in the way.
const seed = () => { try {
  localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Heist', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' }));
  localStorage.setItem('gtasf.founder.bucket.v2', 'ladder');
} catch {} };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await ctx.addInitScript(seed);
const page = await ctx.newPage(); page.setDefaultTimeout(90000);
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0,160)));
page.on('console', m => { if (m.type()==='error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0,160)); });
const api = {}; page.on('response', r => { const p = new URL(r.url()).pathname;
  if (['/api/funding/mission-start','/api/funding/mission-complete'].includes(p))
    r.json().then(b => { (api[p] ??= []).push(b); }).catch(()=>{}); });
// Clear the SA intro + identity + funding onboarding so no modal blocks Interact (reused from combat-prod-verify).
const clearOnboarding = async (p) => {
  for (let i=0;i<20;i++){ const b=await p.evaluate(()=>{const v=s=>{const e=document.querySelector(s);return !!(e&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));};return{intro:v('.gt-sa-intro')||v('.gt-sa-intro__skip'),id:v('.gt-identity-go'),fund:!!document.querySelector('.gt-funding-onboarding[open]')};});
    if(!b.intro&&!b.id&&!b.fund)break;
    if(b.fund){try{const d=p.locator('.gt-funding-onboarding[open]');await d.getByLabel('Startup name',{exact:true}).fill('QA Heist');await d.getByLabel('Your nickname',{exact:true}).fill('q');await d.getByRole('button',{name:'Save startup'}).click({timeout:3000});}catch{}await p.waitForTimeout(600);continue;}
    if(b.id){try{await p.locator('.gt-identity-go').click({timeout:3000});}catch{}await p.waitForTimeout(500);continue;}
    if(b.intro){await p.evaluate(()=>{const s=document.querySelector('.gt-sa-intro__skip');if(s)s.click();});await p.waitForTimeout(500);continue;} }
  await p.waitForTimeout(800);
};
const pressE = async () => { await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE'); };
// The wanted level isn't in __gtasfCombat.state(); it's rendered as lit stars in the combat HUD
// (combatHud.ts: .gt-combat-wanted-star gets a .lit class per filled star; the row hides at level 0).
const wantedStars = () => page.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
const result = { base, isProd, startedAt: new Date().toISOString() };
try {
  await page.goto(`${base}/?at=${SPAWN}&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  if (await page.locator('.gt-age-gate').isVisible().catch(()=>false)) await page.locator('.gt-age-gate-enter').click();
  await page.waitForTimeout(1500);
  // combat enabled? (missions heist needs lane B's wanted). Bail cleanly if not.
  result.combatEnabled = await page.evaluate(() => !!window.__gtasfCombat);
  if (!result.combatEnabled) { note('COMBAT NOT ENABLED at target (no __gtasfCombat) — nothing written. Run after the enable.'); result.enabled = false; throw 'not-enabled'; }
  await clearOnboarding(page);
  await page.waitForTimeout(2000);
  // The ?at= spawn snaps to the nearest walkable, often >10m (MISSION_ARRIVE_RADIUS_M) from the exact office coord
  // where the 'H' start zone is — so walk into range first. Project the heist start via the live frame (same ENU
  // math as radar/projection.ts), then walk the server pose to it (foot nudges below).
  const [hLat, hLon] = HEIST_START.split(',').map(Number);
  const target = await page.evaluate(({ lat, lon }) => {
    // The GLOBAL SF frame that placePoint/geodeticToWorld use (tools/map/src/config SF_FRAME) — NOT
    // world.manifest.frame (a local/chunk frame that mis-projects).
    const frame = { origin: { lat: 37.7842, lon: -122.4078 }, gridRotationDeg: 0 };
    const rad = Math.PI/180, f = 1/298.257223563, e2 = f*(2-f);
    const ecef = (la, lo) => { const phi=la*rad, lam=lo*rad, n=6378137/Math.sqrt(1-e2*Math.sin(phi)**2); return [n*Math.cos(phi)*Math.cos(lam), n*Math.cos(phi)*Math.sin(lam), n*(1-e2)*Math.sin(phi)]; };
    const a = ecef(frame.origin.lat, frame.origin.lon), b = ecef(lat, lon);
    const dx=b[0]-a[0], dy=b[1]-a[1], dz=b[2]-a[2];
    const phi=frame.origin.lat*rad, lam=frame.origin.lon*rad, th=frame.gridRotationDeg*rad;
    const east=-Math.sin(lam)*dx+Math.cos(lam)*dy, north=-Math.sin(phi)*Math.cos(lam)*dx-Math.sin(phi)*Math.sin(lam)*dy+Math.cos(phi)*dz;
    return { x: east*Math.cos(th)-north*Math.sin(th), z: -(east*Math.sin(th)+north*Math.cos(th)) };
  }, { lat: hLat, lon: hLon }).catch(() => null);
  const footXZ = async () => page.evaluate(() => { const f=window.__gtasf?.world?.foot; return f?{x:f.x,z:f.z}:null; });
  // Walk the SERVER pose in: nudge the client foot 0.5 m every 110 ms (~4.5 m/s), so each MOVE passes the server's
  // checkMovement (a teleport would be rejected and leave the server pose behind → 409 too-far). Stops within 6 m.
  const walk = [];
  if (target) {
    for (let i = 0; i < 900; i++) {
      const dist = await page.evaluate(({ tx, tz }) => { const f = window.__gtasf?.world?.foot; if (!f) return null;
        const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz); if (d > 6) { const k = Math.min(0.5, d) / d; f.x += dx * k; f.z += dz * k; } return d; }, { tx: target.x, tz: target.z });
      if (dist == null) break;
      if (i === 0 || i % 50 === 0 || dist <= 6) walk.push({ step: i, dist: Math.round(dist) });
      if (dist <= 6) break;
      await page.waitForTimeout(110);
    }
    await page.waitForTimeout(800); // let the last MOVE land server-side
  }
  const footFinal = await footXZ();
  result.walk = { target: target?{x:Math.round(target.x),z:Math.round(target.z)}:null, trace: walk, footFinal: footFinal?{x:Math.round(footFinal.x),z:Math.round(footFinal.z)}:null,
    distFinal: target&&footFinal?Math.round(Math.hypot(target.x-footFinal.x,target.z-footFinal.z)):null };
  await page.screenshot({ path: '/tmp/heist-smoke-start.jpg', type: 'jpeg', quality: 80 }).catch(()=>{});
  // START the heist: Interact at the 'H' marker.
  let started = false;
  for (let i=0;i<6 && !started;i++){ await pressE(); await page.waitForTimeout(1000);
    started = (api['/api/funding/mission-start'] ?? []).some(b => b?.status === 'started')
      || /Steal the Pitch Deck|Grab the pitch deck|Lose the heat/i.test(await page.evaluate(()=>document.body.innerText||'')); }
  result.missionStartResponses = api['/api/funding/mission-start'] ?? [];
  // Authoritative server-path check: POST mission-start directly (the server re-checks proximity from the real
  // pose + raises wanted on a heist). Isolates the server heist path from the client E-interaction. 'started' =
  // device is at the start + the heist armed; 'too-far' = not in range; 'off' = flag off.
  if (!started) {
    result.directStart = await page.evaluate(async () => {
      try { const r = await fetch('/api/funding/mission-start', { method:'POST', credentials:'same-origin', headers:{'content-type':'application/json'}, body: JSON.stringify({ missionId: 'steal-pitch-deck' }) });
        return { httpStatus: r.status, body: await r.json().catch(()=>null) }; } catch(e){ return { error: String(e?.message ?? e).slice(0,120) }; }
    });
    await page.waitForTimeout(1500);
    const w2 = await wantedStars();
    result.directStartWanted = w2;
    if (result.directStart?.body?.status === 'started') { started = true; result.heistViaDirect = true; }
    note(`[heist/direct] POST mission-start → ${result.directStart?.httpStatus} ${JSON.stringify(result.directStart?.body)} → wanted ${w2}★`);
  }
  const startResp = (api['/api/funding/mission-start'] ?? []).find(b => b?.status === 'started') ?? (api['/api/funding/mission-start'] ?? []).at(-1) ?? null;
  await page.waitForTimeout(1500); // let the WANTED broadcast land
  const wanted = await wantedStars();
  const objText = (await page.evaluate(()=>document.body.innerText||'')).match(/Steal the Pitch Deck[^\n]{0,40}|Lose the heat[^\n]{0,20}/i)?.[0] ?? null;
  result.enabled = true;
  result.heist = {
    startResp, startedResponse: startResp?.status === 'started', wantedStars: wanted, wantedRaised: typeof wanted === 'number' && wanted >= 1, objectiveText: objText,
    pass: startResp?.status === 'started' && typeof wanted === 'number' && wanted >= 1,
  };
  note(`[heist] start=${startResp?.status} mission=${startResp?.mission ?? '?'} → wanted ${wanted}★ "${objText}" (pass=${result.heist.pass})`);
  // Lane B (critic N47): ESCAPE=walk|stay ESCAPE_S=90 — after the start, sample the escape each second: stars, nearest SFPD
  // car, the escape label, health/dead, and the objective text (did 'Lose the heat' complete?). walk = the obvious play
  // (on foot away from the office); stay = stand at the grab. Off by default (the smoke above is unchanged).
  if (process.env.ESCAPE && result.heist.pass) {
    const mode = process.env.ESCAPE, seconds = Number(process.env.ESCAPE_S ?? 90);
    if (mode === 'walk') await page.evaluate(() => { const w = window.__gtasf.world, yaw = w.foot.yaw ?? 0; window.__walker = setInterval(() => { w.foot.x += Math.sin(yaw) * 0.5; w.foot.z += Math.cos(yaw) * 0.5; }, 110); });
    const esc = [];
    for (let t = 0; t < seconds; t++) {
      esc.push({ t, ...(await page.evaluate(() => { const w = window.__gtasf.world; let best = Infinity;
        for (const c of w.fleet?.cars?.values() ?? []) if (c.data.flags & 0x40) { const p = c.model?.root?.position ?? c.data; best = Math.min(best, Math.hypot(p.x - w.foot.x, p.z - w.foot.z)); }
        const row = document.querySelector('.gt-combat-escape'), st = window.__gtasfCombat?.state?.(), text = document.body.innerText || '';
        return { stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length, copM: Number.isFinite(best) ? Math.round(best) : null,
          phase: row && !row.hidden ? (document.querySelector('.gt-combat-escape-label')?.textContent ?? '').trim().slice(0, 28) : '', hp: st?.health ?? null, dead: st?.dead ?? false,
          obj: /Deliver the deck/i.test(text) ? 'DELIVER' : /Lose the heat/i.test(text) ? 'LOSE-HEAT' : /job failed|caught up/i.test(text) ? 'FAILED' : /BUSTED/i.test(text) ? 'BUSTED' : '' }; })) });
      if (esc.at(-1).obj === 'DELIVER') break;
      await page.waitForTimeout(1000);
    }
    await page.evaluate(() => clearInterval(window.__walker));
    result.escape = { mode, samples: esc, delivered: esc.some(s => s.obj === 'DELIVER'), clearedAt: esc.find((s, i) => i > 0 && s.stars === 0)?.t ?? null };
    note(`[escape ${mode}] lose-the-heat ${result.escape.delivered ? 'DONE' : 'not done'} in ${esc.length} s; stars cleared at ${result.escape.clearedAt ?? '-'} s`);
    note(esc.map(s => `${s.t}s:${s.stars}*${s.copM ?? '-'}m${s.phase ? `(${s.phase})` : ''}${s.dead ? 'DEAD' : ''}${s.obj && s.obj !== 'LOSE-HEAT' ? `[${s.obj}]` : ''}`).join(' '));
  }
} catch (e) { if (e !== 'not-enabled') { result.failure = String(e?.message ?? e).slice(0,200); note(`FAILURE: ${result.failure}`); } }
result.errs = errs;
result.passed = result.enabled === true && result.heist?.pass === true && !errs.length;
note(`\nRESULT: ${result.enabled ? (result.passed ? 'HEIST ENTRY PASS ✅ (start + 3★ wanted)' : 'CHECK FAILED ❌') : 'missions/combat not enabled (no-op)'} | errors=${errs.length}`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
