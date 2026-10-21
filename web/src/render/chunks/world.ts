import { Box3, Mesh, Texture, type BufferAttribute, type InterleavedBufferAttribute, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { flags } from '@gtasf/shared/flags';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { decodePackedRoadGraph, routingSubgraph, unpackRoadGraph, unpackRoadGraphSliced } from '@gtasf/shared/roadgraphPacked';
import { restoreMapArtifact, type TransportMetadata } from '@gtasf/shared/mapTransport';
import type { QualityTier } from '../qualityTier';
import { FootprintIndex, createRoadSampler, createRoadSamplerSliced, createRoadSnapper, createRoadSnapperSliced, decodeHeightfield, sampleHeight, type BuildingFootprint, type ChunkCollision, type Heightfield } from './terrain';
import { createLocationNameLookup, createLocationNameLookupSliced, type NeighbourhoodData } from './locationNames';
import { StructureCollisionIndex } from './structureCollision';
import { loadCompactMesh } from './compactMesh';
import { RenderedGroundIndex } from './renderedGround';
import { mergeChunkRoadMeshes } from './mergeChunkMeshes';
import { freezeStaticWorld } from '../staticMatrices';
import type { RoadDrape } from '@gtasf/shared/terrainDrape';

interface Artifact extends TransportMetadata { path: string; bytes: number; meshEncoding?: 'triangles-v1' | 'recipes-v1' | 'joins-v1' | 'height-predicted-v1' | 'surfaces-v1' }
interface Chunk { id: string; detail?: 'low'; x: number; z: number; lods: Artifact[]; terrain: Artifact; collision: Artifact;
  /** graphicsV2 phase 2: NAIP JPEG covering exactly this chunk, north-up (top row = min z). Optional. */
  aerial?: Artifact }
export interface MapManifest {
  version: 1; chunkSize: number; bounds: [number, number, number, number];
  requiredFeatures?: string[];
  frame: { origin: { lat: number; lon: number }; gridRotationDeg: number };
  roadGraph: Artifact & { encoding?: 'roadpack-v1' }; neighbourhoods?: Artifact; chunks: Chunk[]; attribution: unknown;
  /** gtasf-0k01: spawn-area subset of roadGraph (tools/map/roadgraph-subset.mts), used when flags.nearRoadGraph. */
  roadGraphNear?: Artifact & { encoding: 'roadpack-v1'; coverage: NearGraphCentre[];
    /** Per-centre subsets (tools/map/roadgraph-subset.mts); a spawn downloads only its own circle. */
    parts?: (Artifact & { id: string; encoding: 'roadpack-v1' })[] };
}
export interface NearGraphCentre { id: string; x: number; z: number; radiusM: number }
/** A spawn uses the near graph only well inside a circle, so its road snap and first steps stay on kept roads. */
export const NEAR_GRAPH_MARGIN_M = 250;
export function nearGraphCovers(coverage: readonly NearGraphCentre[] | undefined, x: number, z: number): boolean {
  return !!coverage?.some(c => Math.hypot(x - c.x, z - c.z) + NEAR_GRAPH_MARGIN_M <= c.radiusM);
}
/** The smallest file that covers a spawn: its centre's own part when published, else the combined subset. */
/** gtasf-c8sj: the full city road graph's URL + transport metadata, for workers that decode their own copy. */
export let fullRoadGraphSource: { url: string; artifact: MapManifest['roadGraph'] } | undefined;
export function nearGraphArtifact(near: MapManifest['roadGraphNear'], x: number, z: number) {
  if (!near || !nearGraphCovers(near.coverage, x, z)) return undefined;
  const centre = near.coverage.find(c => Math.hypot(x - c.x, z - c.z) + NEAR_GRAPH_MARGIN_M <= c.radiusM)!;
  // With parts published the single file holds only the first centre, so never fall back to it then.
  return near.parts ? near.parts.find(part => part.id === centre.id) : near;
}
export const LOMBARD_SPAWN = Object.freeze({ x: -1041.863, y: 85.954, z: -1975.201, yaw: Math.PI / 2 });
export const LOMBARD_DESTINATION = Object.freeze({ x: -897.138, y: 53.117, z: -1999.980 });
interface Mounted { chunk: Chunk; root: Object3D; release: () => void; meshes: { mesh: Mesh; bytes: number }[] }
export interface StreamStats {
  loading: number; mounted: number; queuedUploads: number; uploadedBytes: number;
  uploadsThisFrame: number; bytesThisFrame: number; lastLoadMs: number; lastUpdateMs: number; errors: string[];
  // Mount-profiling (gtasf-3k35): live references to the collision indexes' counters so a phone-perf
  // capture of world.map.stats can separate rebuild churn from dense cells from the query itself.
  coarse?: StructureCollisionIndex['stats']; structure?: StructureCollisionIndex['stats'];
}

function disposeGeometry(root: Object3D): void {
  const materials = new Set<Material>(), textures = new Set<Texture>();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}

/** aerialFarClipWater: clip a decoded far-LOD chunk to land. The coarse bay chunks are flat terrain painted with
 *  the mapped water colour, but mountFar carries no water overlay, so open Bay renders as flat tan slabs that read
 *  as land floating over the water. Drop every terrain triangle whose three vertices are all the exact mapped water
 *  colour (UNORM8 26,59,105 — the same signal waterMirror.ts uses), keeping shorelines (mixed triangles). Returns
 *  false when nothing renderable remains (a pure-water chunk), so the caller skips mounting it. Visual-only: far
 *  chunks carry no collision or graph, so clipping their geometry changes nothing but what is drawn. */
function clipFarWater(root: Object3D): boolean {
  let hasGeometry = false;
  const drop: Mesh[] = [];
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry, colours = geometry.getAttribute('color');
    // Only terrain carries the water palette; buildings/roads are land and always kept.
    if (!/^terrain(?:_|$)/.test(object.name) || !colours) { hasGeometry = true; return; }
    const index = geometry.index, position = geometry.getAttribute('position');
    const count = index?.count ?? position.count;
    const wet = (i: number) => Math.round(colours.getX(i) * 255) === 26
      && Math.round(colours.getY(i) * 255) === 59 && Math.round(colours.getZ(i) * 255) === 105;
    const kept: number[] = [];
    for (let i = 0; i + 2 < count; i += 3) {
      const a = index?.getX(i) ?? i, b = index?.getX(i + 1) ?? i + 1, c = index?.getX(i + 2) ?? i + 2;
      if (!(wet(a) && wet(b) && wet(c))) kept.push(a, b, c); // keep land + shoreline triangles
    }
    if (!kept.length) { drop.push(object); return; } // all open water -> remove the terrain mesh
    if (kept.length !== count) geometry.setIndex(kept);
    hasGeometry = true;
  });
  for (const mesh of drop) { mesh.geometry.dispose(); mesh.removeFromParent(); }
  return hasGeometry;
}

