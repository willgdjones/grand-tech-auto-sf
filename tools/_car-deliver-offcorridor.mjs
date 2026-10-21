// Ship-packet post-deploy check, proven locally: 'Deliver my car' off the Ferry corridor (SoMa) once the stack's worker has the
// CITY road graph (lane E's manifest-mode R2 seed). Without it the local worker only knows the embedded Ferry->Lombard corridor and
// every off-corridor delivery is 409 no-road. Desktop, no combat:
//   COMBAT_FLAGS="personalCar garageSlots driving missions founderLadder pitching" SNAP=... tools/combat-stack.sh up
//   (seed map/releases/<sha>/roadgraph.bin + map/lombard/manifest.json into $SNAP/worker/.wrangler/state), build, then
//   SNAP=... tools/heavy.sh node tools/_car-deliver-offcorridor.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
setTimeout(() => { console.log('RESULT: CHECK FAILED (watchdog 5 min)'); process.exit(2); }, 300_000).unref();
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/garage-p1'; mkdirSync(out, { recursive: true });
const AT = process.env.AT ?? '37.782190,-122.402980'; // the heist office block, SoMa (off the corridor)
const r = { at: AT, notes: [] }, errs = [];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.opener.v1', 'skipped');
  localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Deliver', foundedAt: 1, billboardSeen: true, preSeedClosed: true })); } catch {} });
const page = await ctx.newPage(); page.setDefaultTimeout(60000);
page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
const ready = () => page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 180000 });
await page.goto(`${base}/?at=${AT},0&bot=1`); await ready(); await page.waitForTimeout(3000);
// A personal car parked at the Ferry (on the corridor), seeded straight into the local D1 for this device.
const device = await page.evaluate(async () => (await (await fetch('/api/funding/profile', { credentials: 'same-origin' })).json()).deviceId);
const sql = `INSERT OR REPLACE INTO personal_cars (device_id, kind, x, y, z, yaw, saved_at) VALUES ('${String(device).replace(/'/g, '')}', 'prius', 120200, 330, -125500, 0, ${Date.now()})`;
execFileSync('node', [new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url).pathname, 'd1', 'execute', 'gtasf-local', '--local', '--command', sql], { cwd: `${process.env.SNAP}/worker`, stdio: 'ignore' });
await page.reload(); await ready(); await page.waitForTimeout(4000);
r.player = await page.evaluate(() => ({ x: Math.round(window.__gtasf.world.foot.x), z: Math.round(window.__gtasf.world.foot.z) }));
r.deliver = await page.evaluate(async () => { const res = await fetch('/api/funding/personal-car-deliver', { method: 'POST', credentials: 'same-origin',
  headers: { 'content-type': 'application/json' }, body: '{}' }); return `${res.status} ${(await res.text()).slice(0, 200)}`; });
await page.waitForTimeout(4000);
// The delivered car in the world: the nearest parked car to the player.
r.nearestCarM = await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let best = Infinity;
  for (const c of w.fleet.cars.values()) best = Math.min(best, Math.hypot(c.model.root.position.x - f.x, c.model.root.position.z - f.z)); return Math.round(best); });
await page.screenshot({ path: `${out}/deliver-offcorridor-desktop.jpg`, type: 'jpeg', quality: 80 });
r.errors = errs;
writeFileSync(`${out}/deliver-offcorridor.json`, JSON.stringify(r, null, 1));
const pass = /^200 /.test(r.deliver) && r.nearestCarM <= 40 && errs.length === 0;
console.log(JSON.stringify(r, null, 1));
console.log(`RESULT: DELIVER OFF-CORRIDOR ${pass ? 'PASS ✅' : 'CHECK FAILED'} ${r.deliver.slice(0, 60)} nearest=${r.nearestCarM} m`);
await browser.close(); process.exit(pass ? 0 : 1);
