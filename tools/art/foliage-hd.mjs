/** Repack the already-selected Scenario masters for HD. Offline; no paid calls. */
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const size = 512;
for (const [name, selected] of [['palm', 'palm-1'], ['plane', 'plane-2'], ['cypress', 'cypress-1']]) {
  const source = await readFile(`artifacts/street-props/masters/${selected}-source.png`);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Match the original chroma-key selection, before filtering; neutral RGB avoids pink mip fringes.
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = data.subarray(i, i + 3);
    if (Math.min(r - g, b - g) > 12 && r > g * 1.15 && b > g * 1.1) {
      data[i + 3] = 0; data[i] = data[i + 1] = data[i + 2] = Math.min(r, g, b);
    }
  }
  let bottom = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++)
    if (data[(y * info.width + x) * 4 + 3] > 180) bottom = y;
  const bytes = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left: 0, top: 0, width: info.width, height: bottom + 1 })
    .resize(size, size, { fit: 'fill', kernel: 'lanczos3' }).modulate({ saturation: .64 })
    .webp({ quality: 88, alphaQuality: 100, effort: 4 }).toBuffer();
  await writeFile(`web/public/art/foliage/${name}-hd.webp`, bytes);
  console.log(JSON.stringify({ name, selected, size, bytes: bytes.length, sourceSha256: createHash('sha256').update(source).digest('hex') }));
}
