import { ROAD_EDGE_FLAGS, ROAD_NODE_FLAGS, ROAD_PACK_HEADER_BYTES, ROAD_PACK_MAGIC, ROAD_PACK_VERSION,
  roadPackColumns, roadPackLayout, type PackedPublicRoadGraph, type RoadPackCounts } from '../../../../shared/roadgraphPacked';

const utf8 = new TextEncoder();
const integer = (value: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`ROAD_PACK_${label}`);
  return value;
};
const coordinate = (value: number) => integer(Math.round(value * 100), -0x80000000, 0x7fffffff, 'COORDINATE');
/** Offline only: preserves the collision-cleared source graph, without simplifying topology. */
export function packRoadGraph(graph: PackedPublicRoadGraph, options: { routableEdgeIds?: ReadonlySet<string> } = {}): Uint8Array {
  if (graph.version !== 1) throw new Error('ROAD_PACK_SOURCE_VERSION');
  const nodes = new Map(graph.nodes.map((n, i) => [n.id, i])), edges = new Map(graph.edges.map((e, i) => [e.id, i]));
  if (nodes.size !== graph.nodes.length || edges.size !== graph.edges.length) throw new Error('ROAD_PACK_DUPLICATE_ID');
  const pool: Uint8Array[] = [], strings = new Map<string, number>(); let stringBytes = 0;
  const intern = (value: string) => {
    if (typeof value !== 'string') throw new Error('ROAD_PACK_STRING');
    const old = strings.get(value); if (old !== undefined) return old;
    const index = pool.length, bytes = utf8.encode(value); pool.push(bytes); strings.set(value, index); stringBytes += bytes.length; return index;
  };
  intern('');
  const pointParts: Uint8Array[] = [], pointOffsets = [0], nextOffsets = [0];
  const point = (delta: number, result: number[]) => {
    integer(delta, -0x80000000, 0x7fffffff, 'DELTA');
    let value = ((delta << 1) ^ (delta >> 31)) >>> 0;
    while (value >= 128) { result.push((value & 127) | 128); value >>>= 7; }
    result.push(value);
  };
  for (const n of graph.nodes) { intern(n.id); intern(n.osmNode); coordinate(n.x); coordinate(n.y); coordinate(n.z); }
  for (const e of graph.edges) {
    intern(e.id); intern(e.name);
    if (!nodes.has(e.from) || !nodes.has(e.to) || e.points.length < 2) throw new Error('ROAD_PACK_TOPOLOGY');
    const origin = graph.nodes[nodes.get(e.from)!]!, previous = [coordinate(origin.x), coordinate(origin.y), coordinate(origin.z)], result: number[] = [];
    for (const p of e.points) for (let axis = 0; axis < 3; axis++) { const value = coordinate(p[axis]!); point(value - previous[axis]!, result); previous[axis] = value; }
    const bytes = Uint8Array.from(result); pointParts.push(bytes); pointOffsets.push(pointOffsets.at(-1)! + bytes.length);
    nextOffsets.push(nextOffsets.at(-1)! + (e.next?.length ?? 0));
    for (const id of e.next ?? []) if (!edges.has(id)) throw new Error('ROAD_PACK_NEXT');
  }
  for (const warning of graph.warnings) intern(warning);
  const counts: RoadPackCounts = { nodes: nodes.size, edges: edges.size, pointBytes: pointOffsets.at(-1)!, next: nextOffsets.at(-1)!,
    strings: pool.length, stringBytes, warnings: graph.warnings.length };
  const bytes = new Uint8Array(roadPackLayout(counts).byteLength), h = new DataView(bytes.buffer, 0, ROAD_PACK_HEADER_BYTES);
  [ROAD_PACK_MAGIC, ROAD_PACK_VERSION, counts.nodes, counts.edges, counts.pointBytes, counts.next, counts.strings, counts.stringBytes, counts.warnings, 0]
    .forEach((value, i) => h.setUint32(i * 4, value, true));
  const c = roadPackColumns(bytes, counts);
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i]!; c.nodeXYZ.set([coordinate(n.x), coordinate(n.y), coordinate(n.z)], i * 3);
    c.nodeId[i] = intern(n.id); c.nodeOsm[i] = intern(n.osmNode);
    if (n.control !== undefined && n.control !== 'signal' && n.control !== 'stop') throw new Error('ROAD_PACK_CONTROL');
    c.nodeFlags[i] = (n.control === 'signal' ? ROAD_NODE_FLAGS.signal : n.control === 'stop' ? ROAD_NODE_FLAGS.stop : 0) | (n.yield ? ROAD_NODE_FLAGS.yield : 0);
  }
  c.edgePointOffsets.set(pointOffsets); c.edgeNextOffsets.set(nextOffsets);
  for (let i = 0; i < graph.edges.length; i++) {
    const e = graph.edges[i]!;
    if (!Number.isFinite(e.lengthM) || e.lengthM < 0 || !Number.isFinite(e.speedMps) || e.speedMps <= 0) throw new Error('ROAD_PACK_SPEED_LENGTH');
    if (e.kind !== 'lane' && e.kind !== 'connector') throw new Error('ROAD_PACK_KIND');
    c.edgeFrom[i] = nodes.get(e.from)!; c.edgeTo[i] = nodes.get(e.to)!; c.edgeLength[i] = e.lengthM; c.edgeSpeed[i] = e.speedMps;
    c.edgeSource[i] = integer(e.osmWay, 0, 0xffffffff, 'SOURCE_ID'); c.edgeName[i] = intern(e.name); c.edgeId[i] = intern(e.id);
    c.edgeLane[i] = integer(e.lane, 0, 255, 'LANE'); c.edgeLayer[i] = integer(e.layer, -128, 127, 'LAYER');
    c.edgeFlags[i] = (e.kind === 'connector' ? ROAD_EDGE_FLAGS.connector : 0) | (e.inferredLanes ? ROAD_EDGE_FLAGS.inferred : 0)
      | (e.bridge ? ROAD_EDGE_FLAGS.bridge : 0) | (e.tunnel ? ROAD_EDGE_FLAGS.tunnel : 0) | (e.next !== undefined ? ROAD_EDGE_FLAGS.next : 0)
      | ((options.routableEdgeIds ? options.routableEdgeIds.has(e.id) : e.routable !== false) ? ROAD_EDGE_FLAGS.routable : 0);
    c.points.set(pointParts[i]!, pointOffsets[i]!);
    for (const [j, id] of (e.next ?? []).entries()) c.next[nextOffsets[i]! + j] = edges.get(id)!;
  }
  let at = 0;
  for (let i = 0; i < pool.length; i++) { c.stringOffsets[i] = at; c.strings.set(pool[i]!, at); at += pool[i]!.length; }
  c.stringOffsets[pool.length] = at;
  c.warnings.set(graph.warnings.map(intern));
  return bytes;
}
