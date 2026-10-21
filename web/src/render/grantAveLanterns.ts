import { Group } from 'three';
import { flags } from '@gtasf/shared/flags';
import { Parts } from './landmarks/primitives';

// Grant Avenue lantern strings (Chinatown identity): red paper lanterns strung on cables across Grant Ave through
// Chinatown, the way the real street is dressed. Cheap vertex-coloured merged static mesh, placed from the road
// graph so each string spans the carriageway and follows the street. HD + Low.
type Pt = [number, number, number];
interface Edge { name?: string; points: Pt[] }
interface Graph { edges: readonly Edge[] }

const LANTERN = '#c43527', GOLD = '#d7ad46', CORD = '#2a2420';
// Chinatown Grant Ave runs north (−z) from the Dragon Gate at Grant & Bush (world ≈ 189, −727) up past Broadway.
const Z_SOUTH = -690, Z_NORTH = -1560, X_MIN = 110, X_MAX = 280;

/** One red lantern hanging with its cord top at (x, topY, z). */
function lantern(p: Parts, x: number, topY: number, z: number): void {
  p.box([x, topY, z], [0.08, 1.0, 0.08], CORD);                      // drop cord
  p.cylinder([x, topY - 0.62, z], 0.17, 0.17, 0.14, GOLD, 8);        // top cap
  p.ellipsoid([x, topY - 1.12, z], [0.5, 0.56, 0.5], LANTERN, 0, 1); // body
  p.cylinder([x, topY - 1.62, z], 0.17, 0.17, 0.14, GOLD, 8);        // bottom cap
  p.box([x, topY - 1.95, z], [0.07, 0.5, 0.07], GOLD);               // tassel
}

export function createGrantAveLanterns(options: { graph: Graph; heightAt?: (x: number, z: number) => number | null }): { root: Group } | null {
  if (!flags.grantAveLanterns) return null;
  const grant = options.graph.edges.filter(e => /grant/i.test(e.name ?? ''));
  const p = new Parts();
  let strings = 0;
  for (const edge of grant) {
    let carried = 14; // first string a little in from the edge start
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!, b = edge.points[i]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const tx = dx / len, tz = dz / len, nx = -tz, nz = tx; // tangent + cross-street normal
      for (; carried < len; carried += 26) {
        const t = carried / len, cx = a[0] + dx * t, cz = a[2] + dz * t;
        if (cz > Z_SOUTH || cz < Z_NORTH || cx < X_MIN || cx > X_MAX) continue;
        // Road-point height (always present in the graph), so the strings build even before that chunk's terrain loads.
        const road = a[1] + dy * t, ground = options.heightAt?.(cx, cz);
        const base = ground !== null && ground !== undefined && Number.isFinite(ground) ? ground : road;
        const top = base + 6.6, half = 8.5;
        // Cable across the street: three shallow segments so it reads as a gently sagging span, not a stiff bar.
        const sag = 0.7;
        const lx = cx + nx * half, lz = cz + nz * half, rx = cx - nx * half, rz = cz - nz * half;
        p.beam([lx, top, lz], [cx + nx * half * 0.4, top - sag, cz + nz * half * 0.4], 0.07, CORD);
        p.beam([cx + nx * half * 0.4, top - sag, cz + nz * half * 0.4], [cx - nx * half * 0.4, top - sag, cz - nz * half * 0.4], 0.07, CORD);
        p.beam([cx - nx * half * 0.4, top - sag, cz - nz * half * 0.4], [rx, top, rz], 0.07, CORD);
        // Five lanterns hung across the span (lower in the middle where the cable sags).
        for (let k = -2; k <= 2; k++) {
          const f = k / 2.4, lxk = cx + nx * half * f, lzk = cz + nz * half * f;
          lantern(p, lxk, top - sag * (1 - Math.abs(f)) - 0.1, lzk);
        }
        strings++;
      }
      carried -= len;
    }
  }
  if (!strings) return null;
  const root = p.finish('Grant Ave lanterns');
  root.name = 'Grant Ave lanterns';
  return { root };
}
