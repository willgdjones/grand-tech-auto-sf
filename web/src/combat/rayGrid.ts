// gtasf-kd2rv follow-up (LANE B): fast aim raycasts against heavy static meshes. three.js tests every triangle of a mesh whose
// bounds the ray crosses; at the Ferry plaza that was ~38 ms per shot at phone Low x4 (the Ferry Building alone, 69k vertices,
// ~20 ms), so aiming while firing (every shot misses the 1° cast-reuse key) failed the firefight gate. Heavy meshes get a
// uniform triangle grid in local space, built lazily in idle slices and cached per geometry; a cast walks only the cells
// the ray crosses (3D DDA) and stops at the first cell that holds a hit. Same exact triangle hits, double-sided (bullets
// stop at back faces too). Until a mesh's grid is ready the caller falls back to three's own raycast.
import * as THREE from 'three';

/** Meshes with at least this many triangles are worth a grid (smaller ones raycast fast enough as they are). */
export const HEAVY_TRIANGLES = 2500;

interface Grid {
  min: THREE.Vector3; size: THREE.Vector3; cell: THREE.Vector3; dims: [number, number, number];
  // Corners are read from the geometry's own buffers (no copy: a 36 B/triangle copy made the Ferry plaza's 20 grids 9.2 MB).
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; index: THREE.BufferAttribute | null; count: number;
  start: Uint32Array;           // CSR: cell c's triangles are ids[start[c] .. start[c + 1])
  ids: Uint32Array;
  stamp: Uint16Array; pass: number; // per-triangle "already tested this cast" marks (cleared when the pass wraps)
  version: number;              // position/index versions at build: a geometry rewritten in place gets a fresh grid
}
/** Bumps whenever three is told the positions or index changed (needsUpdate). */
function versionOf(geometry: THREE.BufferGeometry): number {
  const position = geometry.attributes.position as (THREE.BufferAttribute & { data?: { version: number } }) | undefined;
  return (position ? (position.data ? position.data.version : position.version) : 0) * 65536 + (geometry.index?.version ?? 0);
}
/** Corner k (0..2) of triangle t, local space. */
function corner(grid: Grid, t: number, k: number, out: THREE.Vector3): THREE.Vector3 {
  return out.fromBufferAttribute(grid.position, grid.index ? grid.index.getX(t * 3 + k) : t * 3 + k);
}

const grids = new WeakMap<THREE.BufferGeometry, Grid | 'building'>();
/** Built grids and their memory, for evidence (the testing harness reads it as window.__gtasfRayGrid). */
export const gridStats = { built: 0, bytes: 0, triangles: 0 };
const queue: THREE.BufferGeometry[] = [];
let pumping = false;

export function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.index, position = geometry.attributes.position;
  return position ? Math.floor((index ? index.count : position.count) / 3) : 0;
}

/** The ready grid for this mesh, or null (and its build is queued) while it isn't. */
export function gridFor(mesh: THREE.Mesh): Grid | null {
  const geometry = mesh.geometry, existing = grids.get(geometry);
  if (existing && existing !== 'building') {
    // Same buffers (setAttribute/setIndex can swap in new ones whose version happens to match) and same versions.
    if (existing.version === versionOf(geometry) && existing.position === geometry.attributes.position && existing.index === geometry.index) return existing;
    grids.delete(geometry); // rewritten or replaced since the build: rebuild it
    return gridFor(mesh);
  }
  if (!existing) { grids.set(geometry, 'building'); queue.push(geometry); pump(); }
  return null;
}

function pump(): void {
  if (pumping) return; pumping = true;
  const idle = (globalThis as { requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => void }).requestIdleCallback;
  const run = () => {
    const geometry = queue.shift();
    if (!geometry) { pumping = false; return; }
    const builder = build(geometry);
    const slice = (deadline?: { timeRemaining(): number }) => {
      const until = performance.now() + Math.max(2, Math.min(6, deadline?.timeRemaining() ?? 4));
      let done: IteratorResult<void, Grid | null>;
      do done = builder.next(); while (!done.done && performance.now() < until);
      if (!done.done) { schedule(slice); return; }
      if (done.value) { const g = done.value; grids.set(geometry, g); gridStats.built++; gridStats.triangles += g.count; gridStats.bytes += g.start.byteLength + g.ids.byteLength + g.stamp.byteLength; }
      else grids.delete(geometry);
      schedule(run);
    };
    slice();
  };
  const schedule = (fn: (d?: { timeRemaining(): number }) => void) => { if (idle) idle(d => fn(d), { timeout: 200 }); else setTimeout(() => fn(), 0); };
  schedule(run);
}

