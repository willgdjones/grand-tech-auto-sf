import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const names = ['ferry-title', 'lombard-title', 'golden-gate-title', 'round-closed'];
const ledger = JSON.parse(await readFile('tools/art/ledger.json', 'utf8'));
const manifest = JSON.parse(await readFile('web/public/art/manifest.json', 'utf8'));
const loading = [];
for (const name of names) {
  const chosen = name === 'ferry-title' ? 'ferry-comic' : name === 'lombard-title' ? 'lombard-comic' : name === 'golden-gate-title' ? 'golden-gate-comic' : name;
  const source = `web/public/art/loading/${chosen}.png`, output = `web/public/art/loading/${name}.webp`;
  const bytes = await sharp(source).webp({ quality: 84, effort: 6 }).toBuffer();
  await writeFile(output, bytes);
  const dimensions = await sharp(bytes).metadata();
  const entry = ledger.entries.find((e: { output: string }) => e.output === source);
  loading.push({ id: name, path: `/art/loading/${name}.webp`, source: `/art/loading/${chosen}.png`, width: dimensions.width, height: dimensions.height, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), generationId: entry?.id, colorSpace: 'srgb', usage: name === 'round-closed' ? 'funding round achievement splash artwork' : 'decorative loading/title illustration', selected: true });
}
manifest.loading = loading;
manifest.rejectedLoading = [
  { id: 'ferry-title', selected: false, reason: 'Unrequested branded car and signature; rejected original kept only in ignored local review artifacts.' },
  { id: 'lombard-title', selected: false, reason: 'Too photographic, extra street signs and figure; rejected original kept only in ignored local review artifacts.' },
  { id: 'golden-gate-title', selected: false, reason: 'Founder requested rough inked comic style and character silhouettes instead of clean travel-poster treatment.' },
];
await writeFile('web/public/art/manifest.json', `${JSON.stringify(manifest,null,2)}\n`);
console.log(JSON.stringify({ loading, totals: ledger.totals }, null, 2));
