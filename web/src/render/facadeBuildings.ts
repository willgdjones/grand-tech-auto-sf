import { Mesh, Vector3, type Object3D } from 'three';
import { flags } from '@gtasf/shared/flags';
import type { ShopfrontContext } from './shopfrontSigns';
import { FootprintIndex, sampleHeight, type BuildingFootprint } from './chunks/terrain';

export interface FacadeWall {
  ax: number; az: number; bx: number; bz: number;
  nx: number; nz: number; width: number;
  bottom: number; top: number;
  colour: [number, number, number];
  street: boolean; exposed: boolean; ground: number;
}
export interface FacadeBuilding {
  id: string; walls: FacadeWall[]; x: number; z: number;
  footprint: number; height: number; frontage: number;
}

const pointKey = (x: number, z: number) => `${Math.round(x * 20)},${Math.round(z * 20)}`;
function area(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; sum += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(sum) / 2;
}

// gtasf-facade-exposed-clearance-l6sy: a wall is "exposed" (a plaza/lot/street is in front of it, so it earns
// a real facade) rather than a party wall when it has at least ~EXPOSED_CLEARANCE m of open ground ahead. We
// ray-march the footprint index out from the wall midpoint and take the freer of the two normal directions,
// so a triangle normal that points into the building — or the old single near-roof point probe — can't hide a
// genuinely open face. Load-time only; the footprint index is the same one the road/street pass already built.
const EXPOSED_CLEARANCE = 6;
function clearRun(blockers: FootprintIndex, x: number, z: number, nx: number, nz: number, y: number): number {
  // Metres out before a building footprint blocks the wall's upper band, capped at EXPOSED_CLEARANCE.
  for (const d of [0.7, 1.5, 2.5, 4, EXPOSED_CLEARANCE]) if (blockers.collides(x + nx * d, y, z + nz * d, 0.2, 1.5)) return d;
  return Infinity;
}
function wallExposed(blockers: FootprintIndex, x: number, z: number, nx: number, nz: number, y: number): boolean {
  return Math.max(clearRun(blockers, x, z, nx, nz, y), clearRun(blockers, x, z, -nx, -nz, y)) >= EXPOSED_CLEARANCE;
}

/** Load-time only: read the actual streamed walls, so simplified LODs never acquire floating decals.
 * Collision IDs supply identity/footprints where available. Coarse walls without collision are grouped
 * by connected roof-edge endpoints + source colour; their geometry supplies a stable spatial ID.
 */
