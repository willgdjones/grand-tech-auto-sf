import * as THREE from 'three';
import type { VehicleEntry } from '@gtasf/shared/protocol/types';
import { HELICOPTER_ALTITUDE_M, POLICE_FLAG } from '@gtasf/shared/combat/police';
import type { VehicleInstance } from '../vehicles/models/vehicle';

// SFPD air + SWAT art (GTA-pivot lane A #6, flag policeAirArt). Lane B's Combat 5b (flag policeAir) fields a
// helicopter at wanted 4 (POLICE_FLAG kind 'supercar' at altitude) and SWAT vans at wanted 5 (POLICE_FLAG kind
// 'bus'); until now those rendered as stand-in car GLBs (the heli not at all: the fleet never loads 'supercar').
// These are procedural, fetch-free models in the fleet's VehicleInstance shape:
// - helicopter: b&w SFPD airframe with spinning main/tail rotors, red/blue belly strobes, and a sweeping
//   searchlight — an additive beam cone down to the ground, plus a ground pool drawn by the night lamp light
//   map (userData.gtasfSpotlight), so the pool lies correctly on SF's slopes;
// - SWAT van: armoured black box truck, SWAT / SFPD lettering, spinning wheels; lane B's light bar sits on its
//   roof via userData.policeBarY.
// Models face +Z. Heli origin = airframe centre (the server pose is the hover point); van origin = ground.

export type PoliceAirKind = 'heli' | 'swat';
export interface PoliceAirInstance extends VehicleInstance {
  readonly air: PoliceAirKind;
  /** Ground height under the helicopter (null = unknown; falls back to the server's hover altitude). */
  setGround(y: number | null): void;
}
export interface PoliceAirTemplate { createInstance(): PoliceAirInstance; dispose(): void }

const BLACK = 0x1e2128, WHITE = 0xeceef1, METAL = 0x4a4f57, GLASS = 0x2c3d52;
const FLASH_MS = 240;
const BRIGHT_RED = 0xff2a2a, DIM_RED = 0x3a0606, BRIGHT_BLUE = 0x2a5aff, DIM_BLUE = 0x060a3a;
const BEAM_HALF_ANGLE = Math.tan(6 * Math.PI / 180);

/** White lettering on transparent, generated once per template — no fetch. */
function letteringTexture(lines: Array<{ text: string; size: number }>, w = 512, h = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f2f4f7'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const total = lines.reduce((s, l) => s + l.size, 0);
  let y = (h - total) / 2;
  for (const line of lines) { ctx.font = `bold ${line.size}px Arial, sans-serif`; ctx.fillText(line.text, w / 2, y + line.size / 2 + 2); y += line.size; }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m;
}

/** Two decal planes (left + right side) facing outward from ±x. */
function sideDecals(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, halfX: number, y: number, z: number): void {
  for (const side of [-1, 1]) {
    const d = mesh(geo, mat, side * halfX, y, z); d.rotation.y = side * Math.PI / 2; parent.add(d);
  }
}

function dummies(root: THREE.Group, seatY: number) {
  const seat = new THREE.Object3D(); seat.position.set(0.4, seatY, 0.6);
  const exit = new THREE.Object3D(); exit.position.set(1.8, 0, 0.6);
  const cameraTarget = new THREE.Object3D();
  root.add(seat, exit, cameraTarget);
  return { seat, exit, cameraTarget };
}

