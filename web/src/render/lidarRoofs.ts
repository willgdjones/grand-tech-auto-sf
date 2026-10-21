/**
 * gtasf-6w9a prototype (flag lidarRoofs): replace the baked buildings of two test blocks (FiDi, Haight) with meshes
 * whose heights and roof shapes come from USGS 3DEP LiDAR (tools/map/lidar -> web/public/art/lidar/roofs-proto.json).
 * Shapes: flat, flat-parapet (SF false front / parapet), gable (ridge along the long axis), stepped (upper tier box).
 * The baked buildings inside each replaced footprint's bounds are discarded in the building shader (LIDAR_HIDE).
 * Prototype only: axis-aligned footprint bounds can clip a sliver of a rotated neighbour.
 */
import { BoxGeometry, BufferGeometry, Color, DoubleSide, ExtrudeGeometry, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial, Shape, Vector4 } from 'three';
import { flags } from '@gtasf/shared/flags';
import { addBuildingFacades } from './facades';
import { createFacadeGround, type FacadeAtlas } from './facadeAtlas';

type Ring = [number, number][];
interface RoofShape {
  id: string; type: string; ring: Ring; height: number; parapet?: number; ridge?: number; axis?: number;
  upper?: { height: number; x: number; z: number; length: number; width: number; axis: number };
}
interface ProtoFile { version: 1; blocks: { name: string; bounds: [number, number, number, number]; shapes: RoofShape[] }[] }

/** Flag lidarRoofs, unless a testing-harness A/B shot asks for ?lidar=0. */
export function lidarRoofsEnabled(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  if (!('lidarRoofs' in flags) || !flags.lidarRoofs) return false;
  return !(flags.testingHarness && new URLSearchParams(search).get('lidar') === '0');
}
export const LIDAR_MAX_RECTS = 64;
/** Shared building-shader uniforms: block bounds (cheap gate) and per-footprint rects to discard. */
export const LIDAR_HIDE = {
  uLidarBlocks: { value: [new Vector4(1, 1, 0, 0), new Vector4(1, 1, 0, 0)] },
  uLidarRects: { value: Array.from({ length: LIDAR_MAX_RECTS }, () => new Vector4(1, 1, 0, 0)) },
  uLidarCount: { value: 0 },
};
/** GLSL for the building fragment shader (expects vFacadePosition, world metres). */
export const LIDAR_HIDE_GLSL = `
uniform vec4 uLidarBlocks[2]; uniform vec4 uLidarRects[${LIDAR_MAX_RECTS}]; uniform int uLidarCount;
bool lidarHidden(vec2 p) {
  bool inBlock = false;
  for (int b = 0; b < 2; b++) { vec4 r = uLidarBlocks[b]; if (p.x >= r.x && p.x <= r.z && p.y >= r.y && p.y <= r.w) inBlock = true; }
  if (!inBlock) return false;
  for (int i = 0; i < ${LIDAR_MAX_RECTS}; i++) {
    if (i >= uLidarCount) break;
    vec4 r = uLidarRects[i];
    if (p.x >= r.x && p.x <= r.z && p.y >= r.y && p.y <= r.w) return true;
  }
  return false;
}`;

const PASTELS = ['#e8d3b0', '#d9b8a0', '#c9d6c4', '#e4c6c9', '#cfd7e3', '#e9e0c4', '#d6c4dd', '#bfcfc8'];
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
/** Paint every vertex of a LiDAR wall geometry one per-building colour, so the shared atlas-facade material
 *  (which reads the source wall colour) classifies land-use + varies the facade per building, like a baked
 *  building. [gtasf-6w9a: LiDAR buildings get the real facade, not a flat pastel placeholder] */
function setFacadeColour(g: BufferGeometry, c: Color): void {
  const n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new Float32BufferAttribute(a, 3));
}

function prism(ring: Ring, base: number, top: number): ExtrudeGeometry {
  const shape = new Shape(ring.map(([x, z]) => ({ x, y: -z }) as never));
  const g = new ExtrudeGeometry(shape, { depth: Math.max(.1, top - base), bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, base, 0);
  return g;
}
/** Thin vertical strip along every footprint edge (parapet / false front), double-sided. */
function walls(ring: Ring, y0: number, y1: number): BufferGeometry {
  const p: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!, [bx, bz] = ring[(i + 1) % ring.length]!;
    p.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(p, 3)); g.computeVertexNormals();
  return g;
}
/** Gable cap over the footprint's oriented bounds: eave at y0, ridge at y1 along `axis`. */
function gable(ring: Ring, axis: number, y0: number, y1: number): BufferGeometry {
  const ux = Math.cos(axis), uz = Math.sin(axis), cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const a = ring.map(([x, z]) => (x - cx) * ux + (z - cz) * uz), c = ring.map(([x, z]) => -(x - cx) * uz + (z - cz) * ux);
  const a0 = Math.min(...a), a1 = Math.max(...a), c0 = Math.min(...c), c1 = Math.max(...c), cm = (c0 + c1) / 2;
  const at = (s: number, t: number, y: number) => [cx + s * ux - t * uz, y, cz + s * uz + t * ux];
  const A = at(a0, c0, y0), B = at(a1, c0, y0), C = at(a1, c1, y0), D = at(a0, c1, y0), R0 = at(a0, cm, y1), R1 = at(a1, cm, y1);
  const tri = [A, B, R1, A, R1, R0, D, R0, R1, D, R1, C, A, R0, D, B, C, R1].flat();
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(tri, 3)); g.computeVertexNormals();
  return g;
}

