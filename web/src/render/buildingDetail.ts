import { BufferGeometry, Color, Float32BufferAttribute, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, LOD, Object3D, type Material } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { deinterleaveGeometry, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flags } from '@gtasf/shared/flags';
import type { ShopfrontContext } from './shopfrontSigns';
import { sampleHeight } from './chunks/terrain';
import { graphicsPreset } from './graphicsPreset';
import { districtAt } from '../../../tools/map/src/districts';
import { paintedLadyScheme } from './landmarks/paintedLadyPalette';
import { realisticFacadePieces } from '../assets/realisticFacadePieces';

/*
 * Building detail (PLAN-v2.1 decision 4, pane 11): peak-SA rooftop clutter + procedural cornices on
 * the baked building stock, so buildings read as SA/PS2 at all distances. Pane 9 owns wall/roof COLOUR
 * and the facade atlas; this module only reads each building's footprint ring + roof height (minY/maxY
 * from gtasfShopfrontContext) and adds its OWN merged, flat-shaded geometry per chunk — never touching
 * the buildings material or vertex colours. Merged-per-chunk (like shopfrontSigns/nightLights) keeps it
 * to one draw call per chunk and unloads with the chunk; a per-chunk vertex budget + low-tier caps hold
 * the phone budget. Clutter/cornice shapes are procedural low-poly (no assets). Deterministic per id.
 */

