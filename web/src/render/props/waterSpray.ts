import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, PointsMaterial, type Object3D } from 'three';

/**
 * Brief water-spray bursts for toppled hydrants (gtasf-arcade-props-knockover-30v0). A small pool of
 * droplet Points clouds; burst() launches one upward+outward from a point, update() lets them arc and
 * fall under gravity for ~0.8s, then recycles it. Purely cosmetic and cheap (only active bursts move,
 * usually zero). Ships behind flags.propKnockover with the rest of the knock-over feature.
 */
const DROPS = 14;     // droplets per burst
const LIFE = 0.8;     // seconds a burst lives
const GRAVITY = 9;    // m/s^2 pulling droplets back down

type Spray = { points: Points; vel: Float32Array; life: number };

export interface WaterSpray {
  /** Launch a burst from (x,y,z) if a pooled spray is free; no-op when all are busy. */
  burst(x: number, y: number, z: number): void;
  /** Advance all active bursts by dt seconds and recycle expired ones. */
  update(dtSeconds: number): void;
  readonly activeCount: number;
  destroy(): void;
}

export function createWaterSpray(parent: Object3D, pool = 6): WaterSpray {
  const material = new PointsMaterial({ color: 0xbfe3ff, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending });
  const sprays: Spray[] = [];
  for (let i = 0; i < pool; i++) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(DROPS * 3), 3));
    const points = new Points(geometry, material);
    points.visible = false; points.frustumCulled = false;
    parent.add(points);
    sprays.push({ points, vel: new Float32Array(DROPS * 3), life: 0 });
  }
  return {
    burst(x, y, z) {
      const spray = sprays.find((s) => s.life <= 0);
      if (!spray) return;
      spray.life = LIFE;
      spray.points.position.set(x, y, z);
      spray.points.visible = true;
      const pos = spray.points.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < DROPS; i++) {
        pos.setXYZ(i, 0, 0, 0);
        const angle = Math.random() * Math.PI * 2, out = 0.6 + Math.random() * 1.4, up = 2.2 + Math.random() * 2.6;
        spray.vel[i * 3] = Math.cos(angle) * out; spray.vel[i * 3 + 1] = up; spray.vel[i * 3 + 2] = Math.sin(angle) * out;
      }
      pos.needsUpdate = true;
    },
    update(dtSeconds) {
      const dt = Math.max(0, Math.min(dtSeconds, 0.1));
      for (const spray of sprays) {
        if (spray.life <= 0) continue;
        spray.life -= dt;
        if (spray.life <= 0) { spray.points.visible = false; continue; }
        const pos = spray.points.geometry.getAttribute('position') as BufferAttribute;
        for (let i = 0; i < DROPS; i++) {
          const vy = (spray.vel[i * 3 + 1] ?? 0) - GRAVITY * dt;
          spray.vel[i * 3 + 1] = vy;
          pos.setXYZ(i, pos.getX(i) + (spray.vel[i * 3] ?? 0) * dt, pos.getY(i) + vy * dt, pos.getZ(i) + (spray.vel[i * 3 + 2] ?? 0) * dt);
        }
        pos.needsUpdate = true;
      }
    },
    get activeCount() { return sprays.reduce((n, s) => n + (s.life > 0 ? 1 : 0), 0); },
    destroy() {
      for (const spray of sprays) { parent.remove(spray.points); spray.points.geometry.dispose(); }
      material.dispose();
    },
  };
}