export async function createLidarRoofs(options: { heightAt(x: number, z: number): number | null; atlas?: FacadeAtlas; low?: boolean }) {
  if (!lidarRoofsEnabled()) return null;
  const response = await fetch('/art/lidar/roofs-proto.json');
  if (!response.ok) return null;
  const data = await response.json() as ProtoFile;
  const root = new Group(); root.name = 'LiDAR roofs prototype';
  const roofMaterial = new MeshLambertMaterial({ color: '#7d7a76', flatShading: true, side: DoubleSide });
  // gtasf-6w9a: give the LiDAR walls the SAME atlas facade as their baked neighbours (windows, trim, colour,
  // painted-lady, tar/gravel roof on the flat tops) instead of a flat pastel placeholder. One shared material;
  // per-building variety comes from a per-building vertex colour (read as the source wall) + world position.
  // noLidarHide: these ARE the LiDAR replacement, so they must not discard themselves under their own footprint.
  const facadeGround = options.atlas ? createFacadeGround(undefined) : undefined;
  const wallFacade = options.atlas && facadeGround ? new MeshLambertMaterial({ name: 'GTASF LiDAR facade', vertexColors: true, flatShading: true, side: DoubleSide }) : undefined;
  if (wallFacade && options.atlas) addBuildingFacades(wallFacade, options.atlas, facadeGround, options.low ?? false, undefined, undefined, { noLidarHide: true });
  const wallMaterials = PASTELS.map(c => new MeshLambertMaterial({ color: new Color(c), flatShading: true, side: DoubleSide })); // fallback when the atlas is off
  const geometries: BufferGeometry[] = [];
  let rects = 0;
  data.blocks.slice(0, 2).forEach((block, b) => {
    const [x0, z0, x1, z1] = block.bounds; LIDAR_HIDE.uLidarBlocks.value[b]!.set(x0, z0, x1, z1);
    for (const s of block.shapes) {
      const cx = s.ring.reduce((t, p) => t + p[0], 0) / s.ring.length, cz = s.ring.reduce((t, p) => t + p[1], 0) / s.ring.length;
      const ground = options.heightAt(cx, cz); if (ground === null || !Number.isFinite(ground)) continue;
      const pastel = new Color(PASTELS[hash(s.id) % PASTELS.length]!);
      const wallMat = wallFacade ?? wallMaterials[hash(s.id) % wallMaterials.length]!;
      const add = (g: BufferGeometry, m: MeshLambertMaterial) => { geometries.push(g); root.add(new Mesh(g, m)); };
      // Wall geometry (prism, parapet strip, upper tier box): atlas facade + per-building colour.
      const addWall = (g: BufferGeometry) => { if (wallFacade) setFacadeColour(g, pastel); add(g, wallMat); };
      addWall(prism(s.ring, ground - 1, ground + s.height));
      if (s.type === 'flat-parapet' && s.parapet && s.parapet > s.height + .3) addWall(walls(s.ring, ground + s.height, ground + s.parapet));
      if (s.type === 'gable' && s.ridge && s.axis !== undefined) add(gable(s.ring, s.axis, ground + s.height, ground + s.ridge), roofMaterial);
      if (s.upper) {
        const u = s.upper, g = new BoxGeometry(u.length, Math.max(.5, u.height - s.height), u.width);
        g.rotateY(-u.axis); g.translate(u.x, ground + (s.height + u.height) / 2, u.z); addWall(g);
      }
      if (rects < LIDAR_MAX_RECTS) {
        const xs = s.ring.map(p => p[0]), zs = s.ring.map(p => p[1]);
        LIDAR_HIDE.uLidarRects.value[rects++]!.set(Math.min(...xs) + .2, Math.min(...zs) + .2, Math.max(...xs) - .2, Math.max(...zs) - .2);
      }
    }
  });
  LIDAR_HIDE.uLidarCount.value = rects;
  return { root, dispose() { root.removeFromParent(); for (const g of geometries) g.dispose(); roofMaterial.dispose(); wallFacade?.dispose(); facadeGround?.dispose(); for (const m of wallMaterials) m.dispose(); LIDAR_HIDE.uLidarCount.value = 0; } };
}