const TAU = Math.PI * 2;
/** FNV-1a — same deterministic per-building hash shopfrontSigns uses, so placement is stable. */
function hash(text: string): number { let v = 2166136261; for (const c of text) v = Math.imul(v ^ c.charCodeAt(0), 16777619); return v >>> 0; }
/** Small LCG seeded per building; stable clutter across reloads. */
function rng(seed: number): () => number { let s = (seed || 1) >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
/** Even-odd point-in-polygon on a [x,z] ring (ring coords are chunk-origin-relative). */
function inRing(x: number, z: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// SA rooftop palette (geometry tint only; wall/roof colour stays pane 9's).
const AC = new Color('#90929a'), TANK = new Color('#6e5a43'), TANK_CAP = new Color('#7d6b50');
const ANTENNA = new Color('#3a3b40'), STAIR = new Color('#9b9488');
// Per-building cornice/trim hues — muted painted-lady spread (cream, white, stone, sage, blue-grey,
// sand) so the roofline reads with San Andreas colour variety. Trim colour only; pane 9 owns wall/roof.
const CORNICES = [
  new Color('#e7dcc3'), new Color('#eef0ea'), new Color('#cfc7b0'), new Color('#b9b2a1'),
  new Color('#c3cbb4'), new Color('#b7c2c6'), new Color('#d8c49a'),
];
// Reused per clutter item to apply a tone jitter without allocating a Color each time.
const SCRATCH = new Color();

/** A recorded Meshy hero-piece placement (world coords) used when the hero-piece swap is active; the
 * `kind` keys into realisticFacadePieces and `width` is the desired world span (scale = width/native). */
export interface PiecePlacement { kind: string; x: number; y: number; z: number; yaw: number; width: number }
export interface BuildingDetail { positions: number[]; normals: number[]; colors: number[]; clutter: number; buildings: number; ids: string[]; pieces: PiecePlacement[]; frontages?: BuildingDetail }

/** Push an (optionally yawed) box: local +z runs along `yaw`, +x is the perpendicular, +y is up. */
function box(d: BuildingDetail, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: Color, yaw = 0): void {
  const cos = Math.cos(yaw), sin = Math.sin(yaw), hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const local: [number, number, number][] = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ];
  const corner = local.map(([lx, ly, lz]) => [cx + lx * cos + lz * sin, cy + ly, cz - lx * sin + lz * cos] as [number, number, number]);
  // Each face: four corner indices (CCW) + the outward normal in local space.
  const faces: [number, number, number, number, number, number, number][] = [
    [0, 1, 2, 3, 0, 0, -1], [5, 4, 7, 6, 0, 0, 1], [4, 0, 3, 7, -1, 0, 0],
    [1, 5, 6, 2, 1, 0, 0], [3, 2, 6, 7, 0, 1, 0], [4, 5, 1, 0, 0, -1, 0],
  ];
  for (const [a, b, c, e, lnx, lny, lnz] of faces) {
    const nx = lnx * cos + lnz * sin, nz = -lnx * sin + lnz * cos;
    // Corner tables run clockwise from outside; reverse triangles to match outward normals.
    for (const vi of [a, c, b, a, e, c]) {
      const p = corner[vi]!; d.positions.push(p[0], p[1], p[2]); d.normals.push(nx, lny, nz); d.colors.push(color.r, color.g, color.b);
    }
  }
}
/** Push a vertical truncated cone/cylinder (bottom at cy, top at cy+h) — SF rooftop water tanks. */
function cyl(d: BuildingDetail, cx: number, cy: number, cz: number, rBottom: number, rTop: number, h: number, color: Color, sides = 8): void {
  for (let i = 0; i < sides; i++) {
    const a0 = i / sides * TAU, a1 = (i + 1) / sides * TAU;
    const b0x = cx + Math.cos(a0) * rBottom, b0z = cz + Math.sin(a0) * rBottom, b1x = cx + Math.cos(a1) * rBottom, b1z = cz + Math.sin(a1) * rBottom;
    const t0x = cx + Math.cos(a0) * rTop, t0z = cz + Math.sin(a0) * rTop, t1x = cx + Math.cos(a1) * rTop, t1z = cz + Math.sin(a1) * rTop;
    const nx = Math.cos((a0 + a1) / 2), nz = Math.sin((a0 + a1) / 2);
    for (const [x, y, z] of [[b0x, cy, b0z], [b1x, cy, b1z], [t1x, cy + h, t1z], [b0x, cy, b0z], [t1x, cy + h, t1z], [t0x, cy + h, t0z]]) {
      d.positions.push(x!, y!, z!); d.normals.push(nx, 0.3, nz); d.colors.push(color.r, color.g, color.b);
    }
    // top cap triangle (fan to centre)
    for (const [x, y, z] of [[t0x, cy + h, t0z], [t1x, cy + h, t1z], [cx, cy + h, cz]]) {
      d.positions.push(x!, y!, z!); d.normals.push(0, 1, 0); d.colors.push(color.r, color.g, color.b);
    }
  }
}

/** Push a quad (p0→p1→p2→p3, CCW) as two triangles with one flat normal + colour. */
function quad(d: BuildingDetail, p0: number[], p1: number[], p2: number[], p3: number[], color: Color, n: number[]): void {
  for (const p of [p0, p1, p2, p0, p2, p3]) { d.positions.push(p[0]!, p[1]!, p[2]!); d.normals.push(n[0]!, n[1]!, n[2]!); d.colors.push(color.r, color.g, color.b); }
}

// SA-style striped awning colour pairs (stripe, cloth).
const AWNINGS: [Color, Color][] = [
  [new Color('#a2191c'), new Color('#efe9db')], [new Color('#2f6d4f'), new Color('#efe9db')],
  [new Color('#1d4e89'), new Color('#dfe7ef')], [new Color('#b06a1b'), new Color('#efe3cb')],
];
/** A striped canopy sloping down-and-out from a street wall, with a short front valance. */
function awning(d: BuildingDetail, wall: { x: number; z: number; nx: number; nz: number; len: number }, y: number, seed: number): void {
  const { x, z, nx, nz, len } = wall, tx = -nz, tz = nx; // tangent runs along the wall
  const w = Math.min(len, 5.2), seg = 6, step = w / seg, [a, b] = AWNINGS[seed % AWNINGS.length]!;
  const inx = x + nx * 0.1, inz = z + nz * 0.1, outx = x + nx * 1.5, outz = z + nz * 1.5, iy = y + 0.85;
  const top = [nx * 0.45, 0.9, nz * 0.45];
  for (let s = 0; s < seg; s++) {
    const t0 = (s - seg / 2) * step, t1 = (s + 1 - seg / 2) * step, col = s % 2 ? a : b;
    quad(d, [inx + tx * t0, iy, inz + tz * t0], [inx + tx * t1, iy, inz + tz * t1], [outx + tx * t1, y, outz + tz * t1], [outx + tx * t0, y, outz + tz * t0], col, top);
  }
  // Front valance: a short vertical skirt at the outer edge, stripe colour.
  const h = -w / 2, j = w / 2, out = [nx, 0, nz];
  quad(d, [outx + tx * h, y, outz + tz * h], [outx + tx * j, y, outz + tz * j], [outx + tx * j, y - 0.55, outz + tz * j], [outx + tx * h, y - 0.55, outz + tz * h], a, out);
}

const FE_METAL = new Color('#33363b');
/** Zigzag fire escape up a street wall: stacked platforms, outer rails, alternating diagonal stringers. */
function fireEscape(d: BuildingDetail, wall: { x: number; z: number; nx: number; nz: number; len: number }, groundY: number, roofY: number): void {
  const { x, z, nx, nz, len } = wall, tx = -nz, tz = nx, w = Math.min(2.6, len - 0.5), yaw = Math.atan2(-nz, nx);
  const rise = 3.2, start = groundY + 3.4, floors = Math.min(6, Math.floor((roofY - 0.6 - start) / rise));
  if (floors < 2 || w < 1.4) return;
  for (let f = 0; f < floors; f++) {
    const fy = start + f * rise;
    box(d, x + nx * 0.7, fy, z + nz * 0.7, 1.2, 0.12, w, FE_METAL, yaw);        // platform (projects out 0.1..1.3)
    box(d, x + nx * 1.25, fy + 0.45, z + nz * 1.25, 0.08, 0.9, w, FE_METAL, yaw); // outer guard rail
    if (f > 0) {
      const t = (f % 2 ? 1 : -1) * w * 0.3; // alternate which side the stair descends
      const ax = x + nx * 1.1 + tx * t, az = z + nz * 1.1 + tz * t, ay = fy;
      const bx = x + nx * 0.2 - tx * t, bz = z + nz * 0.2 - tz * t, by = fy - rise + 0.12;
      const a0 = [ax + tx * 0.22, ay, az + tz * 0.22], a1 = [ax - tx * 0.22, ay, az - tz * 0.22];
      const b0 = [bx + tx * 0.22, by, bz + tz * 0.22], b1 = [bx - tx * 0.22, by, bz - tz * 0.22];
      quad(d, a0, a1, b1, b0, FE_METAL, [nx, 0.3, nz]);   // stringer ribbon, drawn both sides
      quad(d, b0, b1, a1, a0, FE_METAL, [-nx, -0.3, -nz]);
    }
  }
}

const BAY_GLASS = new Color('#30414d');
/**
 * A projecting glazed bay window up a street wall — the defining San Francisco Victorian/Edwardian
 * feature. A trim-coloured frame box bumps out from the wall with a dark glazed front panel and a thin
 * sill/head band per floor, so mid-rise facades read as SF rather than flat boxes. Trim colour matches
 * the building's cornice for a cohesive painted-lady look. `offsetT` slides it along the wall tangent.
 */
function bayWindow(d: BuildingDetail, wall: { x: number; z: number; nx: number; nz: number }, startY: number, topY: number, trim: Color, width: number, offsetT: number): void {
  const { x, z, nx, nz } = wall, tx = -nz, tz = nx, yaw = Math.atan2(-nz, nx);
  const proj = 0.72, bh = topY - startY, cy = startY + bh / 2;
  const cx = x + nx * (proj / 2) + tx * offsetT, cz = z + nz * (proj / 2) + tz * offsetT;
  // Frame body (overlaps slightly into the wall so there is no seam), then a dark glazed front box.
  box(d, cx, cy, cz, proj + 0.3, bh, width, trim, yaw);
  const gx = x + nx * (proj + 0.06) + tx * offsetT, gz = z + nz * (proj + 0.06) + tz * offsetT;
  box(d, gx, cy, gz, 0.1, bh - 0.7, width - 0.4, BAY_GLASS, yaw);
  // A trim sill/head band every ~3 m so the glazing reads as stacked sash windows, not one slab.
  const floors = Math.max(1, Math.round(bh / 3));
  for (let f = 1; f < floors; f++) {
    const by = startY + (bh * f) / floors;
    box(d, gx, by, gz, 0.16, 0.22, width - 0.2, trim, yaw);
  }
}

/**
 * A canted (slanted-side) bay window — the classic SF Victorian trapezoidal bay: a narrower glazed
 * front panel linked to the wall by two angled glazed side panels. Built from boxes at derived yaws
 * (the box helper handles winding/normals), so it stays flat-shaded and merges like the rest. Glazed
 * front, trim-framed sides, trim cap + corbel so the open top/bottom are closed.
 */
function cantedBay(d: BuildingDetail, wall: { x: number; z: number; nx: number; nz: number }, startY: number, topY: number, trim: Color, backHalf: number, offsetT: number): void {
  const { x, z, nx, nz } = wall, tx = -nz, tz = nx, frontYaw = Math.atan2(-nz, nx);
  const proj = 0.78, frontHalf = Math.max(0.5, backHalf - 0.45), bh = topY - startY, cy = startY + bh / 2;
  // Front panel + its glazing.
  const fcx = x + nx * proj + tx * offsetT, fcz = z + nz * proj + tz * offsetT;
  box(d, fcx, cy, fcz, 0.16, bh, frontHalf * 2, trim, frontYaw);
  box(d, x + nx * (proj + 0.07) + tx * offsetT, cy, z + nz * (proj + 0.07) + tz * offsetT, 0.08, bh - 0.7, frontHalf * 2 - 0.4, BAY_GLASS, frontYaw);
  // Two angled side panels, each bridging a wall edge to the matching front edge.
  for (const s of [-1, 1]) {
    const wtx = offsetT + s * backHalf, ftx = offsetT + s * frontHalf;
    const wx = x + tx * wtx, wz = z + tz * wtx;                    // wall edge (proj 0)
    const fx = x + nx * proj + tx * ftx, fz = z + nz * proj + tz * ftx; // front edge
    const dxv = fx - wx, dzv = fz - wz, len = Math.hypot(dxv, dzv) || 0.01;
    const sideYaw = Math.atan2(dxv, dzv);
    const mx = (wx + fx) / 2, mz = (wz + fz) / 2;
    box(d, mx, cy, mz, 0.12, bh, len, trim, sideYaw);
    box(d, mx + nx * 0.05, cy, mz + nz * 0.05, 0.06, bh - 0.8, len - 0.25, BAY_GLASS, sideYaw); // side glazing, nudged proud
  }
  // Trim cap and corbel close the open top/bottom of the prism.
  const ccx = x + nx * (proj / 2) + tx * offsetT, ccz = z + nz * (proj / 2) + tz * offsetT;
  box(d, ccx, topY + 0.1, ccz, proj + 0.3, 0.3, backHalf * 2, trim, frontYaw);
  box(d, ccx, startY - 0.1, ccz, proj + 0.1, 0.4, backHalf * 2 - 0.3, trim, frontYaw);
}

const HOME_DISTRICTS = new Set(['mission', 'castro', 'noe-valley', 'richmond', 'sunset', 'marina', 'pacific-heights', 'bernal-heights', 'potrero-hill', 'bayview']);
const DOOR = new Color('#434b48'), GARAGE = new Color('#aaa99b');

/** A shallow, merged residential frontage; never changes the collision footprint or baked walls. */
function homeFrontage(d: BuildingDetail, wall: { x: number; z: number; nx: number; nz: number; len: number }, groundY: number, roofY: number, seed: number, low: boolean): void {
  const district = districtAt(wall.x, wall.z);
  const scheme = paintedLadyScheme(seed), trim = new Color(scheme.trim);
  const palette = district?.buildings.residential;
  const body = palette?.length ? new Color().fromArray(palette[seed % palette.length]!) : new Color(scheme.body);
  const { x, z, nx, nz, len } = wall, tx = -nz, tz = nx, yaw = Math.atan2(-nz, nx);
  const part = (t: number, y: number, out: number, width: number, height: number, depth: number, color: Color) =>
    box(d, x + tx * t + nx * out, y, z + tz * t + nz * out, depth, height, width, color, yaw);
  const top = roofY - 0.7, start = groundY + 3.0;
  if (top - start < 1.7) return;
  // One bay on Low; two on wider HD frontages. Reuse the established SF geometry.
  const twin = !low && len >= 6.2, width = Math.min(2.4, len * (twin ? 0.32 : 0.4));
  for (const offset of twin ? [-len * 0.25, len * 0.25] : [len * 0.18]) {
    const floors = Math.max(1, Math.round((top - start) / 3));
    const rise = (top - start) / floors;
    for (let f = 0; f < floors; f++) {
      const y = start + rise * f;
      // Separate glazed storeys instead of one continuous dark shaft. The solid spandrel
      // and projecting sill hide the join and give the bay the same rhythm as the wall atlas.
      if (!low && seed % 2 === 0) cantedBay(d, wall, y + 0.5, y + rise - 0.25, trim, width / 2, offset);
      else bayWindow(d, wall, y + 0.5, y + rise - 0.25, trim, width, offset);
      part(offset, y + 0.22, 0.43, width, 0.5, 0.92, body);
      part(offset, y + 0.5, 0.45, width + 0.1, 0.12, 0.96, trim);
    }
  }
  // Recess-coloured garage with panel seams and an adjacent raised front door.
  const garageWidth = Math.min(3.1, len * 0.48), garageT = len * 0.19, doorT = -len * 0.32;
  part(garageT, groundY + 1.22, 0.07, garageWidth + 0.2, 2.44, 0.18, trim);
  part(garageT, groundY + 1.14, 0.18, garageWidth, 2.2, 0.06, GARAGE);
  for (let row = 1; row <= (low ? 2 : 4); row++) part(garageT, groundY + row * (low ? 0.7 : 0.45), 0.22, garageWidth, 0.035, 0.035, DOOR);
  part(doorT, groundY + 1.65, 0.12, 1.15, 2.6, 0.22, trim);
  part(doorT, groundY + 1.6, 0.25, 0.87, 2.15, 0.06, DOOR);
  part(doorT, groundY + 2.2, 0.29, 0.55, 0.58, 0.04, BAY_GLASS);
  // Steps remain within a 0.8 m projection; decorative, not a new obstacle on narrow sidewalks.
  for (let step = 0; step < (low ? 1 : 3); step++) part(doorT, groundY + 0.09 + step * 0.09, 0.65 - step * 0.2, 1.3, 0.18 + step * 0.18, 0.3, trim);
  part(0, roofY - 0.15, 0.17, len + 0.3, 0.28, 0.48, trim);
  part(0, roofY + 0.23, 0.08, len, 0.55, 0.26, body);
  if (!low) {
    for (const t of [-len / 2, len / 2]) part(t, (start + top) / 2, 0.12, 0.16, top - start, 0.24, trim);
    for (let t = -len / 2 + 0.35; t < len / 2; t += 0.7) part(t, roofY - 0.4, 0.2, 0.16, 0.24, 0.4, trim);
  }
}

const CHIMNEY = new Color('#92624d'), ROOF_METAL = new Color('#616b69');
/** Small flat-roof silhouettes for SF homes, merged with existing chunk clutter. */
function homeRoofItem(d: BuildingDetail, x: number, y: number, z: number, kind: number, trim: Color, low: boolean): void {
  if (kind === 0) {
    box(d, x, y + 0.5, z, 0.8, 1, 0.65, CHIMNEY);
    box(d, x, y + 1.04, z, 0.96, 0.16, 0.81, trim);
    if (!low) {
      // A dark opening plus a second mortar band reads from uphill approaches.
      box(d, x, y + 1.13, z, 0.46, 0.035, 0.3, DOOR);
      box(d, x, y + 0.65, z, 0.83, 0.08, 0.68, trim);
    }
  } else if (kind === 1) {
    box(d, x, y + 0.32, z, 0.2, 0.64, 0.2, ROOF_METAL);
    box(d, x, y + 0.66, z, 0.5, 0.12, 0.5, ROOF_METAL);
  } else if (kind === 2) {
    box(d, x, y + 0.14, z, 1.2, 0.28, 0.9, trim);
    box(d, x, y + 0.31, z, 1.06, 0.08, 0.76, ROOF_METAL);
  } else {
    box(d, x, y + 0.32, z, 0.9, 0.64, 0.75, AC);
    if (!low) box(d, x, y + 0.65, z, 0.58, 0.04, 0.48, DOOR);
  }
}

export interface BuildingDetailOptions { mappedFrontages?: ReadonlySet<string>; outerHomes?: boolean; deviceLow?: boolean; low?: boolean; maxClutter?: number; vertexBudget?: number; meshyPieces?: boolean;
  /** Meshy hero pieces per chunk (each ~3k triangles). Over budget, cornices fall back to the box lip and other
   *  pieces to their procedural forms. Unbounded, NE chunks reached 2-5k pieces (gtasf-oeua HD boot hang). */
  maxPieces?: number }

/**
 * Pure placement: scatter rooftop clutter + a cornice lip for a chunk's buildings into one merged,
 * chunk-local geometry (coordinates relative to `collision.origin`). `seen` dedupes buildings shared
 * across chunk boundaries. Bounded by a per-chunk vertex budget and (on phones) tighter caps.
 */
/** ~120 x ~3k triangles = ~0.36M per chunk of hero pieces on HD. */
export const MAX_PIECES_PER_CHUNK = 120;
export function buildBuildingDetail(context: ShopfrontContext, options: BuildingDetailOptions = {}, seen?: Set<string>): BuildingDetail {
  const low = options.low ?? false;
  const maxClutter = options.maxClutter ?? (low ? 240 : 560);
  const vertexBudget = options.vertexBudget ?? (low ? 60_000 : 150_000);
  // Spent tallest-building-first (see order below), so the skyline keeps its hero pieces.
  const pieceBudget = options.maxPieces ?? MAX_PIECES_PER_CHUNK;
  const piecesOk = (count = 1) => Boolean(options.meshyPieces) && d.pieces.length + count <= pieceBudget;
  const d: BuildingDetail = { positions: [], normals: [], colors: [], clutter: 0, buildings: 0, ids: [], pieces: [] };
  if (options.outerHomes) d.frontages = { positions: [], normals: [], colors: [], clutter: 0, buildings: 0, ids: [], pieces: [] };
  const { collision, ground, nearestRoad } = context;
  const [originX, , originZ] = collision.origin;
  // Taller/bigger buildings first, so the budget spends on the prominent skyline, not sheds.
  const order = [...collision.buildings].sort((a, b) => (b.maxY - b.minY) - (a.maxY - a.minY) || hash(a.id) - hash(b.id));
  for (const b of order) {
    if (d.positions.length >= vertexBudget * 3) break;
    if (seen?.has(b.id)) continue;
    const ring = b.rings[0]; if (!ring || ring.length < 3) continue;
    const height = b.maxY - b.minY; if (height < 4) continue; // skip sheds/garages
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, signedArea = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, c = ring[(i + 1) % ring.length]!;
      minX = Math.min(minX, a[0]); maxX = Math.max(maxX, a[0]); minZ = Math.min(minZ, a[1]); maxZ = Math.max(maxZ, a[1]);
      signedArea += a[0] * c[1] - c[0] * a[1];
    }
    const spanX = maxX - minX, spanZ = maxZ - minZ, area = Math.abs(signedArea) / 2;
    if (spanX < 4 || spanZ < 4 || area < 20) continue;
    seen?.add(b.id); d.ids.push(b.id); d.buildings++;
    const roofY = b.maxY, sign = Math.sign(signedArea) || 1, random = rng(hash(b.id));

    // Cornice: a thin lip projecting out along each roof-edge (strong SA rooftop silhouette). The trim
    // hue varies per building across the painted-lady palette for citywide roofline colour variety.
    // A subset of buildings also raise a stepped parapet above the lip for a varied skyline (desktop).
    const cornice = CORNICES[hash(b.id + ':cornice') % CORNICES.length]!;
    const parapet = !low && hash(b.id + ':parapet') % 3 === 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, c = ring[(i + 1) % ring.length]!, ex = c[0] - a[0], ez = c[1] - a[1], len = Math.hypot(ex, ez);
      if (len < 2) continue;
      const yaw = Math.atan2(ex, ez), nx = ez / len * sign, nz = -ex / len * sign;
      const mx = originX + (a[0] + c[0]) / 2, mz = originZ + (a[1] + c[1]) / 2;
      // Tile the Meshy cornice GLB along the edge (its native span ~2.6 m), facing outward, while the budget lasts.
      const tiles = Math.max(1, Math.round(len / 2.6)), seg = len / tiles;
      if (piecesOk(tiles)) {
        for (let t = 0; t < tiles; t++) {
          const f = (t + 0.5) / tiles;
          d.pieces.push({ kind: 'cornice', x: originX + a[0] + ex * f + nx * 0.12, y: roofY, z: originZ + a[1] + ez * f + nz * 0.12, yaw: Math.atan2(nx, nz), width: seg });
        }
      } else box(d, mx + nx * 0.12, roofY - 0.25, mz + nz * 0.12, 0.5, 0.7, len, cornice, yaw);
      // Raised central parapet block (a short, taller slab centred on each long edge) for a stepped roofline.
      if (parapet && len >= 5) box(d, mx + nx * 0.06, roofY + 0.45, mz + nz * 0.06, 0.32, 1.1, Math.min(len * 0.5, 4.5), cornice, yaw);
    }

    // Rooftop clutter: a few low-poly items scattered inside the footprint.
    const roofDistrict = options.outerHomes ? districtAt(originX + (minX + maxX) / 2, originZ + (minZ + maxZ) / 2) : undefined;
    const homeRoof = roofDistrict && HOME_DISTRICTS.has(roofDistrict.id) && height <= 24 && area <= 480;
    const target = homeRoof ? (options.deviceLow ? 1 : Math.min(2, 1 + Math.floor(area / 170))) : Math.min(low ? 2 : 4, 1 + Math.floor(area / 170));
    for (let k = 0; k < target && d.clutter < maxClutter; k++) {
      for (let tries = 0; tries < 6; tries++) {
        const px = minX + 1.6 + random() * Math.max(0.1, spanX - 3.2), pz = minZ + 1.6 + random() * Math.max(0.1, spanZ - 3.2);
        if (!inRing(px, pz, ring)) continue;
        const wx = originX + px, wz = originZ + pz, kind = Math.floor(random() * 4);
        const tint = 0.86 + random() * 0.28; // subtle per-item tone jitter so identical props don't repeat across rooftops
        if (homeRoof) {
          // Test the small item's enclosing square too, avoiding overhangs on concave footprints.
          if ([-0.7, 0.7].some(dx => [-0.7, 0.7].some(dz => !inRing(px + dx, pz + dz, ring)))) continue;
          homeRoofItem(d, wx, roofY, wz, kind, cornice, options.deviceLow ?? false);
        } else if (kind === 0) box(d, wx, roofY + 0.6, wz, 1.5, 1.2, 1.3, SCRATCH.copy(AC).multiplyScalar(tint), random() * Math.PI); // AC unit
        else if (kind === 1) { cyl(d, wx, roofY, wz, 1.0, 1.0, 2.1, SCRATCH.copy(TANK).multiplyScalar(tint), 8); cyl(d, wx, roofY + 2.1, wz, 1.15, 0.05, 0.9, SCRATCH.copy(TANK_CAP).multiplyScalar(tint), 8); } // SF wooden water tank + conical cap
        else if (kind === 2) box(d, wx, roofY + 1.9, wz, 0.18, 3.8, 0.18, SCRATCH.copy(ANTENNA).multiplyScalar(tint)); // antenna mast
        else box(d, wx, roofY + 1.35, wz, 2.3, 2.7, 2.1, SCRATCH.copy(STAIR).multiplyScalar(tint), random() * Math.PI); // stair housing
        d.clutter++; break;
      }
    }

    // Street-facing striped awning over the shopfront (both tiers). Pick the canonical road-facing
    // wall exactly as shopfrontSigns does, so awnings sit on the same street frontage as the signs.
    let wall: { x: number; z: number; nx: number; nz: number; len: number; roadY: number } | undefined, bestRoad = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, c = ring[(i + 1) % ring.length]!, dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 5) continue;
      const nx = dz / len * sign, nz = -dx / len * sign;
      const wx = originX + (a[0] + c[0]) / 2, wz = originZ + (a[1] + c[1]) / 2;
      const road = nearestRoad(wx + nx, wz + nz, 20); if (!road) continue;
      const rx = road.x - wx, rz = road.z - wz, dist = Math.hypot(rx, rz);
      if (dist < 2 || dist > 20 || (nx * rx + nz * rz) / dist < 0.7) continue;
      if (dist < bestRoad) { bestRoad = dist; wall = { x: wx, z: wz, nx, nz, len: Math.min(len - 1, 7), roadY: road.y }; }
    }
    if (wall && !options.mappedFrontages?.has(b.id)) {
      const groundY = sampleHeight(ground, wall.x + wall.nx * 0.2, wall.z + wall.nz * 0.2) ?? wall.roadY;
      const district = districtAt(wall.x, wall.z);
      const home = options.outerHomes && district && HOME_DISTRICTS.has(district.id) && roofY - groundY >= 4.7 && height <= 24 && area <= 480 && wall.len >= 4;
      if (home && d.frontages && d.frontages.positions.length < (options.deviceLow ? 18_000 : 48_000) * 3) {
        const before = d.frontages.positions.length;
        homeFrontage(d.frontages, wall, groundY, roofY, hash(b.id), options.deviceLow ?? false);
        if (d.frontages.positions.length > (options.deviceLow ? 18_000 : 48_000) * 3) {
          // Keep complete houses only; never truncate a face at the budget boundary.
          d.frontages.positions.length = d.frontages.normals.length = d.frontages.colors.length = before;
        } else d.frontages.buildings++;
      }
      if (!home && roofY - b.minY > 4 && hash(b.id + ':awn') % 2 === 0) {
        if (piecesOk()) d.pieces.push({ kind: 'awning', x: wall.x + wall.nx * 0.1, y: groundY + 3.0, z: wall.z + wall.nz * 0.1, yaw: Math.atan2(wall.nx, wall.nz), width: Math.min(wall.len, 5.2) });
        else awning(d, wall, groundY + 3.0, hash(b.id));
      }
      // Fire escapes climb tall street walls; desktop only (facade geometry is too heavy for phones).
      // fireEscapeWalkups (gtasf-avas look-check): only walk-up heights (<=30 m). A stack on a glass curtain-wall tower read as
      // nothing (buried in the tower's facade at North Beach) and SF fire escapes climb 3-8 storey walk-ups.
      if (!home && !low && height >= 11 && (!flags.fireEscapeWalkups || height <= 30) && hash(b.id + ':fe') % 3 === 0) {
        // Stack the Meshy fire-escape GLB (~3.2 m tall) up the street wall, one per floor.
        const start = groundY + 3.4, rise = 3.2, floors = Math.min(6, Math.floor((roofY - 0.6 - start) / rise));
        if (piecesOk(Math.max(1, floors))) {
          for (let f = 0; f < floors; f++) d.pieces.push({ kind: 'fire-escape', x: wall.x, y: start + f * rise, z: wall.z, yaw: Math.atan2(wall.nx, wall.nz), width: 2.0 });
        } else fireEscape(d, wall, groundY, roofY);
      }
      // SF bay windows up the street face of mid-rise residential/mixed-use blocks (desktop only, to
      // protect the phone budget). Height band skips sheds and tall office towers; hash gates a subset.
      if (!home && !low && height >= 7 && height <= 24 && hash(b.id + ':bay') % 2 === 0) {
        const startY = groundY + 3.4, topY = roofY - 0.9; // above the shopfront, below the cornice
        if (topY - startY >= 3) {
          const twin = wall.len >= 6;
          const width = Math.min(2.4, twin ? wall.len * 0.38 : wall.len - 0.8);
          // SF has both square (Edwardian) and canted (Victorian) bays — pick per building for variety.
          const canted = hash(b.id + ':cant') % 2 === 0;
          const { x, z, nx, nz } = wall, tx = -nz, tz = nx;
          const place = piecesOk(twin ? 2 : 1)
            // Record a Meshy bay-window placement (instanced later); yaw faces the GLB's +Z detail to the wall.
            ? (offsetT: number) => d.pieces.push({ kind: 'bay-window', x: x + nx * 0.1 + tx * offsetT, y: startY, z: z + nz * 0.1 + tz * offsetT, yaw: Math.atan2(nx, nz), width })
            : (offsetT: number) => canted ? cantedBay(d, wall, startY, topY, cornice, width / 2, offsetT) : bayWindow(d, wall, startY, topY, cornice, width, offsetT);
          if (twin) { place(-wall.len * 0.24); place(wall.len * 0.24); }
          else place(0);
        }
      }
      // Juliet balcony on NON-bay mid-rise street walls (Meshy only; buildingDetail has no procedural
      // balcony, so no double-placement). Gives the non-bay half of mid-rise blocks a hero piece too.
      if (!home && piecesOk() && !low && height >= 7 && height <= 24 && hash(b.id + ':bay') % 2 === 1) {
        d.pieces.push({ kind: 'balcony', x: wall.x + wall.nx * 0.1, y: groundY + Math.min(6, height * 0.4), z: wall.z + wall.nz * 0.1, yaw: Math.atan2(wall.nx, wall.nz), width: 1.2 });
      }
    }
  }
  return d;
}

