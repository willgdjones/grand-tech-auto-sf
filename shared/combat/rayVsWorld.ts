/**
 * GTA V pivot — LANE B (combat & police): ray vs the world, for bullets and line of sight.
 *
 * Pure, shared (client prediction + server hit validation in step 3). Tests a 3D ray against:
 *   - building footprints (shared/mapCollision.ts rings, extruded minY..maxY — origin-local coords,
 *     so world = ring + collision.origin, matching world.ts:302), and
 *   - optional terrain via a heightAt(x,z) sampler (raymarched — arcade-grade, no physics engine).
 *
 * No three.js, no DOM. The ray is in WORLD metres; the collision's origin offset is applied internally.
 */
import type { MapCollision } from '../mapCollision';

export interface Ray {
  /** World metres (x east, y up, z north). */
  origin: readonly [number, number, number];
  /** Unit direction. */
  dir: readonly [number, number, number];
  /** Max 3D distance to test. */
  maxDist: number;
}

export interface RayHit {
  hit: boolean;
  /** 3D distance along the ray to the hit (maxDist when nothing is hit). */
  distance: number;
  /** World hit point. */
  point: [number, number, number];
  kind: 'building' | 'terrain' | 'none';
  buildingId?: string;
}

const EPS = 1e-6;

/** Per-building plan bounds [minX, minZ, maxX, maxZ] (origin-local), computed once per collision object. gtasf-j7wvv: the
 *  server's police sight/step checks run many rays per tick over a downtown 3x3 (~1,800 buildings, 40k edges). */
const boundsCache = new WeakMap<MapCollision, Float64Array>();
function buildingBounds(collision: MapCollision): Float64Array {
  let bounds = boundsCache.get(collision);
  if (bounds) return bounds;
  bounds = new Float64Array(collision.buildings.length * 4);
  collision.buildings.forEach((b, k) => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const ring of b.rings) for (const p of ring) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
    bounds!.set([minX, minZ, maxX, maxZ], k * 4);
  });
  boundsCache.set(collision, bounds);
  return bounds;
}

/** Nearest building hit, in the ray's own parameter (= 3D distance since dir is unit). */
function buildingHit(ray: Ray, collision: MapCollision): { distance: number; id: string } | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.dir;
  const [cx, , cz] = collision.origin;
  // The segment's plan box and height span, origin-local: a building whose box misses it can't be crossed (exact skip).
  const ex0 = ox + ray.maxDist * dx, ez0 = oz + ray.maxDist * dz, ey0 = oy + ray.maxDist * dy;
  const sMinX = Math.min(ox, ex0) - cx - EPS, sMaxX = Math.max(ox, ex0) - cx + EPS, sMinZ = Math.min(oz, ez0) - cz - EPS, sMaxZ = Math.max(oz, ez0) - cz + EPS;
  const sMinY = Math.min(oy, ey0), sMaxY = Math.max(oy, ey0);
  const bounds = buildingBounds(collision);
  let best: { distance: number; id: string } | null = null;
  for (let k = 0; k < collision.buildings.length; k++) {
    const b = collision.buildings[k]!;
    if (bounds[k * 4]! > sMaxX || bounds[k * 4 + 2]! < sMinX || bounds[k * 4 + 1]! > sMaxZ || bounds[k * 4 + 3]! < sMinZ) continue;
    if (sMinY > b.maxY + EPS || sMaxY < b.minY - EPS) continue;
    for (const ring of b.rings) {
      const n = ring.length;
      if (n < 2) continue;
      for (let i = 0; i < n; i++) {
        const a = ring[i]!;
        const c = ring[(i + 1) % n]!;
        // Edge endpoints in world coords.
        const ax = a[0] + cx, az = a[1] + cz;
        const ex = (c[0] + cx) - ax, ez = (c[1] + cz) - az; // edge vector
        const denom = dx * ez - dz * ex; // horizontal cross(dir, edge)
        if (Math.abs(denom) < EPS) continue; // ray parallel to this wall in plan
        const wx = ax - ox, wz = az - oz;
        const s = (wx * ez - wz * ex) / denom; // 3D distance along the ray
        if (s < 0 || s > ray.maxDist) continue;
        const t = (wx * dz - wz * dx) / denom; // position along the edge
        if (t < 0 || t > 1) continue;
        const y = oy + s * dy; // ray height at the crossing
        if (y < b.minY - EPS || y > b.maxY + EPS) continue; // passes over/under the wall
        if (!best || s < best.distance) best = { distance: s, id: b.id };
      }
    }
  }
  return best;
}

/** First terrain crossing (ray dips to/under ground), raymarched up to `limit`. */
function terrainHit(ray: Ray, heightAt: (x: number, z: number) => number | null, limit: number, step: number): number | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.dir;
  for (let s = step; s <= limit; s += step) {
    const x = ox + s * dx, z = oz + s * dz, y = oy + s * dy;
    const ground = heightAt(x, z);
    if (ground !== null && y <= ground) return Math.max(0, s);
  }
  return null;
}

export interface RayVsWorldOptions {
  heightAt?: (x: number, z: number) => number | null;
  /** Terrain raymarch step in metres (default 1). Smaller = more precise, more samples. */
  terrainStep?: number;
}

/** Cast a ray; returns the nearest building/terrain hit within maxDist (or a miss). */
export function rayVsWorld(ray: Ray, collision: MapCollision | null, options: RayVsWorldOptions = {}): RayHit {
  const b = collision ? buildingHit(ray, collision) : null;
  const limit = b ? Math.min(b.distance, ray.maxDist) : ray.maxDist;
  const tStep = options.terrainStep && options.terrainStep > 0 ? options.terrainStep : 1;
  const t = options.heightAt ? terrainHit(ray, options.heightAt, limit, tStep) : null;

  const pick = (distance: number, kind: 'building' | 'terrain', id?: string): RayHit => ({
    hit: true,
    distance,
    point: [ray.origin[0] + distance * ray.dir[0], ray.origin[1] + distance * ray.dir[1], ray.origin[2] + distance * ray.dir[2]],
    kind,
    ...(id ? { buildingId: id } : {}),
  });

  if (t !== null && (!b || t <= b.distance)) return pick(t, 'terrain');
  if (b) return pick(b.distance, 'building', b.id);
  return {
    hit: false,
    distance: ray.maxDist,
    point: [ray.origin[0] + ray.maxDist * ray.dir[0], ray.origin[1] + ray.maxDist * ray.dir[1], ray.origin[2] + ray.maxDist * ray.dir[2]],
    kind: 'none',
  };
}

/** Unit direction + distance from `from` to `to` (world metres). */
export function dirTo(from: readonly [number, number, number], to: readonly [number, number, number]): { dir: [number, number, number]; distance: number } {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const distance = Math.hypot(dx, dy, dz);
  if (distance < EPS) return { dir: [0, 0, 1], distance: 0 };
  return { dir: [dx / distance, dy / distance, dz / distance], distance };
}

/**
 * Is the straight segment from `from` to `to` unobstructed by buildings/terrain? Used by the server to
 * validate a hit (shooter must see the target). A hit strictly before the target distance blocks.
 */
export function lineOfSight(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  collision: MapCollision | null,
  options: RayVsWorldOptions = {},
): boolean {
  const { dir, distance } = dirTo(from, to);
  if (distance < EPS) return true;
  // Stop just short of the target so the target's own footprint/ground at the endpoint isn't a false block.
  const margin = Math.min(0.25, distance / 2);
  const result = rayVsWorld({ origin: from, dir, maxDist: distance - margin }, collision, options);
  return !result.hit;
}
