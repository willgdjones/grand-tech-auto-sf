/**
 * Place logos (gtasf-jcxw): each place's own site icon -> 128 px tiles in 1024x1024 WebP atlas pages (1 MP decoded
 * cap per page, 64 tiles each) under web/public/data/place-logos/, plus index.json { id: { page, x, y, kind } }.
 *   tools/map/node_modules/.bin/tsx tools/places/logos.mts
 * Source order per site: apple-touch-icon link, the largest PNG/SVG <link rel=icon>, /apple-touch-icon.png. No
 * og:image (banners) and no .ico (not decodable here). No icon, or a denylisted place (tools/places/takedown.json):
 * a lettermark tile (initial on the kind colour). Raw icons are cached in tools/places/cache/logos/ (ignored by git).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = 'tools/places', RAW = join(ROOT, 'cache', 'logos'), OUT = 'web/public/data/place-logos';
const TILE = 128, PAGE = 1024, PER_ROW = PAGE / TILE, PER_PAGE = PER_ROW * PER_ROW;
const KIND_COLOUR: Record<string, string> = { lab: '#6b4fd8', bigtech: '#1f6feb', startup: '#16a34a', hackerhouse: '#ea580c', vc: '#ca8a04', accelerator: '#db2777' };
type Place = { id: string; name: string; kind: string; website: string };
const UA = 'Mozilla/5.0 (compatible; GTASF-places/1.0; +https://gtasf.com)';

async function get(url: string, accept: string): Promise<Response | undefined> {
  try { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, redirect: 'follow', signal: AbortSignal.timeout(8000) }); return r.ok ? r : undefined; } catch { return undefined; }
}
/** Icon candidates from a homepage, best first. */
export function iconLinks(html: string, base: string): string[] {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
  const scored: { url: string; score: number }[] = [];
  for (const tag of links) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase(), href = attr(tag, 'href'); if (!href || !/icon/.test(rel)) continue;
    let url: string; try { url = new URL(href, base).href; } catch { continue; }
    if (/\.ico(\?|$)/i.test(url)) continue;
    const size = Number((attr(tag, 'sizes') ?? '').split(/x/i)[0]) || 0, svg = /\.svg(\?|$)/i.test(url) || /svg/.test(attr(tag, 'type') ?? '');
    scored.push({ url, score: (rel.includes('apple-touch-icon') ? 1000 : 0) + (svg ? 500 : 0) + Math.min(size, 512) });
  }
  return [...new Set(scored.sort((a, b) => b.score - a.score).map(s => s.url))];
}
async function fetchIcon(place: Place): Promise<Buffer | undefined> {
  const file = join(RAW, `${place.id}.bin`);
  if (existsSync(file)) { const b = await readFile(file); return b.length ? b : undefined; }
  const home = await get(place.website, 'text/html');
  const html = home ? await home.text().catch(() => '') : '';
  const base = home?.url ?? place.website;
  for (const url of [...iconLinks(html, base), new URL('/apple-touch-icon.png', base).href]) {
    const r = await get(url, 'image/*'); if (!r) continue;
    const bytes = Buffer.from(await r.arrayBuffer());
    try { const meta = await sharp(bytes).metadata(); if ((meta.width ?? 0) >= 32) { await writeFile(file, bytes); return bytes; } } catch { /* not an image */ }
  }
  await writeFile(file, Buffer.alloc(0)); return undefined;
}
function lettermark(place: Place): Buffer {
  const letter = (place.name.match(/[A-Za-z0-9]/)?.[0] ?? '?').toUpperCase(), colour = KIND_COLOUR[place.kind] ?? '#475569';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}"><rect width="${TILE}" height="${TILE}" rx="24" fill="${colour}"/><text x="50%" y="54%" font-family="Helvetica, Arial, sans-serif" font-size="72" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="middle">${letter}</text></svg>`);
}
async function tile(place: Place, icon: Buffer | undefined): Promise<{ png: Buffer; kind: 'logo' | 'lettermark' }> {
  if (icon) {
    try {
      // Logo on a white rounded tile with padding, so dark and transparent icons both read on the map.
      const inner = await sharp(icon, { density: 300 }).resize(TILE - 24, TILE - 24, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      // White-on-transparent icons vanish on the white tile: if the visible pixels are nearly all light, use a dark tile.
      const { data } = await sharp(inner).raw().toBuffer({ resolveWithObject: true });
      let lum = 0, seen = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 128) { lum += (.2126 * data[i]! + .7152 * data[i + 1]! + .0722 * data[i + 2]!) / 255; seen++; }
      const fill = seen && lum / seen > .85 ? '#1e293b' : '#fff';
      const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}"><rect width="${TILE}" height="${TILE}" rx="24" fill="${fill}"/></svg>`);
      return { png: await sharp(bg).composite([{ input: inner, left: 12, top: 12 }]).png().toBuffer(), kind: 'logo' };
    } catch { /* fall through */ }
  }
  return { png: await sharp(lettermark(place)).png().toBuffer(), kind: 'lettermark' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(RAW, { recursive: true }); await mkdir(OUT, { recursive: true });
  const places = (JSON.parse(await readFile('web/public/data/places.json', 'utf8')) as { places: Place[] }).places;
  const denyFile = join(ROOT, 'takedown.json');
  const deny = new Set(existsSync(denyFile) ? (JSON.parse(await readFile(denyFile, 'utf8')) as { logos: string[] }).logos : []);
  const icons = new Map<string, Buffer | undefined>();
  for (let i = 0; i < places.length; i += 6) await Promise.all(places.slice(i, i + 6).map(async p => icons.set(p.id, deny.has(p.id) ? undefined : await fetchIcon(p))));
  const index: Record<string, { page: number; x: number; y: number; kind: 'logo' | 'lettermark' }> = {};
  const pages: { input: Buffer; left: number; top: number }[][] = [];
  for (const [i, p] of places.entries()) {
    const page = Math.floor(i / PER_PAGE), slot = i % PER_PAGE, x = (slot % PER_ROW) * TILE, y = Math.floor(slot / PER_ROW) * TILE;
    const t = await tile(p, icons.get(p.id)); (pages[page] ??= []).push({ input: t.png, left: x, top: y }); index[p.id] = { page, x, y, kind: t.kind };
  }
  let total = 0;
  for (const [n, list] of pages.entries()) {
    const webp = await sharp({ create: { width: PAGE, height: PAGE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(list).webp({ quality: 80, alphaQuality: 80 }).toBuffer();
    await writeFile(join(OUT, `page-${n}.webp`), webp); total += webp.length;
  }
  await writeFile(join(OUT, 'index.json'), JSON.stringify({ version: 1, tile: TILE, page: PAGE, pages: pages.length, logos: index }) + '\n');
  const logos = Object.values(index).filter(v => v.kind === 'logo').length;
  console.log(JSON.stringify({ places: places.length, logos, lettermarks: places.length - logos, pages: pages.length, atlasBytes: total, denylisted: deny.size }));
}