/** The Meshy hero-piece kinds buildingDetail swaps in (gtasf-facade-meshy-buildingdetail-swap-13c6). */
const MESHY_KINDS = ['bay-window', 'awning', 'balcony', 'cornice', 'fire-escape'] as const;
// Placements record yaw assuming each GLB's detail faces local +Z; some Meshy pieces are authored with
// a different native facing, so a per-kind base offset rotates their detail to +Z before the placement
// yaw aims it at the wall. Values from CyanBeaver's GLB vertex-centroid analysis (gtasf-9dup): the
// fire-escape's ladder/platform faces -X (+90deg) and the awning canopy faces -Z (+180deg); bay-window,
// balcony and the near-symmetric cornice are already ~+Z, so 0. Pane 6 fine-tunes in-browser.
const NATIVE_YAW_OFFSET: Record<string, number> = { 'fire-escape': Math.PI / 2, 'awning': Math.PI };
interface LoadedPiece { base: BufferGeometry; material: Material; nativeWidth: number }

/** Scene owns the shared material; each chunk owns only its merged detail geometry (unloads with it). */
export function createBuildingDetail(options: { night?: { value: number } } = {}) {
  const material = new MeshLambertMaterial({ name: 'GTASF building detail', vertexColors: true, flatShading: true, fog: true });
  // Share the atlas clock. Only bay glass emits; walls/trim keep their Lambert response.
  if (flags.graphicsV2) {
    material.onBeforeCompile = shader => {
      shader.uniforms.uHomeNight = options.night ?? { value: 0 };
      shader.fragmentShader = 'uniform float uHomeNight;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#ifdef USE_COLOR
      float homeGlass = 1.0 - step(0.002, distance(vColor.rgb, vec3(${BAY_GLASS.r}, ${BAY_GLASS.g}, ${BAY_GLASS.b})));
      totalEmissiveRadiance += vec3(0.8, 0.43, 0.16) * homeGlass * uHomeNight;
#endif`);
    };
    material.customProgramCacheKey = () => 'gtasf-home-glass-v1';
  }
  const stats = { chunks: 0, buildings: 0, clutter: 0, triangles: 0, pieces: 0, homeFrontages: 0, piecesByKind: {} as Record<string, number> };
  // ?debug=facades: window.__gtasfFacadeStats for look-checks (e.g. find a frame that has fire escapes, gtasf-avas).
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === 'facades') (window as { __gtasfFacadeStats?: typeof stats }).__gtasfFacadeStats = stats;
  const releases = new Set<() => void>();
  const seen = new Set<string>();
  let disposed = false;

  // Meshy hero-piece swap: HD realistic path only (same gate as facadeStorefronts), behind storefrontPieces
  // so pane-6 can review facade textures without untuned hero pieces. graphicsPreset() is the real device
  // tier (not root.gtasfLowDetail, which is map detail). When active, buildBuildingDetail records piece
  // placements instead of box geometry; this loads each Low GLB once and instances it per placement.
  const meshyPieces = typeof window !== 'undefined' && flags.realisticFacades && flags.storefrontPieces && graphicsPreset() === 'hd';
  const loaded = new Map<string, LoadedPiece>();
  const piecesReady = (async () => {
    if (!meshyPieces) return false;
    await Promise.all(MESHY_KINDS.map(async kind => {
      try {
        const asset = realisticFacadePieces[kind];
        if (!asset) return;
        const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(asset.low.url);
        gltf.scene.updateMatrixWorld(true);
        const geometries: BufferGeometry[] = []; let material: Material | undefined;
        gltf.scene.traverse(object => {
          if (object instanceof Mesh) { const g = object.geometry.clone(); g.applyMatrix4(object.matrixWorld); geometries.push(g); material ??= Array.isArray(object.material) ? object.material[0] : object.material; }
        });
        if (!geometries.length || !material) return;
        const base = geometries.length === 1 ? geometries[0]! : mergeGeometries(geometries, false)!;
        // Meshopt GLBs decode to interleaved attributes; every placed copy below clones `base`, and cloning an
        // interleaved attribute de-interleaves it each time. In dense areas (FiDi) that blocked the main thread for
        // 5 s+ at a time, the world socket timed out before opening and HD boot hung (realisticFacades + storefrontPieces;
        // overnight Oct 7 ship-list bisect). De-interleave once here instead.
        deinterleaveGeometry(base);
        if (geometries.length > 1) for (const g of geometries) g.dispose();
        // A +-PI/2 native offset turns the GLB's Z extent into its along-wall width.
        const quarterTurn = Math.abs(Math.abs(NATIVE_YAW_OFFSET[kind] ?? 0) - Math.PI / 2) < 1e-6;
        loaded.set(kind, { base, material, nativeWidth: (quarterTurn ? asset.bounds.max[2]! - asset.bounds.min[2]! : asset.bounds.max[0]! - asset.bounds.min[0]!) || 1 });
      } catch { /* a missing/broken GLB just leaves that kind unloaded (no hero piece for it) */ }
    }));
    return loaded.size > 0;
  })();

  function buildMount(root: Object3D): () => void {
    const context = root.userData.gtasfShopfrontContext as ShopfrontContext | undefined;
    if (!context || disposed) return () => {};
    const low = root.userData.gtasfLowDetail === true;
    const deviceLow = graphicsPreset() === 'low';
    const d = buildBuildingDetail(context, { low, meshyPieces, outerHomes: flags.graphicsV2, deviceLow, mappedFrontages: root.userData.gtasfMappedFacadeIds as Set<string> | undefined }, seen);
    const px = root.position.x, py = root.position.y, pz = root.position.z;
    let active = true, mesh: Mesh | undefined;
    const pieceMeshes: InstancedMesh[] = [];
    let frontageLod: LOD | undefined, frontageMesh: Mesh | undefined;
    const release = () => {
      if (!active) return; active = false;
      if (frontageLod) root.remove(frontageLod);
      if (frontageMesh) { frontageMesh.geometry.dispose(); stats.triangles -= d.frontages!.positions.length / 9; stats.homeFrontages -= d.frontages!.buildings; }
      if (mesh) { root.remove(mesh); mesh.geometry.dispose(); stats.chunks--; stats.buildings -= d.buildings; stats.clutter -= d.clutter; stats.triangles -= d.positions.length / 9; }
      for (const pm of pieceMeshes) { root.remove(pm); pm.dispose(); } // shared GLB geometry stays loaded
      stats.pieces -= d.pieces.length;
      for (const id of d.ids) seen.delete(id);
    };
    if (!d.positions.length && !d.pieces.length) { return release; }
    if (d.positions.length) {
      const geometry = new BufferGeometry();
      // Positions are world; the chunk root sits at its origin, so subtract root.position (cf. shopfrontSigns).
      const local = d.positions.map((v, i) => i % 3 === 0 ? v - px : i % 3 === 1 ? v - py : v - pz);
      geometry.setAttribute('position', new Float32BufferAttribute(local, 3));
      geometry.setAttribute('normal', new Float32BufferAttribute(d.normals, 3));
      geometry.setAttribute('color', new Float32BufferAttribute(d.colors, 3));
      geometry.computeBoundingSphere();
      mesh = new Mesh(geometry, material); mesh.name = 'Building detail'; mesh.userData.gtasfBuildingDetail = true;
      root.add(mesh);
      stats.chunks++; stats.buildings += d.buildings; stats.clutter += d.clutter; stats.triangles += d.positions.length / 9;
    }
    if (d.frontages?.positions.length) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(d.frontages.positions, 3));
      geometry.setAttribute('normal', new Float32BufferAttribute(d.frontages.normals, 3));
      geometry.setAttribute('color', new Float32BufferAttribute(d.frontages.colors, 3));
      geometry.computeBoundingSphere();
      const centre = geometry.boundingSphere!.center.clone();
      geometry.translate(-centre.x, -centre.y, -centre.z);
      frontageMesh = new Mesh(geometry, material);
      frontageMesh.name = 'Outer district homes';
      frontageMesh.userData.gtasfBuildingDetail = true;
      frontageLod = new LOD();
      frontageLod.position.set(centre.x - px, centre.y - py, centre.z - pz);
      // Include chunk radius, so homes beside the camera cannot vanish at chunk boundaries.
      frontageLod.addLevel(frontageMesh, 0);
      frontageLod.addLevel(new Object3D(), geometry.boundingSphere!.radius + (deviceLow ? 65 : 150), 0.12);
      root.add(frontageLod);
      stats.triangles += d.frontages.positions.length / 9; stats.homeFrontages += d.frontages.buildings;
    }
    // Meshy hero pieces: instanced once the Low GLBs resolve. Added after mount returns, so each keeps its
    // own PBR material (applyRealisticMaterials has already traversed root) and sets its own shadow flags.
    if (meshyPieces && d.pieces.length) {
      void piecesReady.then(ok => {
        if (!ok || !active || disposed) return;
        for (const kind of MESHY_KINDS) {
          const piece = loaded.get(kind); if (!piece) continue;
          // One InstancedMesh per kind sharing the loaded GLB geometry: no per-copy clone + CPU merge (which took
          // 2-8 s of main thread per dense NE chunk, gtasf-oeua) and no duplicated vertex memory.
          const matrices: Matrix4[] = [];
          for (const p of d.pieces) {
            if (p.kind !== kind) continue;
            // Fit the unit to the wall span by REPEATING it, never by blowing it up: a uniform scale of
            // span/native turned 6-8 m cornices/bays into storey-tall blurry blocks (Chinatown, Haight).
            const copies = Math.max(1, Math.round(p.width / piece.nativeWidth));
            const s = Math.min(1.25, p.width / copies / piece.nativeWidth), step = p.width / copies;
            for (let c = 0; c < copies; c++) {
              // placement yaw aims local +Z at the wall; add the kind's native-facing offset so pieces
              // whose GLB detail is not +Z (fire-escape, awning) start correctly oriented (gtasf-9dup).
              const matrix = new Matrix4()
                .makeTranslation(p.x - px, p.y - py, p.z - pz)
                .multiply(new Matrix4().makeRotationY(p.yaw))
                // Step along the wall in placement space, THEN turn the GLB to its native facing (gtasf-avas):
                // applying the offset first made PI/2 kinds (fire escapes) stack out from the facade.
                .multiply(new Matrix4().makeTranslation((c + .5) * step - p.width / 2, 0, 0))
                .multiply(new Matrix4().makeRotationY(NATIVE_YAW_OFFSET[kind] ?? 0))
                .multiply(new Matrix4().makeScale(s, s, s));
              matrices.push(matrix);
            }
          }
          if (!matrices.length) continue;
          const pm = new InstancedMesh(piece.base, piece.material, matrices.length);
          for (let i = 0; i < matrices.length; i++) pm.setMatrixAt(i, matrices[i]!);
          pm.instanceMatrix.needsUpdate = true; pm.computeBoundingSphere();
          pm.name = `Building ${kind}`; pm.userData.gtasfBuildingDetail = true;
          pm.castShadow = true; pm.receiveShadow = true;
          root.add(pm); pieceMeshes.push(pm);
        }
        stats.pieces += d.pieces.length;
        for (const p of d.pieces) stats.piecesByKind[p.kind] = (stats.piecesByKind[p.kind] ?? 0) + 1;
      });
    }
    return release;
  }
  function mount(root: Object3D): () => void {
    if (disposed) return () => {};
    let releaseGeometry = buildMount(root), active = true;
    const refresh = () => {
      if (!active || disposed) return;
      releaseGeometry(); releaseGeometry = buildMount(root);
    };
    root.userData.gtasfRefreshBuildingDetail = refresh;
    const release = () => {
      if (!active) return; active = false; releaseGeometry();
      if (root.userData.gtasfRefreshBuildingDetail === refresh) delete root.userData.gtasfRefreshBuildingDetail;
      releases.delete(release);
    };
    releases.add(release); return release;
  }
  return {
    stats, mount,
    dispose(): void {
      if (disposed) return; disposed = true;
      for (const release of [...releases]) release();
      material.dispose();
      for (const piece of loaded.values()) { piece.base.dispose(); if ('dispose' in piece.material) piece.material.dispose(); }
    },
  };
}