/** Time-sliced grid build (yields every ~512 triangles). */
function* build(geometry: THREE.BufferGeometry): Generator<void, Grid | null> {
  const position = geometry.attributes.position as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  if (!position) return null;
  const index = geometry.index, n = triangleCount(geometry);
  if (n === 0) return null;
  const version = versionOf(geometry), shell = { position, index, count: n } as Grid, v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let t = 0; t < n; t++) {
    min.min(corner(shell, t, 0, v0)).min(corner(shell, t, 1, v1)).min(corner(shell, t, 2, v2)); max.max(v0).max(v1).max(v2);
    if ((t & 511) === 511) yield;
  }
  const size = max.clone().sub(min).max(new THREE.Vector3(1e-3, 1e-3, 1e-3));
  // ~4 triangles per cell on average, at most 64 cells per axis, cells roughly cubic.
  const volume = size.x * size.y * size.z, target = Math.max(1, n / 4), edge = Math.cbrt(volume / target);
  const dims: [number, number, number] = [size.x, size.y, size.z].map(s => Math.max(1, Math.min(64, Math.round(s / edge)))) as [number, number, number];
  const cell = new THREE.Vector3(size.x / dims[0], size.y / dims[1], size.z / dims[2]);
  const cellsTotal = dims[0] * dims[1] * dims[2];
  const clampCell = (value: number, axis: 0 | 1 | 2, o: number, c: number) => Math.max(0, Math.min(dims[axis] - 1, Math.floor((value - o) / c)));
  const span = (t: number): [number, number, number, number, number, number] => {
    corner(shell, t, 0, v0); corner(shell, t, 1, v1); corner(shell, t, 2, v2);
    const x0 = Math.min(v0.x, v1.x, v2.x), x1 = Math.max(v0.x, v1.x, v2.x);
    const y0 = Math.min(v0.y, v1.y, v2.y), y1 = Math.max(v0.y, v1.y, v2.y);
    const z0 = Math.min(v0.z, v1.z, v2.z), z1 = Math.max(v0.z, v1.z, v2.z);
    return [clampCell(x0, 0, min.x, cell.x), clampCell(x1, 0, min.x, cell.x), clampCell(y0, 1, min.y, cell.y), clampCell(y1, 1, min.y, cell.y), clampCell(z0, 2, min.z, cell.z), clampCell(z1, 2, min.z, cell.z)];
  };
  const counts = new Uint32Array(cellsTotal + 1);
  for (let t = 0; t < n; t++) {
    const [ax, bx, ay, by, az, bz] = span(t);
    for (let z = az; z <= bz; z++) for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) counts[(z * dims[1] + y) * dims[0] + x]!++;
    if ((t & 511) === 511) yield;
  }
  const start = new Uint32Array(cellsTotal + 1);
  for (let c = 0; c < cellsTotal; c++) start[c + 1] = start[c]! + counts[c]!;
  const ids = new Uint32Array(start[cellsTotal]!), fill = start.slice(0, cellsTotal);
  for (let t = 0; t < n; t++) {
    const [ax, bx, ay, by, az, bz] = span(t);
    for (let z = az; z <= bz; z++) for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) ids[fill[(z * dims[1] + y) * dims[0] + x]!++] = t;
    if ((t & 511) === 511) yield;
  }
  return { min, size, cell, dims, position, index, count: n, start, ids, stamp: new Uint16Array(n), pass: 0, version };
}

const inverse = new THREE.Matrix4(), localRay = new THREE.Ray(), box = new THREE.Box3(), entry = new THREE.Vector3();
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
const p = new THREE.Vector3(), q = new THREE.Vector3(), s = new THREE.Vector3(), hitLocal = new THREE.Vector3(), hitWorld = new THREE.Vector3();

/** Double-sided ray/triangle (Möller–Trumbore) on grid triangle t; returns the local ray parameter or -1. */
function triangle(grid: Grid, t: number, ray: THREE.Ray): number {
  corner(grid, t, 0, a); corner(grid, t, 1, b); corner(grid, t, 2, c);
  e1.subVectors(b, a); e2.subVectors(c, a); p.crossVectors(ray.direction, e2);
  const det = e1.dot(p); if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det; s.subVectors(ray.origin, a);
  const u = s.dot(p) * inv; if (u < 0 || u > 1) return -1;
  q.crossVectors(s, e1); const w = ray.direction.dot(q) * inv; if (w < 0 || u + w > 1) return -1;
  const d = e2.dot(q) * inv; return d >= 0 ? d : -1;
}

