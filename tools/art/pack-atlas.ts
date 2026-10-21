import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Original generated inputs remain intact. Deterministic local art processing is free.
const specs = [
  { id: 'victorian', source: 'victorian-a', crop: { left: 28, top: 56, width: 448, height: 364 }, metres: [3.2, 3.8], review: 'Cream trim and sage clapboard; crop removes the unwanted railing. Russian Hill/North Beach residential.' },
  { id: 'edwardian', source: 'victorian-b', crop: { left: 20, top: 8, width: 472, height: 466 }, metres: [4.8, 3.8], review: 'Two salmon-and-cream sash windows; crop removes the partial doorway. Pastel residential variant.' },
  { id: 'fidi-glass', source: 'fidi-glass', metres: [18, 24], review: 'Blue-green curtain wall grid for taller downtown buildings; larger repeat preserves plausible window sizes in the dense generated grid.' },
  { id: 'fidi-stone', source: 'fidi-stone', metres: [4.8, 3.8], review: 'Warm limestone piers and recessed windows for older downtown blocks.' },
  { id: 'soma-brick', source: 'soma-brick', metres: [5.4, 4.2], review: 'Factory window and brick bay for warehouse districts.' },
  { id: 'mission-mural', source: 'mission-mural', metres: [8, 5], review: 'Original abstract community-mural palette for selected low Mission walls.' },
  { id: 'storefront', source: 'storefront', metres: [5.4, 3.6], review: 'Unbranded awning and shop window for ground floors.' },
  { id: 'stone-variant', source: 'fidi-stone', metres: [4.8, 3.8], review: 'Cooler local colour variant of the same generated limestone bay.' },
];
const tile = 256, gutter = 8, inner = tile - gutter * 2, cols = 4;
const composites: OverlayOptions[] = [];
const ledger = JSON.parse(await readFile('tools/art/ledger.json', 'utf8'));
const assets: Record<string, unknown>[] = [];
for (let i = 0; i < specs.length; i++) {
  const spec = specs[i]!;
  const path = `web/public/art/facades/${spec.source}.png`;
  let source = sharp(path);
  if (spec.crop) source = source.extract(spec.crop);
  // The authored working tile is 120px, enlarged 2x with hard pixel edges.
  const reduced = await source.resize(120, 120, { kernel: 'lanczos3' }).modulate({ saturation: 0.62 }).removeAlpha().raw().toBuffer();
  // Blend only the outer 6px into a common edge, avoiding hard tiling discontinuities.
  const pixels = new Uint8Array(reduced);
  const n = 120, blend = 6;
  for (let y = 0; y < n; y++) for (let x = 0; x < blend; x++) for (let c = 0; c < 3; c++) {
    const a = (y*n+x)*3+c, b = (y*n+n-1-x)*3+c, avg = (pixels[a]!+pixels[b]!)/2, amount = (blend-x)/blend;
    pixels[a] = Math.round(pixels[a]!*(1-amount)+avg*amount); pixels[b] = Math.round(pixels[b]!*(1-amount)+avg*amount);
  }
  for (let y = 0; y < blend; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 3; c++) {
    const a = (y*n+x)*3+c, b = ((n-1-y)*n+x)*3+c, avg = (pixels[a]!+pixels[b]!)/2, amount = (blend-y)/blend;
    pixels[a] = Math.round(pixels[a]!*(1-amount)+avg*amount); pixels[b] = Math.round(pixels[b]!*(1-amount)+avg*amount);
  }
  let packed = sharp(pixels, { raw: { width: n, height: n, channels: 3 } }).resize(inner, inner, { kernel: 'nearest' });
  if (spec.id === 'stone-variant') packed = packed.modulate({ saturation: 0.3, brightness: 0.9 });
  const input = await packed.extend({ top: gutter, bottom: gutter, left: gutter, right: gutter, extendWith: 'copy' }).png().toBuffer();
  const col = i % cols, row = Math.floor(i / cols);
  composites.push({ input, left: col * tile, top: row * tile });
  const generated = ledger.entries.find((e: { output: string }) => e.output === path);
  assets.push({ id: spec.id, source: `/art/facades/${spec.source}.png`, generationId: generated?.id, selected: true, tile: i, pixelRect: [col*tile+gutter, row*tile+gutter, inner, inner], metres: spec.metres, crop: spec.crop, review: spec.review });
}
const output = 'web/public/art/facades/sf-facades.png';
const atlas = await sharp({ create: { width: cols*tile, height: 2*tile, channels: 3, background: '#8a8270' } }).composite(composites).png({ palette: true, colours: 64, dither: 0 }).toBuffer();
await writeFile(output, atlas);
const manifest = {
  ...JSON.parse(await readFile('web/public/art/manifest.json', 'utf8').catch(() => '{}')),
  version: 1, provider: 'Scenario', model: 'model_bfl-flux-1-schnell', ledger: 'tools/art/ledger.json',
  palette: '64-colour PS2 SF: sage, cream, muted terracotta, dark teal, warm stone',
  atlas: { path: '/art/facades/sf-facades.png', width: 1024, height: 512, bytes: atlas.length, sha256: createHash('sha256').update(atlas).digest('hex'), colorSpace: 'srgb', columns: cols, rows: 2, tileSize: tile, gutter, interior: inner, minFilter: 'LinearFilter (no atlas mip bleed)', magFilter: 'NearestFilter', vOrigin: 'top-left; for Three flipY=true sample v = 1 - (y + localV*height)/512' },
  assets,
};
await writeFile('web/public/art/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, bytes: atlas.length, dimensions: [1024,512], colours: 64, tiles: assets.length, credits: ledger.totals.actualCredits, usd: ledger.totals.actualUsd }));
