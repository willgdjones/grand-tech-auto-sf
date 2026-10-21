import { Group, Vector3 } from 'three';
import { flags } from '@gtasf/shared/flags';
import { loadRealisticExtraTemplate, type RealisticExtraId, type VehicleInstance, type VehicleTemplate } from '../../vehicles/models/vehicle';

type Landmark = Group & { userData: { landmarkId?: string } };
type ParkedKind = Extract<RealisticExtraId, 'food-truck' | 'scooter'>;
type Placement = { root: Group; source: Landmark | undefined; spot: ParkedSpot; grounded: boolean };

export interface ParkedVehiclesOptions {
  landmarks: Group;
  low?: boolean;
  /** The visible road/terrain plus authored landmark surfaces, in world coordinates. */
  heightAt(x: number, z: number): number | null;
  /** False until the supporting map chunk is revealed, and after it unloads. */
  isLoaded(x: number, z: number): boolean;
}

export interface ParkedSpot {
  readonly kind: ParkedKind;
  /** Anchor landmark id; the spot is placed in that landmark's local frame when it has streamed in. */
  readonly landmark: string;
  readonly x: number; readonly y: number; readonly z: number;
  /** Yaw in radians, added to the anchor landmark's yaw. */
  readonly yaw: number;
}

/**
 * Where parked props sit. Coordinates are in the anchor landmark's LOCAL frame and are the knobs
 * pane 6 tunes in-browser (ground height / exact position) and extends to more landmarks (SoMa /
 * FiDi) as they are added to the render layer. Spots whose landmark is not yet loaded are placed
 * lazily once it streams in (see createParkedVehicles), so these can sit anywhere in the city.
 * Food trucks line plaza edges; a rental e-scooter rack clusters by each plaza.
 */
export const PARKED_SPOTS: readonly ParkedSpot[] = [
  // Ferry Building plaza (loaded at the default spawn) — cityLife dresses z~64-86, x~-48..48 here.
  { kind: 'food-truck', landmark: 'ferry-building', x: -48, y: 0.18, z: 70, yaw: Math.PI / 2 },
  { kind: 'food-truck', landmark: 'ferry-building', x: 48, y: 0.18, z: 66, yaw: -Math.PI / 2 }, // was z 86: 1.6 m from a lane (in the roadway); z 66 = 18 m clear (gtasf-8s12 probe)
  ...Array.from({ length: 6 }, (_, i): ParkedSpot => ({
    kind: 'scooter', landmark: 'ferry-building', x: 7 + i * 0.75, y: 0.18, z: 82, yaw: 0.15,
  })),
  // Pier 39 / Fisherman's Wharf (streams in to the north) — coords are placeholders for pane-6 tuning.
  { kind: 'food-truck', landmark: 'pier-39', x: -24, y: 0.1, z: 150, yaw: 0 },
  ...Array.from({ length: 4 }, (_, i): ParkedSpot => ({
    kind: 'scooter', landmark: 'pier-39', x: -30 + i * 0.75, y: 0.1, z: 156, yaw: Math.PI / 2,
  })),
];

/**
 * Parked realistic street props (gtasf-parked-vehicle-props-5fx4): food trucks and rental e-scooters
 * dressed around SF landmarks under `realisticRender`. Static client-only cosmetics (no server
 * entity). The Meshy extras load only when realisticRender + driving are on, so this returns null (a
 * no-op) on the CC0 renderer, when the flag is off, or when no spot's anchor landmark ever appears.
 *
 * Placement is streaming-aware: each spot is placed the first throttled `update` tick after its
 * anchor landmark is present, so spots can sit anywhere in the city, not only at the spawn landmark.
 *
 * Wiring (pane 1, like createStreetProps): mount `root`, call `update(player, now)` each frame,
 * `dispose()` on teardown. Start the async load after READY and add the root directly to the scene
 * (not mountGeometry, which repaints authored PBR materials). Call update before the first render.
 */
export async function createParkedVehicles(options: ParkedVehiclesOptions) {
  if (!flags.parkedProps || !flags.driving) return null;
  // Renderer gate (gtasf-8s12): the live graphicsV2 path loads the Meshy extras through pbrCarsV2 (HD + Low, PBR demoted
  // to Lambert unless realisticLightingV2); the legacy path needs realisticRender. loadRealisticExtraTemplate mirrors this.
  if (flags.graphicsV2 ? !flags.pbrCarsV2 : !flags.realisticRender) return null;
  const kinds = [...new Set(PARKED_SPOTS.map(spot => spot.kind))];
  const templates = new Map<ParkedKind, VehicleTemplate>();
  await Promise.all(kinds.map(async kind => {
    const template = await loadRealisticExtraTemplate(kind);
    if (template) templates.set(kind, template);
  }));
  if (!templates.size) return null; // realisticRender/driving off, or extras not generated.

  const root = new Group(); root.name = 'parked vehicles';
  const instances: VehicleInstance[] = [];
  const placed: Placement[] = [];
  const pending = PARKED_SPOTS.filter(spot => templates.has(spot.kind)).slice();
  const point = new Vector3();
  const findLandmark = (id: string) =>
    options.landmarks.children.find(object => (object as Landmark).userData.landmarkId === id) as Landmark | undefined;

  const anchor = (entry: Placement) => {
    // Streaming may remove a landmark and later recreate it as a different object.
    const source = entry.source = findLandmark(entry.spot.landmark);
    entry.grounded = false;
    if (!source) return;
    source.updateWorldMatrix(true, false);
    point.set(entry.spot.x, entry.spot.y, entry.spot.z).applyMatrix4(source.matrixWorld);
    if (!options.isLoaded(point.x, point.z)) return;
    const y = options.heightAt(point.x, point.z);
    if (y === null || !Number.isFinite(y)) return;
    point.y = y;
    entry.root.position.copy(point);
    source.getWorldQuaternion(entry.root.quaternion);
    entry.root.rotateY(entry.spot.yaw);
    entry.grounded = true;
  };

  /** Place any pending spot whose anchor landmark is now present; removes it from `pending`. */
  const placePending = () => {
    for (let i = pending.length - 1; i >= 0; i--) {
      const spot = pending[i]!, source = findLandmark(spot.landmark), template = templates.get(spot.kind);
      if (!source || !template) continue;
      const instance = template.createInstance();
      instances.push(instance);
      // Async completion must not flash props at the origin or over an unloaded chunk.
      instance.root.visible = false;
      const entry: Placement = { root: instance.root, source, spot, grounded: false };
      anchor(entry);
      root.add(instance.root);
      placed.push(entry);
      pending.splice(i, 1);
    }
  };
  placePending(); // place whatever is already loaded (e.g. the Ferry plaza at spawn).

  let disposed = false, nextTick = 0;
  return {
    root,
    /** Place newly streamed-in spots, re-anchor existing ones, and hide distant props (throttled 1 Hz). */
    update(player: { x: number; z: number }, now = Date.now()) {
      if (disposed) return;
      if (now >= nextTick) {
        nextTick = now + 1000;
        if (pending.length) placePending();
        for (const entry of placed) anchor(entry);
      }
      const far = options.low ? 120 : 220;
      for (const entry of placed) {
        entry.root.visible = entry.grounded && entry.source?.parent === options.landmarks &&
          options.landmarks.visible && entry.source.visible &&
          options.isLoaded(entry.root.position.x, entry.root.position.z) &&
          Math.hypot(player.x - entry.root.position.x, player.z - entry.root.position.z) < far;
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const instance of instances) instance.dispose();
      for (const template of templates.values()) template.dispose();
      root.removeFromParent();
    },
  };
}
