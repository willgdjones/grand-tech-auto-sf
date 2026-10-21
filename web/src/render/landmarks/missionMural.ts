import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { Parts, type BuilderOptions, type V3 } from './primitives';

// A Mission-District mural wall (Clarion/Balmy Alley): the Mission's alleys are covered in bold, vivid community
// murals. Rather than a plain wall, this stands a painted mural panel against the alley wall -- a stylised but
// unmistakably Mission composition (bold colour fields, a radiant sun, a dove, papel-picado banners, geometric
// borders) in the vivid Mission palette. Rendered as one UNLIT mesh (MeshBasicMaterial, toneMapped off) because a
// mural is flat paint: the colours read vivid on HD and Low, day or dusk. Faces +Z (into the alley). No textures.
const TERRA = '#c24a2c', MARIGOLD = '#eca72f', TEAL = '#1f8a76', COBALT = '#2f58a6', GREEN = '#4a9e3c',
  YELLOW = '#f2cf3e', MAGENTA = '#b53a7c', CREAM = '#f0e6cc', SKY = '#4fb0c4';

/** A filled triangle on the wall at depth z. */
function tri(p: Parts, a: [number, number], b: [number, number], c: [number, number], z: number, colour: string): void {
  p.polygon([[a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z]] as V3[], colour);
}
/** A filled rectangle (w x h) centred at (x,y,z). */
function rect(p: Parts, x: number, y: number, w: number, h: number, z: number, colour: string): void {
  p.box([x, y, z], [w, h, 0.08], colour);
}

export function createMissionMural(_options: BuilderOptions = {}): Group {
  const W = 9, H = 11, m = new Parts();
  // Base wall and two big colour fields.
  rect(m, 0, H / 2, W, H, 0, TERRA);
  rect(m, -W / 4, H * 0.72, W / 2, H * 0.56, 0.05, TEAL);
  rect(m, W / 4, H * 0.28, W / 2, H * 0.56, 0.05, COBALT);
  // Radiant sun, upper-left.
  const sx = -2.3, sy = 8.2;
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    tri(m, [sx + c * 1.4, sy + s * 1.4], [sx + Math.cos(a + 0.26) * 2.5, sy + Math.sin(a + 0.26) * 2.5],
      [sx + Math.cos(a - 0.26) * 2.5, sy + Math.sin(a - 0.26) * 2.5], 0.1, MARIGOLD);
  }
  m.ellipsoid([sx, sy, 0.16], [1.5, 1.5, 0.1], YELLOW, 0, 2);
  m.ellipsoid([sx, sy, 0.22], [1.0, 1.0, 0.08], TERRA, 0, 2);
  // A white dove, lower-right (body + wings + tail as triangles).
  const dx = 2.4, dy = 3.4;
  m.ellipsoid([dx, dy, 0.14], [1.1, 0.6, 0.1], CREAM, 0, 1);
  tri(m, [dx - 0.3, dy + 0.3], [dx - 2.0, dy + 1.6], [dx + 0.4, dy + 0.5], 0.18, CREAM);   // upper wing
  tri(m, [dx - 0.3, dy - 0.2], [dx - 1.8, dy - 1.2], [dx + 0.3, dy - 0.1], 0.18, CREAM);   // lower wing
  tri(m, [dx + 0.9, dy + 0.1], [dx + 2.0, dy + 0.5], [dx + 2.0, dy - 0.3], 0.18, CREAM);   // tail
  m.box([dx + 1.0, dy + 0.15, 0.2], [0.5, 0.14, 0.06], MARIGOLD);                           // beak
  // Papel-picado banner across the top (alternating colour pennants).
  const pen = [MAGENTA, YELLOW, GREEN, SKY, TERRA, CREAM, COBALT, MARIGOLD, TEAL, MAGENTA];
  for (let i = 0; i < pen.length; i++) {
    const x = -W / 2 + 0.6 + i * (W - 1.2) / (pen.length - 1);
    tri(m, [x - 0.42, H - 0.3], [x + 0.42, H - 0.3], [x, H - 1.3], 0.12, pen[i]!);
  }
  // A green stepped/pyramid motif, lower-left, and a bold zigzag border down each side.
  for (let k = 0; k < 4; k++) rect(m, -3.0, 1.4 + k * 0.7, 3.4 - k * 0.8, 0.6, 0.1, GREEN);
  for (const side of [-1, 1]) for (let k = 0; k < 9; k++) {
    tri(m, [side * (W / 2 - 0.1), 1 + k * 1.1], [side * (W / 2 - 0.8), 1.55 + k * 1.1], [side * (W / 2 - 0.1), 2.1 + k * 1.1], 0.12, k % 2 ? YELLOW : MAGENTA);
  }
  // A couple of bold circles for rhythm.
  m.ellipsoid([-3.0, 5.4, 0.12], [0.8, 0.8, 0.08], MAGENTA, 0, 2);
  m.ellipsoid([3.2, 8.4, 0.12], [0.7, 0.7, 0.08], YELLOW, 0, 2);

  const muralGroup = m.finish('Mission mural');
  const mesh = muralGroup.children[0] as Mesh | undefined;
  if (mesh) {
    (mesh.material as MeshLambertMaterial).dispose?.();
    mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    mesh.name = 'Mission mural geometry';
  }
  return muralGroup;
}