/** The searchlight beam: an open cone, apex at the origin, unit length down -Y, unit base radius. */
function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'GTASF police heli beam',
    uniforms: { uColor: { value: new THREE.Color(1, 0.97, 0.88) }, uIntensity: { value: 0.32 } },
    vertexShader: /* glsl */`
      varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        vT = -position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uIntensity;
      varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = uIntensity * edge * (1.0 - 0.7 * vT) * smoothstep(0.0, 0.03, vT);
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
}

function createHeliTemplate(): PoliceAirTemplate {
  const black = new THREE.MeshPhongMaterial({ color: BLACK, specular: 0x50565f, shininess: 40 });
  const white = new THREE.MeshLambertMaterial({ color: WHITE });
  const metal = new THREE.MeshLambertMaterial({ color: METAL });
  const glass = new THREE.MeshPhongMaterial({ color: GLASS, emissive: 0x101c2a, specular: 0x9ab0c8, shininess: 90 });
  const blur = new THREE.MeshBasicMaterial({ color: 0x1a1c20, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const policeTex = letteringTexture([{ text: 'POLICE', size: 92 }]);
  const sfpdTex = letteringTexture([{ text: 'SFPD', size: 96 }], 256, 128);
  const policeMat = new THREE.MeshLambertMaterial({ map: policeTex, transparent: true, depthWrite: false });
  const sfpdMat = new THREE.MeshLambertMaterial({ map: sfpdTex, transparent: true, depthWrite: false });
  const navRed = new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false });
  const navGreen = new THREE.MeshBasicMaterial({ color: 0x30ff60, toneMapped: false });
  const beamMat = beamMaterial();
  const geos = {
    lower: new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    upper: new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    canopy: new THREE.SphereGeometry(1, 20, 12),
    cowl: new THREE.CapsuleGeometry(0.42, 1.3, 4, 12).rotateX(Math.PI / 2),
    mast: new THREE.CylinderGeometry(0.09, 0.12, 0.5, 8),
    hub: new THREE.CylinderGeometry(0.2, 0.2, 0.14, 10),
    blade: new THREE.BoxGeometry(5.3, 0.04, 0.3).translate(2.75, 0, 0),
    disc: new THREE.CircleGeometry(5.5, 40).rotateX(-Math.PI / 2),
    boom: new THREE.CylinderGeometry(0.16, 0.34, 4.6, 12).rotateX(Math.PI / 2),
    fin: new THREE.BoxGeometry(0.08, 1.35, 0.75),
    stab: new THREE.BoxGeometry(1.7, 0.06, 0.4),
    tailBlade: new THREE.BoxGeometry(0.04, 1.3, 0.12),
    skid: new THREE.CylinderGeometry(0.055, 0.055, 3.5, 8).rotateX(Math.PI / 2),
    strut: new THREE.CylinderGeometry(0.045, 0.045, 0.62, 6),
    strobe: new THREE.SphereGeometry(0.11, 10, 8),
    nav: new THREE.SphereGeometry(0.06, 8, 6),
    lamp: new THREE.CylinderGeometry(0.15, 0.12, 0.3, 12).rotateX(Math.PI / 2),
    policeDecal: new THREE.PlaneGeometry(1.7, 0.42),
    sfpdDecal: new THREE.PlaneGeometry(1.1, 0.5),
    // Apex at the origin, base one unit down -Y (vT = -position.y runs 0 at the lamp to 1 at the ground).
    beam: new THREE.ConeGeometry(1, 1, 28, 1, true).translate(0, -0.5, 0),
  };

  return {
    createInstance(): PoliceAirInstance {
      const root = new THREE.Group(); root.name = 'GTASF SFPD helicopter';
      const airframe = new THREE.Group(); root.add(airframe);
      const lower = mesh(geos.lower, black); lower.scale.set(1.0, 0.95, 2.1);
      const upper = mesh(geos.upper, white); upper.scale.set(1.0, 1.05, 2.1);
      const canopy = mesh(geos.canopy, glass, 0, 0.18, 1.2); canopy.scale.set(0.84, 0.78, 0.98);
      const cowl = mesh(geos.cowl, white, 0, 1.0, -0.45);
      airframe.add(lower, upper, canopy, cowl, mesh(geos.mast, metal, 0, 1.45, -0.1));
      const boom = mesh(geos.boom, black, 0, 0.35, -3.75);
      const fin = mesh(geos.fin, black, 0, 0.95, -5.85); fin.rotation.x = -0.25;
      airframe.add(boom, fin, mesh(geos.stab, black, 0, 0.35, -5.1));
      for (const side of [-1, 1]) {
        airframe.add(mesh(geos.skid, metal, side * 0.95, -1.28, 0.1));
        for (const z of [-0.75, 0.85]) { const s = mesh(geos.strut, metal, side * 0.8, -1.0, z); s.rotation.z = side * 0.45; airframe.add(s); }
        airframe.add(mesh(geos.nav, side < 0 ? navRed : navGreen, side * 0.86, 0.35, -5.1));
      }
      sideDecals(airframe, geos.policeDecal, policeMat, 0.955, -0.32, -0.15);
      sideDecals(airframe, geos.sfpdDecal, sfpdMat, 0.3, 0.38, -3.05);
      // Belly strobes (alternate red/blue like the cruiser bar) + a white tail strobe.
      const redMat = new THREE.MeshBasicMaterial({ color: BRIGHT_RED, toneMapped: false });
      const blueMat = new THREE.MeshBasicMaterial({ color: BRIGHT_BLUE, toneMapped: false });
      const tailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      airframe.add(mesh(geos.strobe, redMat, -0.38, -0.9, 0.2), mesh(geos.strobe, blueMat, 0.38, -0.9, 0.2), mesh(geos.strobe, tailMat, 0, 1.68, -6.1));
      // Rotors.
      const rotor = new THREE.Group(); rotor.position.set(0, 1.72, -0.1);
      for (let i = 0; i < 3; i++) { const b = mesh(geos.blade, metal); b.rotation.y = i * Math.PI * 2 / 3; rotor.add(b); }
      rotor.add(mesh(geos.hub, metal));
      const disc = mesh(geos.disc, blur, 0, 1.72, -0.1); disc.renderOrder = 2;
      const tailRotor = new THREE.Group(); tailRotor.position.set(0.16, 0.95, -5.95);
      for (const r of [0, Math.PI / 2]) { const b = mesh(geos.tailBlade, metal); b.rotation.x = r; tailRotor.add(b); }
      airframe.add(rotor, disc, tailRotor);
      // Searchlight: housing under the nose, beam in root space (aimed in world terms each frame).
      const LAMP = new THREE.Vector3(0.45, -0.95, 1.45);
      airframe.add(mesh(geos.lamp, metal, LAMP.x, LAMP.y, LAMP.z));
      const beam = mesh(geos.beam, beamMat); beam.frustumCulled = false; beam.renderOrder = 3; root.add(beam);
      const spot = { x: 0, y: 0, z: 0, r: 6 };
      root.userData.gtasfSpotlight = spot;
      root.userData.policeBarY = null; // own strobes; no cruiser roof bar
      const { seat, exit, cameraTarget } = dummies(root, -0.4);
      let groundY: number | null = null, t = Math.random() * 100, speed = 0;
      const lampWorld = new THREE.Vector3(), dir = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
      return {
        air: 'heli', root, seat, exit, cameraTarget,
        setGround(y) { groundY = y; },
        update(dt, speedMps = 0) {
          t += dt;
          speed += (Math.abs(speedMps) - speed) * Math.min(1, dt * 1.5);
          rotor.rotation.y += dt * 31; tailRotor.rotation.x += dt * 52;
          // Hover bob + nose-down pitch with forward speed + a slow yaw wander.
          airframe.position.y = Math.sin(t * 1.3) * 0.18;
          airframe.rotation.x = Math.min(0.22, speed * 0.012) + Math.sin(t * 0.9) * 0.02;
          airframe.rotation.z = Math.sin(t * 0.7) * 0.03;
          const phase = Math.floor(performance.now() / FLASH_MS) % 2 === 0;
          redMat.color.setHex(phase ? BRIGHT_RED : DIM_RED); blueMat.color.setHex(phase ? DIM_BLUE : BRIGHT_BLUE);
          tailMat.color.setScalar(Math.floor(performance.now() / 600) % 3 === 0 ? 1 : 0.05);
          // Aim: the hover point is the pursued player; the beam sweeps a slow figure-of-eight around it.
          const yaw = root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
          const ground = groundY ?? root.position.y - HELICOPTER_ALTITUDE_M;
          const tx = root.position.x + Math.sin(t * 0.55) * 4, tz = root.position.z + Math.sin(t * 0.37) * 3;
          lampWorld.set(LAMP.x * c + LAMP.z * s, LAMP.y, -LAMP.x * s + LAMP.z * c).add(root.position);
          dir.set(tx - lampWorld.x, ground - lampWorld.y, tz - lampWorld.z);
          const len = Math.max(1, dir.length());
          dir.divideScalar(len);
          // Into root-local space (root carries only the yaw).
          beam.position.set(LAMP.x, LAMP.y, LAMP.z);
          const lx = dir.x * c - dir.z * s, lz = dir.x * s + dir.z * c;
          beam.quaternion.setFromUnitVectors(down, dir.set(lx, dir.y, lz));
          const r = len * BEAM_HALF_ANGLE;
          beam.scale.set(r, len, r);
          spot.x = tx; spot.y = ground; spot.z = tz; spot.r = r;
        },
        dispose() { root.removeFromParent(); redMat.dispose(); blueMat.dispose(); tailMat.dispose(); },
      };
    },
    dispose() {
      for (const g of Object.values(geos)) g.dispose();
      for (const m of [black, white, metal, glass, blur, policeMat, sfpdMat, navRed, navGreen, beamMat]) m.dispose();
      policeTex.dispose(); sfpdTex.dispose();
    },
  };
}

function createSwatTemplate(): PoliceAirTemplate {
  const body = new THREE.MeshPhongMaterial({ color: 0x14171d, specular: 0x5a6270, shininess: 36 });
  const trim = new THREE.MeshLambertMaterial({ color: 0x3a3e46 });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x0c0c0d });
  const rim = new THREE.MeshLambertMaterial({ color: 0x6a6f78 });
  const glass = new THREE.MeshPhongMaterial({ color: GLASS, emissive: 0x101c2a, specular: 0x9ab0c8, shininess: 90 });
  const head = new THREE.MeshBasicMaterial({ color: 0xfff6dc, toneMapped: false });
  const tail = new THREE.MeshBasicMaterial({ color: 0xc81414, toneMapped: false });
  const swatTex = letteringTexture([{ text: 'SWAT', size: 84 }, { text: 'SFPD  POLICE', size: 34 }]);
  const rearTex = letteringTexture([{ text: 'POLICE', size: 70 }], 512, 96);
  const swatMat = new THREE.MeshLambertMaterial({ map: swatTex, transparent: true, depthWrite: false });
  const rearMat = new THREE.MeshLambertMaterial({ map: rearTex, transparent: true, depthWrite: false });
  const geos = {
    box: new THREE.BoxGeometry(2.24, 1.95, 3.9),
    hood: new THREE.BoxGeometry(2.24, 1.05, 1.7),
    cab: new THREE.BoxGeometry(2.2, 0.85, 1.05),
    windshield: new THREE.PlaneGeometry(1.95, 0.62),
    sideWin: new THREE.PlaneGeometry(0.85, 0.55),
    port: new THREE.PlaneGeometry(0.34, 0.16),
    skirt: new THREE.BoxGeometry(2.3, 0.22, 5.7),
    ram: new THREE.BoxGeometry(2.0, 0.4, 0.22),
    wheel: new THREE.CylinderGeometry(0.5, 0.5, 0.38, 18).rotateZ(Math.PI / 2),
    hub: new THREE.CylinderGeometry(0.26, 0.26, 0.4, 10).rotateZ(Math.PI / 2),
    lamp: new THREE.BoxGeometry(0.32, 0.18, 0.04),
    swatDecal: new THREE.PlaneGeometry(2.6, 0.65),
    rearDecal: new THREE.PlaneGeometry(1.5, 0.28),
    rail: new THREE.BoxGeometry(0.05, 0.08, 3.6),
  };
  return {
    createInstance(): PoliceAirInstance {
      const root = new THREE.Group(); root.name = 'GTASF SFPD SWAT van';
      root.add(mesh(geos.box, body, 0, 1.55, -0.85), mesh(geos.hood, body, 0, 1.08, 1.95), mesh(geos.cab, body, 0, 2.03, 1.6));
      root.add(mesh(geos.skirt, trim, 0, 0.62, 0), mesh(geos.ram, trim, 0, 0.8, 2.92));
      const ws = mesh(geos.windshield, glass, 0, 2.05, 2.13); root.add(ws);
      sideDecals(root, geos.sideWin, glass, 1.105, 2.05, 1.6);
      for (const z of [-0.2, -1.5]) sideDecals(root, geos.port, glass, 1.125, 1.95, z);
      sideDecals(root, geos.swatDecal, swatMat, 1.13, 1.32, -0.85);
      const rearDecal = mesh(geos.rearDecal, rearMat, 0, 1.9, -2.81); rearDecal.rotation.y = Math.PI; root.add(rearDecal);
      for (const x of [-0.75, 0.75]) {
        const h = mesh(geos.lamp, head, x, 1.18, 2.81); root.add(h);
        const t = mesh(geos.lamp, tail, x, 1.0, -2.81); root.add(t);
        root.add(mesh(geos.rail, trim, x, 2.57, -0.85));
      }
      const wheels: THREE.Group[] = [];
      for (const z of [1.9, -1.85]) for (const x of [-1.0, 1.0]) {
        const w = new THREE.Group(); w.position.set(x, 0.5, z);
        w.add(mesh(geos.wheel, tyre), mesh(geos.hub, rim)); root.add(w); wheels.push(w);
      }
      root.userData.policeBarY = 2.66; // lane B's roof light bar sits on the cab/box roof
      const { seat, exit, cameraTarget } = dummies(root, 1.0);
      return {
        air: 'swat', root, seat, exit, cameraTarget,
        setGround() {},
        update(dt, speedMps = 0) { for (const w of wheels) w.rotation.x += speedMps * dt / 0.5; },
        dispose() { root.removeFromParent(); },
      };
    },
    dispose() {
      for (const g of Object.values(geos)) g.dispose();
      for (const m of [body, trim, tyre, rim, glass, head, tail, swatMat, rearMat]) m.dispose();
      swatTex.dispose(); rearTex.dispose();
    },
  };
}

/** Both templates, built lazily once per fleet. */
export function createPoliceAirTemplates(): { heli: PoliceAirTemplate; swat: PoliceAirTemplate; dispose(): void } {
  const heli = createHeliTemplate(), swat = createSwatTemplate();
  return { heli, swat, dispose() { heli.dispose(); swat.dispose(); } };
}

/** Which police art a server vehicle entry gets (lane B's stand-in kinds), or undefined for ordinary cars. */
export function policeAirKind(entry: Pick<VehicleEntry, 'flags' | 'kind'>): PoliceAirKind | undefined {
  if (!(entry.flags & POLICE_FLAG)) return undefined;
  return entry.kind === 'supercar' ? 'heli' : entry.kind === 'bus' ? 'swat' : undefined;
}

/**
 * `?policeairdemo` (testing harness): synthetic wanted-4/5 units around the viewer so the art can be captured
 * in-game without staging a 4-star pursuit — a hovering helicopter and one SWAT van. Client-only, never sent.
 */
export function policeAirDemoEntries(viewer: { x: number; z: number }, groundY: number): VehicleEntry[] {
  const base = { flags: 0x20 | POLICE_FLAG, driverId: 0 };
  return [
    { ...base, id: 990_001, kind: 'supercar', x: Math.round((viewer.x - 26) * 100), y: Math.round((groundY + 17) * 100), z: Math.round((viewer.z - 62) * 100), yaw: 64, speedCmps: 0 },
    { ...base, id: 990_002, kind: 'bus', x: Math.round((viewer.x - 9) * 100), y: Math.round(groundY * 100), z: Math.round((viewer.z - 16) * 100), yaw: 48, speedCmps: 0 },
  ];
}
