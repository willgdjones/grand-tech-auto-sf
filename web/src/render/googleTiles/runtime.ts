import { Box3, Camera, LoadingManager, Material, Mesh, MeshBasicMaterial, Raycaster, Vector3, type Object3D } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TilesRenderer } from '3d-tiles-renderer/three';
import { DownloadPriorityQueue, LRUCache, PriorityQueue, type Tile } from '3d-tiles-renderer/core';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { GLTFExtensionsPlugin } from '3d-tiles-renderer/three/plugins';
import dracoWrapper from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import dracoWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';
import { ecefToWorldMatrix } from './coordinates';
import { createGoogleCoverage } from './coverage';
import type { GoogleTilesHandle, GoogleTilesOptions, GoogleTilesStatus } from './index';

type Loaded = { scene: Object3D; tile: Tile; bounds: Box3; materials: MeshBasicMaterial[] };
const DETAIL_ERROR_METRES = 8;
const DOWN = new Vector3(0, -1, 0);

/** Loaded only after both flags and a nonempty key. Google content never enters our
 * asset pipeline, map bake, collision indexes or persistence. */
export function createGoogleTilesRuntime(options: GoogleTilesOptions, key: string,
  status: (state: GoogleTilesStatus, attribution?: string) => void): GoogleTilesHandle {
  const tiles = new TilesRenderer();
  const coverage = createGoogleCoverage(), loaded = new Map<Object3D, Loaded>();
  const ray = new Raycaster(); ray.far = 500;
  const decoderManager = new LoadingManager();
  decoderManager.setURLModifier(url => url.endsWith('draco_wasm_wrapper.js') ? dracoWrapper
    : url.endsWith('draco_decoder.wasm') ? dracoWasm : url);
  const draco = new DRACOLoader(decoderManager).setDecoderPath('/__google_tiles_decoder__/')
    .setDecoderConfig({ type: 'wasm' }).setWorkerLimit(1);
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true }));
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco, meshoptDecoder: MeshoptDecoder }));
  // The library defaults are shared singletons. Own each queue/cache so the prototype
  // cannot silently change another renderer's concurrency or memory budget.
  const lruOrder = tiles.lruCache.unloadPriorityCallback;
  tiles.lruCache = new LRUCache(); tiles.lruCache.unloadPriorityCallback = lruOrder;
  tiles.lruCache.minSize = options.low ? 32 : 64; tiles.lruCache.maxSize = options.low ? 96 : 192;
  tiles.lruCache.minBytesSize = (options.low ? 24 : 48) * 1024 * 1024;
  tiles.lruCache.maxBytesSize = (options.low ? 48 : 96) * 1024 * 1024;
  const downloadOrder = tiles.downloadQueue.priorityCallback, parseOrder = tiles.parseQueue.priorityCallback, nodeOrder = tiles.processNodeQueue.priorityCallback;
  tiles.downloadQueue = new DownloadPriorityQueue(); tiles.downloadQueue.priorityCallback = downloadOrder; tiles.downloadQueue.maxJobsPerOrigin = options.low ? 2 : 4;
  tiles.parseQueue = new PriorityQueue(); tiles.parseQueue.maxJobs = 1; tiles.parseQueue.priorityCallback = parseOrder;
  tiles.processNodeQueue = new PriorityQueue(); tiles.processNodeQueue.maxJobs = 1; tiles.processNodeQueue.priorityCallback = nodeOrder;
  tiles.errorTarget = options.low ? 24 : 12; tiles.maxTilesProcessed = options.low ? 100 : 200;
  tiles.loadSiblings = false;
  // Pages uses Referrer-Policy: same-origin; a per-request origin referrer lets
  // Google's browser-key restrictions work without weakening other game requests.
  tiles.fetchOptions = { referrerPolicy: 'strict-origin-when-cross-origin' };
  tiles.group.name = 'Google Maps photorealistic basemap';
  tiles.group.matrixAutoUpdate = false; tiles.group.matrix.copy(ecefToWorldMatrix(options.frame));
  tiles.group.visible = false; options.scene.add(tiles.group);
  tiles.group.updateMatrixWorld(true);
  let disposed = false, failed = false, fatal = false, aligned = false, errors = 0;
  let camera: Camera | undefined, lastUpdate: number | undefined, alignmentMs = 0, lastCoverage = -Infinity;
  const visibility = typeof document !== 'undefined' ? document : undefined;
  // A suspended tab cannot advance alignment. Keep the accumulated visible budget,
  // but discard the frame gap across either visibility transition.
  const resetUpdateTime = () => { lastUpdate = undefined; };
  visibility?.addEventListener('visibilitychange', resetUpdateTime);
  let lastX = NaN, lastZ = NaN, coverageDirty = true;
  const attributions: { type: string; value: unknown }[] = [];

  tiles.addEventListener('load-model', event => {
    const materials: MeshBasicMaterial[] = [], replacements = new Map<Material, MeshBasicMaterial>();
    event.scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      // Imagery already contains captured lighting. Keep it unlit, outside our
      // authored-facade conversion, and borrow its texture until the tile unloads.
      const convert = (source: Material) => {
        let material = replacements.get(source);
        if (!material) {
          const input = source as MeshBasicMaterial;
          material = new MeshBasicMaterial({ map: input.map ?? null, color: input.color,
            vertexColors: input.vertexColors, side: source.side, transparent: source.transparent,
            opacity: source.opacity, alphaTest: source.alphaTest, fog: false });
          replacements.set(source, material); materials.push(material);
        }
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
      object.castShadow = false; object.receiveShadow = false;
    });
    loaded.set(event.scene, { scene: event.scene, tile: event.tile, bounds: new Box3(), materials });
    coverageDirty = true;
  });
  tiles.addEventListener('dispose-model', event => {
    for (const material of loaded.get(event.scene)?.materials ?? []) material.dispose();
    loaded.delete(event.scene); coverageDirty = true;
  });
  tiles.addEventListener('tile-visibility-change', () => { coverageDirty = true; });
  // Don't surface library error text: a request URL can contain a browser API key.
  tiles.addEventListener('load-error', event => { if (!event.tile || ++errors >= 8) fatal = true; });

  function stop() {
    visibility?.removeEventListener('visibilitychange', resetUpdateTime);
    tiles.group.removeFromParent(); coverage.clear();
    tiles.dispose(); draco.dispose();
    for (const entry of loaded.values()) for (const material of entry.materials) material.dispose();
    loaded.clear(); coverage.dispose();
  }
  function fallback() {
    if (failed || disposed) return;
    failed = true; stop(); status('unavailable');
  }
  function refresh(focus: { x: number; z: number }) {
    tiles.group.updateMatrixWorld(true);
    const detailed: Loaded[] = [], boxes: Box3[] = [];
    for (const entry of loaded.values()) {
      const visible = tiles.visibleTiles.has(entry.tile);
      // Never replace the street-level world with a continent-sized startup tile.
      if (!visible || entry.tile.geometricError > DETAIL_ERROR_METRES) { entry.scene.visible = false; continue; }
      entry.scene.updateWorldMatrix(true, true); entry.bounds.setFromObject(entry.scene);
      const box = entry.bounds;
      const suitable = !box.isEmpty() && box.max.x - box.min.x < 2048 && box.max.z - box.min.z < 2048
        && box.min.x < focus.x + 700 && box.max.x > focus.x - 700
        && box.min.z < focus.z + 700 && box.max.z > focus.z - 700;
      entry.scene.visible = suitable;
      if (suitable) { detailed.push(entry); boxes.push(box); }
    }
    if (!aligned && detailed.length) {
      // The map heightfield is sea-level based, while Google is ellipsoidal. Align
      // the rendered tiles at three independent road samples; do not change physics
      // or derive any stored map data from Google. Roof/bridge mismatches fail closed.
      const anchor = options.roadAnchor(focus.x, focus.z), offsets: number[] = [];
      if (anchor) for (const step of [-3, 0, 3]) {
        const probe = options.roadAnchor(anchor.x + Math.sin(anchor.yaw) * step, anchor.z + Math.cos(anchor.yaw) * step);
        if (!probe || !boxes.some(box => probe.x >= box.min.x && probe.x <= box.max.x && probe.z >= box.min.z && probe.z <= box.max.z)) break;
        ray.set(new Vector3(probe.x, probe.y + 250, probe.z), DOWN);
        const hit = ray.intersectObjects(detailed.map(entry => entry.scene), true)[0];
        if (!hit) break;
        offsets.push(probe.y - hit.point.y);
      }
      if (offsets.length === 3 && offsets.every(value => Number.isFinite(value) && Math.abs(value) <= 80)
        && Math.max(...offsets) - Math.min(...offsets) < 1.5) {
        const shift = offsets.sort((a, b) => a - b)[1]!;
        tiles.group.matrix.elements[13]! += shift;
        tiles.group.matrixWorldNeedsUpdate = true; tiles.group.updateMatrixWorld(true);
        aligned = true;
      }
    }
    tiles.group.visible = aligned && boxes.length > 0;
    if (!tiles.group.visible) { coverage.clear(); status('aligning'); return; }
    // Patching fragment output leaves meshes visible to all existing terrain,
    // structure, vehicle and camera collision queries.
    for (const root of options.scene.children) if (root.userData.gtasfFacadeGround) coverage.mount(root);
    coverage.mount(options.landmarks);
    coverage.update(boxes, focus);
    attributions.length = 0; tiles.getAttributions(attributions);
    const providers = [...new Set(attributions.filter(item => item.type === 'string' && typeof item.value === 'string')
      .map(item => item.value as string).filter(Boolean))].sort().join(' · ');
    status('streaming', providers);
  }
  return {
    update(nextCamera, focus, now) {
      if (disposed || failed) return;
      if (visibility?.hidden) { resetUpdateTime(); return; }
      if (!aligned && lastUpdate !== undefined) alignmentMs += Math.max(0, now - lastUpdate);
      lastUpdate = now;
      if (fatal || (!aligned && alignmentMs > 45_000)) { fallback(); return; }
      try {
        if (camera !== nextCamera) { if (camera) tiles.deleteCamera(camera); camera = nextCamera; tiles.setCamera(camera); }
        camera.updateMatrixWorld(); tiles.setResolutionFromRenderer(camera, options.renderer);
        tiles.group.updateMatrixWorld(); tiles.update();
        // Rebuild immediately on tile eviction/visibility changes to keep mask and
        // basemap atomic; otherwise refresh at 2 Hz or after a location jump.
        if (coverageDirty || now - lastCoverage >= 500 || Math.hypot(focus.x - lastX, focus.z - lastZ) > 32) {
          refresh(focus); lastCoverage = now; lastX = focus.x; lastZ = focus.z; coverageDirty = false;
        }
      } catch { fallback(); }
    },
    dispose() { if (disposed) return; if (!failed) stop(); disposed = true; },
  };
}
