// Graphics v2 facade atlas, step 2: crop each generated elevation to the building front, annotate it
// (true size, windows for night lighting, body-paint tint mask, base colour, cornice line) and pack one
// WebP colour atlas + one mask atlas (R = tint mask, G = window mask) per style into web/public/art/facades/,
// plus atlas.json. Our own fal art only. Run: node tools/art/pack-facade-atlas.mjs
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { STYLES, cells } from './facade-atlas.mjs';

const OUT = 'web/public/art/facades';
/** Reviewed out: generated in perspective with sky (unusable as a flat elevation). */
const REJECTED = new Set(['tower-05']);
const CELL = { vic: [256, 384], edw: [256, 370], shop: [256, 370], office: [512, 614], mix: [384, 358], brk: [384, 358], apt: [384, 435], tower: [500, 1000] };
// Big-wall styles cover 30-36 m per cell: one 1 MP sheet for every cell left them at ~7 px/m (blurry up close in
// FiDi/Chinatown). Split them over several sheets, each still <= 1 MP decoded, so cells keep their target size.
const PER_SHEET = { office: 2, tower: 2 };
// Bay envelopes outlined against the generated, cropped vic/edw contact sheets (not inferred
// from dark pixels, which also include doors). Top-left normalized bounds; shallow depth is an
// authored approximation. Updating the underlying crop/art requires rechecking these envelopes.
const BAY_RECTS = {
  'vic-00': [[.34,.10,.95,.82]], 'vic-01': [[.48,.17,.91,.83]],
  'vic-02': [[.45,.15,.97,.97]], 'vic-03': [[0,.23,.42,.98],[.57,.16,1,.98]],
  'vic-04': [[.41,.11,.94,.99]], 'vic-05': [[.43,.11,.98,.96]],
  'vic-06': [[.08,.07,.62,.81]], 'vic-07': [[.43,.12,.98,.91]],
  'vic-08': [[.02,.16,.54,.81],[.60,.14,1,.88]], 'vic-09': [[.43,.06,.98,.78]],
  'vic-10': [[.39,.10,.99,.80]], 'vic-11': [[.38,.15,1,.75]],
  'vic-12': [[.40,.10,.97,.95]], 'vic-13': [[.35,.09,.95,.78]],
  'vic-14': [[.04,.15,.61,1]], 'vic-15': [[.47,.05,1,.79]],
  'edw-00': [[.02,.08,.39,.75]], 'edw-01': [[.06,.06,.44,.72],[.52,.06,.94,.72]],
  'edw-02': [[.35,.08,.95,.70]], 'edw-03': [[.03,.03,.51,.74],[.57,.40,.99,.71]],
  'edw-04': [[.48,.10,.95,.73]], 'edw-05': [[.41,.05,.93,.75]],
  'edw-06': [[.62,.11,1,.69]], 'edw-07': [[.02,.05,.43,.70],[.55,.07,.95,.70]],
  'edw-08': [[.02,.04,.58,.71],[.70,.05,1,.64]], 'edw-09': [[.05,.06,.48,.72],[.51,.08,.96,.74]],
  'edw-10': [[.02,.04,.52,.80],[.54,.04,.99,.80]], 'edw-11': [[0,.12,.39,.78],[.51,.11,1,.78]],
  'edw-12': [[.02,.11,.57,.76],[.63,.10,1,.73]], 'edw-13': [[.03,.09,.51,.75],[.53,.14,.98,.72]],
  'edw-14': [[0,.11,.37,.77],[.43,.12,.93,.78]], 'edw-15': [[.52,.12,1,.80]],
};
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Find the building front inside a Flux elevation (sky above, neighbours at the sides, street below). */
function findCrop(px, w, h) {
  const at = (x, y) => { const i = (y * w + x) * 3; return [px[i], px[i + 1], px[i + 2]]; };
  const sky = at(Math.floor(w / 2), 2);
  const near = (a, b, d) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < d;
  let top = 0;
  for (let y = 0; y < h * 0.4; y++) {
    let skyCount = 0, n = 0;
    for (let x = Math.floor(w * 0.3); x < w * 0.7; x += 2) { n++; if (near(at(x, y), sky, 40)) skyCount++; }
    if (skyCount / n < 0.3) { top = y; break; }
  }
  // Strongest long vertical edges in the outer bands mark the building's side walls.
  const edge = new Float64Array(w);
  for (let x = 1; x < w - 1; x++) for (let y = Math.floor(h * 0.25); y < h * 0.75; y++) {
    const a = at(x - 1, y), b = at(x + 1, y); edge[x] += Math.abs(lum(...a) - lum(...b));
  }
  const peak = (lo, hi) => { let best = lo; for (let x = lo; x < hi; x++) if (edge[x] > edge[best]) best = x; return best; };
  const left = peak(Math.floor(w * 0.03), Math.floor(w * 0.3)), right = peak(Math.floor(w * 0.7), Math.floor(w * 0.97));
  // The base meets the sidewalk at the strongest horizontal edge near the bottom.
  let bottom = Math.floor(h * 0.92), best = -1;
  for (let y = Math.floor(h * 0.8); y < h * 0.97; y++) {
    let s = 0; for (let x = left; x < right; x += 2) s += Math.abs(lum(...at(x, y - 1)) - lum(...at(x, y + 1)));
    if (s > best) { best = s; bottom = y; }
  }
  return { left: left + 2, top, width: Math.max(16, right - left - 4), height: Math.max(16, bottom - top) };
}

