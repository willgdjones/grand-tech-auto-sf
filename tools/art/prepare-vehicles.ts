import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const archive = 'artifacts/art-source/vehicles';
await mkdir(archive, { recursive: true });
const recipes = JSON.parse(await readFile('tools/art/recipes/vehicles.json', 'utf8')) as { name: string; output: string }[];
for (const recipe of recipes) await rename(recipe.output, `${archive}/${recipe.name}.png`).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
const ledger = JSON.parse(await readFile('tools/art/ledger.json', 'utf8'));
const assets = [];
for (const spec of [
  { id: 'paint', source: 'sa-car-paint', review: 'Neutral worn enamel; tint comes from the licensed vehicle vertex palette.' },
  { id: 'chrome', source: 'sa-silver-bands', review: 'Selected abstract brushed silver bands. Original bumper candidate rejected because it pictured a car.' },
]) {
  const input = await readFile(`${archive}/${spec.source}.png`);
  const raw = await sharp(input).resize(128, 128).removeAlpha().raw().toBuffer();
  // Paired edge texels make the material repeat without adding a harsh seam.
  const size = 128;
  for (let axis = 0; axis < 2; axis++) for (let i = 0; i < size; i++) for (let j = 0; j < 3; j++) for (let c = 0; c < 3; c++) {
    const a = (axis === 0 ? i * size + j : j * size + i) * 3 + c;
    const b = (axis === 0 ? i * size + size - 1 - j : (size - 1 - j) * size + i) * 3 + c;
    const average = (raw[a]! + raw[b]!) / 2, amount = (3 - j) / 3;
    raw[a] = Math.round(raw[a]! * (1 - amount) + average * amount);
    raw[b] = Math.round(raw[b]! * (1 - amount) + average * amount);
  }
  const bytes = await sharp(raw, { raw: { width: size, height: size, channels: 3 } }).resize(256, 256, { kernel: 'nearest' }).png({ palette: true, colours: 32, dither: 0 }).toBuffer();
  const path = `/art/vehicles/${spec.id}.tile.png`;
  await writeFile(`web/public${path}`, bytes);
  const recipe = recipes.find(value => value.name === spec.source)!;
  const entry = ledger.entries.find((value: { output: string }) => value.output === recipe.output);
  assets.push({ id: spec.id, path, selected: true, width: 256, height: 256, palette: 32, colorSpace: 'srgb', bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), generationId: entry.id, sourceSha256: entry.sha256, model: entry.model, actualCredits: entry.actualCredits, review: spec.review });
}
await writeFile('web/public/art/vehicles/manifest.json', JSON.stringify({ provider: 'Scenario', recipe: 'tools/art/recipes/vehicles.json', assets,
  rejected: [{ generationId: '3fd45cd4-cf13-412a-bc46-ab9e76f7a870', reason: 'Depicted a car front instead of a material swatch; archived outside public payload.' }] }, null, 2) + '\n');
console.log(JSON.stringify({ assets, totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0) }));
