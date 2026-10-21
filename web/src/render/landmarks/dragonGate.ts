import { Group } from 'three';
import { Parts, type BuilderOptions } from './primitives';

// Chinatown Dragon Gate (the paifang at Grant Ave & Bush, gift of Taiwan, 1970): a three-bay gate with green
// glazed-tile roofs and upturned eaves, red pillars, gold accents and hanging red lanterns. Stylised, low-poly,
// vertex-coloured to match the other landmarks. Spans Grant Ave along local X; the street passes under it on Z.
const JADE = '#2f6b43', JADE_DK = '#1f4c30', RED = '#9c2b23', RED_LT = '#b8352a', GOLD = '#d7ad46',
  STONE = '#c9c2b0', STONE_DK = '#a79e88', LANTERN = '#c43527', INK = '#2a2420';

/** A single upturned-eave roof slab centred at (cx, baseY), spanning `span` in X and `depth` in Z. */
function roof(p: Parts, cx: number, baseY: number, span: number, depth: number, colour: string): void {
  const r = span / 2;
  // Two shallow slabs rising to a ridge, so the roof reads as a pitched green tile roof, not a flat lid.
  p.box([cx, baseY + 0.55, 0], [span + 1.4, 0.5, depth + 1.4], colour);                 // eave course (overhang)
  p.box([cx, baseY + 1.25, 0], [span + 0.2, 0.6, depth + 0.2], colour);                 // upper tier
  p.box([cx, baseY + 1.95, 0], [span * 0.6, 0.5, depth * 0.6], JADE_DK);                // ridge block
  p.box([cx, baseY + 2.35, 0], [span * 0.62, 0.22, 0.5], GOLD);                         // gold ridge cresting
  // Upturned eave tips at the four corners (the signature sweep-up), plus a gold bead on each.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    p.beam([cx + sx * (r + 0.4), baseY + 0.5, sz * (depth / 2 + 0.4)],
      [cx + sx * (r + 1.5), baseY + 1.7, sz * (depth / 2 + 1.1)], 0.42, colour);
    p.box([cx + sx * (r + 1.55), baseY + 1.85, sz * (depth / 2 + 1.15)], [0.5, 0.5, 0.5], GOLD);
  }
}

/** A hanging red lantern (barrel body, gold caps, tassel) with its top at (x, topY, z). */
function lantern(p: Parts, x: number, topY: number, z: number, scale = 1): void {
  p.box([x, topY + 0.1, z], [0.12, 0.6, 0.12], INK);                                    // cord
  p.cylinder([x, topY - 0.28, z], 0.16 * scale, 0.16 * scale, 0.14, GOLD, 8);           // top cap
  p.ellipsoid([x, topY - 0.78 * scale, z], [0.5 * scale, 0.56 * scale, 0.5 * scale], LANTERN, 0, 1); // body
  p.cylinder([x, topY - 1.28 * scale, z], 0.16 * scale, 0.16 * scale, 0.14, GOLD, 8);   // bottom cap
  p.box([x, topY - 1.6 * scale, z], [0.08, 0.5, 0.08], GOLD);                           // tassel
}

export function createDragonGate({ detail = 'near' }: BuilderOptions = {}): Group {
  const p = new Parts();
  // Four pillars (two tall central, two side) on stone plinths; the central bay is the tallest.
  const pillarsX = [-7.9, -2.9, 2.9, 7.9];
  for (const x of pillarsX) {
    const central = Math.abs(x) < 5;
    const h = central ? 9.6 : 8.2;
    p.box([x, 0.6, 0], [2.2, 1.2, 2.4], STONE_DK);        // plinth
    p.box([x, h / 2 + 1.1, 0], [1.4, h, 1.5], RED);       // shaft
    p.box([x, h + 1.1, 0], [1.9, 0.5, 2.0], GOLD);        // capital
  }
  // Red lintels / frieze beams across each bay, with a gold panel over the central bay (the name plaque).
  p.box([0, 9.0, 0], [6.2, 1.1, 1.3], RED_LT);            // central frieze
  p.box([0, 9.0, 0.75], [4.4, 0.8, 0.2], GOLD);          // central plaque face
  for (const cx of [-5.4, 5.4]) p.box([cx, 7.7, 0], [4.6, 0.9, 1.2], RED_LT); // side friezes
  // Three green upturned-eave roofs: side bays lower, central bay higher and larger.
  roof(p, -5.4, 8.2, 4.6, 2.6, JADE);
  roof(p, 5.4, 8.2, 4.6, 2.6, JADE);
  roof(p, 0, 10.1, 6.4, 3.2, JADE);
  // Hanging red lanterns: a pair in the central bay and one in each side bay (Grant Ave's lantern strings).
  lantern(p, -1.6, 8.6, 0, 1.15); lantern(p, 1.6, 8.6, 0, 1.15);
  lantern(p, -5.4, 7.3, 0, 1.0); lantern(p, 5.4, 7.3, 0, 1.0);
  // Guardian stone lions on plinths flanking the central opening.
  for (const sx of [-1, 1]) {
    p.box([sx * 4.3, 0.7, 1.6], [1.4, 1.4, 1.4], STONE_DK);                 // lion plinth
    p.ellipsoid([sx * 4.3, 1.9, 1.6], [0.6, 0.7, 0.9], STONE, 0, 1);        // body
    p.ellipsoid([sx * 4.3 + sx * 0.1, 2.7, 2.1], [0.5, 0.5, 0.5], STONE, 0, 1); // head
  }
  if (detail === 'near') {
    // Column banding and small gold bosses pick up the pillars at close range.
    for (const x of pillarsX) for (const y of [3.2, 5.4]) p.box([x, y, 0.78], [1.5, 0.22, 0.2], GOLD);
  }
  return p.finish('Chinatown Dragon Gate');
}