/** Window mask/rects from dark glass, tint mask from pixels near the dominant body colour. */
function annotate(px, w, h, brick = false) {
  const n = w * h, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = lum(px[i * 3], px[i * 3 + 1], px[i * 3 + 2]);
  const sorted = Float32Array.from(L).sort(), median = sorted[n >> 1];
  const win = new Uint8Array(n);
  for (let i = 0; i < n; i++) win[i] = L[i] < median * 0.55 ? 255 : 0;
  // Brick fronts (gtasf-jtkf): the red brick is itself fairly dark, so glass isn't much darker than the median.
  // Glass is neutral or blue-grey, never red: also mark pixels clearly below the median that are not red-dominant.
  if (brick) for (let i = 0; i < n; i++) {
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    if (!win[i] && L[i] < median * 0.82 && r < Math.max(g, b) * 1.12) win[i] = 255;
  }
  // Dominant body colour: the most common 4-bit quantised colour among bright, non-window pixels.
  const counts = new Map();
  for (let i = 0; i < n; i += 3) if (!win[i] && L[i] > median * 0.8) {
    const key = (px[i * 3] >> 4) << 8 | (px[i * 3 + 1] >> 4) << 4 | (px[i * 3 + 2] >> 4); counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0xccc;
  const base = [((top >> 8) & 15) * 16 + 8, ((top >> 4) & 15) * 16 + 8, (top & 15) * 16 + 8];
  const tint = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(px[i * 3] - base[0]) + Math.abs(px[i * 3 + 1] - base[1]) + Math.abs(px[i * 3 + 2] - base[2]);
    tint[i] = win[i] ? 0 : Math.max(0, Math.min(255, Math.round(255 * (1 - (d - 30) / 60))));
  }
  // Window rectangles: connected components of the mask on a coarse 4 px grid, kept if window-sized.
  const gw = Math.ceil(w / 4), gh = Math.ceil(h / 4), grid = new Uint8Array(gw * gh), seen = new Uint8Array(gw * gh), rects = [];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let c = 0; for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) { const X = x * 4 + dx, Y = y * 4 + dy; if (X < w && Y < h && win[Y * w + X]) c++; }
    grid[y * gw + x] = c >= 10 ? 1 : 0;
  }
  for (let s = 0; s < gw * gh; s++) if (grid[s] && !seen[s]) {
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0, count = 0; const stack = [s]; seen[s] = 1;
    while (stack.length) {
      const k = stack.pop(), x = k % gw, y = (k / gw) | 0; count++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const q = ny * gw + nx; if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && grid[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    const rw = (x1 - x0 + 1) / gw, rh = (y1 - y0 + 1) / gh;
    if (count >= 6 && rw > 0.03 && rw < 0.5 && rh > 0.03 && rh < 0.35 && count / ((x1 - x0 + 1) * (y1 - y0 + 1)) > 0.45)
      rects.push([x0 / gw, y0 / gh, (x1 + 1) / gw, (y1 + 1) / gh].map(v => Math.round(v * 1000) / 1000));
  }
  return { win, tint, rects, base: '#' + base.map(v => v.toString(16).padStart(2, '0')).join('') };
}

const atlas = { version: 1, generator: 'tools/art/pack-facade-atlas.mjs (own fal art)', styles: {} };
await mkdir(OUT, { recursive: true });
for (const style of Object.keys(STYLES)) {
  const list = cells([style]).filter(c => existsSync(c.output) && !REJECTED.has(c.id));
  if (!list.length) continue;
  const [targetW, targetH] = CELL[style] ?? [256, 384], perSheet = PER_SHEET[style] ?? list.length;
  const cols = Math.min(4, perSheet), rows = Math.ceil(Math.min(perSheet, list.length) / cols);
  // Cap decoded colour AND composite buffers before allocating them. Even cell edges keep the
  // half-resolution mask aligned exactly; physical dimensions and normalized UVs stay unchanged.
  const scale = Math.min(1, Math.sqrt(1_000_000 / (cols * rows * targetW * targetH)));
  const cw = Math.max(2, Math.floor(targetW * scale / 2) * 2), ch = Math.max(2, Math.floor(targetH * scale / 2) * 2);
  const sheetCount = Math.ceil(list.length / (cols * rows)), sheets = [], meta = [];
  for (let sheet = 0; sheet < sheetCount; sheet++) {
    const colour = [], mask = [], base = sheet * cols * rows;
    for (const [j, cell] of list.slice(base, base + cols * rows).entries()) {
      const src = sharp(cell.output).removeAlpha(), { width, height } = await src.metadata();
      const raw = await src.clone().raw().toBuffer();
      const crop = findCrop(raw, width, height);
      const cropped = await sharp(cell.output).removeAlpha().extract(crop).resize(cw, ch, { fit: 'fill' }).raw().toBuffer();
      const a = annotate(cropped, cw, ch, style === 'brk' || style === 'mix');
      const m = Buffer.alloc(cw * ch * 3); for (let k = 0; k < cw * ch; k++) { m[k * 3] = a.tint[k]; m[k * 3 + 1] = a.win[k]; }
      const left = (j % cols) * cw, top = Math.floor(j / cols) * ch;
      colour.push({ input: cropped, raw: { width: cw, height: ch, channels: 3 }, left, top });
      mask.push({ input: m, raw: { width: cw, height: ch, channels: 3 }, left, top });
      meta.push({ id: cell.id, ...(sheetCount > 1 ? { sheet } : {}), col: j % cols, row: Math.floor(j / cols), baseColour: a.base, windows: a.rects,
        corniceY: style === 'office' ? 0.08 : 0.12, bay: style === 'vic' || style === 'edw',
        bayRects: (BAY_RECTS[cell.id] ?? []).map(rect => ({ rect, depth: style === 'vic' ? .6 : .45 })) });
    }
    const name = sheetCount > 1 ? `${style}-${sheet}` : style;
    const size = { width: cols * cw, height: rows * ch, channels: 3, background: { r: 0, g: 0, b: 0 } };
    await sharp({ create: size }).composite(colour).webp({ quality: 82 }).toFile(`${OUT}/${name}.webp`);
    // Masks are soft data: half resolution keeps them small (sampled with the same UVs, bilinear).
    // composite() yields RGBA; drop alpha so the 3-channel raw read below stays row-aligned.
    const maskFull = await sharp({ create: size }).composite(mask).removeAlpha().raw().toBuffer();
    await sharp(maskFull, { raw: { width: size.width, height: size.height, channels: 3 } })
      .resize(Math.round(size.width / 2), Math.round(size.height / 2)).webp({ quality: 80 }).toFile(`${OUT}/${name}-mask.webp`);
    sheets.push({ image: `${name}.webp`, mask: `${name}-mask.webp` });
  }
  const spec = STYLES[style];
  atlas.styles[style] = { image: sheets[0].image, mask: sheets[0].mask, ...(sheets.length > 1 ? { sheets } : {}), cols, rows, cell: { width: cw, height: ch },
    widthM: spec.width, heightM: spec.height, floors: spec.floors,
    // Tower sources include reflected trees at the base: exclude their lower three whole floors.
    ...(style === 'tower' ? { firstUsableFloor: 3 } : {}), cells: meta };
  console.log(style, list.length, 'cells');
}
await writeFile(`${OUT}/atlas.json`, JSON.stringify(atlas, null, 1) + '\n');
