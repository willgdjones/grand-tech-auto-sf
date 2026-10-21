import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

// Realistic-render facade atlas (gtasf-2rup): CC0 Poly Haven PBR scans packed into three 1024x1024
// atlases (albedo, OpenGL normal, ARM = AO/rough/metal), 2x2 cells of 480 px with 16 px wrapped
// gutters so mip sampling of a tiled cell does not bleed its neighbour. Downloads are checked
// against the API's md5. Run: node tools/art/realistic-facades.mjs
//
// This is the CC0 "optional extras" base (founder 2026-10-04 direction): a sparse starter atlas so
// the realistic path renders today. The primary library is Scenario-generated texture modules
// (tools/art/scenario-facades.mjs), which write cells into the SAME manifest shape. Each cell is
// tagged with a `kind` the client (realisticFacadeAtlas.ts) maps to a fixed style slot; styles
// without a cell (clapboard, glass, storefront, mural) fall back down a chain until Scenario adds them.
const SLUGS = [
  ['brick', 'brick_wall_001', 'brick'],
  ['stone', 'sandstone_blocks_08', 'stone'],
  ['stucco', 'painted_plaster_wall', 'stucco'],
  ['concrete', 'concrete_wall_008', 'concrete'],
];
const OUT = 'web/public/art/facades-pbr';
const CELL = 480, GUTTER = 16, SIZE = 1024;
const MAPS = [['albedo', 'Diffuse', 86], ['normal', 'nor_gl', 92], ['arm', 'arm', 86]];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
async function download(entry) {
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`${entry.url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('md5').update(bytes).digest('hex') !== entry.md5) throw new Error(`md5 mismatch: ${entry.url}`);
  return bytes;
}

await mkdir(OUT, { recursive: true });
const cells = [];
const tiles = Object.fromEntries(MAPS.map(([name]) => [name, []]));
for (let i = 0; i < SLUGS.length; i++) {
  const [id, slug, kind] = SLUGS[i];
  const [info, files] = await Promise.all([json(`https://api.polyhaven.com/info/${slug}`), json(`https://api.polyhaven.com/files/${slug}`)]);
  const left = (i % 2) * (SIZE / 2), top = Math.floor(i / 2) * (SIZE / 2);
  for (const [name, key] of MAPS) {
    const source = await download(files[key]['1k'].jpg);
    const input = await sharp(source).resize(CELL, CELL, { fit: 'fill', kernel: 'lanczos3' })
      .extend({ top: GUTTER, bottom: GUTTER, left: GUTTER, right: GUTTER, extendWith: 'repeat' }).toBuffer();
    tiles[name].push({ input, left, top });
  }
  // Poly Haven dimensions are real-world millimetres for one texture repeat.
  const metres = info.dimensions.map(mm => Math.round(mm) / 1000);
  cells.push({ id, kind, slug, source: `https://polyhaven.com/a/${slug}`, licence: 'CC0-1.0', authors: Object.keys(info.authors),
    pixelRect: [left + GUTTER, top + GUTTER, CELL, CELL], metres });
}
const maps = {};
for (const [name, , quality] of MAPS) {
  const bytes = await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: '#808080' } })
    .composite(tiles[name]).jpeg({ quality, mozjpeg: true }).toBuffer();
  await writeFile(`${OUT}/${name}.jpg`, bytes);
  maps[name] = { path: `/art/facades-pbr/${name}.jpg`, bytes: bytes.byteLength, sha256: sha(bytes),
    colorSpace: name === 'albedo' ? 'srgb' : 'linear' };
}
const manifest = { version: 1, provider: 'Poly Haven (CC0)', width: SIZE, height: SIZE, gutter: GUTTER, maps, cells };
await writeFile(`${OUT}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ maps: Object.fromEntries(Object.entries(maps).map(([k, v]) => [k, v.bytes])), cells: cells.map(c => [c.id, c.metres]) }));
