// LANE E: world-socket soak on prod. One fresh is_bot desktop device walks laps on the Ferry promenade for MINUTES and
// logs every /api/world socket open/close (with the client's close code) and any position jump > 30 m (a reconnect
// that drops the player somewhere else).   MINUTES=4 [AT=lat,lon,h] node tools/_qa-ws-soak.mjs
import { chromium } from '@playwright/test';
const AT = process.env.AT ?? '37.795570,-122.393900,270', MIN = Math.min(3, Number(process.env.MINUTES ?? 3)); // ≤3 min per heavy.sh hold (orchestrator); loop slices outside
// NOH2=1 (gtasf-j7wvv): Chromium can carry the WebSocket over a shared HTTP/2 connection (RFC 8441) with every asset/map
// fetch; --disable-http2 forces HTTP/1.1, so the world socket gets its own TCP connection like the Node-piped runs.
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', ...(process.env.NOH2 ? ['--disable-http2'] : [])] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { const W = window.WebSocket; window.WebSocket = class extends W { constructor(...a) { super(...a);
  const c0 = this.close.bind(this); this.close = (code, reason) => { console.warn(`[soak] client close ${code} ${reason}`); return c0(code, reason); };
  this.addEventListener('close', e => console.warn(`[soak] ws closed code=${e.code} reason=${e.reason} at ${new Date().toISOString()}`)); } }; });
