// critic N19c: which road-graph edges sit near a spot (name/kind/osmWay/routable/lane), e.g. the Ferry plaza lane the event
// robotaxi drive starts on. BASE (local stack), AT (lat,lon), R metres. Read-only.
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:5319', at = process.env.AT ?? '37.795570,-122.393900', R = Number(process.env.R ?? 40);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await page.goto(`${base}/?at=${at}&bot=1`);
await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 180000 });
await page.waitForTimeout(25000); // full graph
const rows = await page.evaluate(R => {
  const w = window.__gtasf.world, g = w.map.graph, f = w.foot, out = [];
  for (const e of g.edges) {
    let best = Infinity; for (const p of e.points) best = Math.min(best, Math.hypot(p[0] - f.x, p[2] - f.z));
    if (best <= R) out.push({ id: e.id.slice(0, 28), name: e.name, kind: e.kind, osmWay: e.osmWay, routable: e.routable, lane: e.lane, d: Math.round(best) });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, 25);
}, R);
for (const r of rows) console.log(JSON.stringify(r));
await b.close();
