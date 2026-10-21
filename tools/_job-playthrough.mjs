// Critic 10-19 22:2x (lane C night item): play "Find Your Co-founders" end to end on a PROD-FLAGS local stack and frame
// every beat on both profiles — giver -> start -> en route -> each recruit -> the return -> MISSION PASSED / payout.
//   stack: see the scratchpad job.sh recipe (combat-stack up, prepare.ts reviewed set applied to the snapshot, build)
//   tools/heavy.sh node tools/_job-playthrough.mjs        [ONLY=desktop|phone] [OUT=docs/sf-data/job-cofounders]
// Walks with the harness pose-nudge (~5.5 m/s, under the server's on-foot cap) in straight lines, so mid-route frames can
// sit inside buildings; the beat frames are taken standing at the road-snapped objective points.
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/job-cofounders'; mkdirSync(out, { recursive: true });
setTimeout(() => { console.log('RESULT: JOB PLAYTHROUGH FAILED (watchdog 40 min)'); process.exit(2); }, 40 * 60_000).unref();
// shared/founder/missions.ts 'cofounder-hunt'
const HOUSE = { lat: 37.785418, lon: -122.397022 };
const BEATS = [
  { id: 'rust', at: { lat: 37.781691, lon: -122.394117 } },
  { id: 'designer', at: process.env.CALTRAIN ? { lat: 37.776493, lon: -122.394309 } : { lat: 37.783355, lon: -122.399594 } }, // cofounderShortLoop (Moscone); CALTRAIN=1 for the old stop
  { id: 'staff-eng', at: { lat: 37.782761, lon: -122.401856 } },
  { id: 'return', at: HOUSE },
];
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = {};
for (const [tag, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { ...devices['Pixel 7'] }]].filter(([t]) => !process.env.ONLY || process.env.ONLY === t)) {
  const r = results[tag] = { notes: [], beats: [], api: [], toasts: [], errors: [] };
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => { try {
    localStorage.setItem('gtasf.opener.v1', 'skipped'); localStorage.setItem('gtasf.combat.age18.v1', 'ok');
    localStorage.setItem('gtasf.founder.bucket.v1', 'ladder');
    localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Cofounders', foundedAt: 1, billboardSeen: true }));
  } catch { /* storage blocked */ } });
  // Every toast / mission band text that appears, in order (frames miss transient ones).
  await ctx.addInitScript(() => { window.__gtSeen = []; const seen = new Set(); setInterval(() => {
    for (const el of document.querySelectorAll('.gt-toast, .gt-mission-band, .gt-mission-slab, .gt-mission-line')) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim(); const key = el.className + '|' + text;
      if (text && !el.hidden && !seen.has(key)) { seen.add(key); window.__gtSeen.push({ t: Math.round(performance.now()), cls: String(el.className).split(' ')[0], text: text.slice(0, 160) }); }
    } }, 200); });
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  page.on('pageerror', e => r.errors.push(e.message.slice(0, 140)));
  page.on('response', async res => { const u = res.url(); if (!/\/api\/funding\/mission-(start|complete)/.test(u)) return;
    r.api.push(`${u.split('/').pop()} ${res.status()} ${(await res.text().catch(() => '')).slice(0, 200)}`); });
  const shot = async name => { await page.screenshot({ path: `${out}/${name}-${tag}.jpg`, type: 'jpeg', quality: 78 }); return name; };
  const objective = () => page.evaluate(() => document.querySelector('.gt-mission-line')?.textContent?.replace(/\s+/g, ' ').trim() ?? null);
  // Point the chase camera at (x, z): foot.yaw is rewritten by the on-foot movement every frame, so steer with camera.look (the
  // mouse-look path; it holds 1.5 s) in small steps until the camera's yaw is behind the player on that bearing.
  const faceCamera = async (x, z) => { for (let i = 0; i < 24; i++) {
    const d = await page.evaluate(({ x, z }) => { const g = window.__gtasf.world, f = g.foot, cam = g.camera; if (!cam?.look) return 0;
      const want = Math.atan2(x - f.x, z - f.z) + Math.PI; let d = want - cam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > 0.06) cam.look(-d * 150, 0); return d; }, { x, z });
    if (Math.abs(d) <= 0.06) return true; await page.waitForTimeout(140); } return false; };
  // Follow the radar's road route like a player would (lane E's qa-prod-playtest routeWalk): aim past the nearest route
  // point. jobRouted = the JOB had already routed this objective (missionObjectiveRoute, critic N41) before any QA waypoint.
  const walkTo = async (p, stop, midShot, nearShot) => { let mid = false, near = false, start = null, jobRouted = null, routedAfterMs = null, still = 0, prev = null; const t0 = Date.now();
    for (let i = 0; i < 6000; i++) {
      const graceOver = Date.now() - t0 > 8000; // like lane E: give the job's own route 8 s before a QA waypoint
      const w = await page.evaluate(({ tx, tz, stop, graceOver }) => { const g = window.__gtasf.world, f = g.foot, d = Math.hypot(tx - f.x, tz - f.z);
        let pts = g.radar?.route?.points ?? [], end = pts.at(-1);
        const routed = pts.length > 1 && end && Math.hypot(end[0] - tx, end[2] - tz) < 45;
        const route0 = { n: pts.length, endD: end ? Math.round(Math.hypot(end[0] - tx, end[2] - tz)) : null, dest: g.radar?.destination?.title ?? g.radar?.destination?.id ?? null };
        if (!routed && !graceOver) return { d, routed, route0: { n: pts.length }, x: f.x, z: f.z, waiting: true };
        // Only when there's NO route at all: a route ending elsewhere means the job moved on to its next stop (the objective
        // advances at 20 m); re-routing ourselves there was the 'stale route' both harnesses reported (10-20 radar.qaLog).
        if (!routed && !pts.length && g.radar?.setDestination && !window.__qaWp?.[`${tx},${tz}`]) {
          (window.__qaWp ??= {})[`${tx},${tz}`] = true; g.radar.setDestination({ title: 'QA objective', x: tx, y: 0, z: tz });
          pts = g.radar.route?.points ?? []; end = pts.at(-1); }
        // Walk the route's points IN ORDER (a monotonic index per target; re-picking 'the point after the nearest' each step
        // rocked between two points forever, 10-20 00:1x). A point we can't close on in ~4 s is skipped.
        let aim = { x: tx, z: tz };
        if (pts.length > 1 && end && Math.hypot(end[0] - tx, end[2] - tz) < 45) {
          const st = (window.__qaWalk ??= {})[`${tx},${tz}`] ??= { k: 0, best: Infinity, stale: 0, len: pts.length };
          if (st.len !== pts.length) { // re-planned: restart from the point nearest the player
            let k = 0, b = Infinity; pts.forEach((q, j) => { const e = Math.hypot(q[0] - f.x, q[2] - f.z); if (e < b) { b = e; k = j; } });
            Object.assign(st, { k, best: Infinity, stale: 0, len: pts.length }); }
          while (st.k < pts.length - 1 && Math.hypot(pts[st.k][0] - f.x, pts[st.k][2] - f.z) < 1.5) { st.k++; st.best = Infinity; st.stale = 0; }
          const e = Math.hypot(pts[st.k][0] - f.x, pts[st.k][2] - f.z);
          if (e < st.best - 0.1) { st.best = e; st.stale = 0; } else if (++st.stale > 36 && st.k < pts.length - 1) { st.k++; st.best = Infinity; st.stale = 0; }
          aim = { x: pts[st.k][0], z: pts[st.k][2] };
        }
        if (d > stop) { const dx = aim.x - f.x, dz = aim.z - f.z, dd = Math.hypot(dx, dz) || 1, k = Math.min(0.6, dd) / dd; f.x += dx * k; f.z += dz * k; }
        return { d, routed, route0, x: f.x, z: f.z }; }, { tx: p.x, tz: p.z, stop, graceOver });
      if (w.routed && routedAfterMs === null && !graceOver) routedAfterMs = Date.now() - t0; // the job's own route landed
      if (start === null) { // leg start: what the game holds (stale-route repro, lane E 10-20)
        r.legStart ??= {}; r.legStart[midShot ?? 'leg'] = await page.evaluate(({ tx, tz }) => { const g = window.__gtasf.world, pts = g.radar?.route?.points ?? [], end = pts.at(-1);
          return { qa: window.__gtasfRouteQa?.() ?? null, radarLog: g.radar?.qaLog?.slice(-14) ?? null, routeN: pts.length, routeM: Math.round(g.radar?.route?.distanceM ?? -1), endToObjM: end ? Math.round(Math.hypot(end[0] - tx, end[2] - tz)) : null }; }, { tx: p.x, tz: p.z }); }
      if (graceOver || w.routed) jobRouted ??= routedAfterMs !== null; start ??= w.d;
      if (w.waiting) { await page.waitForTimeout(250); continue; }
      if (process.env.WALK_DEBUG && i % 40 === 0) console.log(`walk i=${i} d=${Math.round(w.d)} routed=${w.routed} route0=${JSON.stringify(w.route0)} at=${Math.round(w.x)},${Math.round(w.z)} still=${still}`);
      if (midShot && !mid && w.d < start / 2) { mid = true; await shot(midShot); }
      if (nearShot && !near && w.d < 30) { near = true; // the waiting recruit + name label (critic N40 nit): face them first
        // Walk straight at the nearest waiting recruit to 9 m so the chase camera faces them (setting yaw alone didn't turn it).
        for (let k = 0; k < 60; k++) {
          // Stay outside the stop's 20 m arrival radius, or the recruit joins (label off) before the frame.
          const left = await page.evaluate(({ ox, oz }) => { const f = window.__gtasf.world.foot, wait = (window.__gtasfRecruits?.debug?.() ?? []).filter(c => c.phase === 'waiting' && c.placed)
            .sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0];
            if (!wait) return 0; const dx = wait.x - f.x, dz = wait.z - f.z, d = Math.hypot(dx, dz); if (d <= 24 || Math.hypot(ox - f.x, oz - f.z) <= 23) return 0;
            const k = Math.min(0.6, d - 24) / d; f.x += dx * k; f.z += dz * k; return d; }, { ox: p.x, oz: p.z });
          if (!left) break; await page.waitForTimeout(110);
        }
        const target = await page.evaluate(() => { const f = window.__gtasf.world.foot; return (window.__gtasfRecruits?.debug?.() ?? []).filter(c => c.phase === 'waiting' && c.placed)
          .sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0] ?? null; });
        if (target) r.cameraFaced = { ...(r.cameraFaced ?? {}), [nearShot]: await faceCamera(target.x, target.z) };
        await page.waitForTimeout(500); await shot(nearShot);
        r.recruitsAtApproach ??= {}; r.recruitsAtApproach[nearShot] = await page.evaluate(() => window.__gtasfRecruits?.debug?.() ?? null); }
      if (w.d <= stop + 0.2) return { d: Math.round(w.d), jobRouted, routedAfterMs };
      if (prev && Math.hypot(w.x - prev.x, w.z - prev.z) < 0.05) { if (++still > 80) break; } else still = 0; prev = w;
      if (i % 150 === 149) { await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(30); await page.keyboard.up('ShiftLeft'); } // idle kick
      await page.waitForTimeout(110);
    } return { d: -1, jobRouted, routedAfterMs }; };
  const pressE = async () => { await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE'); };

  // 1. The giver: spawn ~22 m south of the hacker house, facing north at it.
  await page.goto(`${base}/?at=${(HOUSE.lat - 0.0002).toFixed(6)},${HOUSE.lon},0&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true'
    && document.querySelector('#loading')?.hidden !== false, null, { timeout: 180000 });
  await page.waitForTimeout(6000); // let the giver NPC + label mount
  // The server pays only a named startup ('unnamed' otherwise): name it the way the found card does (saveIdentity).
  r.named = await page.evaluate(async () => { const res = await fetch('/api/funding/profile', { method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startupName: 'QA Cofounders', nickname: 'QA Founder' }) });
    return `${res.status} ${(await res.text()).slice(0, 80)}`; });
  r.giverVisible = await page.evaluate(() => Boolean(document.querySelector('canvas')));
  await shot('01-giver');
  const house = project(HOUSE.lat, HOUSE.lon);
  r.walkToGiver = (await walkTo(house, 3)).d;
  await page.waitForTimeout(800); await shot('02-at-giver');
  // 2. Start: E at the C marker.
  await pressE(); await page.waitForTimeout(900); await shot('03-start-slab');
  await page.waitForTimeout(3000); r.objectiveAtStart = await objective(); await shot('04-objective');
  // 3. Each recruit: half-way frame, arrival frame, +2 s frame (does anything happen there?).
  for (const beat of BEATS.slice(0, Number(process.env.BEATS ?? BEATS.length))) {
    const p = project(beat.at.lat, beat.at.lon);
    const before = await objective();
    // Stop inside the 20 m arrival radius (15 m): walking on to 4 m kept steering at a stop the job had already left.
    const { d: dist, jobRouted, routedAfterMs } = await walkTo(p, beat.id === 'return' ? 4 : 15, `05-${beat.id}-enroute`, `05b-${beat.id}-approach`);
    await page.waitForTimeout(500); await shot(`06-${beat.id}-arrive`);
    await page.waitForTimeout(2500); await shot(`07-${beat.id}-after`);
    r.beats.push({ id: beat.id, dist, jobRouted, routedAfterMs, questCardVisible: await page.evaluate(() => { const q = document.querySelector('.gt-founder-quest'); return q && !q.hidden ? q.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : null; }), objectiveBefore: before, objectiveAfter: await objective() });
  }
  // 4. The payout: the PASSED band and whatever follows.
  await page.waitForTimeout(3000); await shot('08-payout');
  await page.waitForTimeout(4000); await shot('09-after-payout');
  { const crew = await page.evaluate(() => window.__gtasfRecruits?.debug?.() ?? []); // the crew at the house, camera on them
    if (crew.length) { const cx = crew.reduce((a, c) => a + c.x, 0) / crew.length, cz = crew.reduce((a, c) => a + c.z, 0) / crew.length;
      r.cameraFaced = { ...(r.cameraFaced ?? {}), crew: await faceCamera(cx, cz) }; await page.waitForTimeout(500); await shot('10-crew-at-house'); } }
  r.recruitsEnd = await page.evaluate(() => ({ foot: { x: Math.round(window.__gtasf.world.foot.x), z: Math.round(window.__gtasf.world.foot.z) }, crew: window.__gtasfRecruits?.debug?.() ?? null }));
  r.toasts = await page.evaluate(() => window.__gtSeen);
  r.missions = await page.evaluate(async () => (await (await fetch('/api/funding/missions', { credentials: 'same-origin' })).json()));
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
const ok = Object.values(results).every(r => r.api.some(a => /^mission-complete 200 .*"completed"/.test(a)));
console.log(`RESULT: JOB PLAYTHROUGH ${ok ? 'PASS ✅' : 'CHECK'} ${Object.entries(results).map(([t, r]) => `${t}: ${r.api.join(' | ').slice(0, 160)}`).join(' ; ')}`);
