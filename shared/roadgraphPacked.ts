import type { RoadEdge, RoadGraph, RoadNode } from './roadgraph';

/** GTRP v1: little-endian columns, cm coordinates and per-edge signed-varint point deltas. */
export const ROAD_PACK_MAGIC = 0x50525447;
export const ROAD_PACK_VERSION = 1;
export const ROAD_PACK_HEADER_BYTES = 40;
export const ROAD_PACK_MAX_BYTES = 25_000_000;
export const ROAD_NODE_FLAGS = { signal: 1, stop: 2, yield: 4 } as const;
export const ROAD_EDGE_FLAGS = { connector: 1, inferred: 2, bridge: 4, tunnel: 8, next: 16, routable: 32 } as const;
export interface PackedPublicNode extends RoadNode { osmNode: string; yield?: boolean }
export interface PackedPublicEdge extends RoadEdge {
  kind: 'lane' | 'connector'; osmWay: number; name: string; inferredLanes: boolean;
  layer: number; bridge: boolean; tunnel: boolean; next?: string[]; routable?: boolean;
}
export interface PackedPublicRoadGraph extends RoadGraph { nodes: PackedPublicNode[]; edges: PackedPublicEdge[]; warnings: string[] }
export interface RoadPackCounts { nodes: number; edges: number; pointBytes: number; next: number; strings: number; stringBytes: number; warnings: number }
export interface RoadPackColumns {
  nodeXYZ: Int32Array; nodeId: Uint32Array; nodeOsm: Uint32Array; nodeFlags: Uint8Array;
  edgeFrom: Uint32Array; edgeTo: Uint32Array; edgeLength: Float32Array; edgeSpeed: Float32Array;
  edgeSource: Uint32Array; edgeName: Uint32Array; edgeId: Uint32Array;
  edgePointOffsets: Uint32Array; edgeNextOffsets: Uint32Array;
  edgeFlags: Uint8Array; edgeLane: Uint8Array; edgeLayer: Int8Array;
  next: Uint32Array; stringOffsets: Uint32Array; warnings: Uint32Array; points: Uint8Array; strings: Uint8Array;
}
const aligned = (at: number) => Math.ceil(at / 4) * 4;
/** Shared layout is also used by the offline packer; no object-per-road allocation. */
export function roadPackLayout(c: RoadPackCounts): { byteLength: number; offsets: Record<keyof RoadPackColumns, number> } {
  for (const count of Object.values(c)) if (!Number.isSafeInteger(count) || count < 0) throw new Error('ROAD_PACK_COUNT');
  let at = ROAD_PACK_HEADER_BYTES;
  const offsets = {} as Record<keyof RoadPackColumns, number>;
  const column = (name: keyof RoadPackColumns, count: number, width: number) => { at = aligned(at); offsets[name] = at; at += count * width; };
  column('nodeXYZ', c.nodes * 3, 4); column('nodeId', c.nodes, 4); column('nodeOsm', c.nodes, 4); column('nodeFlags', c.nodes, 1);
  for (const name of ['edgeFrom', 'edgeTo', 'edgeLength', 'edgeSpeed', 'edgeSource', 'edgeName', 'edgeId'] as const) column(name, c.edges, 4);
  column('edgePointOffsets', c.edges + 1, 4); column('edgeNextOffsets', c.edges + 1, 4);
  column('edgeFlags', c.edges, 1); column('edgeLane', c.edges, 1); column('edgeLayer', c.edges, 1);
  column('next', c.next, 4); column('stringOffsets', c.strings + 1, 4); column('warnings', c.warnings, 4);
  column('points', c.pointBytes, 1); column('strings', c.stringBytes, 1);
  if (!Number.isSafeInteger(at) || at > ROAD_PACK_MAX_BYTES) throw new Error('ROAD_PACK_SIZE');
  return { byteLength: at, offsets };
}
export function roadPackColumns(bytes: Uint8Array, c: RoadPackCounts): RoadPackColumns {
  const layout = roadPackLayout(c);
  if (bytes.byteLength !== layout.byteLength || bytes.byteOffset % 4) throw new Error('ROAD_PACK_LENGTH');
  const start = bytes.byteOffset, b = bytes.buffer, o = layout.offsets;
  return {
    nodeXYZ: new Int32Array(b, start + o.nodeXYZ, c.nodes * 3), nodeId: new Uint32Array(b, start + o.nodeId, c.nodes),
    nodeOsm: new Uint32Array(b, start + o.nodeOsm, c.nodes), nodeFlags: new Uint8Array(b, start + o.nodeFlags, c.nodes),
    edgeFrom: new Uint32Array(b, start + o.edgeFrom, c.edges), edgeTo: new Uint32Array(b, start + o.edgeTo, c.edges),
    edgeLength: new Float32Array(b, start + o.edgeLength, c.edges), edgeSpeed: new Float32Array(b, start + o.edgeSpeed, c.edges),
    edgeSource: new Uint32Array(b, start + o.edgeSource, c.edges), edgeName: new Uint32Array(b, start + o.edgeName, c.edges),
    edgeId: new Uint32Array(b, start + o.edgeId, c.edges), edgePointOffsets: new Uint32Array(b, start + o.edgePointOffsets, c.edges + 1),
    edgeNextOffsets: new Uint32Array(b, start + o.edgeNextOffsets, c.edges + 1), edgeFlags: new Uint8Array(b, start + o.edgeFlags, c.edges),
    edgeLane: new Uint8Array(b, start + o.edgeLane, c.edges), edgeLayer: new Int8Array(b, start + o.edgeLayer, c.edges),
    next: new Uint32Array(b, start + o.next, c.next), stringOffsets: new Uint32Array(b, start + o.stringOffsets, c.strings + 1),
    warnings: new Uint32Array(b, start + o.warnings, c.warnings), points: new Uint8Array(b, start + o.points, c.pointBytes),
    strings: new Uint8Array(b, start + o.strings, c.stringBytes),
  };
}
const decoder = new TextDecoder('utf-8', { fatal: true });
export class PackedRoadGraph {
  readonly columns: RoadPackColumns;
  constructor(readonly bytes: Uint8Array, readonly counts: RoadPackCounts) { this.columns = roadPackColumns(bytes, counts); }
  string(index: number, cache?: (string | undefined)[]): string {
    if (!Number.isInteger(index) || index < 0 || index >= this.counts.strings) throw new Error('ROAD_PACK_STRING');
    const found = cache?.[index];
    if (found !== undefined) return found;
    const { stringOffsets, strings } = this.columns;
    const value = decoder.decode(strings.subarray(stringOffsets[index]!, stringOffsets[index + 1]!));
    if (cache) cache[index] = value;
    return value;
  }
  node(index: number, strings?: (string | undefined)[]): PackedPublicNode {
    if (!Number.isInteger(index) || index < 0 || index >= this.counts.nodes) throw new Error('ROAD_PACK_NODE');
    const c = this.columns, f = c.nodeFlags[index]!, at = index * 3;
    return { id: this.string(c.nodeId[index]!, strings), x: c.nodeXYZ[at]! / 100, y: c.nodeXYZ[at + 1]! / 100, z: c.nodeXYZ[at + 2]! / 100,
      osmNode: this.string(c.nodeOsm[index]!, strings), ...(f & 3 ? { control: f & 1 ? 'signal' as const : 'stop' as const } : {}),
      ...(f & ROAD_NODE_FLAGS.yield ? { yield: true } : {}) };
  }
  edgePoints(index: number): [number, number, number][] {
    if (!Number.isInteger(index) || index < 0 || index >= this.counts.edges) throw new Error('ROAD_PACK_EDGE');
    const c = this.columns, source = c.edgeFrom[index]! * 3;
    let cursor = c.edgePointOffsets[index]!;
    const end = c.edgePointOffsets[index + 1]!, xyz = [c.nodeXYZ[source]!, c.nodeXYZ[source + 1]!, c.nodeXYZ[source + 2]!];
    const read = () => {
      let value = 0, shift = 0;
      while (cursor < end && shift <= 28) {
        const byte = c.points[cursor++]!;
        if (shift === 28 && byte > 15) throw new Error('ROAD_PACK_VARINT');
        value = (value | (byte & 127) << shift) >>> 0;
        if (!(byte & 128)) return (value >>> 1) ^ -(value & 1);
        shift += 7;
      }
      throw new Error('ROAD_PACK_VARINT');
    };
    const points: [number, number, number][] = [];
    while (cursor < end) {
      for (let axis = 0; axis < 3; axis++) {
        xyz[axis] = xyz[axis]! + read();
        if (xyz[axis]! < -0x80000000 || xyz[axis]! > 0x7fffffff) throw new Error('ROAD_PACK_COORDINATE');
      }
      points.push([xyz[0]! / 100, xyz[1]! / 100, xyz[2]! / 100]);
    }
    if (points.length < 2) throw new Error('ROAD_PACK_POINTS');
    return points;
  }
  edge(index: number, strings?: (string | undefined)[]): PackedPublicEdge {
    const c = this.columns, points = this.edgePoints(index), f = c.edgeFlags[index]!;
    return { id: this.string(c.edgeId[index]!, strings), from: this.string(c.nodeId[c.edgeFrom[index]!]!, strings), to: this.string(c.nodeId[c.edgeTo[index]!]!, strings),
      lengthM: c.edgeLength[index]!, speedMps: c.edgeSpeed[index]!, lane: c.edgeLane[index]!, points,
      kind: f & ROAD_EDGE_FLAGS.connector ? 'connector' : 'lane', osmWay: c.edgeSource[index]!, name: this.string(c.edgeName[index]!, strings),
      inferredLanes: !!(f & ROAD_EDGE_FLAGS.inferred), layer: c.edgeLayer[index]!, bridge: !!(f & ROAD_EDGE_FLAGS.bridge), tunnel: !!(f & ROAD_EDGE_FLAGS.tunnel),
      routable: !!(f & ROAD_EDGE_FLAGS.routable),
      ...(f & ROAD_EDGE_FLAGS.next ? { next: Array.from(c.next.subarray(c.edgeNextOffsets[index]!, c.edgeNextOffsets[index + 1]!), e => this.string(c.edgeId[e]!, strings)) } : {}) };
  }
}
/** Validates framing and all topology indices before exposing typed views. */
export function decodePackedRoadGraph(input: ArrayBuffer | Uint8Array): PackedRoadGraph {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < ROAD_PACK_HEADER_BYTES || bytes.byteLength > ROAD_PACK_MAX_BYTES) throw new Error('ROAD_PACK_LENGTH');
  if (bytes.byteOffset % 4) bytes = bytes.slice();
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) throw new Error('ROAD_PACK_ENDIAN');
  const h = new DataView(bytes.buffer, bytes.byteOffset, ROAD_PACK_HEADER_BYTES);
  if (h.getUint32(0, true) !== ROAD_PACK_MAGIC || h.getUint32(4, true) !== ROAD_PACK_VERSION || h.getUint32(36, true) !== 0) throw new Error('ROAD_PACK_VERSION');
  const counts: RoadPackCounts = { nodes: h.getUint32(8, true), edges: h.getUint32(12, true), pointBytes: h.getUint32(16, true),
    next: h.getUint32(20, true), strings: h.getUint32(24, true), stringBytes: h.getUint32(28, true), warnings: h.getUint32(32, true) };
  const packed = new PackedRoadGraph(bytes, counts), c = packed.columns;
  function offsets(array: Uint32Array, maximum: number, strict = false) {
    if (array[0] !== 0 || array.at(-1) !== maximum) throw new Error('ROAD_PACK_OFFSET');
    for (let i = 1; i < array.length; i++) if (array[i]! > maximum || (strict ? array[i]! <= array[i - 1]! : array[i]! < array[i - 1]!)) throw new Error('ROAD_PACK_OFFSET');
  }
  offsets(c.edgePointOffsets, counts.pointBytes, true); offsets(c.edgeNextOffsets, counts.next); offsets(c.stringOffsets, counts.stringBytes);
  for (const array of [c.nodeId, c.nodeOsm, c.edgeId, c.edgeName, c.warnings]) for (const value of array) if (value >= counts.strings) throw new Error('ROAD_PACK_STRING');
  for (const array of [c.edgeFrom, c.edgeTo]) for (const value of array) if (value >= counts.nodes) throw new Error('ROAD_PACK_NODE');
  for (const value of c.next) if (value >= counts.edges) throw new Error('ROAD_PACK_EDGE');
  for (const value of c.nodeFlags) if (value > 7 || (value & 3) === 3) throw new Error('ROAD_PACK_FLAGS');
  for (let i = 0; i < counts.edges; i++) {
    if (!Number.isFinite(c.edgeLength[i]) || c.edgeLength[i]! < 0 || !Number.isFinite(c.edgeSpeed[i]) || c.edgeSpeed[i]! <= 0
      || c.edgeFlags[i]! > 63 || (!(c.edgeFlags[i]! & ROAD_EDGE_FLAGS.next) && c.edgeNextOffsets[i] !== c.edgeNextOffsets[i + 1])) throw new Error('ROAD_PACK_EDGE');
  }
  return packed;
}
/** Compatibility adapter for existing browser consumers; servers should retain packed views. */
export function unpackRoadGraph(packed: PackedRoadGraph): PackedPublicRoadGraph {
  // Browser expansion repeats node/edge IDs throughout topology. Decode each
  // distinct UTF-8 string once; this temporary table is released after expansion.
  // Server callers retain packed views and do not allocate this citywide cache.
  const strings: (string | undefined)[] = new Array(packed.counts.strings);
  const { strings: bytes, stringOffsets } = packed.columns;
  // The city table is mostly short ASCII IDs. Decode one byte-preserving pool
  // instead of making hundreds of thousands of tiny TextDecoder/subarray calls.
  // Windows-1252 maps each byte to one UTF-16 code unit; only ASCII slices below
  // are used. Non-ASCII entries retain the existing per-string fatal UTF-8/BOM
  // behavior, including lazy errors for malformed strings that are referenced.
  const bytePool = new TextDecoder('windows-1252').decode(bytes);
  for (let index = 0; index < packed.counts.strings; index++) {
    const start = stringOffsets[index]!, end = stringOffsets[index + 1]!;
    let at = start;
    while (at < end && bytes[at]! < 128) at++;
    if (at === end) strings[index] = bytePool.slice(start, end);
  }
  return finishUnpack(packed, strings);
}
function finishUnpack(packed: PackedRoadGraph, strings: (string | undefined)[]): PackedPublicRoadGraph {
  return { version: 1, nodes: Array.from({ length: packed.counts.nodes }, (_, i) => packed.node(i, strings)),
    edges: Array.from({ length: packed.counts.edges }, (_, i) => packed.edge(i, strings)),
    warnings: Array.from(packed.columns.warnings, index => packed.string(index, strings)) };
}
/** unpackRoadGraph in batches, awaiting `between()` after at most `batch` items or ~`budgetMs` (12 ms, as the city-index
 *  runner and router build; 8 ms left the post-READY unpack at ~7 s on a 4x phone) of work (checked every
 *  256 items) so a browser keeps rendering while the whole city graph expands after READY (gtasf-0k01). The time budget
 *  matters on slow phones: a fixed 25k-item batch was a 100-560 ms long task each on 4x CPU (gtasf-qvajw). Same result as
 *  unpackRoadGraph. */
