// GTA V pivot — LANE B: vehicle damage visuals (flag vehicleDamage). Reads the server's damage bits on each fleet car
// (smoking 0x01, burning 0x02, wreck 0x04) and draws: grey smoke from a smoking car, fire + black smoke from a burning
// one, a charred body on a wreck (its own cloned materials, so other cars of the same model are untouched), and the
// EXPLOSION itself (fireball sprites, a flash light, debris + smoke burst). Two pooled Points clouds, no per-frame
// allocation.
import * as THREE from 'three';

export const SMOKING_FLAG = 0x01, BURNING_FLAG = 0x02, WRECK_FLAG = 0x04;

export interface DamageableCar { data: { id: number; flags: number }; model: { root: THREE.Object3D } }
export interface VehicleFx {
  update(dt: number, cars: Iterable<DamageableCar>): void;
  explode(at: THREE.Vector3): void;
  dispose(): void;
}

const MAX = 600;

function softDisc(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.45, 'rgba(255,255,255,.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** One pooled particle cloud: position, velocity, life, size, colour per particle (ring-buffer spawn). */
function cloud(scene: THREE.Scene, texture: THREE.Texture, additive: boolean) {
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3), vel = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX), maxLife = new Float32Array(MAX);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ map: texture, size: 2.4, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: additive ? .95 : .55 });
  const points = new THREE.Points(geo, mat); points.frustumCulled = false; points.renderOrder = 3; scene.add(points);
  let next = 0;
  for (let i = 0; i < MAX; i++) pos[i * 3 + 1] = -1e4; // parked far below until used
  return {
    spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, lifeS: number, grows: number) {
      const i = next; next = (next + 1) % MAX;
      pos.set([x, y, z], i * 3); vel.set([vx, vy, vz], i * 3); col.set([r, g, b], i * 3);
      life[i] = lifeS; maxLife[i] = lifeS; void grows;
    },
    update(dt: number) {
      for (let i = 0; i < MAX; i++) {
        const left = (life[i] ?? 0) - dt;
        if (left + dt <= 0) continue;
        life[i] = left;
        if (left <= 0) { pos[i * 3 + 1] = -1e4; continue; }
        const p = i * 3;
        pos[p] = (pos[p] ?? 0) + (vel[p] ?? 0) * dt;
        pos[p + 1] = (pos[p + 1] ?? 0) + (vel[p + 1] ?? 0) * dt;
        pos[p + 2] = (pos[p + 2] ?? 0) + (vel[p + 2] ?? 0) * dt;
        vel[p + 1] = (vel[p + 1] ?? 0) + (additive ? 1.5 : .6) * dt; // heat rises
        if (additive) { // fire cools from yellow-white towards deep red
          col[p] = (col[p] ?? 0) * .985; col[p + 1] = (col[p + 1] ?? 0) * .97; col[p + 2] = (col[p + 2] ?? 0) * .96;
        } else { // smoke thins out as it ages
          const fade = left / (maxLife[i] || 1), v = Math.max(.05, (col[p] ?? 0) * (.6 + .4 * fade));
          col[p] = v; col[p + 1] = v; col[p + 2] = v;
        }
      }
      geo.attributes.position!.needsUpdate = true; geo.attributes.color!.needsUpdate = true;
    },
    dispose() { scene.remove(points); geo.dispose(); mat.dispose(); },
  };
}

export function createVehicleFx(options: { scene: THREE.Scene }): VehicleFx {
  const texture = softDisc();
  const smoke = cloud(options.scene, texture, false), fire = cloud(options.scene, texture, true);
  const flash = new THREE.PointLight(0xffa040, 0, 60, 1.6); options.scene.add(flash);
  let flashT = 0;
  const charred = new WeakSet<THREE.Object3D>();
  const emitAcc = new Map<number, number>();
  const tmp = new THREE.Vector3();

  function char(root: THREE.Object3D): void {
    if (charred.has(root)) return;
    charred.add(root);
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const darken = (m: THREE.Material) => { const c = m.clone() as THREE.MeshStandardMaterial; if (c.color) c.color.multiplyScalar(.12); if ('emissive' in c && c.emissive) c.emissive.setRGB(0, 0, 0); return c; };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(darken) : darken(mesh.material);
    });
  }

  return {
    update(dt, cars) {
      const live = new Set<number>();
      for (const car of cars) {
        const f = car.data.flags;
        if (f & WRECK_FLAG) char(car.model.root);
        const rate = f & BURNING_FLAG ? 26 : f & WRECK_FLAG ? 10 : f & SMOKING_FLAG ? 8 : 0; // particles / second
        if (!rate) continue;
        live.add(car.data.id);
        let acc = (emitAcc.get(car.data.id) ?? 0) + rate * dt;
        car.model.root.getWorldPosition(tmp);
        while (acc >= 1) {
          acc -= 1;
          const jx = (Math.random() - .5) * 1.4, jz = (Math.random() - .5) * 1.4;
          if (f & BURNING_FLAG && Math.random() < .55) fire.spawn(tmp.x + jx, tmp.y + 1.1, tmp.z + jz, jx * .3, 1.4 + Math.random(), jz * .3, 1, .55 + Math.random() * .25, .12, .6 + Math.random() * .4, 1);
          const dark = f & (BURNING_FLAG | WRECK_FLAG) ? .12 : .55;
          smoke.spawn(tmp.x + jx, tmp.y + 1.3, tmp.z + jz, jx * .2, .9 + Math.random() * .6, jz * .2, dark, dark, dark, 2.2 + Math.random() * 1.2, 1);
        }
        emitAcc.set(car.data.id, acc);
      }
      for (const id of emitAcc.keys()) if (!live.has(id)) emitAcc.delete(id);
      smoke.update(dt); fire.update(dt);
      if (flashT > 0) { flashT = Math.max(0, flashT - dt); flash.intensity = 900 * (flashT / .5) ** 2; }
    },
    explode(at) {
      flash.position.set(at.x, at.y + 2, at.z); flashT = .5;
      for (let i = 0; i < 90; i++) { // fireball
        const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI / 2, s = 4 + Math.random() * 7;
        fire.spawn(at.x, at.y + 1, at.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, 1, .6 + Math.random() * .3, .2, .5 + Math.random() * .5, 2);
      }
      for (let i = 0; i < 60; i++) { // smoke column
        const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
        smoke.spawn(at.x, at.y + 1.5, at.z, Math.cos(a) * s, 2 + Math.random() * 3, Math.sin(a) * s, .14, .14, .14, 3 + Math.random() * 2, 2);
      }
    },
    dispose() { smoke.dispose(); fire.dispose(); options.scene.remove(flash); texture.dispose(); },
  };
}
