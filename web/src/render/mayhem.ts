import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, Group,
  InstancedBufferAttribute, InstancedMesh, LinearFilter, Matrix4, MeshBasicMaterial, PlaneGeometry, Points, PointsMaterial,
  Quaternion, SRGBColorSpace, Texture, Vector3, type Object3D,
} from 'three';
import {
  MAX_SPLAT_DECALS, MAYHEM_DEFAULT_COLOUR, SPLAT_FADE_MS, type MayhemFireEvent,
} from '@gtasf/shared/content/mayhem';

/*
 * Playful Mayhem renderer (PLAN-v2.1, gtasf-mayhem-render-dd3w, flags.playfulMayhem). Consumes the
 * controller/sync fire events (shared/content/mayhem.ts MayhemFireEvent) and draws the cosmetic payoff:
 *  - paintball -> a logo-colour SPLAT DECAL on the hit surface, fading over SPLAT_FADE_MS (~3 min),
 *    capped at MAX_SPLAT_DECALS (oldest recycled) for the phone budget.
 *  - confetti  -> a festive multi-colour particle burst (round close / event crowd).
 *  - water     -> a blue splash burst where the balloon lands.
 * Pooled + flat-shaded + additive particles, modelled on props/waterSpray.ts; nothing moves when idle,
 * so the cost is ~zero until something fires. World-space in v1 (targetId sticking is a follow-up).
 */

const UP = new Vector3(0, 1, 0), FWD = new Vector3(0, 0, 1);
const CONFETTI_COLOURS = [0xff2d7a, 0xffd23f, 0x5ab6ff, 0x4ade80, 0xa855f7, 0xff8c42];

type Burst = { points: Points; vel: Float32Array; life: number; maxLife: number; gravity: number; drops: number };

export interface MayhemEffects {
  /** Draw the payoff for one fired toy (world-space). Unknown items are ignored. */
  fire(event: MayhemFireEvent): void;
  /** Advance decal fades + particle bursts by dt seconds and recycle expired ones. */
  update(dtSeconds: number): void;
  readonly stats: { readonly decals: number; readonly bursts: number };
  dispose(): void;
}

/** Orient a plane (default facing +Z) onto a surface normal; lies flat (face +Y) when none is given. */
function orient(q: Quaternion, normal: readonly [number, number, number] | undefined): Vector3 {
  if (normal) { const n = new Vector3(normal[0], normal[1], normal[2]); if (n.lengthSq() < 1e-6) n.copy(UP); else n.normalize(); q.setFromUnitVectors(FWD, n); return n; }
  q.setFromUnitVectors(FWD, UP); return UP.clone();
}

