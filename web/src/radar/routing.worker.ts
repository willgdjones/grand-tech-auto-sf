import type { RoadGraph, RoadNode } from '@gtasf/shared/roadgraph';
import { routingGraphFromPacked } from '@gtasf/shared/roadgraphPacked';
import { buildRouterStructures, encodeRouterEdges } from './routing';

/** gtasf-fddi: build the whole-city routing index off the main thread. radar.ts builds its routing-index
 * (nodes map + directed adjacency + lane spatial grid) on main via createMapRouter/createMapRouterIncremental
 * — ~261 ms (4x-throttled phone) that, even idle-sliced, smears into the post-READY steady window. This worker
 * fetches the route-graph JSON by URL, drains buildRouterStructures (budget Infinity — blocking the worker is
 * fine, it is off-main), and streams the plain-data structures back. The flat typed arrays post as
 * transferables; nodes/outgoing/cells post as batched entries so each main-thread deserialize task stays small
 * (mirrors layout.worker.ts). assembleMapRouter on main wraps them in the route closures over its own graph
 * copy — the driver only takes the worker path when main uses the SAME fetch URL, so edge order is identical
 * and routes are byte-identical. NOTE: the real app (main.ts) passes an in-memory routeGraph, not a URL, so
 * this worker is inert there today; see the routingWorker flag comment for why the index is "worker-hard". */
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ url?: string; bytes?: ArrayBuffer }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
scope.onmessage = async ({ data: { url, bytes } }) => {
  try {
    // routingWorkerPacked: the restored road-pack bytes main already downloaded, decoded with routingGraphFromPacked — the
    // same unpack + routingSubgraph main uses, so edge order matches by construction (routingPacked.test.ts). Otherwise
    // parse the JSON URL exactly as radar.ts does (response.json() -> RoadGraph).
    let graph: RoadGraph;
    if (bytes) graph = routingGraphFromPacked(bytes);
    else {
      const response = await fetch(url!); if (!response.ok) throw new Error(`Road graph HTTP ${response.status}`);
      graph = await response.json() as RoadGraph;
    }
    // Infinity budget: the generator never yields, so one drain produces the finished structures.
    const build = buildRouterStructures(graph, Infinity);
    let step = build.next(); while (!step.done) step = build.next();
    const { nodes, outgoing, nextEdge, laneEdges, bounds, laneStamps, cells, cellSize, minCellX, maxCellX, minCellZ, maxCellZ } = step.value;
    // Batched streams: each postMessage is its own main-thread deserialize task, so a big city graph never
    // lands as one multi-hundred-ms task. nodes/outgoing are small pairs (2000); cells carry a Uint32Array each (500).
    const nodeEntries: [string, RoadNode][] = [...nodes.entries()];
    for (let i = 0; i < nodeEntries.length; i += 2000) scope.postMessage({ nodes: nodeEntries.slice(i, i + 2000) });
    const outgoingEntries: [string, number][] = [...outgoing.entries()];
    for (let i = 0; i < outgoingEntries.length; i += 2000) scope.postMessage({ outgoing: outgoingEntries.slice(i, i + 2000) });
    const cellEntries: [string, Uint32Array][] = [...cells.entries()];
    for (let i = 0; i < cellEntries.length; i += 500) scope.postMessage({ cells: cellEntries.slice(i, i + 500) });
    // routerLightEdges: the routable edges as a typed view, so main can assemble without its own full-graph unpack.
    if (bytes) { const view = encodeRouterEdges(graph);
      scope.postMessage({ edges: view }, [view.from.buffer, view.to.buffer, view.lengthM.buffer, view.pointOffsets.buffer, view.points.buffer]); }
    // The flat typed arrays transfer (zero-copy); the receiver owns their buffers after this.
    scope.postMessage({ done: true, nextEdge, laneEdges, bounds, laneStamps, cellSize, minCellX, maxCellX, minCellZ, maxCellZ },
      [nextEdge.buffer, laneEdges.buffer, bounds.buffer, laneStamps.buffer]);
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
