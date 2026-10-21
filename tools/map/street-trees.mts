/**
 * gtasf-umar: DataSF Street Tree List (data.sf.gov tkzw-k3nq, PDDL 1.0) -> web/public/art/trees/street-trees.bin.
 * Every mapped tree with coordinates becomes one instance of the game's six foliage kinds (palm, plane, cypress,
 * eucalyptus, pine, ficus: web/public/art/foliage/sf-trees.json) with a size class from the recorded trunk diameter.
 *   curl -sL "https://data.sf.gov/resource/tkzw-k3nq.csv?$select=treeid,species,planttype,mapdbh,latitude,longitude,data_as_of&$where=planttype='Tree'&$limit=200000" \
 *     -o tools/map/out/cache/trees/street-trees.csv
 *   tools/map/node_modules/.bin/tsx tools/map/street-trees.mts [csv] [out]
 * Format GTST v1 (little endian): 'GTST' u8 version u8 0 u16 0 u32 count; then count x {i16 x, i16 z} in 0.5 m units of
 * the SF world frame (+x east, -z north), then count x u8 kind, then count x u8 size class (0..3). Sorted by 64 m cell.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { project } from './src/pipeline/settings';

export const TREE_KINDS = ['palm', 'plane', 'cypress', 'eucalyptus', 'pine', 'ficus'] as const;
export type TreeKind = typeof TREE_KINDS[number];

/** Genus-level mapping onto the six foliage billboards (shape, not botany). */
export function treeKindFor(species: string): TreeKind {
  const s = species.toLowerCase();
  if (/\b(phoenix|washingtonia|trachycarpus|syagrus|archontophoenix|butia|cordyline|dracaena|chamaerops|brahea)\b/.test(s)) return 'palm';
  if (/\b(eucalyptus|corymbia|lophostemon)\b/.test(s)) return 'eucalyptus';
  if (/\b(pinus|araucaria)\b/.test(s)) return 'pine';
  if (/\b(cupressus|hesperocyparis|juniperus|sequoia|thuja|chamaecyparis|calocedrus|podocarpus|taxus|cedrus)\b/.test(s)) return 'cypress';
  if (/\b(platanus|ginkgo|pyrus|ulmus|prunus|acer|liquidambar|tilia|quercus|fraxinus|betula|zelkova|gleditsia|celtis|malus|cercis|lagerstroemia|liriodendron|ceratonia|jacaranda|robinia|koelreuteria|catalpa|styrax|carpinus|populus|aesculus|fagus|morus|sophora|styphnolobium|pistacia)\b/.test(s)) return 'plane';
  // Round evergreens dominate SF (Metrosideros, Tristaniopsis, Pittosporum, Magnolia, Ficus, Olea, Arbutus, Maytenus, ...).
  return 'ficus';
}
/** DBH (inches) -> size class: 0 young (< 6), 1 (< 12), 2 (< 24), 3 mature. Unknown -> 1. */
export function sizeClass(dbh: string): number {
  const d = Number(dbh);
  if (!Number.isFinite(d) || d <= 0) return 1;
  return d < 6 ? 0 : d < 12 ? 1 : d < 24 ? 2 : 3;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; continue; }
    if (c === '"') quoted = true; else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows; return body.map(r => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ''])));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2] ?? 'tools/map/out/cache/trees/street-trees.csv';
  const output = process.argv[3] ?? 'web/public/art/trees/street-trees.bin';
  const rows = parseCsv(await readFile(input, 'utf8'));
  const trees: { x: number; z: number; kind: number; size: number; cell: number }[] = [];
  const kinds = new Map<string, number>(); let skipped = 0; const asOf = new Set<string>();
  for (const r of rows) {
    const lat = Number(r.latitude), lon = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 37.6 || lat > 37.85 || lon < -122.55 || lon > -122.3) { skipped++; continue; }
    const [x, z] = project(lon, lat); // project() returns an [x, z] tuple
    const qx = Math.round(x * 2), qz = Math.round(z * 2);
    if (!Number.isFinite(qx) || !Number.isFinite(qz) || Math.abs(qx) > 32767 || Math.abs(qz) > 32767) { skipped++; continue; }
    const kind = treeKindFor(r.species ?? ''); kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    if (r.data_as_of) asOf.add(r.data_as_of.slice(0, 10));
    trees.push({ x: qx, z: qz, kind: TREE_KINDS.indexOf(kind), size: sizeClass(r.mapdbh ?? ''), cell: Math.floor(x / 64) * 100003 + Math.floor(z / 64) });
  }
  trees.sort((a, b) => a.cell - b.cell || a.x - b.x || a.z - b.z);
  const n = trees.length, buf = Buffer.alloc(12 + n * 6);
  buf.write('GTST', 0, 'ascii'); buf.writeUInt8(1, 4); buf.writeUInt32LE(n, 8);
  trees.forEach((t, i) => { buf.writeInt16LE(t.x, 12 + i * 4); buf.writeInt16LE(t.z, 14 + i * 4); buf.writeUInt8(t.kind, 12 + n * 4 + i); buf.writeUInt8(t.size, 12 + n * 5 + i); });
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, buf);
  const meta = { source: 'DataSF Street Tree List (tkzw-k3nq)', licence: 'PDDL 1.0', url: 'https://data.sf.gov/d/tkzw-k3nq', asOf: [...asOf].sort(),
    trees: n, skipped, kinds: Object.fromEntries(kinds), kindOrder: TREE_KINDS, bytes: buf.length, gzipBytes: gzipSync(buf, { level: 9 }).length };
  await writeFile(output.replace(/\.bin$/, '.json'), JSON.stringify(meta, null, 1) + '\n');
  console.log(JSON.stringify(meta));
}
