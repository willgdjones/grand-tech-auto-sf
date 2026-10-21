/**
 * gtasf-0k01: post-process an existing bake (NO rebake) into roadgraph-near.bin, a small spawn-area
 * road graph the client (flags.nearRoadGraph) loads before READY; the full city graph streams after.
 * Coverage: 1.5 km around the Ferry Building default spawn + 600 m around every /go/ place
 * (web/src/spawn/locations.ts PLACES, district spawns included).
 *   tools/map/node_modules/.bin/tsx tools/map/roadgraph-subset.mts --root=tools/map/out/sf
 * Adds manifest.roadGraphNear; run before src/pack/publication.ts (deploy.mjs does this).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FERRY, PLACES, placePoint } from '../../web/src/spawn/locations';
import { writeNearRoadGraph, type NearCentre } from './src/pack/roadgraphNear';

export const FERRY_RADIUS_M = 1500, PLACE_RADIUS_M = 600;
// gtasf-8hr5: MAP_NEAR_FERRY_RADIUS_M / MAP_NEAR_PLACE_RADIUS_M shrink the published spawn-circle
// graphs (~9 MB of first-load parts, one fetched per session) to claw back whole-city payload budget.
// Unset = the defaults above. A smaller circle just means a deep-link spawn waits for the full city
// graph (which always ships) a little longer before its first route; correctness is unchanged.
const envRadius = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name}: want a positive metre radius, got '${raw}'`);
  return value;
};
export function defaultNearCentres(): NearCentre[] {
  const ferry = envRadius('MAP_NEAR_FERRY_RADIUS_M', FERRY_RADIUS_M), place = envRadius('MAP_NEAR_PLACE_RADIUS_M', PLACE_RADIUS_M);
  return PLACES.map(p => ({ id: p.slug, ...placePoint(p), radiusM: p.slug === FERRY.slug ? ferry : place }));
}
/** Committed Tech Week venue circles (near-event-centres.mts) so /e/ arrivals also get a small graph. */
async function eventCentres(): Promise<NearCentre[]> {
  try { return JSON.parse(await readFile(new URL('./near-event-centres.json', import.meta.url), 'utf8')) as NearCentre[]; } catch { return []; }
}
/** MAP_NEAR_UNION=1 publishes one deduped citywide near graph instead of 50 overlapping per-centre
 *  parts (gtasf-tdbw): smaller whole-city payload, bigger first-load near download. Off by default. */
export const nearUnion = (): boolean => {
  const raw = process.env.MAP_NEAR_UNION;
  return raw === '1' || raw === 'true';
};
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = process.argv.find(a => a.startsWith('--root='))?.slice(7);
  if (!root) throw new Error('Usage: roadgraph-subset.mts --root=<map output dir>');
  const union = nearUnion();
  const artifact = await writeNearRoadGraph(resolve(root), [...defaultNearCentres(), ...await eventCentres()], { union });
  console.log(JSON.stringify({ path: artifact.path, bytes: artifact.bytes, gzipBytes: artifact.gzipBytes, decodedBytes: artifact.decodedBytes ?? artifact.bytes, centres: artifact.coverage.length, parts: artifact.parts?.length ?? 0, union }));
}
