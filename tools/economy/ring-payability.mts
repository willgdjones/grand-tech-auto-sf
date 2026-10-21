// Diagnostic (founder 12:5x "can't walk through some circles"): for every venue ring the client renders at
// `now`, compare the client ring (venue centroid → createRoadSnapper within 200 m → surface y) with the
// server payout anchors (per event: project → PackedRoads.snap within 150 m, lane edges only) under the
// shared visibility rule. Run: npx tsx tools/economy/ring-payability.mts [ISO now]
import { readFileSync } from 'node:fs';
import { decodePackedRoadGraph, unpackRoadGraph } from '../../shared/roadgraphPacked';
import { focusVenues, representativeEvent } from '../../web/src/events/venues';
import { projectLocation } from '../../web/src/radar/projection';
import { createRoadSnapper } from '../../web/src/render/chunks/terrain';
import { PackedRoads } from '../../worker/src/world/packedRoads';
import { fundingAnchor } from '../../worker/src/funding/anchors';
import { eventVisibilityWindowEnd, eventVisibleIn } from '../../shared/eventVisibility';
import { DRIVE_THROUGH_RADIUS_M, DRIVE_THROUGH_HEIGHT_M } from '../../shared/funding';

const now = Date.parse(process.argv[2] ?? '2026-10-05T03:00:00Z');
const raw = JSON.parse(readFileSync('worker/src/events/data/sf-tech-week.json', 'utf8'));
const events = (Array.isArray(raw) ? raw : raw.events);
const packed = decodePackedRoadGraph(new Uint8Array(readFileSync('tools/map/out/sf/roadgraph.bin'))), graph = unpackRoadGraph(packed);
const frame = JSON.parse(readFileSync('tools/map/out/sf/manifest.json', 'utf8')).frame;
const clientSnap = createRoadSnapper(graph), server = new PackedRoads(packed);
const windowEnd = eventVisibilityWindowEnd(events, now, true);
const venues = focusVenues(events, { now });
const stats = { rings: 0, noServerAnchor: 0, anchorTooFar: 0, heightMismatch: 0, noVisibleEvent: 0, repNotPayable: 0, payable: 0 };
const examples: string[] = [];
for (const venue of venues) {
  const p = projectLocation(venue.lat, venue.lon, frame);
  const road = clientSnap(p.x, p.z, 200);
  if (!road) continue; // client renders no ring
  stats.rings++;
  const ringY = road.y ?? NaN;
  const visible = venue.focus.map(v => v.event).filter(e => eventVisibleIn(e, now, windowEnd));
  if (!visible.length) { stats.noVisibleEvent++; continue; }
  let any = false, repOk = false; const rep = representativeEvent(venue);
  let worst = '';
  for (const e of visible) {
    const a = fundingAnchor(e, server);
    if (!a) { worst ||= 'no-anchor'; continue; }
    const d = Math.hypot(a.x - road.x, a.z - road.z), dy = Number.isFinite(ringY) ? Math.abs(a.y - ringY) : 0;
    if (d > DRIVE_THROUGH_RADIUS_M) { worst ||= `far ${d.toFixed(0)}m`; continue; }
    if (dy > DRIVE_THROUGH_HEIGHT_M) { worst ||= `dy ${dy.toFixed(1)}m`; continue; }
    any = true; if (e.id === rep?.id) repOk = true;
  }
  if (any) { stats.payable++; if (!repOk) stats.repNotPayable++; continue; }
  if (worst === 'no-anchor') stats.noServerAnchor++; else if (worst.startsWith('far')) stats.anchorTooFar++; else stats.heightMismatch++;
  if (examples.length < 12) examples.push(`${venue.title.slice(0, 40).padEnd(40)} ${worst}`);
}
console.log(new Date(now).toISOString(), stats);
console.log(examples.join('\n'));

// Candidate fix check: the server snapping the SAME venue centroid with its lane-only snap (200 m).
{
  let worst = 0, over = 0, none = 0, dyMax = 0; const gaps: number[] = [];
  for (const venue of venues) {
    const p = projectLocation(venue.lat, venue.lon, frame), road = clientSnap(p.x, p.z, 200); if (!road) continue;
    const s = server.snap({ x: p.x * 100, y: 0, z: p.z * 100 }, 200);
    if (!s) { none++; continue; }
    const d = Math.hypot(s.point[0] - road.x, s.point[2] - road.z); gaps.push(d);
    worst = Math.max(worst, d); dyMax = Math.max(dyMax, Math.abs(s.point[1] - road.y)); if (d > 3) over++;
  }
  gaps.sort((a, b) => a - b);
  console.log({ centroidLaneSnap: { worst: worst.toFixed(1), p95: gaps[Math.floor(gaps.length * .95)]?.toFixed(1), over3m: over, none, dyMax: dyMax.toFixed(1) } });
}