export function createMayhemEffects(parent: Object3D, options: { low?: boolean } = {}): MayhemEffects {
  const low = options.low ?? false;
  const group = new Group(); group.name = 'Playful Mayhem'; parent.add(group);

  // --- Splat decals (gtasf founder 'painting feels blocky'): ONE instanced draw over a procedural splat atlas.
  // Each instance picks one of ATLAS_CELLS irregular splats (lobes, satellite droplets, drips, soft alpha edge),
  // its own paint colour, size and fade. Wall splats keep their drips pointing down; floor splats spin freely.
  const maxDecals = Math.min(MAX_SPLAT_DECALS, low ? 28 : MAX_SPLAT_DECALS);
  const atlas = createSplatAtlas(low ? 128 : 256);
  const decalGeometry = new PlaneGeometry(1, 1);
  const cellAttr = new InstancedBufferAttribute(new Float32Array(maxDecals), 1);
  const fadeAttr = new InstancedBufferAttribute(new Float32Array(maxDecals), 1).setUsage(DynamicDrawUsage);
  decalGeometry.setAttribute('splatCell', cellAttr); decalGeometry.setAttribute('splatFade', fadeAttr);
  const decalMaterial = new MeshBasicMaterial({ map: atlas, transparent: true, depthWrite: false, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, alphaTest: .02 });
  decalMaterial.customProgramCacheKey = () => 'gtasf-paint-splat-v1';
  decalMaterial.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float splatCell; attribute float splatFade; varying float vSplatFade;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
      vMapUv = (uv + vec2(mod(splatCell, ${ATLAS_COLS}.0), floor(splatCell / ${ATLAS_COLS}.0))) / vec2(${ATLAS_COLS}.0, ${ATLAS_ROWS}.0);
      vSplatFade = splatFade;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSplatFade;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      // Wet paint: the atlas alpha is the splat shape; its luminance carries a little thickness shading.
      diffuseColor.a *= vSplatFade;`);
  };
  const decalMesh = new InstancedMesh(decalGeometry, decalMaterial, maxDecals);
  decalMesh.instanceMatrix.setUsage(DynamicDrawUsage); decalMesh.frustumCulled = false; decalMesh.renderOrder = 3; decalMesh.count = maxDecals;
  decalMesh.name = 'Paint splats'; group.add(decalMesh);
  const hidden = new Matrix4().makeScale(0, 0, 0), tmpColour = new Color(1, 1, 1);
  const decals = Array.from({ length: maxDecals }, () => ({ age: 0, life: SPLAT_FADE_MS / 1000, active: false }));
  for (let i = 0; i < maxDecals; i++) { decalMesh.setMatrixAt(i, hidden); decalMesh.setColorAt(i, tmpColour); }
  const decalQuat = new Quaternion(), spin = new Quaternion(), place = new Matrix4(), pos = new Vector3(), scl = new Vector3();
  let decalsDirty = false;
  function splat(at: readonly [number, number, number], colour: number, normal: readonly [number, number, number] | undefined, size = 1): void {
    // Prefer a free decal; otherwise recycle the oldest live one (keeps us inside MAX_SPLAT_DECALS).
    let index = decals.findIndex(d => !d.active);
    if (index < 0) index = decals.reduce((o, d, i) => (d.age > decals[o]!.age ? i : o), 0);
    const n = orient(decalQuat, normal);
    // On walls, roll the splat so the atlas' "down" (drips) follows world -Y; floors get a random spin.
    let roll = Math.random() * Math.PI * 2;
    if (Math.abs(n.y) < .7) {
      const down = new Vector3(0, -1, 0).projectOnPlane(n).normalize(), localDown = new Vector3(0, -1, 0).applyQuaternion(decalQuat);
      roll = Math.atan2(new Vector3().crossVectors(localDown, down).dot(n), localDown.dot(down)) + (Math.random() - .5) * .35;
    }
    spin.setFromAxisAngle(FWD, roll); decalQuat.multiply(spin);
    const scale = (1.3 + Math.random() * 1.1) * size; // size variation; readable from across the plaza
    pos.set(at[0] + n.x * 0.02, at[1] + n.y * 0.02, at[2] + n.z * 0.02); scl.set(scale, scale, 1);
    decalMesh.setMatrixAt(index, place.compose(pos, decalQuat, scl));
    decalMesh.setColorAt(index, tmpColour.set(colour));
    cellAttr.setX(index, Math.floor(Math.random() * ATLAS_COLS * ATLAS_ROWS)); fadeAttr.setX(index, 1);
    decals[index]!.age = 0; decals[index]!.active = true;
    cellAttr.needsUpdate = true; decalMesh.instanceColor!.needsUpdate = true; decalsDirty = true;
    hitBurst(at, colour, n);
  }

  // --- Particle bursts: confetti (multi-colour, long flutter) + water (blue splash). ---
  const confettiMat = new PointsMaterial({ size: low ? 0.16 : 0.2, vertexColors: true, transparent: true, opacity: 1, depthWrite: false });
  const waterMat = new PointsMaterial({ color: 0x9fd8ff, size: 0.1, transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending });
  function makePool(count: number, drops: number, maxLife: number, gravity: number, material: PointsMaterial, coloured: boolean): Burst[] {
    const pool: Burst[] = [];
    for (let i = 0; i < count; i++) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(drops * 3), 3));
      if (coloured) geometry.setAttribute('color', new BufferAttribute(new Float32Array(drops * 3), 3));
      const points = new Points(geometry, material); points.visible = false; points.frustumCulled = false;
      group.add(points); pool.push({ points, vel: new Float32Array(drops * 3), life: 0, maxLife, gravity, drops });
    }
    return pool;
  }
  const confetti = makePool(low ? 3 : 5, low ? 28 : 54, 2.6, 3.2, confettiMat, true);
  const water = makePool(low ? 2 : 4, 14, 0.8, 9, waterMat, false);
  // Short paint-droplet spray on every paintball hit, flung off the surface (juicier hit).
  const dropletMat = new PointsMaterial({ size: low ? 0.09 : 0.07, vertexColors: true, transparent: true, opacity: 1, depthWrite: false });
  const droplets = makePool(low ? 3 : 6, low ? 10 : 18, 0.45, 9, dropletMat, true);
  function hitBurst(at: readonly [number, number, number], colour: number, n: Vector3): void {
    const b = droplets.find(p => p.life <= 0); if (!b) return;
    b.life = b.maxLife; b.points.position.set(at[0] + n.x * .05, at[1] + n.y * .05, at[2] + n.z * .05); b.points.visible = true;
    const p = b.points.geometry.getAttribute('position') as BufferAttribute, c = b.points.geometry.getAttribute('color') as BufferAttribute;
    scratch.set(colour);
    for (let i = 0; i < b.drops; i++) {
      p.setXYZ(i, 0, 0, 0);
      const r = new Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(4).addScaledVector(n, 2 + Math.random() * 2.5);
      b.vel[i * 3] = r.x; b.vel[i * 3 + 1] = r.y; b.vel[i * 3 + 2] = r.z; c.setXYZ(i, scratch.r, scratch.g, scratch.b);
    }
    p.needsUpdate = true; c.needsUpdate = true;
  }
  const scratch = new Color();

  function burst(pool: Burst[], at: readonly [number, number, number], colour: number | undefined): void {
    const b = pool.find(p => p.life <= 0);
    if (!b) return;
    b.life = b.maxLife; b.points.position.set(at[0], at[1], at[2]); b.points.visible = true;
    const pos = b.points.geometry.getAttribute('position') as BufferAttribute;
    const col = b.points.geometry.getAttribute('color') as BufferAttribute | undefined;
    for (let i = 0; i < b.drops; i++) {
      pos.setXYZ(i, 0, 0, 0);
      const angle = Math.random() * Math.PI * 2, out = 0.6 + Math.random() * 1.8, up = 2.4 + Math.random() * 3.2;
      b.vel[i * 3] = Math.cos(angle) * out; b.vel[i * 3 + 1] = up; b.vel[i * 3 + 2] = Math.sin(angle) * out;
      if (col) { scratch.set(colour ?? CONFETTI_COLOURS[i % CONFETTI_COLOURS.length]!); col.setXYZ(i, scratch.r, scratch.g, scratch.b); }
    }
    pos.needsUpdate = true; if (col) col.needsUpdate = true;
  }

  function stepBursts(pool: Burst[], material: PointsMaterial, dt: number): void {
    let anyLive = false, minLifeFrac = 1;
    for (const b of pool) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.points.visible = false; continue; }
      anyLive = true; minLifeFrac = Math.min(minLifeFrac, b.life / b.maxLife);
      const pos = b.points.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < b.drops; i++) {
        const vy = (b.vel[i * 3 + 1] ?? 0) - b.gravity * dt; b.vel[i * 3 + 1] = vy;
        pos.setXYZ(i, pos.getX(i) + (b.vel[i * 3] ?? 0) * dt, pos.getY(i) + vy * dt, pos.getZ(i) + (b.vel[i * 3 + 2] ?? 0) * dt);
      }
      pos.needsUpdate = true;
    }
    if (anyLive) material.opacity = Math.max(0, Math.min(1, minLifeFrac * 1.6)); // fade the burst out near end of life
  }

  return {
    fire(event) {
      const colour = event.colour ?? MAYHEM_DEFAULT_COLOUR[event.item];
      if (event.item === 'paintball') splat(event.at, colour, event.normal, event.size);
      else if (event.item === 'confetti') burst(confetti, event.at, event.colour);
      else if (event.item === 'water') { burst(water, event.at, undefined); if (event.normal) splat(event.at, 0x6fc3ff, event.normal); }
    },
    update(dtSeconds) {
      const dt = Math.max(0, Math.min(dtSeconds, 0.1));
      decals.forEach((d, i) => {
        if (!d.active) return;
        d.age += dt;
        if (d.age >= d.life) { d.active = false; decalMesh.setMatrixAt(i, hidden); fadeAttr.setX(i, 0); decalsDirty = true; return; }
        const f = 1 - d.age / d.life, fade = f < 0.25 ? f / 0.25 : 1; // hold, then fade the last quarter
        if (fade !== fadeAttr.getX(i)) { fadeAttr.setX(i, fade); fadeAttr.needsUpdate = true; }
      });
      if (decalsDirty) { decalMesh.instanceMatrix.needsUpdate = true; fadeAttr.needsUpdate = true; decalsDirty = false; }
      stepBursts(droplets, dropletMat, dt);
      stepBursts(confetti, confettiMat, dt);
      stepBursts(water, waterMat, dt);
    },
    get stats() {
      return { decals: decals.reduce((n, d) => n + (d.active ? 1 : 0), 0), bursts: confetti.concat(water, droplets).reduce((n, b) => n + (b.life > 0 ? 1 : 0), 0) };
    },
    dispose() {
      decalMaterial.dispose(); atlas.dispose(); decalMesh.dispose();
      decalGeometry.dispose();
      for (const b of confetti.concat(water, droplets)) b.points.geometry.dispose();
      confettiMat.dispose(); waterMat.dispose(); dropletMat.dispose();
      parent.remove(group);
    },
  };
}

const ATLAS_COLS = 4, ATLAS_ROWS = 2;
/** Procedural paint-splat atlas (white shapes, alpha = coverage): irregular lobed blob, satellite droplets and
 *  1-3 drips running toward the bottom of the cell. Generated once; deterministic per cell. */
function createSplatAtlas(cell: number): Texture {
  if (typeof document === 'undefined') return new Texture(); // headless/unit runs: shape-less but valid
  const canvas = document.createElement('canvas'); canvas.width = cell * ATLAS_COLS; canvas.height = cell * ATLAS_ROWS;
  const g = canvas.getContext('2d')!;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let k = 0; k < ATLAS_COLS * ATLAS_ROWS; k++) {
    const ox = (k % ATLAS_COLS) * cell, oy = Math.floor(k / ATLAS_COLS) * cell, cx = ox + cell / 2, cy = oy + cell * .44, r = cell * .24;
    g.save(); g.beginPath(); g.rect(ox, oy, cell, cell); g.clip();
    g.shadowColor = 'rgba(255,255,255,1)'; g.shadowBlur = cell * .02; g.fillStyle = '#ffffff';
    // Main blob: a noisy radial outline with a few lobes.
    g.beginPath();
    const lobes = 5 + Math.floor(rnd() * 4), phase = rnd() * 6.28;
    for (let i = 0; i <= 48; i++) {
      const a = i / 48 * Math.PI * 2;
      const rr = r * (0.78 + .22 * Math.sin(a * lobes + phase) + (rnd() - .5) * .18);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath(); g.fill();
    // Splash arms + satellite droplets.
    for (let i = 0, arms = 4 + Math.floor(rnd() * 5); i < arms; i++) {
      const a = rnd() * Math.PI * 2, d = r * (1.05 + rnd() * .75), s = cell * (.012 + rnd() * .035);
      g.beginPath(); g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s * 1.4, s, a, 0, Math.PI * 2); g.fill();
      if (rnd() < .6) { g.beginPath(); g.arc(cx + Math.cos(a) * d * 1.25, cy + Math.sin(a) * d * 1.25, s * .55, 0, Math.PI * 2); g.fill(); }
    }
    // Drips running down (+y in canvas = cell bottom = world down on walls).
    for (let i = 0, drips = 1 + Math.floor(rnd() * 3); i < drips; i++) {
      const x = cx + (rnd() - .5) * r * 1.3, w = cell * (.018 + rnd() * .02), len = cell * (.12 + rnd() * .2), top = cy + r * .5;
      g.beginPath(); g.moveTo(x - w, top); g.lineTo(x - w * .8, top + len); g.arc(x, top + len, w * 1.15, Math.PI, 0, true); g.lineTo(x + w, top); g.closePath(); g.fill();
    }
    g.restore();
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter; texture.magFilter = LinearFilter; texture.generateMipmaps = false;
  return texture;
}