export async function unpackRoadGraphSliced(packed: PackedRoadGraph, between: () => Promise<void>, batch = 25_000, budgetMs = 12): Promise<PackedPublicRoadGraph> {
  const now = () => globalThis.performance?.now() ?? Date.now();
  let started = now(), sinceYield = 0;
  const due = () => ++sinceYield >= batch || ((sinceYield & 255) === 0 && now() - started >= budgetMs);
  const pause = async () => { await between(); started = now(); sinceYield = 0; };
  const strings: (string | undefined)[] = new Array(packed.counts.strings);
  const { strings: bytes, stringOffsets } = packed.columns, bytePool = new TextDecoder('windows-1252').decode(bytes);
  for (let index = 0; index < packed.counts.strings; index++) {
    const start = stringOffsets[index]!, end = stringOffsets[index + 1]!;
    let at = start;
    while (at < end && bytes[at]! < 128) at++;
    if (at === end) strings[index] = bytePool.slice(start, end);
    if (due()) await pause();
  }
  await pause();
  const nodes = new Array(packed.counts.nodes), edges = new Array(packed.counts.edges);
  for (let i = 0; i < nodes.length; i++) { nodes[i] = packed.node(i, strings); if (due()) await pause(); }
  await pause();
  for (let i = 0; i < edges.length; i++) { edges[i] = packed.edge(i, strings); if (due()) await pause(); }
  return { version: 1, nodes, edges, warnings: Array.from(packed.columns.warnings, index => packed.string(index, strings)) };
}

/** The subgraph the client router uses: the same graph keeping only routable edges, in order. ONE helper for world.ts
 *  (main thread) and the routing worker, so their edge lists match by construction (gtasf-fddi / critic N16). */
export function routingSubgraph<G extends { edges: readonly { routable?: boolean }[] }>(graph: G): G {
  return { ...graph, edges: graph.edges.filter(edge => edge.routable) } as G;
}
/** The routing graph exactly as world.ts derives it from the packed artifact (unpack, then routingSubgraph). */
export function routingGraphFromPacked(input: ArrayBuffer | Uint8Array): PackedPublicRoadGraph {
  return routingSubgraph(unpackRoadGraph(decodePackedRoadGraph(input)));
}
