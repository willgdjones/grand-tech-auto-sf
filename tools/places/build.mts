/**
 * Living map places (gtasf-jcxw): curated + Apollo org rows -> web/public/data/places.json.
 *   tools/map/node_modules/.bin/tsx tools/places/build.mts
 * 1. Geocode each address against DataSF Enterprise Addressing System (data.sf.gov 3mea-di5p, PDDL), cached in
 *    tools/places/cache/eas.json. Rows may carry "at": [lat, lon] for places EAS can't address (piers, Presidio).
 * 2. Snap to the DataSF building footprint containing the address point (the map bake's cached 2010-survey footprints);
 *    the pin goes to its centroid and records its id and median height. No containing footprint: the EAS point stands.
 * Unmatched rows are reported and dropped, never guessed.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type PlaceKind = 'lab' | 'bigtech' | 'hackerhouse' | 'vc' | 'accelerator' | 'startup';
export interface SourcePlace { id: string; name: string; kind: PlaceKind; address: string; website: string; blurb: string; at?: [number, number]; source?: 'curated' | 'apollo'; rank?: number }
export interface Place extends Omit<SourcePlace, 'at'> { lat: number; lon: number; building?: string; heightM?: number; geocode: 'eas' | 'manual' }

const ROOT = 'tools/places', CACHE = join(ROOT, 'cache'), MAP_RAW = 'tools/map/out/cache/sf/raw';
const SUFFIX: Record<string, string> = { street: 'ST', st: 'ST', avenue: 'AVE', ave: 'AVE', boulevard: 'BLVD', blvd: 'BLVD', drive: 'DR', dr: 'DR', way: 'WAY', place: 'PL', pl: 'PL', road: 'RD', rd: 'RD', alley: 'ALY', terrace: 'TER', court: 'CT', lane: 'LN' };
/** '88 Colin P Kelly Jr St' -> '88 COLIN P KELLY JR ST' (EAS 'address' field form). Suite/floor suffixes dropped. */
export function easAddress(address: string): string {
  const words = address.replace(/,.*$/, '').replace(/#.*$/, '').replace(/\./g, '').trim().split(/\s+/);
  const last = words.length - 1; if (last > 0) words[last] = SUFFIX[words[last]!.toLowerCase()] ?? words[last]!;
  // EAS zero-pads single-digit numbered streets: '3rd St' -> '03RD ST'.
  return words.map((w, i) => i > 0 && /^\d(st|nd|rd|th)$/i.test(w) ? `0${w}` : w).join(' ').toUpperCase();
}

async function easLookup(address: string, cache: Record<string, [number, number] | null>): Promise<[number, number] | null> {
  const hit = await easExact(easAddress(address), cache);
  // Some SF streets carry no type in EAS ('35 SOUTH PARK', not '... PARK ST'): retry without the suffix.
  return hit ?? (/ (ST|AVE|BLVD|DR|WAY|PL|RD|ALY|TER|CT|LN)$/.test(easAddress(address)) ? easExact(easAddress(address).replace(/ \w+$/, ''), cache) : null);
}
async function easExact(key: string, cache: Record<string, [number, number] | null>): Promise<[number, number] | null> {
  if (key in cache) return cache[key]!;
  const url = `https://data.sf.gov/resource/3mea-di5p.json?$select=latitude,longitude&$limit=1&address=${encodeURIComponent(key)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`EAS HTTP ${response.status} for ${key}`);
  const rows = await response.json() as { latitude?: string; longitude?: string }[];
  const hit = rows[0]?.latitude ? [Number(rows[0].latitude), Number(rows[0].longitude)] as [number, number] : null;
  cache[key] = hit; await new Promise(r => setTimeout(r, 150)); // polite
  return hit;
}

type Footprint = { id: string; ring: [number, number][]; cx: number; cy: number; h: number; box: [number, number, number, number] };
async function footprints(): Promise<Footprint[]> {
  const out: Footprint[] = [];
  for (const f of (await readdir(MAP_RAW)).filter(f => f.endsWith('.bin.json'))) {
    const record = JSON.parse(await readFile(join(MAP_RAW, f), 'utf8')) as { key: string };
    if (!/^datasf-\d+$/.test(record.key)) continue;
    const rows = JSON.parse(await readFile(join(MAP_RAW, f.slice(0, -5)), 'utf8')) as { sf16_bldgid: string; shape: { coordinates: [number, number][][][] }; hgt_median_m?: string }[];
    for (const row of rows) {
      const ring = row.shape?.coordinates?.[0]?.[0]; if (!ring?.length) continue;
      let cx = 0, cy = 0; for (const [x, y] of ring) { cx += x; cy += y; } cx /= ring.length; cy /= ring.length;
      const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
      out.push({ id: row.sf16_bldgid, ring, cx, cy, h: Number(row.hgt_median_m ?? 0), box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
  }
  return out;
}
function inside([x, y]: [number, number], ring: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
export function snap(lon: number, lat: number, all: readonly Footprint[]): Footprint | undefined {
  // DataSF footprints are the 2010 survey (sf16 ids 201006.*): newer towers/HQs (Salesforce Tower 2018, Mission Bay)
  // are absent and old lots show as sub-metre pieces. Ignore anything under 3 m; the EAS point then stands alone.
  const near = all.filter(f => f.h >= 3 && lon > f.box[0] - .0006 && lon < f.box[2] + .0006 && lat > f.box[1] - .0005 && lat < f.box[3] + .0005);
  // Only a footprint that contains the address point counts: a neighbour within tens of metres is often a different
  // (older) building next to a newer tower (181 Fremont snapped to a 15 m neighbour). Tallest containing piece wins.
  return near.filter(f => inside([lon, lat], f.ring)).sort((a, b) => b.h - a.h)[0];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(CACHE, { recursive: true });
  const cacheFile = join(CACHE, 'eas.json');
  const cache = existsSync(cacheFile) ? JSON.parse(await readFile(cacheFile, 'utf8')) as Record<string, [number, number] | null> : {};
  const curated = (JSON.parse(await readFile(join(ROOT, 'curated.json'), 'utf8')) as { places: SourcePlace[] }).places.map(p => ({ ...p, source: 'curated' as const }));
  const apolloFile = join(ROOT, 'apollo-orgs.json');
  const apollo = existsSync(apolloFile) ? (JSON.parse(await readFile(apolloFile, 'utf8')) as { places: SourcePlace[] }).places.map(p => ({ ...p, source: 'apollo' as const })) : [];
  const denyFile = join(ROOT, 'takedown.json');
  const removed = new Set(existsSync(denyFile) ? (JSON.parse(await readFile(denyFile, 'utf8')) as { places: string[] }).places : []);
  const seen = new Set<string>(removed), all = await footprints(), places: Place[] = [], dropped: string[] = [...removed].map(id => `${id} (takedown)`);
  for (const p of [...curated, ...apollo]) {
    const nameKey = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(p.id) || seen.has(nameKey)) continue; seen.add(p.id); seen.add(nameKey);
    const at = p.at ?? await easLookup(p.address, cache);
    if (!at) { dropped.push(`${p.id} (${easAddress(p.address)}: no EAS match)`); continue; }
    const f = snap(at[1], at[0], all);
    const { at: _at, ...rest } = p;
    places.push({ ...rest, lat: +(f ? f.cy : at[0]).toFixed(6), lon: +(f ? f.cx : at[1]).toFixed(6), ...(f ? { building: f.id, heightM: +f.h.toFixed(1) } : {}), geocode: p.at ? 'manual' : 'eas' });
  }
  await writeFile(cacheFile, JSON.stringify(cache, null, 1) + '\n');
  const out = { version: 1, generated: new Date().toISOString().slice(0, 10),
    sources: ['curated (tools/places/curated.json)', 'DataSF Enterprise Addressing System 3mea-di5p (PDDL)', 'DataSF building footprints (PDDL)', ...(apollo.length ? ['Apollo organization search (firmographics)'] : [])],
    places };
  await mkdir('web/public/data', { recursive: true });
  await writeFile('web/public/data/places.json', JSON.stringify(out) + '\n');
  // Pitch targets for the worker (gtasf-y5vc): VC/accelerator offices, a tiny generated module (no web JSON import).
  const vcs = places.filter(p => p.kind === 'vc' || p.kind === 'accelerator').map(p => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon }));
  await writeFile('shared/content/pitchVcs.ts', `// Generated by tools/places/build.mts from web/public/data/places.json. Do not edit by hand.\nexport const PITCH_VCS: readonly { id: string; name: string; lat: number; lon: number }[] = ${JSON.stringify(vcs, null, 1)};\n`);
  const kinds = places.reduce<Record<string, number>>((m, p) => (m[p.kind] = (m[p.kind] ?? 0) + 1, m), {});
  console.log(JSON.stringify({ places: places.length, snapped: places.filter(p => p.building).length, kinds, dropped }, null, 1));
}
