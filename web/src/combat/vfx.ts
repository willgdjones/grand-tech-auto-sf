import * as THREE from 'three';
import type { ShotEvent } from './fire';

// Combat visuals (GTA-pivot lane A #6) — the gunfire the combat system reports via deps.fire.onShot:
// muzzle flash + flash light, tracer, impact sparks + dust, and (behind the gore gate) a blood spray +
// decal. Everything is pooled and advanced in one update(dt); onShot allocates nothing. Blood is gated
// by `isGore()` (flags.gore + the player's gore toggle); with it false there is no blood path at all.

const v = new THREE.Vector3(), v2 = new THREE.Vector3(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);

/** Soft round sprite texture (muzzle flash core, dust, decal splat), generated once — no fetch. */
function discTexture(inner: string, outer: string): THREE.CanvasTexture {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const ctx = c.getContext('2d')!, g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, inner); g.addColorStop(0.55, outer); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}

export interface CombatVfx {
  onShot(shot: ShotEvent): void;
  update(dt: number): void;
  dispose(): void;
}

/**
 * Mount combat VFX into `scene`. `onShot` draws the shot; `update(dt)` fades everything. `isGore()` gates
 * the blood (default never). Pools are sized for sustained auto fire without per-shot allocation.
 */
export function createCombatVfx(opts: { scene: THREE.Scene; camera: THREE.Camera; isGore?: () => boolean }): CombatVfx {
  const { scene, camera } = opts;
  const isGore = opts.isGore ?? (() => false);
  const group = new THREE.Group(); group.name = 'GTASF combat VFX'; group.renderOrder = 8; scene.add(group);

  const flashTex = discTexture('rgba(255,248,210,1)', 'rgba(255,170,40,0.7)');
  const dustTex = discTexture('rgba(190,185,175,0.9)', 'rgba(150,145,135,0.35)');
  const bloodTex = discTexture('rgba(150,0,0,0.95)', 'rgba(90,0,0,0.6)');

  // Muzzle flashes: additive sprites + one shared flash light.
  const flashes = Array.from({ length: 6 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    s.visible = false; s.renderOrder = 9; group.add(s); return { s, life: 0 };
  });
  // gtasf-0qct5: the light stays VISIBLE (intensity 0 when idle). Toggling .visible per shot changed the scene's point-light
  // count, which bumps three.js's lights-state version: every lit material re-resolves its program (and compiles new
  // variants) on each muzzle flash, and SFPD shots go through here too, so the cost scaled with the number of police.
  const flashLight = new THREE.PointLight(0xffd27a, 0, 6, 2); group.add(flashLight);
  let flashLightLife = 0;

  // Tracers: a bright, slightly thick additive streak — a stretched box, since WebGL ignores line width.
  const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  const tracers = Array.from({ length: 14 }, () => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff4c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const mesh = new THREE.Mesh(tracerGeo, mat); mesh.frustumCulled = false; mesh.visible = false; group.add(mesh); return { mesh, mat, life: 0 };
  });

  // Sparks + blood spray share one Points cloud (one draw call), colour-coded per particle.
  const MAX = 320;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX * 3), pCol = new Float32Array(MAX * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pVel = new Float32Array(MAX * 3), pLife = new Float32Array(MAX), pMax = new Float32Array(MAX);
  // A soft round sprite per particle (without a map, WebGL points draw as screen-aligned SQUARES, which read as pink
  // confetti tiles around every hit in the #7 evidence). Additive stays: dead particles fade to black and vanish.
  const pointTex = discTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.55)');
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.16, map: pointTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95, sizeAttenuation: true }));
  points.frustumCulled = false; group.add(points); let pHead = 0;
  function emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, life: number): void {
    const i = pHead; pHead = (pHead + 1) % MAX;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
    pCol[i * 3] = r; pCol[i * 3 + 1] = g; pCol[i * 3 + 2] = b; pLife[i] = pMax[i] = life;
  }

  // Dust puffs (billboard sprites) + blood decals (flat quads laid on the hit surface).
  const dust = Array.from({ length: 10 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; group.add(s); return { s, life: 0 }; });
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  const decals = Array.from({ length: 16 }, () => { const m = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({ map: bloodTex, transparent: true, depthWrite: false, opacity: 0, color: 0x8a0000 })); m.visible = false; m.renderOrder = 7; group.add(m); return { m, life: 0, max: 1 }; });

  function spawnImpact(to: [number, number, number], normal?: [number, number, number]): void {
    const [x, y, z] = to;
    const nx = normal?.[0] ?? 0, ny = normal?.[1] ?? 1, nz = normal?.[2] ?? 0;
    // Sparks: a tight cone off the surface normal, warm orange-white, gravity in update.
    for (let i = 0; i < 10; i++) {
      const sx = nx + (Math.random() - 0.5) * 1.3, sy = ny + (Math.random() - 0.5) * 1.3 + 0.4, sz = nz + (Math.random() - 0.5) * 1.3;
      const sp = 2.5 + Math.random() * 3.5;
      emit(x, y, z, sx * sp, sy * sp, sz * sp, 1, 0.75 + Math.random() * 0.25, 0.35, 0.18 + Math.random() * 0.14);
    }
    // Dust puff at the impact.
    const d = (dust.find(e => e.life <= 0) ?? dust[0])!;
    d.s.position.set(x + nx * 0.1, y + ny * 0.1, z + nz * 0.1); d.s.scale.setScalar(0.35); d.s.visible = true;
    (d.s.material as THREE.SpriteMaterial).opacity = 0.5; d.life = 0.5;
  }

  function spawnBlood(to: [number, number, number], normal?: [number, number, number]): void {
    if (!isGore()) return;
    const [x, y, z] = to;
    const nx = normal?.[0] ?? 0, ny = normal?.[1] ?? 1, nz = normal?.[2] ?? 0;
    // Spray: a mist of dark-red droplets thrown back along the shot (−normal) + sideways, with gravity.
    for (let i = 0; i < 16; i++) {
      const sp = 1.8 + Math.random() * 3;
      emit(x, y, z, (-nx + (Math.random() - 0.5) * 1.6) * sp, (Math.random() * 1.1 + 0.3) * sp, (-nz + (Math.random() - 0.5) * 1.6) * sp,
        0.5 + Math.random() * 0.3, 0.02, 0.02, 0.3 + Math.random() * 0.4);
    }
    // Decal: a splat laid flat against the hit surface (oriented by the normal), slow fade.
    const dec = (decals.find(e => e.life <= 0) ?? decals[0])!;
    v.set(nx, ny, nz).normalize(); q.setFromUnitVectors(UP, v.lengthSq() > 0.001 ? v : UP);
    dec.m.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    dec.m.position.set(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02);
    const sc = 0.5 + Math.random() * 0.6; dec.m.scale.set(sc, sc, sc); dec.m.visible = true;
    (dec.m.material as THREE.MeshBasicMaterial).opacity = 0.9; dec.life = dec.max = 7;
  }

  function onShot(shot: ShotEvent): void {
    const [fx, fy, fz] = shot.from;
    if (!shot.weapon.melee) {
      // Muzzle flash sprite + a one-frame flash light.
      const f = (flashes.find(e => e.life <= 0) ?? flashes[0])!;
      f.s.position.set(fx, fy, fz); f.s.scale.setScalar(0.55 + Math.random() * 0.25); f.s.material.rotation = Math.random() * Math.PI;
      f.s.visible = true; (f.s.material as THREE.SpriteMaterial).opacity = 1; f.life = 0.07;
      flashLight.position.set(fx, fy, fz); flashLight.intensity = 3.2; flashLightLife = 0.05;
      // Tracer.
      const t = (tracers.find(e => e.life <= 0) ?? tracers[0])!;
      const [tx, ty, tz] = shot.to, len = Math.hypot(tx - fx, ty - fy, tz - fz) || 1;
      t.mesh.position.set((fx + tx) / 2, (fy + ty) / 2, (fz + tz) / 2);
      t.mesh.scale.set(0.06, 0.06, len); t.mesh.lookAt(tx, ty, tz);
      t.mesh.visible = true; t.mat.opacity = 1; t.life = 0.075;
    }
    if (shot.hit) { spawnImpact(shot.to, shot.normal); spawnBlood(shot.to, shot.normal); }
  }

  function update(dt: number): void {
    const d = Math.min(0.05, Math.max(0, dt));
    for (const f of flashes) if (f.life > 0) { f.life -= d; const m = f.s.material as THREE.SpriteMaterial; m.opacity = Math.max(0, f.life / 0.07); if (f.life <= 0) f.s.visible = false; }
    if (flashLightLife > 0) { flashLightLife -= d; flashLight.intensity = Math.max(0, flashLightLife / 0.05) * 3.2; }
    for (const t of tracers) if (t.life > 0) { t.life -= d; t.mat.opacity = Math.max(0, t.life / 0.075); if (t.life <= 0) t.mesh.visible = false; }
    for (const e of dust) if (e.life > 0) { e.life -= d; const m = e.s.material as THREE.SpriteMaterial; m.opacity = Math.max(0, e.life / 0.5) * 0.5; e.s.scale.setScalar(0.35 + (0.5 - e.life) * 1.2); if (e.life <= 0) e.s.visible = false; }
    for (const e of decals) if (e.life > 0) { e.life -= d; const k = e.life / e.max; (e.m.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, k * 2) * 0.9; if (e.life <= 0) e.m.visible = false; }
    // Particles: integrate velocity + gravity, fade colour to black, hide dead ones at the origin.
    let any = false;
    for (let i = 0; i < MAX; i++) {
      let life = pLife[i]!;
      if (life <= 0) continue;
      any = true; life -= d; pLife[i] = life;
      const b = i * 3;
      if (life <= 0) { pPos[b] = pPos[b + 1] = pPos[b + 2] = 1e6; continue; }
      pVel[b + 1] = pVel[b + 1]! - 9.8 * d; // gravity
      pPos[b] = pPos[b]! + pVel[b]! * d; pPos[b + 1] = pPos[b + 1]! + pVel[b + 1]! * d; pPos[b + 2] = pPos[b + 2]! + pVel[b + 2]! * d;
      const k = life / pMax[i]!; pCol[b] = pCol[b]! * (0.92 + 0.08 * k); pCol[b + 1] = pCol[b + 1]! * 0.9; pCol[b + 2] = pCol[b + 2]! * 0.9;
    }
    (points.material as THREE.PointsMaterial).opacity = any ? 0.95 : 0;
    // Idle (no live particle): skip the draw and the per-frame re-upload of both buffers (lane B draw-call sweep, 10-19 —
    // this was the only drawn-but-invisible object left in the Ferry scene). The frame the last particle dies still uploads.
    points.visible = any;
    if (any) {
      (pGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (pGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
    void camera;
  }

  return {
    onShot, update,
    dispose(): void {
      scene.remove(group);
      flashTex.dispose(); dustTex.dispose(); bloodTex.dispose(); pointTex.dispose(); decalGeo.dispose(); pGeo.dispose();
      for (const f of flashes) f.s.material.dispose();
      tracerGeo.dispose(); for (const t of tracers) t.mat.dispose();
      for (const e of dust) e.s.material.dispose();
      for (const e of decals) (e.m.material as THREE.Material).dispose();
      (points.material as THREE.Material).dispose();
    },
  };
}
