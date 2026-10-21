// One-off: are the taxi-fare coords on walkable/road ground? Prod ?at= snap distance (docs: light coord walkable check).
import { chromium } from '@playwright/test';
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [name, lat, lon] of [['union-square', 37.787850, -122.407550]]) {
  const page = await (await b.newContext({ viewport: { width: 900, height: 600 } })).newPage();
  await page.goto(`https://gtasf.pages.dev/?at=${lat},${lon},0&bot=1&preset=low`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
  await page.waitForTimeout(3500);
  const p = project(lat, lon);
  const r = await page.evaluate(({ x, z }) => { const w = window.__gtasf.world, f = w.foot, road = w.map.nearestRoad(x, z, 200);
    return { foot: { x: f.x, z: f.z }, snap: Math.round(Math.hypot(f.x - x, f.z - z) * 10) / 10, road: road ? Math.round(Math.hypot(road.x - x, road.z - z) * 10) / 10 : null, place: w.map.locationNameAt(f.x, f.z, 80, f.y) }; }, p);
  if (r.foot) { r.nudged = { lat: +(lat - (r.foot.z - p.z) / 111000).toFixed(6), lon: +(lon + (r.foot.x - p.x) / 87700).toFixed(6) }; }
  console.log(name, JSON.stringify(r)); await page.context().close();
}
await b.close();
