/**
 * gtasf-0k01: extra near-road-graph centres for Tech Week venues that the default spawn circles miss, so
 * organiser /e/<event> arrivals also load a small spawn-area graph instead of the 11 MB city graph.
 * Greedy cover of upcoming mapped events (600 m usable radius); writes near-event-centres.json, which
 * roadgraph-subset.mts includes. Re-run when the event list changes much:
 *   tools/map/node_modules/.bin/tsx tools/map/near-event-centres.mts [events-url]
 */
import { writeFile } from 'node:fs/promises';
import { geodeticToWorld } from './src/geo';
import { SF_FRAME } from './src/config';
import { defaultNearCentres } from './roadgraph-subset.mts';

export const EVENT_RADIUS_M = 850; // the client needs spawn + 250 m inside the circle -> 600 m usable
const url = process.argv[2] ?? 'https://gtasf.com/api/events';
const now = new Date().toISOString();
const events = ((await (await fetch(url)).json()) as { events: { lat: number | null; lon: number | null; start?: string }[] }).events
  .filter(e => e.lat != null && e.lon != null && (!e.start || e.start > now));
const base = defaultNearCentres();
let left = events.map(e => geodeticToWorld(e.lat!, e.lon!, SF_FRAME))
  .filter(([x, z]) => !base.some(c => Math.hypot(x - c.x, z - c.z) + 250 <= c.radiusM));
const usable = EVENT_RADIUS_M - 250, centres: { id: string; x: number; z: number; radiusM: number }[] = [];
while (left.length) {
  let best = left[0]!, bestCount = -1;
  for (const p of left) { const n = left.filter(q => Math.hypot(q[0] - p[0], q[1] - p[1]) <= usable).length; if (n > bestCount) { bestCount = n; best = p; } }
  centres.push({ id: `events-${centres.length + 1}`, x: Math.round(best[0] * 100) / 100, z: Math.round(best[1] * 100) / 100, radiusM: EVENT_RADIUS_M });
  left = left.filter(q => Math.hypot(q[0] - best[0], q[1] - best[1]) > usable);
}
await writeFile(new URL('./near-event-centres.json', import.meta.url), JSON.stringify(centres, null, 2) + '\n');
console.log(JSON.stringify({ events: events.length, centres: centres.length }));
