import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { Parts, type BuilderOptions } from './primitives';

// The Powell & Market cable-car turntable (Hallidie Plaza) -- the wooden turntable where the single-ended Powell
// cable cars are pushed around by hand at the end of the line, one of the city's most-photographed spots. A circular
// timber turntable set in a dark pit, with a classic maroon-and-cream Powell car sitting on it. Built as the usual
// lit vertex-coloured mesh; the small "POWELL" roof board + headlight are a second UNLIT mesh so they read on HD and
// Low. The car points up Powell St (+X). No textures, no per-frame cost.
const MAROON = '#7c2b28', CREAM = '#e7dbc1', ROOF = '#5c2520', GLASS = '#2a3036',
  WOOD_DK = '#4b3826', METAL = '#3b3936', BOARD = '#f2ead4', LAMP = '#ffe9b0',
  // The turntable surface is rendered UNLIT (see below), so these are weathered wood/steel tones close to the road
  // grey -- a Low colour floor so the deck/ring read as a timber turntable, not a near-black disc, on the phone path.
  DECK = '#978e7e', DECK_SEAM = '#7e7565', STEEL_W = '#8e8c86', RAIL_W = '#9d9b95';

/** A stylised single-ended Powell cable car centred at origin, length along X, front (open grip) toward +X. */
function cableCar(p: Parts, face: Parts, y0: number): void {
  const L = 7.4, W = 2.3;
  // Lower maroon body (the enclosed cabin is the rear ~5 m; the front ~2 m is the open grip platform).
  p.box([-1.0, y0 + 0.75, 0], [5.2, 1.3, W], MAROON);                 // cabin lower body
  p.box([-1.0, y0 + 1.45, 0], [5.3, 0.3, W + 0.06], CREAM);           // waist rail
  p.box([-1.0, y0 + 2.1, 0], [5.0, 1.0, W - 0.1], GLASS);            // window band
  for (const x of [-3.4, -2.0, -0.6, 0.8]) p.box([x, y0 + 2.1, 0], [0.22, 1.05, W], CREAM); // window posts
  for (const z of [-1, 1]) p.box([-1.0, y0 + 2.1, z * (W / 2)], [5.0, 1.05, 0.12], CREAM);  // corner rails each side
  // Open front grip platform: floor, a maroon dash, and four cream posts carrying the roof.
  p.box([2.2, y0 + 0.5, 0], [2.0, 0.5, W], MAROON);                  // front floor/apron
  p.box([1.5, y0 + 1.3, 0], [0.3, 1.1, W], MAROON);                  // dash between cabin and platform
  for (const x of [0.9, 3.1]) for (const z of [-1, 1]) p.box([x, y0 + 2.0, z * (W / 2 - 0.1)], [0.16, 2.0, 0.16], CREAM);
  // Monitor (clerestory) roof over the whole car.
  p.box([0.0, y0 + 2.95, 0], [L, 0.28, W + 0.3], ROOF);
  p.box([-0.6, y0 + 3.25, 0], [L - 1.6, 0.4, W - 0.7], ROOF);        // raised center monitor
  // Running board, grab rails and the grip/brake levers in the open section.
  for (const z of [-1, 1]) p.box([0.0, y0 + 0.35, z * (W / 2 + 0.18)], [L - 0.4, 0.14, 0.3], WOOD_DK);
  for (const x of [2.0, 2.7]) p.box([x, y0 + 1.5, 0], [0.1, 1.4, 0.1], METAL); // grip + brake levers
  // Fenders/dashes both ends and small wheels peeking under the body.
  for (const x of [-3.7]) p.box([x, y0 + 1.1, 0], [0.3, 1.9, W], MAROON);       // rear dash
  for (const x of [-3.0, -0.2]) for (const z of [-1, 1]) p.cylinder([x, y0 + 0.2, z * (W / 2 - 0.2)], 0.3, 0.3, 0.2, METAL, 8);
  // Unlit: the "POWELL" roof destination board and a headlight, so they read on HD and Low.
  face.box([2.6, y0 + 2.75, 0], [0.12, 0.7, 1.7], BOARD);           // destination board (faces +X)
  face.box([3.3, y0 + 1.0, 0], [0.12, 0.35, 0.35], LAMP);          // headlight
}

export function createCablecarTurntable(_options: BuilderOptions = {}): Group {
  const lit = new Parts();
  // The turntable surface (pit ring, timber deck, plank seams, running rails, centre pivot) goes in the UNLIT mesh so
  // it keeps its weathered-grey colour on the phone/Low path instead of darkening to a near-black disc.
  const face = new Parts();
  face.cylinder([0, 0.12, 0], 6.1, 6.1, 0.3, STEEL_W, 40);          // pit ring (weathered steel)
  face.cylinder([0, 0.34, 0], 5.4, 5.4, 0.3, DECK, 40);            // timber turntable deck
  for (let i = 0; i < 24; i++) {                                     // radial plank seams
    const a = i / 24 * Math.PI * 2;
    face.box([Math.cos(a) * 2.7, 0.5, Math.sin(a) * 2.7], [5.0, 0.04, 0.12], DECK_SEAM, a);
  }
  for (const z of [-0.75, 0.75]) face.box([0, 0.52, z], [10.4, 0.1, 0.16], RAIL_W);  // the two running rails
  face.cylinder([0, 0.6, 0], 0.5, 0.5, 0.6, STEEL_W, 12);          // centre pivot hub
  cableCar(lit, face, 0.49);                                        // the car on the deck (body lit, signage unlit)
  const group = lit.finish('Powell & Market cable-car turntable');
  const fm = face.finish('cable-car turntable deck + signage');
  const mesh = fm.children[0] as Mesh | undefined;
  if (mesh) {
    (mesh.material as MeshLambertMaterial).dispose?.();
    mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    mesh.name = 'cable-car turntable deck geometry';
    group.add(mesh);
  }
  return group;
}
