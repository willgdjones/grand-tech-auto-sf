// GTA V pivot — LANE B driving feel (flag drivingFeel, critique #10): tyre smoke + skid marks for the car you drive.
// Skids = a ring buffer of soft dark decals (one InstancedMesh, one draw call) laid at both rear wheels every ~0.3 m
// while the car slides or brakes hard; they fade out over their last quarter of life. Smoke = a small pool of
// camera-facing puffs (Sprites sharing one radial-gradient texture) that rise, grow and fade. All pooled: nothing
// is allocated per frame, and the meshes are hidden when idle.
import * as THREE from 'three';

const MARKS = 320, MARK_LIFE_S = 14, MARK_SPACING_M = 0.3, MARK_LENGTH_M = 0.42, MARK_WIDTH_M = 0.24;
const PUFFS = 28, PUFF_LIFE_S = 1.1, PUFF_EVERY_S = 0.05;

function radialTexture(inner: string, outer: string, size = 64): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!, grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface SkidInput {
  x: number; y: number; z: number; yaw: number;
  /** True while the tyres are sliding (handbrake drift / hard braking) and on the ground. */
  sliding: boolean;
  /** 0..1 how hard (scales smoke density). */
  intensity: number;
  heightAt(x: number, z: number): number | null;
}

export function createSkids(scene: THREE.Scene, options: { halfTrackM?: number; rearOffsetM?: number } = {}) {
  const halfTrack = options.halfTrackM ?? 0.78, rear = options.rearOffsetM ?? 1.3;
  // Skid decals: a flat quad, darker in the middle, soft at the edges.
  const markTexture = radialTexture('rgba(20,20,20,0.85)', 'rgba(20,20,20,0)');
  const markGeometry = new THREE.PlaneGeometry(MARK_WIDTH_M, MARK_LENGTH_M); markGeometry.rotateX(-Math.PI / 2);
  const markMaterial = new THREE.MeshBasicMaterial({ map: markTexture, transparent: true, depthWrite: false, opacity: 0.7,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const marks = new THREE.InstancedMesh(markGeometry, markMaterial, MARKS);
  marks.frustumCulled = false; marks.count = 0; marks.visible = false; marks.renderOrder = 1;
  const born = new Float32Array(MARKS).fill(-Infinity), scaleOf = new Float32Array(MARKS);
  const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let next = 0, used = 0, lastX = NaN, lastZ = NaN;
  scene.add(marks);

  // Smoke puffs.
  const smokeTexture = radialTexture('rgba(235,235,235,0.9)', 'rgba(235,235,235,0)');
  const puffs = Array.from({ length: PUFFS }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, depthWrite: false, opacity: 0 }));
    sprite.visible = false; scene.add(sprite);
    return { sprite, age: Infinity, vx: 0, vz: 0 };
  });
  let puffNext = 0, puffClock = 0, time = 0;
  // Read-only counters for the in-game evidence harness (tools/_drive-feel-check.mjs): marks laid / puffs emitted.
  const stats = { marks: 0, puffs: 0 }; (globalThis as { __gtasfSkids?: typeof stats }).__gtasfSkids = stats;

  function lay(x: number, z: number, y: number, yaw: number): void {
    pos.set(x, y + 0.03, z); quat.setFromAxisAngle(up, yaw); scl.set(1, 1, 1);
    matrix.compose(pos, quat, scl); marks.setMatrixAt(next, matrix); born[next] = time; scaleOf[next] = 1;
    next = (next + 1) % MARKS; used = Math.min(MARKS, used + 1); stats.marks++;
  }

  return {
    update(dt: number, car: SkidInput | null): void {
      time += dt;
      const sliding = Boolean(car?.sliding);
      if (car && sliding) {
        const moved = Number.isFinite(lastX) ? Math.hypot(car.x - lastX, car.z - lastZ) : MARK_SPACING_M;
        if (moved >= MARK_SPACING_M) {
          const sin = Math.sin(car.yaw), cos = Math.cos(car.yaw);
          for (const side of [-1, 1]) {
            const wx = car.x - sin * rear + cos * halfTrack * side, wz = car.z - cos * rear - sin * halfTrack * side;
            lay(wx, wz, car.heightAt(wx, wz) ?? car.y, car.yaw);
          }
          lastX = car.x; lastZ = car.z;
        }
        puffClock += dt * (0.5 + car.intensity);
        while (puffClock >= PUFF_EVERY_S) {
          puffClock -= PUFF_EVERY_S;
          const p = puffs[puffNext]!; puffNext = (puffNext + 1) % PUFFS;
          const side = puffNext % 2 ? 1 : -1, sin = Math.sin(car.yaw), cos = Math.cos(car.yaw);
          p.sprite.position.set(car.x - sin * rear + cos * halfTrack * side, car.y + 0.35, car.z - cos * rear - sin * halfTrack * side);
          p.age = 0; stats.puffs++; p.vx = (Math.random() - .5) * 1.2; p.vz = (Math.random() - .5) * 1.2; p.sprite.visible = true;
        }
      } else { lastX = NaN; puffClock = 0; }
      // Fade marks in their last quarter of life by shrinking their width (opacity is shared).
      if (used) {
        let alive = 0, dirty = false;
        for (let i = 0; i < used; i++) {
          const age = time - born[i]!;
          if (age > MARK_LIFE_S) { if (scaleOf[i] !== 0) { marks.getMatrixAt(i, matrix); matrix.decompose(pos, quat, scl); scl.set(0, 0, 0); matrix.compose(pos, quat, scl); marks.setMatrixAt(i, matrix); scaleOf[i] = 0; dirty = true; } continue; }
          alive++;
          const fade = Math.min(1, (MARK_LIFE_S - age) / (MARK_LIFE_S * .25));
          if (fade < 1 && Math.abs(fade - scaleOf[i]!) > .05) { marks.getMatrixAt(i, matrix); matrix.decompose(pos, quat, scl); scl.set(fade, 1, 1); matrix.compose(pos, quat, scl); marks.setMatrixAt(i, matrix); scaleOf[i] = fade; dirty = true; }
        }
        marks.count = used; marks.visible = alive > 0;
        if (dirty || sliding) marks.instanceMatrix.needsUpdate = true;
      }
      for (const p of puffs) {
        if (!p.sprite.visible) continue;
        p.age += dt;
        if (p.age >= PUFF_LIFE_S) { p.sprite.visible = false; continue; }
        const k = p.age / PUFF_LIFE_S;
        p.sprite.position.x += p.vx * dt; p.sprite.position.z += p.vz * dt; p.sprite.position.y += 0.9 * dt;
        p.sprite.scale.setScalar(0.8 + k * 2.6);
        (p.sprite.material as THREE.SpriteMaterial).opacity = 0.42 * (1 - k) * Math.min(1, p.age / 0.08);
      }
    },
    dispose(): void {
      scene.remove(marks); markGeometry.dispose(); markMaterial.dispose(); markTexture.dispose(); marks.dispose();
      for (const p of puffs) { scene.remove(p.sprite); p.sprite.material.dispose(); }
      smokeTexture.dispose();
    },
  };
}
