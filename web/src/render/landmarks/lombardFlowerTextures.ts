import { ImageLoader, RepeatWrapping, SRGBColorSpace, Texture } from 'three';

/** Painted fallbacks plus bundled fal botanical cards. Four runtime maps total 0.61 MP. */
export function gardenRandom(seed: number): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function paint(size: number, name: string, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Lombard plant textures require a 2D canvas.');
  draw(ctx);
  const texture = new Texture(canvas); texture.needsUpdate = true; texture.name = name;
  texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}
/** Keep the painted texture visible while its bundled 512px botanical card loads. */
export function loadLombardPlantImage(texture: Texture, url: string): void {
  let disposed = false;
  texture.addEventListener('dispose', () => { disposed = true; });
  void new ImageLoader().loadAsync(url).then(image => {
    // A remounted garden owns a new texture; a late download must never revive the old one.
    if (disposed || image.width !== 512 || image.height !== 512) return;
    texture.image = image as typeof texture.image; texture.needsUpdate = true; // an img and the painted canvas are both valid sources
  }, () => { /* Offline or missing art: retain the original painted leaves/petals. */ });
}
function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, length: number, angle: number, light: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  const g = ctx.createLinearGradient(-length * .3, 0, length * .35, -length);
  g.addColorStop(0, `hsl(107 38% ${light * .55}%)`);
  g.addColorStop(.5, `hsl(89 43% ${light}%)`); g.addColorStop(1, `hsl(83 40% ${light + 9}%)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0);
  // Broad hydrangea leaves with a pointed tip and a gently serrated margin.
  for (const side of [-1, 1]) {
    for (let i = 0; i <= 14; i++) {
      const t = side < 0 ? i / 14 : 1 - i / 14;
      ctx.lineTo(side * Math.sin(t * Math.PI) * length * (.32 + (i % 2) * .025), -t * length);
    }
  }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(201,214,127,.34)'; ctx.lineWidth = .9;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -length * .95);
  for (let i = 1; i < 5; i++) {
    const y0 = -length * i / 6, w = Math.sin(i / 6 * Math.PI) * length * .25;
    ctx.moveTo(0, y0); ctx.lineTo(-w, y0 - length * .13);
    ctx.moveTo(0, y0); ctx.lineTo(w, y0 - length * .13);
  }
  ctx.stroke(); ctx.restore();
}
export function createLombardFlowerTextures() {
  const foliage = paint(512, 'Lombard hydrangea leaves and stems', ctx => {
    const random = gardenRandom(31);
    const leaves = Array.from({ length: 110 }, () => {
      const a = random() * Math.PI * 2, r = Math.sqrt(random());
      return { x: 256 + Math.cos(a) * r * 190, y: 282 + Math.sin(a) * r * 152, a: (random() - .5) * 4, r };
    }).sort((a, b) => b.y - a.y);
    ctx.strokeStyle = '#736c3d'; ctx.lineWidth = 3;
    for (const p of leaves) { ctx.beginPath(); ctx.moveTo(256, 475); ctx.quadraticCurveTo(242, 320, p.x, p.y); ctx.stroke(); }
    for (const p of leaves) leaf(ctx, p.x, p.y, 45 + random() * 40, p.a, 25 + random() * 15);
  });
  const flowers = paint(512, 'Lombard four-petal hydrangea florets', ctx => {
    const random = gardenRandom(82);
    // Overlapping individual florets produce a broken silhouette and a soft domed head.
    for (let i = 0; i < 190; i++) {
      const a = i * 2.399963, r = Math.sqrt(i / 190) * 205;
      const x = 256 + Math.cos(a) * r, y = 248 + Math.sin(a) * r * .9;
      const shade = 64 + 28 * Math.sqrt(1 - (r / 216) ** 2) + random() * 6;
      ctx.save(); ctx.translate(x, y); ctx.rotate(random() * Math.PI);
      for (let petal = 0; petal < 4; petal++) {
        ctx.rotate(Math.PI / 2);
        const g = ctx.createRadialGradient(0, -13, 1, 0, -6, 18);
        g.addColorStop(0, `hsl(40 12% ${Math.min(98, shade + 9)}%)`);
        g.addColorStop(.65, `hsl(32 8% ${shade}%)`); g.addColorStop(1, `hsl(290 8% ${shade * .66}%)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, -10, 9 + random() * 3, 15, .1, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#c2c598'; ctx.beginPath(); ctx.arc(0, 0, 2.1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  });
  const hedge = paint(256, 'Lombard clipped box hedge leaf texture', ctx => {
    // Lit boxwood green, not the old near-black olive: a mid green base with lighter leafy specks so clipped hedges
    // read green and leafy even on their shaded faces, never as solid black slabs.
    const random = gardenRandom(7); ctx.fillStyle = '#5c8a4e'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1600; i++) {
      ctx.fillStyle = `hsl(${92 + random() * 26} ${38 + random() * 18}% ${36 + random() * 26}%)`;
      ctx.beginPath(); ctx.ellipse(random() * 256, random() * 256, 2 + random() * 3, 1.5 + random() * 2, random() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
  });
  const soil = paint(128, 'Lombard soil and small mulch chips', ctx => {
    // Lighter warm mulch so the bed bases read as soil, not black, under low sun.
    const random = gardenRandom(19); ctx.fillStyle = '#6b5a41'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2200; i++) {
      ctx.fillStyle = `hsl(${25 + random() * 16} 25% ${24 + random() * 24}%)`;
      ctx.fillRect(random() * 128, random() * 128, 1 + random() * 3, 1 + random() * 2);
    }
  });
  for (const map of [hedge, soil]) map.wrapS = map.wrapT = RepeatWrapping;
  loadLombardPlantImage(foliage, '/art/foliage/lombard-leaves-v1.webp');
  loadLombardPlantImage(flowers, '/art/foliage/lombard-petals-v1.webp');
  return { foliage, flowers, hedge, soil };
}
