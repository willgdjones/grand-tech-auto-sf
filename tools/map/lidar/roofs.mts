/**
 * gtasf-6w9a feasibility: derive roof shapes for one block from USGS 3DEP LiDAR (ept_fetch.py -> to_bin.py) against the
 * footprints the game already uses (tools/map/out/sf chunk collision.json, DataSF-derived).
 *   tools/map/node_modules/.bin/tsx tools/map/lidar/roofs.mts <points.bin> [--out report.json]
 * Per footprint: ground = median class-2 elevation near the footprint; roof = class-1 points inside the footprint
 * more than 2.5 m above ground, rasterised to a 1 m max-height grid. Classified as flat (spread < 1.5 m), stepped
 * (>= 2 height tiers >= 3 m apart, each >= 12 % of the roof) or pitched (plane fit slope > 15 deg, low residual),
 * else complex. Compares LiDAR height with the bake's (maxY - minY).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectLocation } from '../../../web/src/radar/projection';

const ROOT = join(import.meta.dirname, '..', 'out', 'sf');
const args = process.argv.slice(2), src = args[0]!, out = args[args.indexOf('--out') + 1];
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as { frame: Parameters<typeof projectLocation>[2] };
const raw = new Float64Array(readFileSync(src).buffer.slice(0));
const n = raw.length / 5, px = new Float64Array(n), pz = new Float64Array(n), py = new Float64Array(n), cls = new Uint8Array(n), nret = new Uint8Array(n);
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (let i = 0; i < n; i++) {
  const p = projectLocation(raw[i * 5 + 1]!, raw[i * 5]!, manifest.frame);
  px[i] = p.x; pz[i] = p.z; py[i] = raw[i * 5 + 2]!; cls[i] = raw[i * 5 + 3]!; nret[i] = raw[i * 5 + 4]!;
  minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
}
// Spatial hash of points (4 m cells) for footprint queries.
const H = 4, hash = new Map<number, number[]>();
const hk = (x: number, z: number) => Math.floor(x / H) * 100003 + Math.floor(z / H);
for (let i = 0; i < n; i++) { const k = hk(px[i]!, pz[i]!); (hash.get(k) ?? hash.set(k, []).get(k)!).push(i); }
function pointsIn(x0: number, z0: number, x1: number, z1: number, each: (i: number) => void) {
  for (let gx = Math.floor(x0 / H); gx <= Math.floor(x1 / H); gx++) for (let gz = Math.floor(z0 / H); gz <= Math.floor(z1 / H); gz++)
    for (const i of hash.get(gx * 100003 + gz) ?? []) each(i);
}
const inside = (x: number, z: number, ring: number[][]) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!, [xj, zj] = ring[j]!;
    if ((zi! > z) !== (zj! > z) && x < (xj! - xi!) * (z - zi!) / (zj! - zi!) + xi!) c = !c;
  }
  return c;
};
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };
const pct = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;

type B = { id: string; minY: number; maxY: number; dataSfHeight?: number };
// Footprints: DataSF Building Footprints GeoJSON (--footprints), else the bake's chunk collision footprints.
const fpArg = args.indexOf('--footprints') >= 0 ? args[args.indexOf('--footprints') + 1] : undefined;
const buildings: { b: B; ring: number[][] }[] = [];
if (fpArg) {
  const gj = JSON.parse(readFileSync(fpArg, 'utf8')) as { features: { properties: Record<string, string>; geometry: { type: string; coordinates: number[][][] | number[][][][] } }[] };
  for (const f of gj.features) {
    const polys = (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]) as number[][][][];
    const outer = polys.map(p => p[0]!).sort((a, b) => b.length - a.length)[0];
    if (!outer) continue;
    const ring = outer.map(([lon, lat]) => { const p = projectLocation(lat!, lon!, manifest.frame); return [p.x, p.z]; });
    const xs = ring.map(p => p[0]!), zs = ring.map(p => p[1]!);
    if (Math.min(...xs) < minX + 1 || Math.max(...xs) > maxX - 1 || Math.min(...zs) < minZ + 1 || Math.max(...zs) > maxZ - 1) continue;
    const h = Number(f.properties.hgt_median_m);
    buildings.push({ b: { id: f.properties.sf16_bldgid ?? f.properties.globalid ?? String(buildings.length), minY: 0, maxY: Number.isFinite(h) ? h : NaN, dataSfHeight: Number.isFinite(h) ? h : undefined }, ring });
  }
} else
for (let cx = Math.floor(minX / 256); cx <= Math.floor(maxX / 256); cx++) for (let cz = Math.floor(minZ / 256); cz <= Math.floor(maxZ / 256); cz++) {
  let col: { origin: number[]; buildings: B[] };
  try { col = JSON.parse(readFileSync(join(ROOT, 'chunks', `${cx}_${cz}`, 'collision.json'), 'utf8')); } catch { continue; }
  for (const b of col.buildings) {
    const ring = b.rings[0]?.map(([x, z]) => [x! + col.origin[0]!, z! + col.origin[2]!]);
    if (!ring || ring.length < 3) continue;
    const xs = ring.map(p => p[0]!), zs = ring.map(p => p[1]!);
    // Whole footprint inside the fetched box (edge buildings would be clipped).
    if (Math.min(...xs) < minX + 2 || Math.max(...xs) > maxX - 2 || Math.min(...zs) < minZ + 2 || Math.max(...zs) > maxZ - 2) continue;
    if (!buildings.some(e => e.b.id === b.id)) buildings.push({ b, ring });
  }
}
const results = [], shapes: Record<string, unknown>[] = [];
for (const { b, ring } of buildings) {
  const xs = ring.map(p => p[0]!), zs = ring.map(p => p[1]!);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const groundZ: number[] = [];
  pointsIn(x0 - 12, z0 - 12, x1 + 12, z1 + 12, i => { if (cls[i] === 2) groundZ.push(py[i]!); });
  const ground = median(groundZ);
  const cells = new Map<string, number[]>();
  pointsIn(x0, z0, x1, z1, i => {
    // Vegetation filter: tree canopy returns several echoes per pulse, hard roofs one (no building class here).
    if (cls[i] !== 1 || nret[i]! > 1 || !(py[i]! > ground + 2.5) || !inside(px[i]!, pz[i]!, ring)) return;
    // Key by a string of the 1 m cell (numeric packing broke for negative z: FiDi), keep the cell origin alongside.
    const cx = Math.floor(px[i]!), cz = Math.floor(pz[i]!), k = `${cx},${cz}`, prev = cells.get(k);
    if (!prev || py[i]! > prev[2]!) cells.set(k, [cx + .5, cz + .5, py[i]!]);
  });
  let area = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += (ring[j]![0]! + ring[i]![0]!) * (ring[j]![1]! - ring[i]![1]!);
  area = Math.abs(area / 2);
  const hs = [...cells.values()].map(c => c[2]! - ground).sort((a, b) => a - b);
  if (hs.length < 10) { results.push({ id: b.id, area: Math.round(area), cells: hs.length, type: 'no-data', refHeight: +(b.maxY - b.minY).toFixed(1) }); continue; }
  const p10 = pct(hs, .1), p50 = pct(hs, .5), p95 = pct(hs, .95);
  // Height tiers: 1 m histogram peaks merged within 3 m.
  const hist = new Map<number, number>(); for (const h of hs) { const k = Math.round(h); hist.set(k, (hist.get(k) ?? 0) + 1); }
  const tiers: { h: number; n: number }[] = [];
  for (const [h, c] of [...hist].sort((a, b) => b[1] - a[1])) {
    const t = tiers.find(t => Math.abs(t.h - h) < 3); if (t) t.n += c; else tiers.push({ h, n: c });
  }
  const bigTiers = tiers.filter(t => t.n >= .12 * hs.length).sort((a, b) => b.h - a.h);
  // Plane fit z = a x + b z + c over roof cells (least squares).
  const pts = [...cells.values()].map(([x, z, h]) => [x!, z!, h! - ground]);
  let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, sh = 0, sxh = 0, szh = 0; const m = pts.length;
  for (const [x, z, h] of pts) { sxx += x! * x!; sxz += x! * z!; szz += z! * z!; sx += x!; sz += z!; sh += h!; sxh += x! * h!; szh += z! * h!; }
  const A = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, m]], y = [sxh, szh, sh];
  const det = (M: number[][]) => M[0]![0]! * (M[1]![1]! * M[2]![2]! - M[1]![2]! * M[2]![1]!) - M[0]![1]! * (M[1]![0]! * M[2]![2]! - M[1]![2]! * M[2]![0]!) + M[0]![2]! * (M[1]![0]! * M[2]![1]! - M[1]![1]! * M[2]![0]!);
  const D = det(A), col = (i: number) => A.map((row, r) => row.map((v, c) => c === i ? y[r]! : v));
  const [pa, pb, pc] = [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
  let res = 0; for (const [x, z, h] of pts) res += (h! - (pa * x! + pb * z! + pc)) ** 2;
  const slopeDeg = Math.atan(Math.hypot(pa, pb)) * 180 / Math.PI, rms = Math.sqrt(res / m);
  // Gable test: split along the footprint's long axis (principal direction of the roof cells) and fit a plane to each
  // half; opposite slopes > 15 deg with low residual = gable (SF Victorians/Edwardians behind false fronts often read
  // flat; true gables are common in the outer districts).
  const cxm = pts.reduce((s, p) => s + p[0]!, 0) / m, czm = pts.reduce((s, p) => s + p[1]!, 0) / m;
  let cxx = 0, czz = 0, cxz = 0; for (const [x, z] of pts) { cxx += (x! - cxm) ** 2; czz += (z! - czm) ** 2; cxz += (x! - cxm) * (z! - czm); }
  const axis = 0.5 * Math.atan2(2 * cxz, cxx - czz), ux = Math.cos(axis), uz = Math.sin(axis);
  const fit = (subset: number[][]) => {
    const k = subset.length; if (k < 8) return { slope: 0, dir: 0, rms: Infinity };
    // Slope across the ridge only: regress height on the perpendicular distance from the long axis.
    const d = subset.map(([x, z]) => -(x! - cxm) * uz + (z! - czm) * ux), h = subset.map(p => p[2]!);
    const md = d.reduce((s, v) => s + v, 0) / k, mh = h.reduce((s, v) => s + v, 0) / k;
    let sdd = 0, sdh = 0; for (let i = 0; i < k; i++) { sdd += (d[i]! - md) ** 2; sdh += (d[i]! - md) * (h[i]! - mh); }
    const b = sdd ? sdh / sdd : 0; let r = 0; for (let i = 0; i < k; i++) r += (h[i]! - (mh + b * (d[i]! - md))) ** 2;
    return { slope: Math.atan(Math.abs(b)) * 180 / Math.PI, dir: Math.sign(b), rms: Math.sqrt(r / k) };
  };
  const side = (p: number[]) => -(p[0]! - cxm) * uz + (p[1]! - czm) * ux;
  const left = fit(pts.filter(p => side(p) < 0)), right = fit(pts.filter(p => side(p) >= 0));
  const gable = left.slope > 15 && right.slope > 15 && left.dir === -right.dir && left.dir !== 0 && Math.max(left.rms, right.rms) < 1.0;
  const type = p95 - p10 < 1.5 ? 'flat' : gable ? 'gable' : bigTiers.length >= 2 && bigTiers[0]!.h - bigTiers.at(-1)!.h >= 3 ? 'stepped'
    : slopeDeg > 15 && rms < 1.2 ? 'pitched'
    // SF archetype: one main roof level with a raised false front / parapet / bay up to ~3.5 m above it.
    : bigTiers.length === 1 && p95 - bigTiers[0]!.h <= 3.5 ? 'flat-parapet' : 'complex';
  // Shape record for the in-game prototype (flag lidarRoofs): heights relative to ground, ring in world metres.
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const shape: Record<string, unknown> = { id: b.id, type, ring: ring.map(([x, z]) => [r1(x!), r1(z!)]) };
  if (type === 'flat-parapet') { shape.height = r1(bigTiers[0]!.h); shape.parapet = r1(p95); }
  else if (type === 'gable') { shape.height = r1(pct(hs, .25)); shape.ridge = r1(p95); shape.axis = +axis.toFixed(3); }
  else if (type === 'stepped') {
    const low = bigTiers.at(-1)!.h, top = bigTiers[0]!.h; shape.height = r1(low);
    // Upper tier: oriented box (principal axis) around cells within 1.5 m of the top tier.
    const up = pts.filter(p => p[2]! >= top - 1.5);
    const a = up.map(p => (p[0]! - cxm) * ux + (p[1]! - czm) * uz), c = up.map(p => -(p[0]! - cxm) * uz + (p[1]! - czm) * ux);
    const a0 = Math.min(...a), a1 = Math.max(...a), c0 = Math.min(...c), c1 = Math.max(...c), am = (a0 + a1) / 2, cm = (c0 + c1) / 2;
    shape.upper = { height: r1(top), x: r1(cxm + am * ux - cm * uz), z: r1(czm + am * uz + cm * ux), length: r1(a1 - a0 + 1), width: r1(c1 - c0 + 1), axis: +axis.toFixed(3) };
  } else shape.height = r1(type === 'flat' ? p50 : p50);
  shapes.push(shape);
  results.push({ id: b.id, area: Math.round(area), cells: hs.length, coverage: +(hs.length / Math.max(1, area)).toFixed(2), type,
    lidarHeight: +p95.toFixed(1), refHeight: +(b.maxY - b.minY).toFixed(1), tiers: bigTiers.map(t => t.h), slopeDeg: +slopeDeg.toFixed(0), rms: +rms.toFixed(2) });
}
const typed = results.filter(r => r.type !== 'no-data') as { type: string; lidarHeight: number; refHeight: number }[];
const count = (t: string) => typed.filter(r => r.type === t).length;
const err = typed.filter(r => Number.isFinite(r.refHeight)).map(r => Math.abs(r.lidarHeight - r.refHeight)).sort((a, b) => a - b);
const summary = { src, points: n, footprints: results.length, withRoofData: typed.length, flat: count('flat'), flatParapet: count('flat-parapet'), gable: count('gable'), stepped: count('stepped'), pitched: count('pitched'), complex: count('complex'),
  heightErrorMedianM: err.length ? +pct(err, .5).toFixed(1) : null, heightErrorP90M: err.length ? +pct(err, .9).toFixed(1) : null };
console.log(JSON.stringify(summary));
if (out) writeFileSync(out, JSON.stringify({ summary, buildings: results }, null, 1));
const shapesOut = args.indexOf('--shapes') >= 0 ? args[args.indexOf('--shapes') + 1] : undefined;
if (shapesOut) writeFileSync(shapesOut, JSON.stringify({ version: 1, bounds: [minX, minZ, maxX, maxZ].map(v => Math.round(v)), shapes }));
