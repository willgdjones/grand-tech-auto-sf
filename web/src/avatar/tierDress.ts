import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Box3, BoxGeometry, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshLambertMaterial, Quaternion, SkinnedMesh, Vector3, type Object3D } from 'three';
import { addCharacterNightFill } from '../render/characterNight';

/**
 * meshyTierDress (critique 20c, lane D): the prod player wears a Meshy body, whose clothes and face are baked, so the round
 * tier's fitted garment kit (appearance.ts, template body only) never shows and a round unlock changed nothing visible.
 * This dresses the SAME body (no swap: a different Meshy body is a different person) in a chunky tier garment that reads
 * at chase-camera distance on a phone: Seed = an open fleece vest; Series A = the vest in blazer navy with shirt lapels and a
 * watch; Series D+ = darker, plus a tie; Unicorn+ = gold watch. Sized from the posed body's height, attached rigidly to the
 * Chest bone (the arms swing outside it), authored in metres in the body's facing frame (+z forward, like appearance.ts).
 */
const TIERS: readonly { body: number; trim: number; lapel?: number; tie?: number; watch?: number }[] = [
  { body: 0, trim: 0 }, // Bootstrapping: no garment (the body's own clothes)
  { body: 0x26324a, trim: 0xd8d2c4 }, // Seed: navy fleece vest, light zip + hem
  { body: 0x1f2b45, trim: 0xe9e5da, lapel: 0xe9e5da, watch: 0xb9c2c6 }, // Series A: navy, shirt lapels, steel watch
  { body: 0x1a1d24, trim: 0xe9e5da, lapel: 0xe9e5da, tie: 0x8a2433, watch: 0xb9c2c6 }, // Series D: charcoal + tie
  { body: 0x14161b, trim: 0xf1ede2, lapel: 0xf1ede2, tie: 0x2a3d8f, watch: 0xd4af37 }, // Unicorn: gold watch
  { body: 0x0e0f12, trim: 0xf6f2e6, lapel: 0xf6f2e6, tie: 0xd4af37, watch: 0xd4af37 }, // Decacorn
];

export interface TierDress { apply(tier: number): void; setOpacity(opacity: number): void; dispose(): void }

