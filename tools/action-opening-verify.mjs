// In-action opening (flag actionOpening, GTA V critique #13) on a LOCAL stack with founderLadder + pitching on:
//   SNAP=/tmp/gtasf-lanec-verify WEB_PORT=5319 WORKER_PORT=8988 COMBAT_FLAGS="founderLadder pitching" tools/combat-stack.sh up
//   tools/heavy.sh node tools/action-opening-verify.mjs        (stack OUTSIDE heavy.sh; only this capture inside)
// Fresh device per profile: no naming modal -> Pre-seed 'walk over + E' -> conversation -> reply 1 -> cheque count-up ->
// Seed: desktop WALKS to First Round (stands in for driving), phone takes the robotaxi option -> E -> conversation -> SEED CLOSED.
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/action-opening'; mkdirSync(out, { recursive: true });
const PEAR = { lat: 37.795570, lon: -122.393771 }, SEED = { lat: 37.799896, lon: -122.400499 }; // shared FOUNDER_PLAZA_ANGEL / content/pitchVcs first-round
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = {};
for (const [tag, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { ...devices['Pixel 7'] }]].filter(([t]) => !process.env.ONLY || process.env.ONLY === t)) {
  const r = results[tag] = { notes: [] };
  const ctxOpts = await browser.newContext(opts);
  // The guided opener (b6a71d58) is newer than this check: play as a device that has already seen it (OPENER=1 keeps it).
  if (!process.env.OPENER) await ctxOpts.addInitScript(() => { try { localStorage.setItem('gtasf.opener.v1', 'skipped'); } catch { /* storage blocked */ } });
  const page = await ctxOpts.newPage(); page.setDefaultTimeout(60000);
  if (process.env.GARAGE) { // the garage gift toast ('NEW CAR IN YOUR GARAGE', centre slot), caught when it appears
    r.giftToast = null;
    await page.exposeFunction('__gtGiftToast', async text => {
      if (r.giftToast) return; r.giftToast = text;
      await page.waitForTimeout(400); await page.screenshot({ path: `${out}/garage-gift-toast-${tag}.jpg`, type: 'jpeg', quality: 78 });
    });
    await page.addInitScript(() => { const poll = setInterval(() => {
      const el = [...document.querySelectorAll('.gt-toast')].find(t => /NEW CAR/.test(t.textContent ?? ''));
      if (el) { clearInterval(poll); window.__gtGiftToast(el.textContent); }
    }, 250); });
  }
  if (process.env.WARDROBE) { // the look-unlock toast, caught the moment it appears (it queues in the centre slot, so its time varies)
    r.newLookTexts = [];
    await page.exposeFunction('__gtNewLook', async text => {
      if (r.newLookTexts.length) return; r.newLookTexts.push(text);
      await page.waitForTimeout(400); await page.screenshot({ path: `${out}/look-unlock-toast-${tag}.jpg`, type: 'jpeg', quality: 76 });
    });
    await page.addInitScript(() => { const poll = setInterval(() => { // a poll, not a MutationObserver: documentElement can be null this early
      const el = [...document.querySelectorAll('.gt-toast')].find(t => /TIER REACHED|NEW LOOK/.test(t.textContent ?? ''));
      if (el) { clearInterval(poll); window.__gtNewLook(el.textContent); }
    }, 250); });
  }
  // FAIL_SAVE=1 (review H1): every name save (POST /api/funding/profile) fails — the opening must still go on.
  if (process.env.FAIL_SAVE) { r.saveFailures = 0; await page.route('**/api/funding/profile', route => route.request().method() === 'POST' ? (r.saveFailures++, route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Funding is temporarily unavailable"}' })) : route.continue()); }
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
  const pitches = []; page.on('response', async res => { if (/\/api\/funding\/pitch/.test(res.url())) { try { pitches.push({ status: res.status(), body: (await res.text()).slice(0, 200) }); } catch {} } });
  const quest = () => page.evaluate(() => document.querySelector('.gt-founder-quest')?.textContent?.replace(/\s+/g, ' ').trim() ?? null);
  const waitQuest = async (re, ms = 90000) => { const t = Date.now(); while (Date.now() - t < ms) { const q = await quest(); if (q && re.test(q)) return q; await page.waitForTimeout(500); } return null; };
  const walkTo = async (t, stop) => { const p = project(t.lat, t.lon); for (let i = 0; i < 5000; i++) {
    const d = await page.evaluate(({ x, z, stop }) => { const f = window.__gtasf.world.foot, dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz); if (d > stop) { const k = Math.min(0.6, d - stop) / d; f.x += dx * k; f.z += dz * k; } return d; }, { x: p.x, z: p.z, stop });
    if (d <= stop + 0.2) return Math.round(d); if (i % 150 === 0) await page.keyboard.press('ShiftLeft'); await page.waitForTimeout(110); } return -1; };
  const walkToXZ = async (p, stop) => { for (let i = 0; i < 3000; i++) {
    const d = await page.evaluate(({ x, z, stop }) => { const f = window.__gtasf.world.foot, dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz); if (d > stop) { const k = Math.min(0.6, d - stop) / d; f.x += dx * k; f.z += dz * k; } return d; }, { x: p.x, z: p.z, stop });
    if (d <= stop + 0.2) return Math.round(d); await page.waitForTimeout(110); } return -1; };
  const pressE = async () => { await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE'); };
  const talk = async label => {
    await page.waitForSelector('.gt-convo:not([hidden])', { timeout: 15000 });
    await page.screenshot({ path: `${out}/${label}-ask-${tag}.jpg`, type: 'jpeg', quality: 72 });
    if (process.env.CONVO_LEAVE && label === 'preseed') {
      // critic N7 (gtasf-8i6t5): the open conversation hides the quest card, closes when you walk 10 m away (keys 1-3
      // released), and E back at the partner reopens it.
      const shownNow = () => page.evaluate(() => { const c = [...document.querySelectorAll('.gt-convo')].find(c => !c.hidden); return !!c && c.getClientRects().length > 0; });
      r.questHiddenInConvo = await page.evaluate(() => { const q = document.querySelector('.gt-founder-quest'); return !q || q.getClientRects().length === 0; });
      const here = await page.evaluate(() => ({ x: window.__gtasf.world.foot.x, z: window.__gtasf.world.foot.z }));
      await walkToXZ({ x: here.x + 7.5, z: here.z + 7.5 }, 0.3); await page.waitForTimeout(800);
      r.closedAfterLeaving = !(await shownNow());
      await page.keyboard.press('Digit1'); await page.waitForTimeout(600);
      r.keysReleased = !(await shownNow()) && !(await page.evaluate(() => /^You$/i.test([...document.querySelectorAll('.gt-convo-who')].map(e => e.textContent).join(''))));
      r.questBackAfterLeaving = await page.evaluate(() => { const q = document.querySelector('.gt-founder-quest'); return !!q && q.getClientRects().length > 0; });
      await page.screenshot({ path: `${out}/convo-left-${tag}.jpg`, type: 'jpeg', quality: 72 });
      await walkToXZ(here, 0.3); await page.waitForTimeout(800); await pressE();
      await page.waitForSelector('.gt-convo:not([hidden])', { timeout: 15000 }).catch(() => {});
      r.reopened = await shownNow();
    }
    if (process.env.CONVO_PHONE && label === 'preseed') {
      // The jobs phone opened over a waiting conversation: the conversation steps aside (its replies never cover the
      // phone's buttons, keys 1-3 don't answer it invisibly) and returns when the phone closes.
      const shown = () => page.evaluate(() => { const c = [...document.querySelectorAll('.gt-convo')].find(c => !c.hidden); return !!c && c.getClientRects().length > 0; });
      if (tag === 'phone') { // ☰ → City actions → Phone: jobs (the options dialog is open on the way: the convo hides then too)
        for (const sel of ['.gt-pause-launch', '#movement-mode']) { await page.locator(sel).first().tap({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(600); }
        await page.getByRole('button', { name: /Phone: jobs/ }).first().tap({ timeout: 8000 }).catch(() => {}); } else await page.keyboard.press('KeyN');
      await page.waitForTimeout(1200);
      r.convoHiddenUnderPhone = !(await shown());
      r.phoneStartOnTop = await page.evaluate(() => { const b = document.querySelector('.gt-mission-phone:not([hidden]) .gt-mission-phone-start'); if (!b) return false; const q = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2)); });
      if (tag === 'desktop') { await page.keyboard.press('Digit2'); await page.waitForTimeout(800); }
      r.noInvisibleAnswer = await page.evaluate(() => !/^You$/i.test([...document.querySelectorAll('.gt-convo-who')].map(e => e.textContent).join('')));
      await page.screenshot({ path: `${out}/convo-under-phone-${tag}.jpg`, type: 'jpeg', quality: 72 });
      await page.keyboard.press('Escape'); await page.locator('.gt-mission-phone-close').first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(800);
      r.convoBack = await shown();
    }
    await page.keyboard.press('Digit1');
    const visibleCheque = () => [...document.querySelectorAll('.gt-convo')].find(c => !c.hidden)?.querySelector('.gt-convo-cheque')?.textContent ?? '';
    await page.waitForFunction(fn => /\$/.test(eval(fn)()), visibleCheque.toString(), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${label}-cheque-${tag}.jpg`, type: 'jpeg', quality: 72 });
    r[label] = await page.evaluate(fn => eval(fn)() || null, visibleCheque.toString());
    await page.waitForFunction(() => [...document.querySelectorAll('.gt-convo')].every(c => c.hidden), null, { timeout: 15000 }).catch(() => {});
  };
  try {
    await page.goto(`${base}/?bot=1${tag === 'phone' ? '&preset=low' : ''}`);
    await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
    await page.waitForTimeout(1500);
    r.modalAtStart = await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map(d => d.className).join(','));
    r.firstQuest = await quest();
    await page.screenshot({ path: `${out}/start-${tag}.jpg`, type: 'jpeg', quality: 72 });
    for (const s of [10, 20]) { await page.waitForTimeout(10000); await page.screenshot({ path: `${out}/first-minute-${s}s-${tag}.jpg`, type: 'jpeg', quality: 72 }); }
    r.preSeedQuest = await waitQuest(/Walk over and (press|tap)/); // touch copy says 'tap Enter / exit' (N9)
    // The partner model stands at its snapped walkable spot (not exactly the anchor): walk to the model once it's in.
    const npc = await page.waitForFunction(() => { const p = window.__gtasf.world.founderPlazaInvestor?.position; return p ? { x: p.x, z: p.z } : null; }, null, { timeout: 30000 }).then(h => h.jsonValue()).catch(() => null);
    r.notes.push(`partner model ${npc ? `at ${npc.x.toFixed(1)},${npc.z.toFixed(1)}` : 'NOT mounted'}`);
    // WARDROBE=1 (critic 20c, needs characterLooks): the same LOOK_TIERS rows before the first cheque and after Seed closes,
    // so a round-gated look reads LOCK -> OPEN (lane D's ask).
    const wardrobeShot = async name => {
      for (let i = 0; i < 3; i++) { // O is ignored while a card/modal is up: retry after it clears
        await page.keyboard.press('KeyO'); await page.waitForTimeout(900);
        if (await page.evaluate(() => Boolean(document.querySelector('dialog.gt-wardrobe[open]')))) break;
        await page.waitForTimeout(2500);
      }
      r[`wardrobe_${name}`] = await page.evaluate(() => ({ stage: document.querySelector('.gt-wardrobe-stage')?.textContent ?? null,
        tiers: [...document.querySelectorAll('.gt-wardrobe-tiers li')].map(li => `${li.dataset.unlocked === 'true' ? 'OPEN' : 'LOCK'} ${li.textContent}`) }));
      await page.screenshot({ path: `${out}/wardrobe-${name}-${tag}.jpg`, type: 'jpeg', quality: 76 });
      // Close with Cancel: a second O lands on the focused Outfit <select> (it jumps to 'Ocean') instead of toggling it shut.
      await page.locator('dialog.gt-wardrobe[open] button', { hasText: 'Cancel' }).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
    };
    // critic 20c acceptance (lane D meshyTierDress): the player's own body before vs after the Seed unlock, same 3/4 view.
    // The chase camera fades the player when a wall pushes it in (camera.avatarOpacity), so try a few orbits and shoot the
    // first where the body is fully drawn.
    const avatarShot = async name => {
      const base = await page.evaluate(() => window.__gtasf.world.camera.yaw);
      for (const turn of [0.6, -0.6, 1, 0.3, -0.3, 0]) {
        await page.evaluate(y => window.__gtasf.world.camera.setOrbit?.(y, -0.12), base + Math.PI * turn);
        await page.waitForTimeout(1100);
        const opacity = await page.evaluate(() => window.__gtasf.world.camera.avatarOpacity ?? 1);
        if (opacity >= 0.95 || turn === 0) { r[`avatarOpacity_${name}`] = opacity; break; }
      }
      await page.screenshot({ path: `${out}/avatar-${name}-${tag}.jpg`, type: 'jpeg', quality: 80 });
      await page.evaluate(y => window.__gtasf.world.camera.setOrbit?.(y, -0.12), base); await page.waitForTimeout(400);
    };
    if (process.env.WARDROBE) { await avatarShot('before-preseed'); await wardrobeShot('before-preseed'); }
    r.walkupQuest = await quest(); // walkUpPitch: the card must not ask for a key press (critic 14:40 PT 10-15)
    if (process.env.WALKUP) await page.screenshot({ path: `${out}/walkup-card-${tag}.jpg`, type: 'jpeg', quality: 78 });
    r.walkPear = npc ? await walkToXZ(npc, 2.5) : await walkTo(PEAR, 2.5);
    await page.waitForTimeout(1200); // walkUpPitch: the conversation opens on arrival, before any E
    r.autoOpened = await page.evaluate(() => [...document.querySelectorAll('.gt-convo')].some(c => !c.hidden && c.getClientRects().length > 0));
    r.convoCount = await page.evaluate(() => [...document.querySelectorAll('.gt-convo')].filter(c => !c.hidden && c.getClientRects().length > 0).length); // critic: no double-open with guidedOpener
    r.stampOverQuest = await page.evaluate(() => [...document.querySelectorAll('.gt-hud-notice, .gt-notice, [class*="notice"]')].some(n => !n.hidden && /Stamped:/.test(n.textContent ?? '')));
    await pressE();
    const splash = page.waitForSelector('.gt-rank-up.is-in', { timeout: 40000 }).then(async () => { r.rankUp = await page.evaluate(() => document.querySelector('.gt-rank-up')?.textContent); await page.screenshot({ path: `${out}/rank-up-${tag}.jpg`, type: 'jpeg', quality: 72 }); }).catch(() => {});
    await talk('preseed');
    if (process.env.WARDROBE) { // lane D: the look-unlock toast (the observer above screenshots it the moment it appears)
      for (let i = 0; i < 90 && !r.newLookTexts.length; i++) await page.waitForTimeout(500);
      r.unlockToast = r.newLookTexts.length > 0;
    }
    await splash;
    r.seedQuest = await waitQuest(/drive there|wants a meeting/);
    await page.screenshot({ path: `${out}/seed-quest-${tag}.jpg`, type: 'jpeg', quality: 72 });
    if (tag === 'desktop' || !process.env.PHONE_TAXI) r.walkSeed = await walkTo(SEED, 8); // local stacks have no robotaxi (taxi=unavailable)
    else {
      await page.locator('.gt-founder-quest button', { hasText: /robotaxi/i }).click();
      for (let i = 0; i < 12; i++) { await page.waitForTimeout(5000); r.notes.push(`${(i + 1) * 5}s: ${await quest()} | taxi=${await page.evaluate(() => document.querySelector('#world')?.dataset.taxiState)} | quick=${await page.evaluate(() => !document.querySelector('.gt-quick-ride')?.hidden)}`); if (/You made it/.test((await quest()) ?? '')) break; }
    }
    r.arrivedQuest = await waitQuest(/You made it/, 180000);
    await pressE();
    await talk('seed');
    r.closedQuest = await waitQuest(/SEED CLOSED|Series A opens tomorrow/, 20000);
    if (process.env.GARAGE) { // gtasf-n1bns acceptance: the Seed gift car is LISTED in 'My garage' and DELIVERED (critic, 20c lesson)
      await page.waitForTimeout(8000);
      // The pose-nudge walk can leave the player inside a building at the partner (no road qualifies for a delivery): step out
      // to the nearest road first, like a player standing on a street calling their car.
      const street = await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot, r = w.map?.nearestRoad?.(f.x, f.z, 60); return r ? { x: r.x, z: r.z } : null; });
      if (street) await walkToXZ(street, 1.5);
      await page.keyboard.press('KeyN'); await page.waitForTimeout(2500); // the jobs phone; its open loads the garage (+ places gifts)
      const garageText = () => page.evaluate(() => [
        [...document.querySelectorAll('.gt-mission-phone-header')].map(h => h.textContent).find(t => /MY GARAGE/.test(t ?? '')) ?? null,
        document.querySelector('.gt-mission-phone-garage')?.textContent ?? null].filter(Boolean).join(' | '));
      r.garageList = await garageText();
      await page.screenshot({ path: `${out}/garage-list-${tag}.jpg`, type: 'jpeg', quality: 78 });
      // Deliver from the Ferry plaza: a reload there also checks the slots persist. (The LOCAL stack's server road graph is
      // the embedded corridor around the Ferry; prod loads the whole city, so delivery works anywhere there.)
      await page.keyboard.press('KeyN'); await page.waitForTimeout(400);
      await page.goto(`${base}/?at=37.795570,-122.393900,64&bot=1${tag === 'phone' ? '&preset=low' : ''}`);
      await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120000 });
      await page.waitForTimeout(4000);
      await page.keyboard.press('KeyN'); await page.waitForTimeout(2500);
      r.garageAfterReload = await garageText();
      await page.screenshot({ path: `${out}/garage-after-reload-${tag}.jpg`, type: 'jpeg', quality: 78 });
      const deliver = page.locator('.gt-mission-phone-garage button', { hasText: 'Deliver' }).first();
      r.garageDeliverButton = await deliver.count() > 0;
      if (r.garageDeliverButton) {
        const response = page.waitForResponse(res => /\/api\/funding\/garage-deliver/.test(res.url()), { timeout: 10000 }).catch(() => null);
        await deliver.click();
        const res = await response; r.garageDeliverResponse = res ? `${res.status()} ${(await res.text().catch(() => '')).slice(0, 200)}` : null;
        await page.waitForTimeout(2500);
      }
      r.garageServerPose = await page.evaluate(() => { const f = window.__gtasf.world.foot; return { x: Math.round(f.x), z: Math.round(f.z) }; });
      r.garageAfterDeliver = await garageText();
      r.garageCarNear = await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let best = null;
        for (const c of w.fleet.cars.values()) { const d = Math.hypot(c.model.root.position.x - f.x, c.model.root.position.z - f.z); if (d < 130 && (!best || d < best.d)) best = { d: Math.round(d), kind: c.data.kind }; } return best; });
      await page.screenshot({ path: `${out}/garage-delivered-${tag}.jpg`, type: 'jpeg', quality: 78 });
      await page.keyboard.press('KeyN'); await page.waitForTimeout(500);
      // 'Keep this car' in a real run: get into a parked car that isn't yours, open the phone, Replace slot 1.
      const delivered = (() => { try { return JSON.parse((r.garageDeliverResponse ?? '').replace(/^\d+ /, '')).car ?? null; } catch { return null; } })();
      const other = await page.evaluate(mine => { const w = window.__gtasf.world, f = w.foot; let best = null;
        for (const c of w.fleet.cars.values()) {
          const x0 = c.model.root.position.x, z0 = c.model.root.position.z;
          if ((mine && Math.hypot(x0 - mine.x, z0 - mine.z) < 8) || c.data.driverId || !['prius', 'tesla', 'subaru', 'supercar'].includes(c.data.kind)) continue; // well clear of the car just delivered (E enters the NEAREST car)
          const x = c.model.root.position.x, z = c.model.root.position.z, d = Math.hypot(x - f.x, z - f.z); if (d < 120 && (!best || d < best.d)) best = { d, x, z, kind: c.data.kind }; } return best; }, delivered);
      r.garageKeepTarget = other ? `${other.kind} ${Math.round(other.d)} m` : null;
      if (other) {
        await walkToXZ(other, 2.5); await pressE(); await page.waitForTimeout(2500);
        r.garageKeepDriving = await page.evaluate(() => window.__gtasf.world.mode === 'driver');
        r.garageKeepDrivenKind = await page.evaluate(() => { const w = window.__gtasf.world, d = w.driving; let best = null;
          for (const c of w.fleet.cars.values()) { const dd = Math.hypot(c.model.root.position.x - d.x, c.model.root.position.z - d.z); if (!best || dd < best.d) best = { d: dd, kind: c.data.kind }; } return best?.kind ?? null; });
        await page.keyboard.press('KeyN'); await page.waitForTimeout(2500);
        const keep = page.locator('.gt-mission-phone-garage button', { hasText: /Replace|Keep/ }).first();
        await page.screenshot({ path: `${out}/garage-keep-prompt-${tag}.jpg`, type: 'jpeg', quality: 78 }); // the prompt while driving
        if (await keep.count()) {
          const response = page.waitForResponse(res => /\/api\/funding\/garage-keep/.test(res.url()), { timeout: 10000 }).catch(() => null);
          await keep.click(); const res = await response;
          r.garageKeepResponse = res ? `${res.status()} ${(await res.text().catch(() => '')).slice(0, 200)}` : null;
          await page.waitForTimeout(2000);
        }
        r.garageAfterKeep = await garageText();
        await page.screenshot({ path: `${out}/garage-kept-${tag}.jpg`, type: 'jpeg', quality: 78 });
        await page.keyboard.press('KeyN'); await page.waitForTimeout(500);
        // Reviewer: kept -> reload -> listed -> deliver (the device-wide 60 s cooldown from the first delivery has to pass).
        const deliveredAt = Date.now();
        await pressE(); await page.waitForTimeout(1500); // out of the car
        await page.goto(`${base}/?at=37.795570,-122.393900,64&bot=1${tag === 'phone' ? '&preset=low' : ''}`);
        await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120000 });
        await page.waitForTimeout(Math.max(4000, 65_000 - (Date.now() - deliveredAt)));
        await page.keyboard.press('KeyN'); await page.waitForTimeout(2500);
        r.garageKeptAfterReload = await garageText();
        const again = page.locator('.gt-mission-phone-garage button', { hasText: 'Deliver' }).first();
        if (await again.count()) {
          const response = page.waitForResponse(res => /\/api\/funding\/garage-deliver/.test(res.url()), { timeout: 10000 }).catch(() => null);
          await again.click(); const res = await response;
          r.garageKeptDeliverResponse = res ? `${res.status()} ${(await res.text().catch(() => '')).slice(0, 200)}` : null;
          await page.waitForTimeout(2000);
        }
        await page.screenshot({ path: `${out}/garage-kept-delivered-${tag}.jpg`, type: 'jpeg', quality: 78 });
        await page.keyboard.press('KeyN'); await page.waitForTimeout(500);
      }
    }
    if (process.env.WARDROBE) { await page.waitForTimeout(8000); await wardrobeShot('after-seed');
      // The harness walks by nudging the pose, so it can end inside a building at the partner (camera 'unsafe' -> the body
      // fades to 0). Step out to the nearest road point first so the chase camera can frame the player.
      const road = await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot, r = w.map?.nearestRoad?.(f.x, f.z, 60); return r ? { x: r.x, z: r.z } : null; });
      if (road) await walkToXZ(road, 1.5);
      await avatarShot('after-seed'); } // no Escape: it opens the pause menu, which blocks O
    if (process.env.SERIESA) { // phase 6 surfacing: a returning Seed player on a new SF day gets the Demo Day card + route
      await page.evaluate(() => { const k = 'gtasf.founder.v1', s = JSON.parse(localStorage.getItem(k) || '{}'); s.lastRoundCloseDay = '2020-01-01'; localStorage.setItem(k, JSON.stringify(s)); });
      await page.reload(); await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
      r.seriesACard = await waitQuest(/SERIES A.*Demo Day is open/, 30000);
      await page.locator('.gt-founder-quest button', { hasText: /Route there/ }).click().catch(() => {});
      await page.waitForTimeout(1200);
      r.seriesARoute = await page.evaluate(() => document.querySelector('#trip-status')?.textContent?.trim() ?? null);
      await page.screenshot({ path: `${out}/series-a-card-${tag}.jpg`, type: 'jpeg', quality: 72 });
    }
    await page.screenshot({ path: `${out}/seed-closed-${tag}.jpg`, type: 'jpeg', quality: 72 });
    // Founder Rank (flag founderRank): the crown chip shows the level after Seed; the two pitches earned a RANK UP.
    await page.waitForTimeout(4000);
    r.rank = await page.evaluate(() => { const e = document.querySelector('.gt-founder-crown-rank'); return e && !e.hidden ? e.textContent : null; });
    if (tag === 'desktop') { await page.keyboard.press('KeyN'); await page.waitForTimeout(2500); r.phoneRank = await page.evaluate(() => { const e = document.querySelector('.gt-mission-phone-rank'); return e && !e.hidden ? e.textContent : null; }); await page.screenshot({ path: `${out}/rank-phone-line-${tag}.jpg`, type: 'jpeg', quality: 72 }); }
    r.rankUps = await page.evaluate(() => [...document.querySelectorAll('[class*="toast"]')].map(t => t.textContent).filter(t => /RANK UP/.test(t ?? '')).length);
    await page.screenshot({ path: `${out}/rank-${tag}.jpg`, type: 'jpeg', quality: 72 });
  } catch (e) { r.failure = String(e?.message ?? e).slice(0, 240); }
  r.pitches = pitches; r.errs = errs;
  r.checks = { partnerModel: r.notes.some(n => /partner model at/.test(n)), ...(process.env.FAIL_SAVE ? { saveReallyFailed: (r.saveFailures ?? 0) >= 1 } : {}), noModalAtStart: !r.modalAtStart, foundedAuto: /You founded|is going up on the Embarcadero/.test(r.firstQuest ?? '') || /You founded/.test(r.preSeedQuest ?? '') || !!r.preSeedQuest, // founding copy is now the billboard reveal ('<startup> is going up on the Embarcadero…')
    preSeedCheque: /\$/.test(r.preseed ?? ''), seedReached: !!r.arrivedQuest, seedCheque: /\$/.test(r.seed ?? ''), seedClosed: !!r.closedQuest,
    ...(process.env.RANK ? { rankUpSplash: /RANK UP/.test(r.rankUp ?? ''), noStampOverQuest: !r.stampOverQuest, rankChip: /LV \d/.test(r.rank ?? ''), ...(tag === 'desktop' ? { phoneRankLine: /LV \d+ · \w+ · .*XP/.test(r.phoneRank ?? '') } : {}) } : {}),
    ...(process.env.CONVO_LEAVE ? { questHiddenInConvo: !!r.questHiddenInConvo, closedAfterLeaving: !!r.closedAfterLeaving, keysReleased: !!r.keysReleased, questBackAfterLeaving: !!r.questBackAfterLeaving, reopened: !!r.reopened } : {}),
    ...(process.env.CONVO_PHONE ? { convoHiddenUnderPhone: !!r.convoHiddenUnderPhone, phoneStartOnTop: !!r.phoneStartOnTop, noInvisibleAnswer: !!r.noInvisibleAnswer, convoBack: !!r.convoBack } : {}),
    ...(process.env.WALKUP ? { autoOpened: !!r.autoOpened, singleConvo: r.convoCount === 1, cardAsksNoKey: !!r.walkupQuest && !/press E|tap Enter/i.test(r.walkupQuest) } : {}), ...(process.env.SERIESA ? { seriesACard: !!r.seriesACard, seriesARoute: /Demo Day/.test(r.seriesARoute ?? '') } : {}), pitchesOk: pitches.length >= 2 && pitches.every(p => p.status === 200), noConsoleErrors: !errs.length };
  await page.context().close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
const all = Object.values(results).every(r => Object.values(r.checks).every(Boolean));
console.log(`\nRESULT: ${all ? 'ACTION OPENING PASS ✅' : 'CHECK FAILED ❌'} ${JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.checks])))}`);
