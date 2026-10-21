// One-off (gtasf-avas): find a real fire-escape instance on prod (HD desktop) and capture a frame of it, to confirm the
// db30a874 fix (copies stack UP the wall, not out from it). Phase 1 finds an instance; phase 2 stands in front of it.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 420_000).unref();
const out = 'docs/sf-data/fire-escape'; mkdirSync(out, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ready = p => p.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 150000 });
const O = { lat: 37.7842, lon: -122.4078 };
let found = null;
for (const [lat, lon] of [[37.7790, -122.4070], [37.7838, -122.4140], [37.7860, -122.4120], [37.7805, -122.4100]]) try {
  const page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(`https://gtasf.pages.dev/?at=${lat},${lon},0&bot=1&gfx=hd&debug=facades`); await ready(page); await page.waitForTimeout(15000);
  found = await page.evaluate(() => {
    const w = window.__gtasf.world, scene = w.landmarks?.parent; if (!scene) return { err: 'no scene' };
    const meshes = []; scene.traverse(o => { if (o.isInstancedMesh && /fire-escape/.test(o.name)) meshes.push(o); });
    let best = null;
    for (const mesh of meshes) {
      mesh.updateMatrixWorld(true);
      for (let i = 0; i < mesh.count; i++) {
        const arr = mesh.instanceMatrix.array.slice(i * 16, i * 16 + 16), wm = mesh.matrixWorld.elements;
        const x = wm[0] * arr[12] + wm[4] * arr[13] + wm[8] * arr[14] + wm[12], z = wm[2] * arr[12] + wm[6] * arr[13] + wm[10] * arr[14] + wm[14];
        const d = Math.hypot(x - w.foot.x, z - w.foot.z);
        if (!best || d < best.d) best = { x, z, d, yawX: arr[8], yawZ: arr[10], count: mesh.count };
      }
    }
    return best ?? { none: true, meshes: meshes.length };
  }).catch(e => ({ err: String(e).slice(0, 120) }));
  const stats = await page.evaluate(() => window.__gtasfFacadeStats?.piecesByKind ?? null).catch(() => null);
  console.log('probe', lat, lon, JSON.stringify(found), 'pieces', JSON.stringify(stats));
  await page.context().close();
  if (found && found.x !== undefined) break;
} catch (e) { console.log('probe failed', lat, lon, String(e).slice(0, 120)); }
if (found?.x !== undefined) {
  // Stand ~22 m out along the wall normal (the instance's local +Z after the native yaw is unknown — try both sides).
  for (const side of [1, -1]) {
    const n = Math.hypot(found.yawX, found.yawZ) || 1, nx = found.yawX / n * side, nz = found.yawZ / n * side;
    const sx = found.x + nx * 22, sz = found.z + nz * 22;
    const lat = O.lat - sz / 111000, lon = O.lon + sx / 87700;
    const yaw = Math.atan2(-nx, -nz), heading = ((180 - yaw * 180 / Math.PI) % 360 + 360) % 360; // face the wall (headingToYaw = PI - h)
    const page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await page.goto(`https://gtasf.pages.dev/?at=${lat.toFixed(6)},${lon.toFixed(6)},${heading.toFixed(0)}&bot=1&gfx=hd`); await ready(page); await page.waitForTimeout(12000);
    await page.screenshot({ path: `${out}/fire-escape-side${side > 0 ? 'a' : 'b'}-desktop.jpg`, type: 'jpeg', quality: 80 });
    console.log('shot', side, lat.toFixed(6), lon.toFixed(6), heading.toFixed(0));
    await page.context().close();
  }
}
await b.close(); console.log('RESULT done');