/** ?debug=facades diagnostics (gtasf-5mn5): why walls/buildings get no front. Counts only; no behaviour change. */
export interface FacadeDebugStats { wallTris: number; nonRect: number; walls: number; buildings: number }
export function readFacadeBuildings(root: Object3D, context: ShopfrontContext, stats?: FacadeDebugStats): FacadeBuilding[] {
  root.updateWorldMatrix(true, true);
  const walls: FacadeWall[] = [], keys = new Set<string>(), joints = new Map<string, number>();
  const parents: number[] = [];
  const find = (index: number): number => { while (parents[index] !== index) { parents[index] = parents[parents[index]!]!; index = parents[index]!; } return index; };
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), ab = new Vector3(), ac = new Vector3(), normal = new Vector3();
  root.traverse(object => {
    if (!(object instanceof Mesh) || !/^buildings(?:_|$)/.test(object.name)) return;
    // Explicit authored landmark subtrees stay untouched; this is not a radius exclusion,
    // so ordinary neighbouring buildings still receive fronts and side materials.
    for (let parent: Object3D | null = object; parent; parent = parent.parent) {
      if (parent.userData.landmark === true) return;
      if (parent === root) break;
    }
    const geometry = object.geometry, position = geometry.getAttribute('position'), colour = geometry.getAttribute('color'), index = geometry.index;
    if (!position) return;
    const count = index?.count ?? position.count;
    for (let offset = 0; offset + 2 < count && walls.length < 4096; offset += 3) {
      const ia = index ? index.getX(offset) : offset, ib = index ? index.getX(offset + 1) : offset + 1, ic = index ? index.getX(offset + 2) : offset + 2;
      a.fromBufferAttribute(position, ia).applyMatrix4(object.matrixWorld);
      b.fromBufferAttribute(position, ib).applyMatrix4(object.matrixWorld);
      c.fromBufferAttribute(position, ic).applyMatrix4(object.matrixWorld);
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      if (normal.lengthSq() < 0.01) continue;
      normal.normalize();
      if (Math.abs(normal.y) > 0.02) continue;
      const bottom = Math.min(a.y, b.y, c.y), top = Math.max(a.y, b.y, c.y);
      if (top - bottom < 2.5) continue;
      if (stats) stats.wallTris++;
      const points = new Map([a, b, c].map(p => [pointKey(p.x, p.z), [p.x, p.z] as const]));
      if (points.size !== 2) { if (stats) stats.nonRect++; continue; } // Generic rectangular extrusion walls only; leave authored shapes alone.
      const [[ax, az], [bx, bz]] = [...points.values()] as [readonly [number, number], readonly [number, number]];
      const width = Math.hypot(bx - ax, bz - az);
      if (width < 1.5) continue;
      const rgb: [number, number, number] = colour ? [colour.getX(ia), colour.getY(ia), colour.getZ(ia)] : [0.6, 0.6, 0.6];
      const shade = rgb.map(n => Math.round(n * 255)).join(','), roof = Math.round(top * 10);
      const ends = [pointKey(ax, az), pointKey(bx, bz)].sort();
      const key = `${ends.join('|')}|${roof}|${Math.round(bottom * 10)}|${shade}`;
      if (keys.has(key)) continue;
      keys.add(key);
      // Viewed from the street, U grows left-to-right: tangent = (normal.z, -normal.x).
      const forward = (bx - ax) * normal.z - (bz - az) * normal.x > 0;
      const id = walls.length;
      walls.push({ ax: forward ? ax : bx, az: forward ? az : bz, bx: forward ? bx : ax, bz: forward ? bz : az,
        nx: normal.x, nz: normal.z, width, bottom, top, colour: rgb, street: false, exposed: false, ground: bottom });
      parents.push(id);
      for (const endpoint of ends) {
        const joint = `${endpoint}|${roof}|${shade}`, previous = joints.get(joint);
        if (previous !== undefined) parents[find(id)] = find(previous);
        else joints.set(joint, id);
      }
    }
  });

  const [ox, , oz] = context.collision.origin;
  const cells = new Map<string, BuildingFootprint[]>();
  for (const building of context.collision.buildings) {
    const ring = building.rings[0]; if (!ring?.length) continue;
    const xs = ring.map(p => p[0] + ox), zs = ring.map(p => p[1] + oz);
    for (let x = Math.floor(Math.min(...xs) / 32); x <= Math.floor(Math.max(...xs) / 32); x++) {
      for (let z = Math.floor(Math.min(...zs) / 32); z <= Math.floor(Math.max(...zs) / 32); z++) {
        const key = `${x},${z}`, entries = cells.get(key) ?? []; entries.push(building); cells.set(key, entries);
      }
    }
  }
  function match(wall: FacadeWall): BuildingFootprint | undefined {
    const x = (wall.ax + wall.bx) / 2, z = (wall.az + wall.bz) / 2;
    let closest = 1, result: BuildingFootprint | undefined;
    for (const building of cells.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`) ?? []) {
      if (Math.abs(building.maxY - wall.top) > 0.6) continue;
      const ring = building.rings[0]!;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!, b = ring[(i + 1) % ring.length]!, dx = b[0] - a[0], dz = b[1] - a[1], length2 = dx * dx + dz * dz;
        if (length2 < 0.01) continue;
        const t = Math.max(0, Math.min(1, ((x - ox - a[0]) * dx + (z - oz - a[1]) * dz) / length2));
        const distance2 = (x - ox - a[0] - t * dx) ** 2 + (z - oz - a[1] - t * dz) ** 2;
        if (distance2 < closest) { closest = distance2; result = building; }
      }
    }
    return result;
  }
  const components = new Map<number, FacadeWall[]>();
  walls.forEach((wall, index) => { const key = find(index), group = components.get(key) ?? []; group.push(wall); components.set(key, group); });
  const groups = new Map<string, { walls: FacadeWall[]; source?: BuildingFootprint }>();
  for (const component of components.values()) {
    const matches = component.map(match), sources = new Map(matches.filter((source): source is BuildingFootprint => Boolean(source)).map(source => [source.id, source]));
    const onlySource = sources.size === 1 ? sources.values().next().value : undefined;
    // Touching terrace houses can share colour, roof height and edge endpoints. Their actual
    // footprint IDs must still own independent fronts rather than inheriting the first house's ID.
    const minX = Math.min(...component.flatMap(w => [w.ax, w.bx])), minZ = Math.min(...component.flatMap(w => [w.az, w.bz]));
    const fallback = `wall:${pointKey(minX, minZ)}:${Math.round(component[0]!.top * 10)}`;
    component.forEach((wall, index) => {
      const source = matches[index] ?? onlySource, id = source?.id ?? fallback;
      const group = groups.get(id) ?? { walls: [], source }; group.walls.push(wall); groups.set(id, group);
    });
  }
  const blockers = new FootprintIndex(); blockers.rebuild([context.collision]);
  const result: FacadeBuilding[] = [];
  for (const [id, group] of groups) {
    // The Ferry's authored elevation must not get a generic shop/home painted over it.
    if (id.startsWith('datasf:201006.0000058:')) continue;
    const walls = group.walls;
    const minX = Math.min(...walls.flatMap(w => [w.ax, w.bx])), maxX = Math.max(...walls.flatMap(w => [w.ax, w.bx]));
    const minZ = Math.min(...walls.flatMap(w => [w.az, w.bz])), maxZ = Math.max(...walls.flatMap(w => [w.az, w.bz]));
    let frontage = 0, ground = Infinity;
    // Ground every face, including small side walls outside the bounded road-query set.
    // Probe near the roof so a tower rising above its neighbour still receives upper windows.
    for (const wall of walls) {
      const x = (wall.ax + wall.bx) / 2, z = (wall.az + wall.bz) / 2;
      wall.ground = Math.max(wall.bottom, sampleHeight(context.ground, x + wall.nx * .2, z + wall.nz * .2) ?? wall.bottom);
      ground = Math.min(ground, wall.ground);
      // Exposed = open ground in front (gets a facade) vs a party wall (stays plain). The old single near-roof
      // point probe gave false negatives when the triangle normal pointed inward; the geometric clearance test
      // (freer of the two normal directions) catches those. Kept as a union so the fix only ever ADDS exposure.
      const probe = !blockers.collides(x + wall.nx * .8, wall.top - 1.5, z + wall.nz * .8, .15, 1);
      wall.exposed = flags.exposedByClearance
        ? probe || wallExposed(blockers, x, z, wall.nx, wall.nz, wall.top - 1.5)
        : probe;
    }
    // Bound road queries on unusually complex polygons; most buildings have four to eight walls.
    for (const wall of [...walls].sort((a, b) => b.width - a.width).slice(0, 12)) {
      const x = (wall.ax + wall.bx) / 2, z = (wall.az + wall.bz) / 2;
      const road = context.nearestRoad(x + wall.nx, z + wall.nz, 32);
      wall.ground = Math.max(wall.bottom, sampleHeight(context.ground, x + wall.nx * 0.2, z + wall.nz * 0.2) ?? road?.y ?? wall.bottom);
      ground = Math.min(ground, wall.ground);
      if (!road) continue;
      const dx = road.x - x, dz = road.z - z, distance = Math.hypot(dx, dz);
      if (distance < 1.5 || (wall.nx * dx + wall.nz * dz) / distance < 0.72 || wall.top - wall.ground < 2.5) continue;
      if (blockers.collides(x + wall.nx * 0.8, wall.ground + 1, z + wall.nz * 0.8, 0.15, 1)) continue;
      wall.street = true; frontage = Math.max(frontage, wall.width); ground = Math.min(ground, wall.ground);
    }
    // Set-back/coarse blocks may have no nearby road segment. Give their widest exposed
    // wall an elevation instead of dropping the entire building; party walls remain tiled.
    if (!frontage) {
      const candidate = [...walls].sort((a, b) => b.width - a.width).find(wall => {
        const x = (wall.ax + wall.bx) / 2, z = (wall.az + wall.bz) / 2;
        return wall.top - wall.ground >= 2.5 && !blockers.collides(x + wall.nx * .8, wall.ground + 1, z + wall.nz * .8, .15, 1);
      });
      if (candidate) { candidate.street = true; frontage = candidate.width; }
    }
    // Set-back and courtyard-facing buildings still need side/back material coverage.
    if (!Number.isFinite(ground)) ground = Math.min(...walls.map(w => w.bottom));
    result.push({ id, walls, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2,
      footprint: group.source?.rings[0] ? area(group.source.rings[0]) : Math.max(1, (maxX - minX) * (maxZ - minZ)),
      height: Math.max(...walls.map(w => w.top)) - ground, frontage });
  }
  return result;
}
