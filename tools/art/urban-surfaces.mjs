#!/usr/bin/env node
/** gtasf-r60c: capped generation, then offline periodic atlas packing. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createFalClient } from './fal.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const recipe = JSON.parse(await readFile(new URL('./prompts/urban-surfaces.json', import.meta.url), 'utf8'));
const cache = 'tools/assets/cache/fal/urban-v2';
const command = process.argv[2];
if (command === 'generate') {
  const fal = createFalClient();
  for (const tile of recipe.tiles.filter(tile => !process.argv[3] || tile.id === process.argv[3])) {
    const prompt = `${recipe.basePrompt} ${tile.prompt}.`;
    const base = `${cache}/${tile.id}.png`;
    const generated = await fal.run({ model: recipe.model, input: { prompt, image_size: { width: 480, height: 480 }, seed: tile.seed, num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, output_format: 'png' }, estimatedUsd: recipe.estimatedUsdPerCall, output: base });
    console.log(JSON.stringify({ tile: tile.id, stage: 'generated', ledgerId: generated.id, bytes: generated.bytes }));
    const bytes = await readFile(resolve(root, base));
    const dimensions = await sharp(bytes).metadata();
    if (dimensions.width !== 480 || dimensions.height !== 480) throw new Error('Unexpected base dimensions');
    const upscaled = await fal.run({ model: recipe.upscaler, input: { image_url: `data:image/png;base64,${bytes.toString('base64')}`, prompt, upscale_factor: 2, creativity: 0.15, resemblance: 0.9, guidance_scale: 4, num_inference_steps: 18, seed: tile.seed, enable_safety_checker: true }, estimatedUsd: recipe.estimatedUsdPerCall, output: `${cache}/${tile.id}.960.png` });
    console.log(JSON.stringify({ tile: tile.id, stage: 'upscaled', ledgerId: upscaled.id, bytes: upscaled.bytes }));
  }
} else if (command === 'pack') {
  // One 1152x768 atlas (884,736 pixels); 8px wrapped gutters protect filtered tile edges.
  const cell = 384, gutter = 8, size = cell - gutter * 2, width = cell * 3, height = cell * 2;
  const atlas = Buffer.alloc(width * height * 3);
  for (const [index, tile] of recipe.tiles.entries()) {
    const input = resolve(root, `${cache}/${tile.id}.960.png`);
    const meta = await sharp(input).metadata();
    if (meta.width !== 960 || meta.height !== 960) throw new Error('Upscaled texture must be 960x960');
    const pixels = await sharp(input).resize(size, size).removeAlpha().toColourspace('srgb').raw().toBuffer();
    // Feather only opposite rims, keeping interior detail; paired endpoint pixels become identical.
    const band = 24;
    for (const axis of [0, 1]) for (let along = 0; along < size; along++) for (let edge = 0; edge < band; edge++) {
      const a = axis === 0 ? (along * size + edge) * 3 : (edge * size + along) * 3;
      const b = axis === 0 ? (along * size + size - 1 - edge) * 3 : ((size - 1 - edge) * size + along) * 3;
      const blend = (1 + Math.cos(Math.PI * edge / band)) * .25;
      for (let c = 0; c < 3; c++) { const first = pixels[a+c], last = pixels[b+c]; pixels[a+c] = Math.round(first * (1-blend) + last * blend); pixels[b+c] = Math.round(last * (1-blend) + first * blend); }
    }
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const sx = (x - gutter + size) % size, sy = (y - gutter + size) % size;
      const from = (sy * size + sx) * 3, to = ((Math.floor(index / 3) * cell + y) * width + index % 3 * cell + x) * 3;
      pixels.copy(atlas, to, from, from + 3);
    }
  }
  const output = resolve(root, 'web/public/art/urban-surfaces.webp');
  await mkdir(resolve(root, 'web/public/art'), { recursive: true });
  const encoded = await sharp(atlas, { raw: { width, height, channels: 3 } }).webp({ quality: 84, effort: 4 }).toBuffer();
  if (encoded.length > 500_000) throw new Error('Urban atlas exceeds encoded budget');
  await writeFile(output, encoded);
  console.log(JSON.stringify({ output: 'web/public/art/urban-surfaces.webp', width, height, pixels: width * height, decodedRgbaBytes: width * height * 4, bytes: encoded.length }));
} else throw new Error('Usage: node tools/art/urban-surfaces.mjs generate | pack');
