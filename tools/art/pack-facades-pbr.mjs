import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';

// Pack the realistic facade PBR atlas (gtasf-realistic-facade-scenario-modules-ghk0) from Scenario
// albedo texture modules. FLUX generates diffuse only, so normal + ARM (AO/roughness/metalness) are
// DERIVED here deterministically — no credits. This writes the same three-atlas + manifest shape the
// client reads (web/src/render/realisticFacadeAtlas.ts), so richer modules drop in with no client
// change. Scenario sources live under web/public/art/facades-pbr/src/ (gitignored); run after:
//   node --import tsx tools/art/cli.ts generate tools/art/recipes/facades-pbr.json <name>   (per cell)
//   node tools/art/pack-facades-pbr.mjs
const OUT = process.env.FACADES_PBR_OUT || 'web/public/art/facades-pbr';
const SRC = process.env.FACADES_PBR_SRC || `${OUT}/src`;
// 4x3 grid in a 1024^2 (<=1MP) atlas: 256x341 tiles, 224w x 309h cells. Non-square keeps the full
// VERTICAL resolution (309 px) for stacked floors/windows while fitting a 2nd module per wall type.
const SIZE = 1024, COLS = 4, ROWS = 3, GUTTER = 16;
const TILE_W = Math.floor(SIZE / COLS), TILE_H = Math.floor(SIZE / ROWS);
const CELL_W = TILE_W - 2 * GUTTER, CELL_H = TILE_H - 2 * GUTTER;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Each realistic module: a Scenario albedo src, a client style `kind`, real-world metre repeat, and a
// per-kind base roughness. Glass roughness/metalness is overridden procedurally in the shader. Styles
// with two modules (brick, stone, stucco, clapboard) feed the per-building alt-variant (atlas slots 8+).
const CELLS = [
  { id: 'brick-soma', kind: 'brick', metres: [2.6, 2.6], rough: 0.90 },
  { id: 'stone-fidi', kind: 'stone', metres: [3.0, 3.0], rough: 0.82 },
  { id: 'stucco-mission', kind: 'stucco', metres: [2.4, 2.4], rough: 0.92 },
  { id: 'clapboard-victorian', kind: 'clapboard', metres: [2.2, 2.2], rough: 0.55 },
  { id: 'glass-curtain', kind: 'glass', metres: [3.4, 3.3], rough: 0.30 },
  { id: 'concrete-industrial', kind: 'concrete', metres: [3.0, 3.0], rough: 0.88 },
  { id: 'storefront-retail', kind: 'storefront', metres: [4.0, 3.6], rough: 0.50 },
  { id: 'mural-mission', kind: 'mural', metres: [5.0, 5.0], rough: 0.80 },
  { id: 'brick-painted', kind: 'brick', metres: [2.6, 2.6], rough: 0.88 },
  { id: 'stone-civic', kind: 'stone', metres: [3.0, 3.0], rough: 0.80 },
  { id: 'stucco-marina', kind: 'stucco', metres: [2.4, 2.4], rough: 0.92 },
  { id: 'clapboard-pacheights', kind: 'clapboard', metres: [2.2, 2.2], rough: 0.55 },
];

const clamp8 = v => Math.max(0, Math.min(255, Math.round(v)));
const wrap = (i, n) => (i + n) % n;

/** Derive an OpenGL (+Y up) tangent-space normal map from the albedo's luminance height field.
 * Gradients wrap so a seamless albedo yields a seamless normal. */
function deriveNormal(height, w, h, strength = 2.0) {
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hl = height[y * w + wrap(x - 1, w)] / 255;
      const hr = height[y * w + wrap(x + 1, w)] / 255;
      const hu = height[wrap(y - 1, h) * w + x] / 255;
      const hd = height[wrap(y + 1, h) * w + x] / 255;
      let nx = -(hr - hl) * strength, ny = (hu - hd) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const o = (y * w + x) * 3;
      out[o] = clamp8(nx * 127.5 + 127.5);
      out[o + 1] = clamp8(ny * 127.5 + 127.5);
      out[o + 2] = clamp8(nz * 127.5 + 127.5);
    }
  }
  return out;
}

/** Derive ARM: R=ambient occlusion (cavity from a small box-blur of the height), G=roughness
 * (per-kind base nudged by local luminance), B=metalness (0 — glass is handled in the shader). */