const page = await ctx.newPage();
const t0 = Date.now(), log = s => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s ${s}`);
// WS_VIA=pages|direct (gtasf-j7wvv proxy A/B): pipe the page's /api/world socket through a Node ws client, either back
// to wss://gtasf.com (the Pages _worker -> service binding path, as players get) or straight to the worker on
// workers.dev (bypasses Pages). Same piping both ways, so only the Pages layer differs. The page sees close 4006 when the
// server side drops abnormally (1006 can't be sent); the Node side logs the real close code.
if (process.env.WS_VIA) {
  const { default: WebSocket } = await import('ws');
  const ORIGIN = process.env.WS_VIA === 'direct' ? 'wss://gtasf-production.YOUR-SUBDOMAIN.workers.dev' : 'wss://gtasf.com';
  let grant = null;
  page.on('response', async r => { if (/\/api\/admission\/(enter|poll)/.test(r.url())) { const j = await r.json().catch(() => null); if (j?.grant) grant = j.grant; } });
  await page.routeWebSocket(/\/api\/world/, async route => {
    const u = new URL(route.url()), target = `${ORIGIN}${u.pathname}${u.search}`;
    const cookie = (await ctx.cookies('https://gtasf.com')).map(c => `${c.name}=${c.value}`).join('; ');
    const server = new WebSocket(target, grant ? ['gtasf.v2', `gtasf.admit.${grant}`] : 'gtasf.v2', { headers: cookie ? { Cookie: cookie } : {} });
    const queue = []; let up = false;
    server.on('open', () => { up = true; log(`[proxy ${process.env.WS_VIA}] open`); for (const m of queue.splice(0)) server.send(m); });
    server.on('unexpected-response', (_q, res) => { log(`[proxy ${process.env.WS_VIA}] upgrade refused HTTP ${res.statusCode}`); route.close({ code: 4003, reason: 'upgrade refused' }); });
    server.on('error', e => log(`[proxy ${process.env.WS_VIA}] error ${e.message}`));
    server.on('message', (data, binary) => route.send(binary ? data : data.toString()));
    server.on('close', (code, reason) => { log(`[proxy ${process.env.WS_VIA}] server close ${code} ${reason} at ${new Date().toISOString()}`);
      route.close({ code: code === 1006 || code === 1005 ? 4006 : code, reason: String(reason).slice(0, 60) }); });
    route.onMessage(m => up ? server.send(m) : queue.push(m));
    route.onClose(() => { if (server.readyState <= 1) server.close(1000); });
  });
}
// Last server opcodes before a close (first byte of each binary frame; shared/protocol/constants.ts S2C).
const recent = []; let sent = 0; setInterval(() => { if (sent > 0) { sentLog.push(sent); sent = 0; } }, 10000); const sentLog = [];
page.on('websocket', ws => { if (!/\/api\/world/.test(ws.url())) return; log('ws open');
  ws.on('framereceived', f => { if (typeof f.payload !== 'string') { recent.push(`0x${f.payload[0].toString(16)}/${f.payload.length}`); if (recent.length > 12) recent.shift();
    // Server corrections (CORRECTION 0x89) and respawn-ish frames are the interesting ones around a drop.
    if (f.payload[0] === 0x89) log(`CORRECTION from server (${f.payload.length} B)`);
    if (f.payload[0] === 0xaa) log('BUSTED'); } });
  ws.on('framesent', f => { if (typeof f.payload !== 'string') { sent++; } });
  ws.on('close', () => log(`last server frames: ${recent.join(' ')}`)); });
page.on('console', m => { if (/\[soak\]|Reconnect|Connection/i.test(m.text())) log(m.text().slice(0, 140)); });
page.on('response', r => { if (r.status() >= 500) log(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
await page.goto(`https://gtasf.com/?at=${AT}&bot=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 });
for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
log('READY');
let last = await page.evaluate(() => ({ x: window.__gtasf.world.foot.x, z: window.__gtasf.world.foot.z })), dir = 1, steps = 0, disconnectedSamples = 0;
// COMBAT=1: accept 18+, then each lap fires the pistol, walks through the bat + health pickups and robs the corner
// market (Ferry plaza ↔ Embarcadero Corner Market), so the socket carries FIRE/HIT/WANTED/PICKUP/rob traffic.
const COMBAT = process.env.COMBAT === '1';
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const WAY = [[37.795799, -122.394805], [37.79583, -122.39478], [37.7975, -122.3955], [37.7990, -122.3970], [37.796823, -122.398323], [37.7990, -122.3970], [37.7975, -122.3955]].map(([la, lo]) => project(la, lo));
if (COMBAT) {
  await page.keyboard.press('KeyF'); await page.waitForTimeout(900);
  if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); log('18+ accepted'); }
  await page.keyboard.press('Digit3');
  const rob = []; page.on('response', r => { const p = new URL(r.url()).pathname; if (/rob-|buy-|combat\//.test(p)) rob.push(`${r.status()} ${p}`); });
  let wp = 0, lastShot = 0, killed = false, respawned = false;
  // KILL_AT=<s>: die once at that point (the real /api/combat/death → server respawn at SF General) so a ≤3-min
  // slice still covers the post-respawn window where the 4004 drop was seen (it came ~16 s after a respawn).
  const KILL_AT = Number(process.env.KILL_AT ?? 0);
  while (Date.now() - t0 < MIN * 60000) {
    const s = await page.evaluate(t => { const f = window.__gtasf.world.foot; const dx = t.x - f.x, dz = t.z - f.z, d = Math.hypot(dx, dz);
      if (d > 1) { const k = Math.min(0.65, d) / d; f.x += dx * k; f.z += dz * k; }
      return { d, x: f.x, z: f.z, connected: document.querySelector('#world')?.dataset.connected, stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length, hp: window.__gtasfCombat?.state?.()?.health }; }, WAY[wp]);
    const jump = Math.hypot(s.x - last.x, s.z - last.z);
    if (jump > 30) log(`POSITION JUMP ${Math.round(jump)} m`);
    if (s.connected !== 'true') { if (disconnectedSamples++ % 20 === 0) log(`connected=${s.connected} stars=${s.stars}`); } else disconnectedSamples = 0;
    last = s;
    if (jump > 1000 && process.env.RESPAWN === 'stay') {
      // A real server respawn (police/PvP death): stay and keep playing at SF General — a small loop around the
      // landing spot (no long walks through buildings) — so the slice covers the post-respawn window the 4004 hit.
      log('respawn detected — staying, looping around SF General'); respawned = true;
      const c = { x: s.x, z: s.z }; WAY.length = 0;
      for (let k = 0; k < 6; k++) WAY.push({ x: c.x + Math.cos(k) * 8, z: c.z + Math.sin(k) * 8 });
      wp = 0; continue;
    }
    if (jump > 1000) {
      // A WASTED/BUSTED respawn at SF General: don't walk 4.5 km through buildings (nudges bypass client collision, the
      // server rightly rejects those MOVEs). Do what a player does: wait out the respawn, then reload back at the Ferry.
      log('respawn detected — reloading at the Ferry plaza'); await page.waitForTimeout(8000);
      await page.goto(`https://gtasf.com/?at=${AT}&bot=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 }).catch(() => log('reload: not READY in 150 s'));
      last = await page.evaluate(() => ({ x: window.__gtasf.world.foot.x, z: window.__gtasf.world.foot.z })); wp = 0; log('back at the Ferry');
      continue;
    }
    if (s.d <= 1.2) { if (wp === 4) { log(`at market (stars ${s.stars} hp ${s.hp}) — holding for the robbery`); await page.waitForTimeout(3500); } wp = (wp + 1) % WAY.length; }
    if (KILL_AT && !killed && Date.now() - t0 > KILL_AT * 1000) { killed = true; log('KILL (harness) → WASTED + respawn'); await page.evaluate(() => window.__gtasfCombat?.kill?.()); }
    // RESPAWN=stay: until the first respawn, trade fire with the nearest cruiser (aimed, every 0.7 s — "resisting", so no
    // bust) so SFPD kills us quickly (~20 s) and the slice gets a REAL server respawn early.
    if (process.env.RESPAWN === 'stay' && !respawned && Date.now() - lastShot > 700) {
      lastShot = Date.now();
      await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let best = null, d = 1e9;
        for (const c of w.fleet.cars.values()) if (c.data.flags & 0x40) { const p = c.model.root.position, dd = Math.hypot(p.x - f.x, p.z - f.z); if (dd < d) { d = dd; best = p; } }
        if (best) w.camera.setOrbit(Math.atan2(-(best.x - f.x), -(best.z - f.z)), -0.05); });
      await page.keyboard.down('KeyF'); await page.waitForTimeout(50); await page.keyboard.up('KeyF');
    } else if (Date.now() - lastShot > 8000) { lastShot = Date.now(); await page.keyboard.down('KeyF'); await page.waitForTimeout(60); await page.keyboard.up('KeyF'); }
    if (++steps % 150 === 0) await page.keyboard.press('ShiftLeft');
    await page.waitForTimeout(110);
  }
  log(`combat API: ${[...new Set(rob)].join(', ')}`);
}
while (Date.now() - t0 < MIN * 60000) {
  const s = await page.evaluate(d => { const f = window.__gtasf.world.foot; f.x += 0.45 * d; f.z -= 0.3 * d;
    return { x: f.x, z: f.z, connected: document.querySelector('#world')?.dataset.connected }; }, dir);
  if (Math.hypot(s.x - last.x, s.z - last.z) > 30) log(`POSITION JUMP ${Math.round(Math.hypot(s.x - last.x, s.z - last.z))} m`);
  if (s.connected !== 'true') { if (disconnectedSamples++ % 20 === 0) log(`connected=${s.connected}`); } else disconnectedSamples = 0;
  last = s; if (++steps % 300 === 0) { dir = -dir; await page.keyboard.press('ShiftLeft'); }
  await page.waitForTimeout(110);
}
log(`client frames sent per 10 s: ${sentLog.join(',')}`); log('done');
setTimeout(() => process.exit(0), 8000).unref(); // a hung browser.close() once held the heavy lock 8 extra minutes
await browser.close();