/** Null when the figure has no Chest bone (not a hoodie-rig-named body). Call with the figure posed (mixer updated). */
export function createTierDress(figure: Object3D): TierDress | null {
  const chest = figure.getObjectByName('Chest'), wristL = figure.getObjectByName('Wrist.L');
  if (!chest) return null;
  figure.updateMatrixWorld(true);
  // Posed body height (skinned bounds, world metres).
  const bounds = new Box3();
  figure.traverse(node => {
    if (!(node instanceof SkinnedMesh)) return;
    node.skeleton.update(); node.computeBoundingBox();
    bounds.union(node.boundingBox!.clone().applyMatrix4(node.matrixWorld));
  });
  const height = Math.max(1.2, Math.min(2.2, bounds.max.y - bounds.min.y || 1.75));
  // Socket: world metres at the chest origin, axes = the figure's facing (no bone frame, no model scale).
  const facing = figure.getWorldQuaternion(new Quaternion());
  const socketFor = (bone: Object3D) => {
    const at = bone.getWorldPosition(new Vector3());
    const world = new Matrix4().compose(at, facing, new Vector3(1, 1, 1));
    const local = bone.matrixWorld.clone().invert().multiply(world), socket = new Group();
    local.decompose(socket.position, socket.quaternion, socket.scale); bone.add(socket); return socket;
  };
  const socket = socketFor(chest), wrist = wristL ? socketFor(wristL) : undefined;
  socket.name = 'tier-dress'; if (wrist) wrist.name = 'tier-dress-watch';
  const materials: MeshLambertMaterial[] = [];
  const material = (colour: number, vertexColors = false) => { const m = new MeshLambertMaterial({ color: colour, side: DoubleSide, vertexColors }); addCharacterNightFill(m); materials.push(m); return m; };
  let tier = -1, opacity = 1;
  const clear = () => {
    for (const group of [socket, wrist]) if (group) for (const child of group.children.slice()) { group.remove(child); (child as Mesh).geometry?.dispose(); }
    for (const m of materials.splice(0)) m.dispose();
  };
  // FITTED to this body (the first two passes were a box: inside the puffy bomber, then a rigid block at the hips). Sample the
  // posed (skinned) torso in the socket frame, take its outline in RINGS horizontal slices x SEG angle bins, and build a smooth
  // shell a little outside it: an open front, armholes in the top band, a contrasting edge trim and hem. +z is the body front.
  const k = height / 1.75, top = .40 * k, bottom = -.12 * k, margin = .018 * k, RINGS = 8, SEG = 28;
  socket.updateWorldMatrix(true, false);
  const toSocket = new Matrix4().copy(socket.matrixWorld).invert(), v = new Vector3();
  const samples: number[][] = Array.from({ length: RINGS }, () => []);
  figure.traverse(node => {
    if (!(node instanceof SkinnedMesh)) return;
    const count = node.geometry.getAttribute('position').count, stride = Math.max(1, Math.floor(count / 9000));
    for (let i = 0; i < count; i += stride) {
      node.getVertexPosition(i, v); v.applyMatrix4(node.matrixWorld).applyMatrix4(toSocket);
      if (Math.abs(v.x) > .26 * k) continue; // the arms hang further out
      const ring = Math.round((v.y - bottom) / (top - bottom) * (RINGS - 1));
      if (ring < 0 || ring >= RINGS || Math.abs(bottom + ring / (RINGS - 1) * (top - bottom) - v.y) > .04 * k) continue;
      samples[ring]!.push(v.x, v.z);
    }
  });
  const ringCentre: [number, number][] = [], ringRadius: number[][] = [];
  for (let ring = 0; ring < RINGS; ring++) {
    const pts = samples[ring]!; let cx = 0, cz = 0; const n = pts.length / 2;
    for (let i = 0; i < pts.length; i += 2) { cx += pts[i]!; cz += pts[i + 1]!; }
    cx = n ? cx / n : 0; cz = n ? cz / n : 0;
    const r = new Array<number>(SEG).fill(0);
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i]! - cx, dz = pts[i + 1]! - cz, a = (Math.atan2(dx, dz) + Math.PI * 2) % (Math.PI * 2);
      const bin = Math.floor(a / (Math.PI * 2) * SEG) % SEG; r[bin] = Math.max(r[bin]!, Math.hypot(dx, dz));
    }
    const fallback = Math.max(...r) || .15 * k;
    for (let j = 0; j < SEG; j++) if (!r[j]) r[j] = r[(j + SEG - 1) % SEG] || r[(j + 1) % SEG] || fallback; // fill gaps
    ringRadius.push(r.map((_, j) => (r[(j + SEG - 1) % SEG]! + 2 * r[j]! + r[(j + 1) % SEG]!) / 4 + margin)); // smooth
    ringCentre.push([cx, cz]);
  }
  const vertex = (ring: number, seg: number, out = 0) => {
    const a = seg / SEG * Math.PI * 2, r = ringRadius[ring]![seg % SEG]! + out, [cx, cz] = ringCentre[ring]!;
    return [cx + Math.sin(a) * r, bottom + ring / (RINGS - 1) * (top - bottom), cz + Math.cos(a) * r];
  };
  const armhole = (ring: number, seg: number) => { const a = (seg + .5) / SEG * Math.PI * 2; return ring >= RINGS - 4 && (Math.abs(a - Math.PI / 2) < .55 || Math.abs(a - Math.PI * 1.5) < .55); };
  // Indexed over a shared ring grid (seam duplicated), so the normals average across bins: smooth cloth, not facets.
  const strip = (keep: (ring: number, seg: number) => boolean, out: number) => {
    const positions: number[] = [], index: number[] = [];
    for (let ring = 0; ring < RINGS; ring++) for (let seg = 0; seg <= SEG; seg++) positions.push(...vertex(ring, seg, out));
    const at = (ring: number, seg: number) => ring * (SEG + 1) + seg;
    for (let ring = 0; ring < RINGS - 1; ring++) for (let seg = 0; seg < SEG; seg++) {
      if (!keep(ring, seg)) continue;
      index.push(at(ring, seg), at(ring, seg + 1), at(ring + 1, seg + 1), at(ring, seg), at(ring + 1, seg + 1), at(ring + 1, seg));
    }
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(positions, 3)); geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
  };
  // A flat strip down the body front (angle 0) from ring `from` to `to`: half-width per ring, pushed `out` beyond the shell.
  // Used for the zip, the shirt V under a blazer and the tie (the first look pass had an open front: it read as a jagged gap).
  const frontStrip = (from: number, to: number, halfWidth: (ring: number) => number, out: number) => {
    const positions: number[] = [], index: number[] = [];
    for (let ring = from; ring <= to; ring++) { const [x, y, z] = vertex(ring, 0, out), w = halfWidth(ring); positions.push(x! - w, y!, z!, x! + w, y!, z!); }
    for (let i = 0; i < to - from; i++) { const a = i * 2; index.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(positions, 3)); geometry.setIndex(index);
    geometry.computeVertexNormals(); return geometry;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new BoxGeometry(w, h, d).translate(x, y, z);
  return {
    apply(next) {
      const t = Math.max(0, Math.min(TIERS.length - 1, Math.trunc(next)));
      if (t === tier) return;
      tier = t; clear();
      const spec = TIERS[t]!;
      if (!spec.body) return;
      // Every chest part is merged into ONE mesh coloured per part (vertex colours): 1 draw per dressed avatar (+1 for a watch),
      // so a plaza of remote players in tier dress costs a draw each (reviewer 14:5x perf condition), not 3-5.
      const mid = Math.floor((RINGS - 1) / 2), parts: [BufferGeometry, number][] = [
        [strip((ring, seg) => !armhole(ring, seg), 0), spec.body],
        [strip((ring, seg) => ring === 0 && !armhole(ring, seg), .006 * k), spec.trim], // hem
        spec.lapel
          ? [frontStrip(mid, RINGS - 1, ring => .075 * k * (ring - mid) / (RINGS - 1 - mid) + .004 * k, .004 * k), spec.lapel] // shirt V
          : [frontStrip(0, RINGS - 1, () => .006 * k, .005 * k), spec.trim], // zip line
      ];
      if (spec.tie) parts.push([frontStrip(mid - 1, RINGS - 1, ring => ring >= RINGS - 2 ? .016 * k : .012 * k, .008 * k), spec.tie]);
      const colour = new Color();
      for (const [geometry, hex] of parts) {
        colour.set(hex); const n = geometry.getAttribute('position').count, colours = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) colours.set([colour.r, colour.g, colour.b], i * 3);
        geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
      }
      const merged = mergeGeometries(parts.map(([geometry]) => geometry), false);
      for (const [geometry] of parts) geometry.dispose();
      if (merged) { const vest = new Mesh(merged, material(0xffffff, true)); vest.name = 'tier-dress vest'; socket.add(vest); }
      if (spec.watch && wrist) { const watch = new Mesh(box(.07 * k, .03 * k, .07 * k, 0, 0, 0), material(spec.watch)); watch.name = 'tier-dress watch'; wrist.add(watch); }
      this.setOpacity(opacity);
    },
    setOpacity(value) {
      opacity = value;
      for (const m of materials) { const transparent = value < .999; if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; } m.opacity = value; m.depthWrite = !transparent; }
    },
    dispose() { clear(); socket.removeFromParent(); wrist?.removeFromParent(); },
  };
}
