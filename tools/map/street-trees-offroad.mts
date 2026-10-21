/**
 * gtasf-tr62l (lane D): DataSF street trees whose trunk sits in a traffic lane (e.g. a SoMa plane on the double yellow) read as
 * a tree growing out of the road. Measure every tree's distance to the nearest lane centreline of the game's road graph and,
 * with --write, drop the ones closer than --min (metres) from web/public/art/trees/street-trees.bin (GTST v1, same order).
 * Writes a SEPARATE file (default web/public/art/trees/street-trees-offroad.bin) so flag treesOffCarriageway picks it.
 *   tools/map/node_modules/.bin/tsx tools/map/street-trees-offroad.mts [--min=2.0] [--write] [--out=path]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { decodePackedRoadGraph, unpackRoadGraph } from '../../shared/roadgraphPacked';

const MIN = Number(process.argv.find(a => a.startsWith('--min='))?.slice(6) ?? 2.0), WRITE = process.argv.includes('--write');
const OUT = process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? 'web/public/art/trees/street-trees-offroad.bin';
const BIN = 'web/public/art/trees/street-trees.bin', GRAPH = 'tools/map/out/sf/roadgraph.bin';
const graph = unpackRoadGraph(decodePackedRoadGraph(await readFile(GRAPH)));
// Grid of lane-centre segments (4 m cells); connectors are junction links, not lanes.
const C = 4, grid = new Map<string, number[]>(), seg: number[] = [];
for (const e of graph.edges) {
  if ((e as { kind?: string }).kind === 'connector' || (e as { bridge?: boolean }).bridge || (e as { tunnel?: boolean }).tunnel) continue;
  for (let i = 1; i < e.points.length; i++) {
    const a = e.points[i - 1]!, b = e.points[i]!, id = seg.length / 4; seg.push(a[0], a[2], b[0], b[2]);
    const x0 = Math.floor(Math.min(a[0], b[0]) / C) - 1, x1 = Math.floor(Math.max(a[0], b[0]) / C) + 1, z0 = Math.floor(Math.min(a[2], b[2]) / C) - 1, z1 = Math.floor(Math.max(a[2], b[2]) / C) + 1;
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const k = `${gx}:${gz}`; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(id); }
  }
}
// Nearest lane centre (d) plus the nearest lane centre on the OTHER side of the trunk (gap = d + that distance): a tree on a
// median island between carriageways has gap >= MEDIAN_GAP and is kept (Octavia / Sunset Blvd medians; reviewer HOLD on the
// plain 2 m cut); a trunk on a double-yellow line between two adjacent lanes has gap ~3.5 m and is dropped.
const MEDIAN_GAP = Number(process.argv.find(a => a.startsWith('--median='))?.slice(9) ?? 4.5);
const lanesNear = (x: number, z: number) => {
  let best = Infinity, bx0 = 0, bz0 = 0; const cand: [number, number, number][] = [], seen = new Set<number>();
  // +-2 cells (~10 m): a median's far carriageway can sit 6-10 m from the trunk.
  for (let gx = Math.floor(x / C) - 2; gx <= Math.floor(x / C) + 2; gx++) for (let gz = Math.floor(z / C) - 2; gz <= Math.floor(z / C) + 2; gz++)
    for (const id of grid.get(`${gx}:${gz}`) ?? []) { if (seen.has(id)) continue; seen.add(id);
      const ax = seg[id * 4]!, az = seg[id * 4 + 1]!, bx = seg[id * 4 + 2]!, bz = seg[id * 4 + 3]!, dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)), cx = ax + dx * t - x, cz = az + dz * t - z, d = Math.hypot(cx, cz);
      cand.push([d, cx, cz]); if (d < best) { best = d; bx0 = cx; bz0 = cz; } }
  let other = Infinity; for (const [d, cx, cz] of cand) if (cx * bx0 + cz * bz0 < 0) other = Math.min(other, d);
  // No lane on the other side (kerb edge, outermost lane) is NOT a median: gap stays infinite only via a finite `other`.
  return { d: best, gap: Number.isFinite(other) ? best + other : 0 };
};
const dist = (x: number, z: number) => lanesNear(x, z).d;
// Outermost (kerb) lane, no lane on the far side: the graph's kerb lanes are often offset or drawn wider than the real street,
// so a sidewalk row sits 1.2-2 m from the lane centre. Drop only a trunk well inside the kerb lane (reviewer 12:00 refinement).
const KERB_MIN = Number(process.argv.find(a => a.startsWith('--kerb='))?.slice(7) ?? 1.2);
const keepTree = (x: number, z: number, d: number) => { if (d >= MIN) return 0; const { gap } = lanesNear(x, z);
  return gap >= MEDIAN_GAP ? 1 : gap === 0 && d >= KERB_MIN ? 3 : 2; };
const bytes = await readFile(BIN), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = view.getUint32(8, true);
// gtasf-dj6xk: DataSF geocoding fallbacks stack many trees on one 0.5 m point (address/block centroids, up to 68): a stack of
// >= 3 is not a planting spot, so all of it goes; a pair keeps one tree.
const pointCount = new Map<number, number>(), seen = new Set<number>();
const pointKey = (i: number) => (view.getInt16(12 + i * 4, true) + 32768) * 65536 + (view.getInt16(14 + i * 4, true) + 32768);
for (let i = 0; i < n; i++) pointCount.set(pointKey(i), (pointCount.get(pointKey(i)) ?? 0) + 1);
let stacked = 0, paired = 0;
const keep: number[] = [], hist = new Map<number, number>(), dropXZ: [number, number][] = [];
for (let i = 0; i < n; i++) {
  const x = view.getInt16(12 + i * 4, true) / 2, z = view.getInt16(14 + i * 4, true) / 2, d = dist(x, z);
  const bucket = d === Infinity ? 99 : Math.min(8, Math.floor(d * 2) / 2); hist.set(bucket, (hist.get(bucket) ?? 0) + 1);
  const k = pointKey(i), count = pointCount.get(k)!;
  // Keep ONE tree per stacked point (reviewer: Sunset's median is recorded as big stacks; dropping whole stacks removed real
  // trees); a centroid stack that lands in a lane is still caught by the lane rule below.
  if (count >= 2 && seen.has(k)) { if (count >= 3) stacked++; else paired++; continue; }
  seen.add(k);
  if (keepTree(x, z, d) !== 2) keep.push(i); else dropXZ.push([x, z]);
}
console.log(`trees ${n}, lane segments ${seg.length / 4}; distance to nearest lane centre (m bucket: count):`);
console.log([...hist].sort((a, b) => a[0] - b[0]).map(([b, c]) => `${b === 99 ? '>4' : b}:${c}`).join('  '));
console.log(`stacks: ${stacked} extra trees in stacks of >= 3 and ${paired} pair duplicates dropped (one kept per point)`);
// Review checks: Octavia Blvd band, Sunset Blvd median band, the SoMa centre-line plane (~(598,633)).
const inBox = (x0: number, x1: number, z0: number, z1: number) => dropXZ.filter(([x, z]) => x >= x0 && x <= x1 && z >= z0 && z <= z1).length;
console.log(`lane-rule drops: Octavia band ${inBox(-1460, -1410, 600, 1400)}, Sunset band ${inBox(-7705, -7635, 700, 1400)}, SoMa 60 m box ${inBox(540, 660, 570, 690)}, Third St Dogpatch cell ${inBox(1380, 1880, 1870, 2370)}`);
console.log(`--min=${MIN}: drop ${n - keep.length} (${((n - keep.length) / n * 100).toFixed(1)} %), keep ${keep.length}`);
// --dump=path: tree points (kept/dropped by the lane rule and under the plain cut) + lane segments in the review bands, for a plot.
const DUMP = process.argv.find(a => a.startsWith('--dump='))?.slice(7);
if (DUMP) {
  const bands = { octavia: [-1700, -1200, 400, 1600], sunset: [-7900, -7400, 500, 1600], soma: [480, 720, 520, 760], thirdSt: [1380, 1880, 1870, 2370] } as Record<string, number[]>;
  const out: Record<string, unknown> = {};
  for (const [name, [x0, x1, z0, z1]] of Object.entries(bands)) {
    const trees: [number, number, number][] = []; // x, z, code: 0 kept, 1 kept as median, 2 dropped, 3 kept as kerb-lane sidewalk row
    for (let i = 0; i < n; i++) { const x = view.getInt16(12 + i * 4, true) / 2, z = view.getInt16(14 + i * 4, true) / 2; if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      const l = lanesNear(x, z); trees.push([x, z, keepTree(x, z, l.d), +l.d.toFixed(2), +l.gap.toFixed(2)] as unknown as [number, number, number]); }
    const lanes: number[][] = []; for (let id = 0; id < seg.length / 4; id++) { const ax = seg[id * 4]!, az = seg[id * 4 + 1]!; if (ax >= x0 && ax <= x1 && az >= z0 && az <= z1) lanes.push([ax, az, seg[id * 4 + 2]!, seg[id * 4 + 3]!]); }
    out[name] = { box: [x0, x1, z0, z1], trees, lanes };
  }
  await writeFile(DUMP, JSON.stringify(out)); console.log(`dumped ${DUMP}`);
}
if (WRITE) {
  const m = keep.length, out = Buffer.alloc(12 + m * 6); bytes.copy(out, 0, 0, 8); out.writeUInt32LE(m, 8);
  keep.forEach((i, j) => { out.writeInt16LE(view.getInt16(12 + i * 4, true), 12 + j * 4); out.writeInt16LE(view.getInt16(14 + i * 4, true), 14 + j * 4);
    out[12 + m * 4 + j] = bytes[12 + n * 4 + i]!; out[12 + m * 5 + j] = bytes[12 + n * 5 + i]!; });
  await writeFile(OUT, out); console.log(`wrote ${OUT} (${out.length} bytes)`);
}
