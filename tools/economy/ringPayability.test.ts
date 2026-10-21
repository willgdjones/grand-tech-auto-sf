// Founder 12:5x "can't walk through some circles": every event ring the client draws must be payable by the
// server. Client ring = focusVenues centroid → createRoadSnapper (200 m). Server ring = the same shared venue
// bucket/centroid → fundingAnchor (WorldFunding.ensureDriveIndex). Fails if any visible ring is unpayable.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePackedRoadGraph, unpackRoadGraph } from '../../shared/roadgraphPacked';
import type { RoadGraph } from '../../shared/roadgraph';
import { DRIVE_THROUGH_HEIGHT_M, DRIVE_THROUGH_RADIUS_M } from '../../shared/funding';
import { eventVisibilityWindowEnd, eventVisibleIn, venueBuckets, venueCentroid, venueKey } from '../../shared/eventVisibility';
import { focusVenues } from '../../web/src/events/venues';
import { projectLocation } from '../../web/src/radar/projection';
import { createRoadSnapper } from '../../web/src/render/chunks/terrain';
import { fundingAnchor } from '../../worker/src/funding/anchors';
import { LocalRoads } from '../../worker/src/world/localRoads';
import { PackedRoads } from '../../worker/src/world/packedRoads';
import { LOCAL_ROAD_GRAPH } from '../../worker/src/world/localRoadData';

const raw = JSON.parse(readFileSync(new URL('../../worker/src/events/data/sf-tech-week.json', import.meta.url), 'utf8'));
const EVENTS = (Array.isArray(raw) ? raw : raw.events) as Parameters<typeof focusVenues>[0];
const FRAME = { origin: { lat: 37.7842, lon: -122.4078 }, gridRotationDeg: 0 };
const RING_OUTER_M = 2.75, MARGIN_M = 1; // the drawn ring must sit fully inside the payout radius

function unpayable(graph: RoadGraph, server: Pick<LocalRoads, 'snap'>, now: number): string[] {
  const snap = createRoadSnapper(graph), windowEnd = eventVisibilityWindowEnd(EVENTS, now, true);
  const buckets = venueBuckets(EVENTS), failures: string[] = [];
  for (const venue of focusVenues(EVENTS, { now })) {
    const p = projectLocation(venue.lat, venue.lon, FRAME as never), ring = snap(p.x, p.z, 200);
    if (!ring) continue; // the client draws no ring here
    const visible = venue.focus.map(v => v.event).filter(e => eventVisibleIn(e, now, windowEnd));
    if (!visible.length) { failures.push(`${venue.title}: ring with no server-visible event`); continue; }
    const bucket = buckets.get(venueKey(visible[0]!));
    const anchor = bucket && fundingAnchor(venueCentroid(bucket), server);
    if (!anchor) { failures.push(`${venue.title}: no server anchor`); continue; }
    const d = Math.hypot(anchor.x - ring.x, anchor.z - ring.z), dy = Math.abs(anchor.y - ring.y);
    if (d + RING_OUTER_M + MARGIN_M > DRIVE_THROUGH_RADIUS_M) failures.push(`${venue.title}: anchor ${d.toFixed(1)} m from ring`);
    else if (dy > DRIVE_THROUGH_HEIGHT_M) failures.push(`${venue.title}: height off ${dy.toFixed(1)} m`);
    else if (!visible.every(e => bucket!.includes(e))) failures.push(`${venue.title}: visible event not paid at this ring`);
  }
  return failures;
}
const NOWS = ['2026-10-05T03:00:00Z', '2026-10-05T19:00:00Z', '2026-10-07T19:00:00Z', '2026-10-09T23:00:00Z'].map(Date.parse);

describe('every visible event ring is payable (client ring == server anchor)', () => {
  it('on the committed Ferry–Lombard corridor graph', () => {
    const server = new LocalRoads(LOCAL_ROAD_GRAPH);
    for (const now of NOWS) expect(unpayable(LOCAL_ROAD_GRAPH, server, now)).toEqual([]);
  });
  const city = new URL('../map/out/sf/roadgraph.bin', import.meta.url);
  it.skipIf(!existsSync(city))('on the published whole-city graph (local map build)', () => {
    const packed = decodePackedRoadGraph(new Uint8Array(readFileSync(city))), server = new PackedRoads(packed);
    const graph = unpackRoadGraph(packed);
    for (const now of NOWS) expect(unpayable(graph, server, now)).toEqual([]);
  }, 300_000);
});