/**
 * Nearest hit of a world ray (origin, unit direction, max world distance `far`) on a gridded mesh, or null. The returned
 * intersection carries the world point/distance, the face normal (local; the caller transforms it) and the object.
 */
export function raycastGrid(mesh: THREE.Mesh, grid: Grid, origin: THREE.Vector3, dir: THREE.Vector3, far: number): THREE.Intersection | null {
  inverse.copy(mesh.matrixWorld).invert();
  localRay.origin.copy(origin).applyMatrix4(inverse);
  localRay.direction.copy(dir).transformDirection(inverse); // unit in local space; scale handled by world distance below
  box.min.copy(grid.min); box.max.copy(grid.min).add(grid.size);
  let t0 = 0;
  if (!box.containsPoint(localRay.origin)) { if (!localRay.intersectBox(box, entry)) return null; t0 = entry.distanceTo(localRay.origin); }
  grid.pass = (grid.pass + 1) & 0xffff; if (grid.pass === 0) { grid.stamp.fill(0); grid.pass = 1; }
  const [nx, ny, nz] = grid.dims, d = localRay.direction, o = localRay.origin;
  const startPoint = entry.copy(d).multiplyScalar(t0 + 1e-6).add(o);
  let x = Math.max(0, Math.min(nx - 1, Math.floor((startPoint.x - grid.min.x) / grid.cell.x)));
  let y = Math.max(0, Math.min(ny - 1, Math.floor((startPoint.y - grid.min.y) / grid.cell.y)));
  let z = Math.max(0, Math.min(nz - 1, Math.floor((startPoint.z - grid.min.z) / grid.cell.z)));
  const stepX = d.x > 0 ? 1 : -1, stepY = d.y > 0 ? 1 : -1, stepZ = d.z > 0 ? 1 : -1;
  const next = (i: number, step: number, mn: number, cs: number, oo: number, dd: number) => dd === 0 ? Infinity : ((mn + (i + (step > 0 ? 1 : 0)) * cs) - oo) / dd;
  let tMaxX = next(x, stepX, grid.min.x, grid.cell.x, o.x, d.x), tMaxY = next(y, stepY, grid.min.y, grid.cell.y, o.y, d.y), tMaxZ = next(z, stepZ, grid.min.z, grid.cell.z, o.z, d.z);
  const tDeltaX = d.x === 0 ? Infinity : Math.abs(grid.cell.x / d.x), tDeltaY = d.y === 0 ? Infinity : Math.abs(grid.cell.y / d.y), tDeltaZ = d.z === 0 ? Infinity : Math.abs(grid.cell.z / d.z);
  let best = Infinity, bestTri = -1;
  for (let guard = 0; guard < nx + ny + nz + 3; guard++) {
    const cellIndex = (z * ny + y) * nx + x;
    for (let j = grid.start[cellIndex]!, end = grid.start[cellIndex + 1]!; j < end; j++) {
      const tri = grid.ids[j]!; if (grid.stamp[tri] === grid.pass) continue; grid.stamp[tri] = grid.pass;
      const hit = triangle(grid, tri, localRay); if (hit >= 0 && hit < best) { best = hit; bestTri = tri; }
    }
    const exit = Math.min(tMaxX, tMaxY, tMaxZ);
    if (best <= exit) break; // the nearest hit lies inside the cells walked so far
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; tMaxX += tDeltaX; if (x < 0 || x >= nx) break; }
    else if (tMaxY < tMaxZ) { y += stepY; tMaxY += tDeltaY; if (y < 0 || y >= ny) break; }
    else { z += stepZ; tMaxZ += tDeltaZ; if (z < 0 || z >= nz) break; }
  }
  if (bestTri < 0) return null;
  hitLocal.copy(d).multiplyScalar(best).add(o);
  hitWorld.copy(hitLocal).applyMatrix4(mesh.matrixWorld);
  const distance = hitWorld.distanceTo(origin);
  if (distance > far) return null;
  corner(grid, bestTri, 0, a); corner(grid, bestTri, 1, b); corner(grid, bestTri, 2, c);
  const normal = new THREE.Vector3().subVectors(c, b).cross(e1.subVectors(a, b)).normalize();
  return { distance, point: hitWorld.clone(), object: mesh, face: { a: 0, b: 0, c: 0, normal, materialIndex: 0 } };
}
