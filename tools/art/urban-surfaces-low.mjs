/** Offline Low derivative of the approved fal atlas; no generation/API calls. */
import sharp from 'sharp';
const input = new URL('../../web/public/art/urban-surfaces.webp', import.meta.url);
const output = new URL('../../web/public/art/urban-surfaces-low.webp', import.meta.url);
const result = await sharp(input.pathname).resize(576, 384, { kernel: 'lanczos3' })
  .webp({ quality: 80, effort: 4 }).toFile(output.pathname);
console.log(JSON.stringify({ width: result.width, height: result.height, bytes: result.size }));
