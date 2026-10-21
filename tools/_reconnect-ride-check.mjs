// gtasf-j7wvv reconnectGrace: does a robotaxi ride survive a socket drop? Local stack (GTASF_URL). Hail a ride, wait until
// riding, cut the network for 3 s (Chromium offline kills the WebSocket: an abnormal close, like prod's 1006s), restore it,
// then check the ride is still active and the car keeps moving.   GTASF_URL=http://localhost:5384 node tools/_reconnect-ride-check.mjs
import { chromium } from '@playwright/test';
import net from 'node:net';
setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 300_000).unref();
const upstream = new URL(process.env.GTASF_URL ?? 'http://localhost:5384');
// A TCP pipe in front of the stack: cut() destroys every live connection (the world socket dies uncleanly, like prod's
// 1006s; Chromium's offline emulation leaves a localhost WebSocket open) and refuses new ones until restore().
const live = new Set(); let refusing = false;
const pipe = net.createServer(client => {
  if (refusing) { client.destroy(); return; }
  const server = net.connect(Number(upstream.port), upstream.hostname); live.add(client); live.add(server);
  client.pipe(server).pipe(client);
  const drop = () => { live.delete(client); live.delete(server); client.destroy(); server.destroy(); };
  client.on('error', drop); server.on('error', drop); client.on('close', drop); server.on('close', drop);
});
await new Promise(r => pipe.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${pipe.address().port}`;
const cut = () => { refusing = true; for (const s of live) s.destroy(); live.clear(); };
const restore = () => { refusing = false; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage(); page.setDefaultTimeout(60000);
const errors = [], notices = [], log = s => console.log(`[ride] ${s}`);
page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
page.on('console', m => { if (/Reconnect|robotaxi|ride/i.test(m.text())) notices.push(m.text().slice(0, 100)); });
const st = () => page.evaluate(() => { const t = window.__gtasf.world.taxi, f = window.__gtasf.world.foot;
  return { state: t.state, active: t.active, vehicleId: t.vehicleId, x: Math.round(f.x), z: Math.round(f.z), connected: document.querySelector('#world')?.dataset.connected,
    notice: [...document.querySelectorAll('[class*=notice],[class*=toast]')].map(n => n.textContent?.trim()).filter(Boolean).slice(-2) }; });
let ok = false;
try {
  await page.goto(`${base}/?at=${process.env.AT ?? '37.795570,-122.393900,270'}&preset=low&bot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120000 });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  // Ferry -> LOCAL_TAXI_DESTINATION (Lombard), the pair the local DO tests ride: a long trip that straddles the blip.
  // quickRobotaxi: the server prices the trip first (quote), then the hail carries that fare.
  const hail = () => page.evaluate(async () => { const f = window.__gtasf.world.foot, t = window.__gtasf.world.taxi, dest = { x: -897.14, y: 53.12, z: -1999.98, title: 'Reconnect test' }; // worker/src/world/localSpawn.ts LOCAL_TAXI_DESTINATION
    let q = null; try { q = await Promise.race([t.quote(dest), new Promise(r => setTimeout(() => r('quote timeout'), 8000))]); } catch (e) { q = String(e); }
    return { quote: q, hailed: t.hail(dest) }; });
  log(`hail sent: ${JSON.stringify(await hail())}`);
  let s = await st();
  for (let i = 0; i < 90 && s.state !== 'riding'; i++) {
    if (s.state === 'quick') await page.evaluate(() => window.__gtasf.world.taxi.ready());
    if ((s.state === 'unavailable' || s.state === 'idle') && i % 5 === 4) log(`re-hail: ${JSON.stringify(await hail())}`);
    await page.waitForTimeout(1000); s = await st(); if (i % 10 === 0) log(`waiting: ${JSON.stringify(s)}`);
  }
  if (s.state !== 'riding') throw new Error(`never riding: ${JSON.stringify(s)}`);
  await page.waitForTimeout(3000);
  const before = await st(); log(`riding before blip: ${JSON.stringify(before)}`);
  cut(); await page.waitForTimeout(3000);
  const during = await st(); log(`cut: ${JSON.stringify(during)}`);
  if (during.connected === 'true') throw new Error('the cut did not drop the world socket');
  restore();
  await page.waitForFunction(() => document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 30000 });
  await page.waitForTimeout(8000);
  const after = await st(); log(`after reconnect +8 s: ${JSON.stringify(after)}`);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  log(`moved ${moved.toFixed(0)} m since the blip; notices seen: ${JSON.stringify(notices.slice(-4))}`);
  ok = (after.state === 'riding' || after.state === 'arrived') && after.vehicleId !== 0 && moved > 15;
} catch (e) { log(`ABORTED: ${String(e.message).split('\n')[0]}`); }
console.log(`RESULT: ${ok && !errors.length ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 4))}`);
await browser.close(); pipe.close();