let workersStarted = false;
/** Local/R2-compatible prebaked map stream. Call update once before each rendered frame. */
// Cold load (gtasf-ce5s): boot starts the manifest + city road graph downloads before admission/referrals.
// loadLombardWorld consumes these in-flight responses once instead of re-requesting them.
const earlyAssets = new Map<string, Promise<Response>>();
/** `nearCentre`: the near-graph centre id when the spawn is already known (the default Ferry arrival). */
/** Hand over a boot-time prefetched response (once); undefined when it was never prefetched. */
export function takeEarlyAsset(href: string): Promise<Response> | undefined {
  const early = earlyAssets.get(href); earlyAssets.delete(href); return early;
}
export function prefetchMapCore(baseUrl = '/map/lombard/', nearCentre?: string): void {
  if (!flags.mapStreaming || earlyAssets.size) return;
  const base = new URL(baseUrl, location.href), get = (path: string) => fetch(new URL(path, base));
  const manifest = get('manifest.json');
  earlyAssets.set(new URL('manifest.json', base).href, manifest.then(r => r.clone()));
  void manifest.then(r => r.ok ? r.json() as Promise<MapManifest> : undefined).then(m => {
    // gtasf-0k01: with a near graph published, prefetch only it; the full city graph is requested after
    // READY (or at once by loadLombardWorld when the spawn is outside the near coverage).
    // Near graph on: prefetch only the known spawn's part (deep links resolve first and fetch their own);
    // without parts, the combined subset. Near graph off: the full city graph.
    const near = m?.roadGraphNear, part = nearCentre ? near?.parts?.find(p => p.id === nearCentre) : undefined;
    const graph = flags.nearRoadGraph && near ? (near.parts ? part : near) : m?.roadGraph;
    // The radar's coastline was fetched (and awaited) only during HUD setup, ~1.2 s on a throttled phone. [gtasf-1k82]
    const coastline = (m as { coastline?: { path: string } } | undefined)?.coastline;
    for (const asset of [graph, m?.neighbourhoods, coastline]) if (asset) earlyAssets.set(new URL(asset.path, base).href, get(asset.path));
  }).catch(() => {});
}
export async function loadLombardWorld(options: {
  mountGeometry(root: Object3D): () => void;
  /** Cheap visual-only mount for the aerial far-LOD ring (aerialFarChunks); no collision/facade/shadow work. */
  mountFar?(root: Object3D): () => void;
  baseUrl?: string; tier?: QualityTier; enabled?: boolean;
  position: { x: number; z: number };
  /** Explicit links load their sourced lane first; default plaza arrivals keep their position. */
  snapToRoad?: boolean;
  /** gtasf-0k01: false forces the full city graph before READY (scripted/cinematic runs). Default flags.nearRoadGraph. */
  nearGraph?: boolean;
}) {
  if (!(options.enabled ?? flags.mapStreaming)) return null;
  // /map/lombard/ now serves the whole-city map (the citywide graph is published at this path as of
  // #5.4, gtasf-vcaj); an explicit options.baseUrl (deep links / tests) still wins.
  const base = new URL(options.baseUrl ?? '/map/lombard/', location.href);
  const abort = new AbortController();
  async function fetchAsset(path: string): Promise<Response> {
    const url = new URL(path, base), early = earlyAssets.get(url.href);
    earlyAssets.delete(url.href);
    let response = early ? await early.catch(() => undefined) : undefined;
    // R2 returns transient 5xx ('internal error (10001)', prod 12:40 PT 10-15) and a single failed chunk left the
    // player on the loading card past 150 s. Retry 5xx / network errors twice (0.4 s, 1.6 s); 4xx is final.
    for (let attempt = 0; !response?.ok && !(response && response.status < 500); attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 400 * 4 ** (attempt - 1)));
      try { response = await fetch(url, { signal: abort.signal }); } catch (error) { if (abort.signal.aborted || attempt >= 2) throw error; continue; }
      if (attempt >= 2) break;
    }
    if (!response!.ok) throw new Error(`Map ${path}: HTTP ${response!.status}`);
    return response!;
  }
  const manifest = await (await fetchAsset('manifest.json')).json() as MapManifest;
  fullRoadGraphSource = { url: new URL(manifest.roadGraph.path, base).href, artifact: manifest.roadGraph };
  if (manifest.version !== 1 || manifest.chunkSize !== 256 || !manifest.chunks.length) throw new Error('Unsupported map manifest');
  if (manifest.requiredFeatures?.some(feature => feature !== 'compactMapAssets' || !flags.compactMapAssets)) throw new Error('COMPACT_MAP_ASSETS_DISABLED');
  const chunkGrid = new Map<number, Map<number, Chunk>>();
  for (const chunk of manifest.chunks) {
    let column = chunkGrid.get(chunk.x);
    if (!column) { column = new Map(); chunkGrid.set(chunk.x, column); }
    column.set(chunk.z, chunk);
  }
  const lod = options.tier === 'low' ? 1 : 0;
  function fetchChunkData(chunk: Chunk, lodIndex = lod): Promise<[ArrayBuffer, { field: Heightfield; bytes: ArrayBuffer }, ChunkCollision]> {
    return Promise.all([
      fetchAsset(chunk.lods[lodIndex]!.path).then(r => r.arrayBuffer()),
      fetchAsset(chunk.terrain.path).then(r => r.arrayBuffer())
        .then(bytes => restoreMapArtifact(bytes, chunk.terrain, 'height', flags.compactMapAssets))
        .then(bytes => ({ field: decodeHeightfield(bytes), bytes })),
      fetchAsset(chunk.collision.path).then(r => r.arrayBuffer())
        .then(bytes => restoreMapArtifact(bytes, chunk.collision, 'collision', flags.compactMapAssets))
        .then(bytes => JSON.parse(new TextDecoder().decode(bytes)) as ChunkCollision),
    ]);
  }
  const requestedChunk = chunkGrid.get(Math.floor(options.position.x / 256))?.get(Math.floor(options.position.z / 256));
  // The default plaza's chunk is known from the manifest. Download its three files while the
  // city graph loads, without constructing geometry or starting neighbour chunks. Explicit links
  // still wait for the graph's road snap, so we never fetch the wrong target's assets.
  let initialData = !options.snapToRoad && requestedChunk ? {
    chunk: requestedChunk,
    result: fetchChunkData(requestedChunk).then(data => ({ data }), error => ({ error })),
  } : undefined;
  type Graphs = { graph: RoadGraph; routingGraph: RoadGraph | undefined };
  // Post-READY graph upgrades run in separate tasks so play never freezes for the whole decode. [gtasf-0k01]
  // slicesFramePaced: chained setTimeout(0) yields only ~4 ms between 12 ms slices, so a post-READY build (full graph unpack,
  // city indexes, rendered ground) took ~75% of a frame-bound phone's main thread until it finished. Yield to the next
  // animation frame instead (100 ms fallback for hidden tabs): before READY frames are cheap, so loading pace barely changes;
  // in game it is one slice per rendered frame.
  const nextTask = flags.slicesFramePaced && typeof requestAnimationFrame === 'function'
    ? () => new Promise<void>(resolve => { let done = false; const go = () => { if (done) return; done = true; setTimeout(resolve, 0); }; requestAnimationFrame(go); setTimeout(go, 100); })
    : () => new Promise<void>(resolve => setTimeout(resolve, 0));
  async function loadGraph(artifact: MapManifest['roadGraph'], sliced = false, onBytes?: (bytes: ArrayBuffer) => void): Promise<Graphs> {
    const response = await fetchAsset(artifact.path);
    if (artifact.encoding === 'roadpack-v1') {
      const buffer = await response.arrayBuffer(); performance.mark('gtasf:graph-downloaded');
      const bytes = await restoreMapArtifact(buffer, artifact, 'road', flags.compactMapAssets);
      onBytes?.(bytes);
      const packed = decodePackedRoadGraph(bytes);
      if (sliced) await nextTask();
      const decoded = sliced ? await unpackRoadGraphSliced(packed, nextTask) : unpackRoadGraph(packed);
      if (sliced) await nextTask();
      return { graph: decoded, routingGraph: routingSubgraph(decoded) }; // same helper as the routing worker (gtasf-fddi)
    }
    return { graph: await response.json() as RoadGraph, routingGraph: undefined };
  }
  // gtasf-0k01: inside the published near coverage, READY waits only on the spawn-area subset. The full
  // graph replaces it after READY (upgradeGraph), atomically for every lazy reader below.
  const nearArtifact = (options.nearGraph ?? flags.nearRoadGraph)
    ? nearGraphArtifact(manifest.roadGraphNear, options.position.x, options.position.z) : undefined;
  let graphs: Graphs, neighbourhoods: NeighbourhoodData | undefined;
  try {
    [graphs, neighbourhoods] = await Promise.all([
      loadGraph(nearArtifact ?? manifest.roadGraph),
      manifest.neighbourhoods ? fetchAsset(manifest.neighbourhoods.path).then(r => r.json() as Promise<NeighbourhoodData>) : undefined,
    ]);
  } catch (error) { abort.abort(); throw error; }
  performance.mark('gtasf:graph-decoded'); // cold-load trace
  let locationLookup = createLocationNameLookup(graphs.graph, neighbourhoods);
  let roadSampler = createRoadSampler(graphs.graph);
  let roadSnapper = createRoadSnapper(graphs.graph);
  // Stable function identities: consumers that captured these at setup see the upgraded graph.
  const locationNameAt: typeof locationLookup = (...args) => locationLookup(...args);
  const roadHeightAt: typeof roadSampler = Object.assign((x: number, z: number, referenceY?: number) => roadSampler(x, z, referenceY),
    { contains: (x: number, z: number, referenceY?: number) => roadSampler.contains(x, z, referenceY) });
  const nearestRoad: typeof roadSnapper = (...args) => roadSnapper(...args);
  let graphComplete = !nearArtifact, fullGraph: Promise<Graphs> | undefined = nearArtifact ? undefined : Promise.resolve(graphs);
  /** Starts (once) the full-city graph download after READY and swaps it in; resolves with it. */
  // The decoded full graph before the city-wide indexes are built (gtasf-ep30n): the router needs only the routing graph.
  let fullDecoded: Promise<Graphs> | undefined = nearArtifact ? undefined : Promise.resolve(graphs);
  // routingWorkerPacked (gtasf-fddi): the restored full-graph bytes, handed to the routing worker before the main-thread unpack.
  let resolveFullBytes!: (bytes: ArrayBuffer) => void;
  const fullBytes = new Promise<ArrayBuffer>(resolve => { resolveFullBytes = resolve; });
  function upgradeGraph(): Promise<Graphs> {
    fullDecoded ??= loadGraph(manifest.roadGraph, true, bytes => resolveFullBytes(bytes.slice(0))); // a copy for the routing worker
    fullGraph ??= fullDecoded.then(async full => {
      if (disposed) return full;
      // Build every index before publishing any of them, so no reader sees a mixed state.
      // Sliced: each city-wide index is ~0.4-1 s of main thread on a phone if built in one go (gtasf-0k01 stalls).
      const lookup = await createLocationNameLookupSliced(full.graph, neighbourhoods, nextTask);
      const sampler = await createRoadSamplerSliced(full.graph, nextTask);
      const snapper = await createRoadSnapperSliced(full.graph, nextTask);
      if (disposed) return full;
      graphs = full; locationLookup = lookup; roadSampler = sampler; roadSnapper = snapper; graphComplete = true;
      return full;
    }, error => { fullGraph = undefined; fullDecoded = undefined; throw error; }); // a failed download may be retried
    return fullGraph;
  }
  // Full-city bakes omit empty chunks. The graph can still find a nearby
  // reachable street before any chunk exists at the raw requested position.
  const initialPosition: { x: number; z: number; y?: number } = options.snapToRoad || !requestedChunk
    ? nearestRoad(options.position.x, options.position.z, 500) ?? options.position : options.position;
  if (!workersStarted) { MeshoptDecoder.useWorkers(2); workersStarted = true; }
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // Compressed decode runs in workers, but GLTFLoader constructs the scene on
  // the main thread. Never let two completed fetches construct/mount together.
  let decodeQueue: Promise<unknown> = Promise.resolve();
  function decode(buffer: ArrayBuffer, meshEncoding?: string, collision?: ChunkCollision, height?: ArrayBuffer) {
    const job = decodeQueue.then(async () => {
      await new Promise<void>(resolve => {
        // Background tabs suspend RAF; their initial map must still finish loading.
        if (document.visibilityState === 'hidden') setTimeout(resolve, 16);
        else requestAnimationFrame(() => resolve());
      });
      if (disposed) throw new Error('Map is disposed');
      if (meshEncoding) {
        if (!['triangles-v1', 'recipes-v1', 'joins-v1', 'height-predicted-v1', 'surfaces-v1'].includes(meshEncoding) || !flags.compactMapAssets) throw new Error('COMPACT_MAP_ASSETS_DISABLED');
        return { scene: await loadCompactMesh(buffer, collision, height) };
      }
      return loader.parseAsync(buffer, base.href);
    });
    decodeQueue = job.catch(() => {});
    return job;
  }
  const collisions = new Map<string, ChunkCollision>();
  const fieldGrid = new Map<number, Map<number, Heightfield>>();
  const wanted: Chunk[] = [];
  const collisionIndex = new FootprintIndex();
  const structureIndex = new StructureCollisionIndex();
  // Cosmetic paint uses decoded triangle planes; existing graph/contact physics stays intact.
  let paintSurface:RenderedGroundIndex|undefined;
  // Lazy until a consumer asks (road-detail paint or the camera): a partial rollout adds no indexing cost. One index
  // serves both; chunk mount/unload/clear keep it in step below.
  // renderedGroundSliced (gtasf-fht16): the lookup-only consumers (camera/foot rendered ground) no longer build the whole index
  // synchronously on their first query (~0.2-0.3 s on a 4x phone, right before the first live frame); they start a sliced build
  // and read null (their fallback) until it lands. Mounts/unmounts during the build go to the index being built.
  let pendingSurface:RenderedGroundIndex|undefined, surfaceBuildStarted=false;
  const surfaceRegions=()=>[{minX:manifest.bounds[0],minZ:manifest.bounds[1],maxX:manifest.bounds[2],maxZ:manifest.bounds[3]}];
  function ensureRenderedGround():RenderedGroundIndex {
    if(!paintSurface){
      // A synchronous consumer (road drape) adopts a sliced build in progress and finishes it now (setChunk is idempotent).
      paintSurface=pendingSurface??new RenderedGroundIndex(surfaceRegions()); pendingSurface=undefined;
      for(const [id,item] of mounted)paintSurface.setChunk(id,item.root);
    }
    return paintSurface;
  }
  async function buildRenderedGroundSliced():Promise<void> {
    const index=pendingSurface=new RenderedGroundIndex(surfaceRegions());
    for(const id of [...mounted.keys()]){
      await nextTask();
      if(disposed||paintSurface||pendingSurface!==index)return;
      const item=mounted.get(id); if(item)index.setChunk(id,item.root);
    }
    if(!paintSurface&&pendingSurface===index){paintSurface=index;pendingSurface=undefined;}
  }
  const drapeRoadTriangle:RoadDrape|undefined=flags.graphicsV2 ? (triangle,lift,emit)=>ensureRenderedGround().drapeTriangle(triangle,lift,emit) : undefined;
  /** cameraRenderedGround (gtasf-h2qrw): the DRAWN terrain/road surface height at (x, z) on the deck nearest
   *  `referenceY` (the collision/road height the player stands on, so a tunnel never resolves to the hill above), or
   *  null when nothing drawn covers the point yet. The decoded LOD mesh can sit ~0.5-1.5 m off the coarse collision
   *  heightfield on steep hills (Coit summit), which is enough to put the chase camera under the rendered ground. */
  function renderedGroundHeightAt(x:number,z:number,referenceY:number):number|null {
    if(!flags.cameraRenderedGround&&!flags.footRenderedGround)return null;
    if(flags.renderedGroundSliced&&!paintSurface){
      if(!surfaceBuildStarted){surfaceBuildStarted=true;void buildRenderedGroundSliced();}
      return null;
    }
    return ensureRenderedGround().heightAt(x,z,referenceY);
  }
  const mounted = new Map<string, Mounted>(), pending = new Set<string>(), failedUntil = new Map<string, number>();
  const jobs = new Map<string, Promise<void>>();
  const cameraBoxes: Box3[] = [];
  // Triangle-accurate occluder for coarse (citywide) chunks' buildings, which ship no footprint collision
  // JSON (80 MB budget). The camera always avoids these (gtasf-q3r6); the player collides only when
  // flags.coarseBuildingCollision is on (gtasf-ntcl). Taken from the already-streamed meshes — zero payload.
  const coarseBuildingIndex = new StructureCollisionIndex();
  const cameraBoxCache = new WeakMap<BuildingFootprint, Box3>();
  let disposed = false, focus = initialPosition, collisionRevision = 0;
  const stats: StreamStats = { loading: 0, mounted: 0, queuedUploads: 0, uploadedBytes: 0, uploadsThisFrame: 0, bytesThisFrame: 0, lastLoadMs: 0, lastUpdateMs: 0, errors: [], coarse: coarseBuildingIndex.stats, structure: structureIndex.stats };

  function distance(chunk: Chunk): number { return Math.max(Math.abs(chunk.x - Math.floor(focus.x / 256)), Math.abs(chunk.z - Math.floor(focus.z / 256))); }
  function rebuildCameraBoxes() {
    collisionIndex.rebuild(collisions.values());
    collisionRevision++;
    cameraBoxes.length = 0;
    const seen = new Set<string>();
    for (const collision of collisions.values()) for (const building of collision.buildings) {
      if (seen.has(building.id)) continue;
      seen.add(building.id);
      let box = cameraBoxCache.get(building);
      if (!box) {
        box = new Box3();
        for (const point of building.rings[0] ?? []) {
          const x = point[0] + collision.origin[0], z = point[1] + collision.origin[2];
          box.min.x = Math.min(box.min.x, x); box.max.x = Math.max(box.max.x, x);
          box.min.z = Math.min(box.min.z, z); box.max.z = Math.max(box.max.z, z);
        }
        box.min.y = building.minY; box.max.y = building.maxY;
        cameraBoxCache.set(building, box);
      }
      if (!box.isEmpty()) cameraBoxes.push(box);
    }
  }
  async function load(chunk: Chunk) {
    pending.add(chunk.id); stats.loading = pending.size;
    const started = performance.now();
    let root: Object3D | undefined;
    try {
      const prefetched = initialData?.chunk === chunk ? initialData : undefined;
      if (prefetched) initialData = undefined;
      const result = prefetched ? await prefetched.result : { data: await fetchChunkData(chunk) };
      if ('error' in result) throw result.error;
      const [buffer, heightData, collision] = result.data, height = heightData.field;
      root = (await decode(buffer, chunk.lods[lod]!.meshEncoding, collision, heightData.bytes)).scene;
      if (disposed || distance(chunk) > 2) { disposeGeometry(root); return; }
      // Fewer road draw calls per chunk (gtasf-c8sj); geometry is re-expressed in root space.
      if (flags.chunkRoadMerge) mergeChunkRoadMeshes(root);
      root.position.set(chunk.x * 256, 0, chunk.z * 256);
      const meshes: Mounted['meshes'] = [];
      root.traverse(object => {
        if (!(object instanceof Mesh)) return;
        // Reveal only a bounded amount of new geometry per frame. glTF decode runs in workers.
        object.visible = false;
        const arrays = new Set<ArrayBufferLike>();
        for (const attribute of Object.values(object.geometry.attributes) as (BufferAttribute | InterleavedBufferAttribute)[]) {
          arrays.add(attribute.array.buffer);
        }
        if (object.geometry.index) arrays.add(object.geometry.index.array.buffer);
        meshes.push({ mesh: object, bytes: [...arrays].reduce((sum, array) => sum + array.byteLength, 0) });
      });
      // Terrain first, then roads, then buildings; loaded assets have no external textures.
      meshes.sort((a, b) => Number(b.mesh.name.startsWith('terrain')) - Number(a.mesh.name.startsWith('terrain')));
      // Renderer borrows this sourced field for a ground-floor facade band; contact data is unchanged.
      root.userData.gtasfFacadeGround = height;
      root.userData.gtasfLowDetail = chunk.detail === 'low';
      // Item 2 (aerial far / facade near): the renderer samples this per chunk when graphicsV2 is on.
      root.userData.gtasfAerial = chunk.aerial ? { url: new URL(chunk.aerial.path, base).href,
        bounds: [chunk.x * manifest.chunkSize, chunk.z * manifest.chunkSize, (chunk.x + 1) * manifest.chunkSize, (chunk.z + 1) * manifest.chunkSize] } : undefined;
      root.userData.gtasfShopfrontContext = { collision, ground: height, nearestRoad };
      const release = options.mountGeometry(root);
      // gtasf-pooa: chunk subtrees never move after placement (LOD/facade levels only toggle
      // visibility), so skip per-frame local-matrix composes; matrixWorld still propagates.
      // chunkWorldFreeze: also prune the whole static subtree from the per-frame updateMatrixWorld walk.
      if (flags.staticMatrixFreeze) {
        if (flags.chunkWorldFreeze) freezeStaticWorld(root);
        else root.traverse(object => { object.updateMatrix(); object.matrixAutoUpdate = false; });
      }
      const item: Mounted = { chunk, root, release, meshes };
      mounted.set(chunk.id, item);
      structureIndex.setChunk(chunk.id,root);
      (paintSurface??pendingSurface)?.setChunk(chunk.id,root);
      // Coarse (citywide) chunks ship no building footprint collision (80 MB budget), so index their
      // already-streamed buildings* meshes for triangle-accurate occlusion. Per-mesh AABBs would be
      // useless here (partition batches a whole chunk's buildings into one mesh). Camera always uses this
      // (gtasf-q3r6); the player only when flags.coarseBuildingCollision is on (gtasf-ntcl).
      if (chunk.detail === 'low') coarseBuildingIndex.setChunk(chunk.id, root, /^buildings(?:_|$)/);
      let fieldColumn = fieldGrid.get(chunk.x);
      if (!fieldColumn) { fieldColumn = new Map(); fieldGrid.set(chunk.x, fieldColumn); }
      fieldColumn.set(chunk.z, height);
      collisions.set(chunk.id, collision); rebuildCameraBoxes();
      stats.lastLoadMs = performance.now() - started;
    } catch (error) {
      if (root && !mounted.has(chunk.id)) disposeGeometry(root);
      if (!disposed) {
        stats.errors.push(String(error)); stats.errors.splice(0, Math.max(0, stats.errors.length - 8));
        failedUntil.set(chunk.id, performance.now() + 10_000);
      }
    } finally { pending.delete(chunk.id); stats.loading = pending.size; }
  }
  function unload(id: string, item: Mounted) {
    structureIndex.removeChunk(id); coarseBuildingIndex.removeChunk(id); (paintSurface??pendingSurface)?.removeChunk(id);
    item.release(); disposeGeometry(item.root); mounted.delete(id); collisions.delete(id);
    const fieldColumn = fieldGrid.get(item.chunk.x);
    fieldColumn?.delete(item.chunk.z);
    if (!fieldColumn?.size) fieldGrid.delete(item.chunk.x);
  }
  function requestChunk(chunk: Chunk): Promise<void> {
    const existing = jobs.get(chunk.id);
    if (existing) return existing;
    if (mounted.has(chunk.id)) return Promise.resolve();
    const job = load(chunk).finally(() => { jobs.delete(chunk.id); });
    jobs.set(chunk.id, job); return job;
  }
  function update(position: { x: number; z: number }): void {
    if (disposed) return;
    const started = performance.now(); focus = position;
    stats.uploadsThisFrame = 0; stats.bytesThisFrame = 0;
    let changed = false;
    for (const item of mounted.values()) if (distance(item.chunk) > 2) { unload(item.chunk.id, item); changed = true; }
    if (changed) rebuildCameraBoxes();
    // One geometry reveal per frame bounds driver uploads, even if several network responses resolve together.
    let nextUpload: Mounted | undefined, nextDistance = Infinity, queuedUploads = 0;
    for (const item of mounted.values()) {
      queuedUploads += item.meshes.length;
      if (!item.meshes.length) continue;
      const away = distance(item.chunk);
      if (away < nextDistance) { nextUpload = item; nextDistance = away; }
    }
    if (nextUpload) {
      const upload = nextUpload.meshes.shift()!;
      upload.mesh.visible = true; stats.uploadsThisFrame = 1; stats.bytesThisFrame = upload.bytes;
      stats.uploadedBytes += upload.bytes; queuedUploads--;
    }
    // At most two chunks fetch/decode concurrently; only the nearest 3x3 are requested.
    wanted.length = 0;
    const cx = Math.floor(focus.x / 256), cz = Math.floor(focus.z / 256), now = performance.now();
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) {
      const chunk = chunkGrid.get(x)?.get(z);
      if (chunk && !mounted.has(chunk.id) && !pending.has(chunk.id) && (failedUntil.get(chunk.id) ?? 0) <= now) wanted.push(chunk);
    }
    wanted.sort((a, b) => Math.hypot(a.x * 256 + 128 - focus.x, a.z * 256 + 128 - focus.z) - Math.hypot(b.x * 256 + 128 - focus.x, b.z * 256 + 128 - focus.z));
    for (const chunk of wanted) { if (pending.size >= 2) break; void requestChunk(chunk); }
    stats.mounted = mounted.size; stats.queuedUploads = queuedUploads;
    stats.lastUpdateMs = performance.now() - started;
  }
  function heightAt(x: number, z: number): number | null {
    const field = fieldGrid.get(Math.floor(x / 256))?.get(Math.floor(z / 256));
    return field ? sampleHeight(field, x, z) : null;
  }
  /** Top (max y) of the loaded building whose footprint box contains (x, z), or is within `slack` m of it; null if none. */
  function buildingTopAt(x: number, z: number, slack = 12): number | null {
    let best: number | null = null, bestGap = Infinity;
    for (const box of cameraBoxes) {
      const gx = Math.max(box.min.x - x, 0, x - box.max.x), gz = Math.max(box.min.z - z, 0, z - box.max.z), gap = Math.hypot(gx, gz);
      if (gap <= slack && (gap < bestGap || (gap === bestGap && box.max.y > (best ?? -Infinity)))) { best = box.max.y; bestGap = gap; }
    }
    return best;
  }
  function surfaceHeightAt(x: number, z: number, referenceY?: number): number | null {
    const ground = heightAt(x, z);
    if (ground === null) return null;
    const road = roadHeightAt(x, z, referenceY);
    // Leaving a tunnel's lane must not teleport the player onto the hill above.
    return road ?? (referenceY !== undefined && ground > referenceY + 5 ? null : ground);
  }
  function collidesStatic(x: number, y: number, z: number, radius: number, height: number): boolean {
    return collisionIndex.collides(x, y, z, radius, height)||structureIndex.collides(x,y,z,radius,height);
  }
  function collides(x: number, y: number, z: number, radius = .35, height = 1.8): boolean {
    return collidesStatic(x, y, z, radius, height)
      ||(flags.coarseBuildingCollision&&coarseBuildingIndex.collides(x, y, z, radius, height));
  }
  // The camera always avoids coarse-district blocks (triangle-accurate), independent of the player
  // collision flag, so deep-link spawns there never bury the chase camera in a block (gtasf-q3r6).
  function collidesCamera(x: number, y: number, z: number, radius = .35, height = 1.8): boolean {
    return collidesStatic(x, y, z, radius, height)||coarseBuildingIndex.collides(x, y, z, radius, height);
  }
  async function ensureAround(position: { x: number; z: number }): Promise<void> {
    if (disposed) throw new Error('Map is disposed');
    focus = position;
    const target = chunkGrid.get(Math.floor(position.x / 256))?.get(Math.floor(position.z / 256));
    if (!target) throw new Error('Location is outside the loaded map area');
    while (!mounted.has(target.id) && !jobs.has(target.id) && pending.size >= 2) await Promise.race(jobs.values());
    await requestChunk(target);
    if (!mounted.has(target.id)) throw new Error(stats.errors.at(-1) ?? 'Location chunk failed');
    update(position);
  }
  // Aerial far-LOD ring (aerialFarChunks): when the camera lifts well above the ground, stream the cheap coarse
  // chunks (detail:'low') in a ring beyond the near 3x3 out to a few km, so the aerial mid-ground is not an empty
  // haze void. Visual-only via mountFar (no collision, camera boxes, facade fronts, shadows or water); loaded
  // after READY and disposed when the camera descends, so street play, first load and collision are untouched.
  const FAR_MIN_HEIGHT = 55;   // metres above ground before the ring activates (clearly aerial, above rooftops)
  const FAR_CONCURRENCY = 4;   // far chunks fetching/decoding at once (fills the ring faster); near keeps its own budget
  const farMounted = new Map<string, { chunk: Chunk; root: Object3D; release: () => void }>();
  const farJobs = new Map<string, Promise<void>>();
  const farPending = new Set<string>();
  const farWanted = new Set<string>();
  function disposeFar(id: string): void {
    const item = farMounted.get(id); if (!item) return;
    item.release(); disposeGeometry(item.root); farMounted.delete(id);
  }
  function disposeAllFar(): void { for (const id of [...farMounted.keys()]) disposeFar(id); farWanted.clear(); }
  async function loadFar(chunk: Chunk): Promise<void> {
    farPending.add(chunk.id);
    let root: Object3D | undefined;
    try {
      // aerialFarCorridor: a full-detail corridor chunk enters the far ring at its smallest LOD, fetched AND decoded at
      // that index (coarse chunks keep the stock fetch: their LODs are the same file).
      const corridor = flags.aerialFarCorridor && chunk.detail !== 'low', farLod = corridor ? chunk.lods.length - 1 : Math.min(1, chunk.lods.length - 1);
      const [buffer, heightData, collision] = await (corridor ? fetchChunkData(chunk, farLod) : fetchChunkData(chunk));
      root = (await decode(buffer, chunk.lods[farLod]!.meshEncoding, collision, heightData.bytes)).scene;
      if (disposed || !farWanted.has(chunk.id) || mounted.has(chunk.id) || !options.mountFar) { disposeGeometry(root); return; }
      if (flags.chunkRoadMerge) mergeChunkRoadMeshes(root);
      // Clip the far ring to land: a pure-water bay chunk is skipped entirely (no tan slab, fewer draws).
      if (flags.aerialFarClipWater && !clipFarWater(root)) { disposeGeometry(root); return; }
      root.position.set(chunk.x * 256, 0, chunk.z * 256);
      root.userData.gtasfLowDetail = true; // coarse far-LOD
      if (flags.staticMatrixFreeze) {
        if (flags.chunkWorldFreeze) freezeStaticWorld(root);
        else root.traverse(object => { object.updateMatrix(); object.matrixAutoUpdate = false; });
      }
      farMounted.set(chunk.id, { chunk, root, release: options.mountFar(root) });
    } catch (error) {
      if (root && !farMounted.has(chunk.id)) disposeGeometry(root);
      if (!disposed) failedUntil.set(chunk.id, performance.now() + 10_000);
    } finally { farPending.delete(chunk.id); }
  }
  function requestFar(chunk: Chunk): void {
    if (farJobs.has(chunk.id) || farMounted.has(chunk.id)) return;
    farJobs.set(chunk.id, loadFar(chunk).finally(() => { farJobs.delete(chunk.id); }));
  }
  /** Stream/keep cheap far-LOD coarse chunks out to a few km when the camera lifts high above the ground;
   *  dispose them (free their memory + draw calls) the moment it descends or the flag is off. */
  function updateFar(cameraX: number, cameraZ: number, heightAboveGround: number): void {
    if (disposed) return;
    if (!flags.aerialFarChunks || !options.mountFar || !(heightAboveGround > FAR_MIN_HEIGHT)) {
      if (farMounted.size || farPending.size) disposeAllFar();
      return;
    }
    // aerialFarFill: fill the mid-distance so the skyline doesn't float across a bayWater void. HD-ONLY: HD is
    // vsync-bound aloft and gets a generous ring (base 6, step 9, max 18 ~ 4.6 km) that reaches the full skyline; the
    // aerial Low path is streaming-hitch-bound (an aerial-fps probe showed ~50 fps mean even with the flag OFF, and the
    // fuller ring made it worse), so Low keeps the stock aerialFarChunks ring unchanged. Off (or Low): byte-identical.
    const low = options.tier === 'low', fill = flags.aerialFarFill && !low;
    const maxR = fill ? 18 : (low ? 5 : 14); // ~1.25 km phone (unchanged), HD ~3.6 km, ~4.6 km with fill
    const base = fill ? 6 : 3, step = fill ? 9 : 14;
    const radius = Math.max(base, Math.min(maxR, base + Math.floor((heightAboveGround - FAR_MIN_HEIGHT) / step)));
    const cx = Math.floor(cameraX / 256), cz = Math.floor(cameraZ / 256), now = performance.now();
    farWanted.clear();
    const missing: Chunk[] = [];
    // d<=1 is the near 3x3 (full detail); the far ring starts at d=2 so it butts against it with no gap, and
    // runs out to `radius` in every direction (a full ring, not one sector).
    for (let gx = cx - radius; gx <= cx + radius; gx++) for (let gz = cz - radius; gz <= cz + radius; gz++) {
      if (Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) <= 1) continue; // the near 3x3 owns d<=1
      const chunk = chunkGrid.get(gx)?.get(gz);
      // aerialFarCorridor: the 78 full-detail corridor chunks (Ferry->Columbus->Lombard: North Beach, Jackson Square)
      // carry no `detail` tag, so the coarse-only ring skipped them and they rendered as open bay once outside the
      // near 3x3 (the FiDi "floating" across water from Telegraph Hill). Include them too (smallest LOD, see loadFar).
      // HD-only: on phone Low the parked aerial dropped from ~22-33 to ~12 fps with them (4x throttle).
      if (!chunk || (chunk.detail !== 'low' && !(flags.aerialFarCorridor && !low)) || mounted.has(chunk.id)) continue; // never shadow a near chunk
      farWanted.add(chunk.id);
      if (!farMounted.has(chunk.id) && !farPending.has(chunk.id) && (failedUntil.get(chunk.id) ?? 0) <= now) missing.push(chunk);
    }
    for (const id of [...farMounted.keys()]) if (!farWanted.has(id)) disposeFar(id); // left the ring, or became near
    missing.sort((a, b) => Math.hypot(a.x * 256 + 128 - cameraX, a.z * 256 + 128 - cameraZ) - Math.hypot(b.x * 256 + 128 - cameraX, b.z * 256 + 128 - cameraZ));
    for (const chunk of missing) { if (farPending.size >= FAR_CONCURRENCY) break; requestFar(chunk); }
  }

  const initial = chunkGrid.get(Math.floor(focus.x / 256))?.get(Math.floor(focus.z / 256));
  if (!initial) throw new Error('Spawn is outside the map');
  performance.mark('gtasf:indexes-built');
  await requestChunk(initial);
  performance.mark('gtasf:initial-chunk');
  if (!mounted.has(initial.id)) { abort.abort(); throw new Error(stats.errors.at(-1) ?? 'Spawn chunk failed'); }
  update(focus);
  return {
    manifest, cameraBoxes,
    /** Current graph: the near subset until upgradeGraph() resolves (gtasf-0k01), then the full city graph. */
    get graph() { return graphs.graph; }, get routingGraph() { return graphs.routingGraph; },
    get graphComplete() { return graphComplete; },
    upgradeGraph,
    /** Starts the upgrade if needed; resolves with the full ROUTING graph as soon as it's decoded, before the three
     *  city-wide indexes (earlyRouterGraph). The radar router snaps endpoints with its own structures, not these indexes. */
    /** A copy of the restored full road-graph bytes as soon as they're downloaded (starts the upgrade if needed). */
    fullRoadGraphBytes(): Promise<ArrayBuffer> { upgradeGraph(); return fullBytes; },
    fullRoutingGraph(): Promise<RoadGraph> { upgradeGraph(); return fullDecoded!.then(full => full.routingGraph ?? full.graph); },
    stats, spawn: { ...initialPosition, y: surfaceHeightAt(initialPosition.x, initialPosition.z, initialPosition.y)! }, destination: LOMBARD_DESTINATION,
    heightAt, surfaceHeightAt, buildingTopAt, roadHeightAt, drapeRoadTriangle, renderedGroundHeightAt, collides, collidesCamera, update, updateFar, ensureAround, nearestRoad, locationNameAt, collisionStats: collisionIndex.stats,
    structureCollisionStats: structureIndex.stats, coarseCollisionStats: coarseBuildingIndex.stats,
    get collisionRevision() { return collisionRevision; },
    collidesCircle(x: number, z: number, radius = .35): boolean {
      const y = surfaceHeightAt(x, z);
      return y === null || collides(x, y, z, radius);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true; abort.abort();
      for (const [id, item] of mounted) unload(id, item);
      disposeAllFar();
      collisionIndex.rebuild([]);
      structureIndex.clear(); paintSurface?.clear(); pendingSurface=undefined; surfaceBuildStarted=false;
      coarseBuildingIndex.clear();
      collisionRevision++;
      cameraBoxes.length = 0;
    },
  };
}
export type LombardWorld = NonNullable<Awaited<ReturnType<typeof loadLombardWorld>>>;