function deriveArm(height, w, h, rough) {
  const blur = Buffer.alloc(w * h);
  const r = 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { sum += height[wrap(y + dy, h) * w + wrap(x + dx, w)]; n++; }
    blur[y * w + x] = sum / n;
  }
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const cavity = (blur[i] - height[i]) / 255;           // >0 in recesses below local average
    const ao = Math.max(0, Math.min(1, 1 - cavity * 1.8));
    const lum = height[i] / 255;
    const roughness = Math.max(0.04, Math.min(1, rough + (0.5 - lum) * 0.12));
    const o = i * 3;
    out[o] = clamp8(ao * 255);
    out[o + 1] = clamp8(roughness * 255);
    out[o + 2] = 0;
  }
  return out;
}

async function tile(buf, channels) {
  // Extend a wrapped gutter around a CELL_W x CELL_H raw buffer so mip sampling of the tiled cell does
  // not bleed its neighbour.
  return sharp(buf, { raw: { width: CELL_W, height: CELL_H, channels } })
    .extend({ top: GUTTER, bottom: GUTTER, left: GUTTER, right: GUTTER, extendWith: 'repeat' }).raw().toBuffer();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  if (CELLS.length > COLS * ROWS) throw new Error(`${CELLS.length} cells exceed the ${COLS}x${ROWS} atlas grid`);
  const albedo = [], normal = [], arm = [], manifestCells = [];
  for (let i = 0; i < CELLS.length; i++) {
    const cell = CELLS[i];
    const srcPath = `${SRC}/${cell.id}.png`;
    try { await access(srcPath); } catch { throw new Error(`Missing Scenario source ${srcPath}; generate it first (tools/art/recipes/facades-pbr.json ${cell.id})`); }
    const col = i % COLS, row = Math.floor(i / COLS);
    const left = col * TILE_W, top = row * TILE_H;
    // Albedo: resize the square Scenario source into the (non-square) cell.
    const albedoRaw = await sharp(await readFile(srcPath)).resize(CELL_W, CELL_H, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
    const heightRaw = await sharp(albedoRaw, { raw: { width: CELL_W, height: CELL_H, channels: 3 } }).greyscale().blur(0.6).raw().toBuffer();
    const normalRaw = deriveNormal(heightRaw, CELL_W, CELL_H);
    const armRaw = deriveArm(heightRaw, CELL_W, CELL_H, cell.rough);
    albedo.push({ input: await tile(albedoRaw, 3), raw: { width: TILE_W, height: TILE_H, channels: 3 }, left, top });
    normal.push({ input: await tile(normalRaw, 3), raw: { width: TILE_W, height: TILE_H, channels: 3 }, left, top });
    arm.push({ input: await tile(armRaw, 3), raw: { width: TILE_W, height: TILE_H, channels: 3 }, left, top });
    manifestCells.push({ id: cell.id, kind: cell.kind, source: 'Scenario FLUX.1 Dev (generated, not CC0)',
      pixelRect: [left + GUTTER, top + GUTTER, CELL_W, CELL_H], metres: cell.metres });
  }
  const maps = {};
  for (const [name, parts, srgb, quality] of [['albedo', albedo, true, 88], ['normal', normal, false, 92], ['arm', arm, false, 88]]) {
    const base = sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: name === 'normal' ? '#8080ff' : '#808080' } });
    const bytes = await base.composite(parts).jpeg({ quality, mozjpeg: true }).toBuffer();
    await writeFile(`${OUT}/${name}.jpg`, bytes);
    maps[name] = { path: `/art/facades-pbr/${name}.jpg`, bytes: bytes.byteLength, sha256: sha(bytes), colorSpace: srgb ? 'srgb' : 'linear' };
  }
  const manifest = { version: 1, provider: 'Scenario FLUX.1 Dev (derived normal/ARM)', width: SIZE, height: SIZE, gutter: GUTTER, maps, cells: manifestCells };
  await writeFile(`${OUT}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ cells: manifestCells.map(c => [c.id, c.kind]), maps: Object.fromEntries(Object.entries(maps).map(([k, v]) => [k, v.bytes])) }, null, 2));
}
main().catch(error => { console.error(String(error)); process.exit(1); });
