import { flags } from '@gtasf/shared/flags';
import type { RoadEdge, RoadGraph } from '@gtasf/shared/roadgraph';
import { LOCAL_ROAD_GRAPH } from './localRoadData';
import { LocalRoads, routePose } from './localRoads';
import { LOCAL_SPAWN } from './localSpawn';
import type { ParkingBay } from './ferryParking';

const hash = (value: string) => {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
};

/** Bounded starter stock along the sourced street network, sharing Ferry's bay lifecycle.
 * Outermost lanes only; no connectors, junction mouths, fast roads or steep switchbacks.
 * Additional stock needs the Worker graphicsV2 flag, never a client-authored vehicle. */
export function streetParkingBays(graph: RoadGraph = LOCAL_ROAD_GRAPH, options: { roads?: LocalRoads; limit?: number } = {}): ParkingBay[] {
  const outer = new Map<string, RoadEdge>();
  for (const edge of graph.edges) {
    const meta = edge as RoadEdge & { bridge?: boolean; tunnel?: boolean; layer?: number; osmWay?: number };
    if (meta.bridge || meta.tunnel || meta.layer) continue;
    if (!edge.id.startsWith('lane:') || edge.lengthM < 65 || edge.speedMps > 13.5 || edge.speedMps < 4) continue;
    // Packed city IDs are lane:<compact-id>, not the corridor's way/direction/lane IDs.
    const first = edge.points[0]!, last = edge.points.at(-1)!;
    const direction = Math.round(Math.atan2(last[0] - first[0], last[2] - first[2]) * 4 / Math.PI);
    const key = meta.osmWay === undefined ? edge.id.slice(0, edge.id.lastIndexOf(':')) : `way:${meta.osmWay}:${direction}`;
    if (!outer.has(key) || outer.get(key)!.lane < edge.lane) outer.set(key, edge);
  }
  const roads = options.roads ?? new LocalRoads(graph), bays: ParkingBay[] = [];
  const kinds = ['prius', 'tesla', 'subaru'] as const;
  for (const edge of [...outer.values()].sort((a, b) => hash(a.id) - hash(b.id))) {
    if (bays.length >= (options.limit ?? 24)) break;
    const segment = roads.approach({ edge, point: edge.points[0]!, along: edge.lengthM / 2, distance: 0 }, .5).at(-1);
    if (!segment) continue;
    const dx = segment.to[0] - segment.from[0], dz = segment.to[2] - segment.from[2], length = Math.hypot(dx, dz);
    if (length < .1 || Math.abs(segment.to[1] - segment.from[1]) / length > .12) continue;
    const pose = routePose(segment, segment.length);
    // Keep the Ferry's authored stock/drop-off and the Lombard switchback entrance unchanged.
    if (Math.hypot(pose.x - LOCAL_SPAWN.x, pose.z - LOCAL_SPAWN.z) < 10_000
      || (pose.x > -113_000 && pose.x < -100_000 && pose.z > -205_000 && pose.z < -190_000)) continue;
    // Park beyond the outer lane, parallel to its heading, like the Ferry kerb bays.
    pose.x += Math.round(dz / length * 250); pose.z -= Math.round(dx / length * 250);
    if (roads.snap(pose, 1.6, 2) || graph.nodes.some(node => Math.hypot(node.x * 100 - pose.x, node.z * 100 - pose.z) < 2000)
      || bays.some(bay => Math.hypot(bay.pose.x - pose.x, bay.pose.z - pose.z) < 3500)) continue;
    bays.push({ kind: kinds[bays.length % kinds.length]!, pose });
  }
  return bays;
}

/** Four parallel bays per district, derived from the configured map rather than invented poses.
 * Only the local candidate edges are decoded; no second whole-city graph is retained. */
export function districtParkingBays(roads: LocalRoads): ParkingBay[] {
  const centres = [
    [550, 100], [-1200, 2600], [-1500, 800], [750, 2600],
    [-5000, -200], [-6500, 2600], [-3000, -2200], [-300, -1700],
  ] as const; // SoMa, Mission, Hayes, Dogpatch, Richmond, Sunset, Marina, North Beach.
  const bays: ParkingBay[] = [];
  for (const [x, z] of centres) {
    const nearby = roads.lanesNear({ x, z }, 450);
    // Include source endpoints of nearby lanes when keeping junction mouths clear.
    const nodes = nearby.flatMap(edge => [edge.points[0]!, edge.points.at(-1)!]).map((p, i) => ({ id: String(i), x: p[0], y: p[1], z: p[2] }));
    const candidates = nearby.filter(edge => edge.points.some(p => Math.hypot(p[0] - x, p[2] - z) <= 450));
    const district = streetParkingBays({ version: 1, nodes, edges: candidates }, { roads, limit: 4 });
    for (const bay of district) if (!bays.some(old => Math.hypot(old.pose.x - bay.pose.x, old.pose.z - bay.pose.z) < 3500)) bays.push(bay);
  }
  // A VC's absurd supercar in Pacific Heights near Jackson & Fillmore (Broadway is too steep for a bay;
  // checked against the whole-city graph). Appended
  // last so the district bays above keep their stable local IDs. [gtasf-txt]
  if (flags.vcSupercar) {
    const [x, z] = [-2290, -922], nearby = roads.lanesNear({ x, z }, 220);
    const nodes = nearby.flatMap(edge => [edge.points[0]!, edge.points.at(-1)!]).map((p, i) => ({ id: String(i), x: p[0], y: p[1], z: p[2] }));
    const [bay] = streetParkingBays({ version: 1, nodes, edges: [...nearby] }, { roads, limit: 1 });
    if (bay && !bays.some(old => Math.hypot(old.pose.x - bay.pose.x, old.pose.z - bay.pose.z) < 3500)) bays.push({ ...bay, kind: 'supercar' });
  }
  return bays;
}
