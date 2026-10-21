import { AdditiveBlending, Box3, Color, DynamicDrawUsage, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion,
  ShaderMaterial, Vector3, type Camera, type Object3D, type Scene } from 'three';
import type { VehicleEntry } from '@gtasf/shared/protocol/types';

/** vehicleNightLamps (lane D): visible head- and taillights for every moving car at night. One instanced, additive,
 * camera-facing glow quad per lamp (no lights, no per-car draw calls). Cars opt in through the same
 * `userData.gtasfHeadlight` the ground headlight pools use (lampLightMap.ts); lamps sit on the car's local bounds
 * (+z = forward). Headlamps fade when seen from behind; distant lamps grow a little so a street reads as a line of
 * lights instead of vanishing to sub-pixel. Unlit and not tone-mapped so they hold their colour against the night. */
type Layout = { x: number; headY: number; tailY: number; front: number; rear: number; scale: number };
const HEAD = new Color(1, .88, .68), TAIL = new Color(1, .07, .04);
const box = new Box3(), part = new Box3(), inverse = new Matrix4(), local = new Matrix4(), out = new Matrix4();
const offset = new Vector3(), size = new Vector3(), turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI), none = new Quaternion();

/** Local (car-frame) lamp positions from the car's mesh bounds, cached on the root. */
function layoutFor(car: Object3D): Layout | null {
  const cached = car.userData.gtasfLampLayout as Layout | null | undefined;
  if (cached !== undefined) return cached;
  car.updateMatrixWorld(true); inverse.copy(car.matrixWorld).invert(); box.makeEmpty();
  car.traverse(object => {
    if (!(object instanceof Mesh) || !object.geometry) return;
    object.geometry.boundingBox ?? object.geometry.computeBoundingBox();
    box.union(part.copy(object.geometry.boundingBox!).applyMatrix4(local.multiplyMatrices(inverse, object.matrixWorld)));
  });
  let layout: Layout | null = null;
  if (!box.isEmpty()) {
    box.getSize(size);
    layout = { x: size.x * .34, headY: box.min.y + size.y * .36, tailY: box.min.y + size.y * .42,
      front: box.max.z + .04, rear: box.min.z - .04, scale: Math.min(1.6, Math.max(.8, size.x / 1.9)) };
  }
  car.userData.gtasfLampLayout = layout;
  return layout;
}

export function createVehicleLamps(low: boolean) {
  const cars = low ? 24 : 48, capacity = cars * 4;
  const geometry = new PlaneGeometry(1, 1);
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, fog: false,
    uniforms: { uNight: { value: 0 } },
    vertexShader: `uniform float uNight; varying vec2 vUv; varying vec3 vColour; varying float vFade;
      void main(){
        vec3 centre=(modelMatrix*vec4(instanceMatrix[3].xyz,1.0)).xyz;
        vec3 forward=normalize(mat3(modelMatrix)*instanceMatrix[2].xyz);
        float size=length(instanceMatrix[0].xyz);
        vec3 toCam=cameraPosition-centre; float dist=max(length(toCam),.001);
        float facing=smoothstep(-.05,.45,dot(forward,toCam/dist));
        float grow=clamp(1.0+dist/45.0,1.0,4.0);
        vec4 mv=viewMatrix*vec4(centre,1.0);
        mv.xyz+=normalize(-mv.xyz)*.3; // in front of the lens geometry
        mv.xy+=position.xy*size*grow*(.35+.65*facing);
        gl_Position=projectionMatrix*mv;
        vUv=uv; vColour=instanceColor; vFade=facing*uNight;
      }`,
    fragmentShader: `varying vec2 vUv; varying vec3 vColour; varying float vFade;
      void main(){
        vec2 p=vUv*2.0-1.0; float r2=dot(p,p); if(r2>1.0||vFade<.002) discard;
        float glow=exp(-r2*16.0)*2.4+exp(-r2*4.0)*.38;
        gl_FragColor=vec4(vColour*glow*vFade,1.0);
      }`,
  });
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = 'Vehicle night lamps'; mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = 3;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage); mesh.setColorAt(0, HEAD); mesh.visible = false;
  const lamp = (car: Object3D, x: number, y: number, z: number, tail: boolean, scale: number) => {
    local.compose(offset.set(x, y, z), tail ? turn : none, size.setScalar(scale));
    out.multiplyMatrices(car.matrix, local);
    mesh.setMatrixAt(mesh.count, out); mesh.setColorAt(mesh.count++, tail ? TAIL : HEAD);
  };
  return {
    mesh,
    /** `night` 0..1 (foundation's night level). Cars are direct scene children, as for the ground pools. */
    update(scene: Scene, camera: Camera, night: number) {
      const level = Math.max(0, Math.min(1, (night - .15) / .4));
      material.uniforms.uNight!.value = level * level * (3 - 2 * level);
      mesh.visible = level > .001;
      if (!mesh.visible) return;
      mesh.count = 0;
      const range2 = (low ? 180 : 260) ** 2;
      for (const car of scene.children) {
        const light = car.userData.gtasfHeadlight as { active: boolean } | undefined;
        if (!light?.active || !car.visible || mesh.count + 4 > capacity) continue;
        if ((car.position.x - camera.position.x) ** 2 + (car.position.z - camera.position.z) ** 2 > range2) continue;
        const layout = layoutFor(car);
        if (!layout) continue;
        car.updateMatrix(); // this frame's pose (scene children: local = world), so lamps never trail a fast car
        for (const side of [-1, 1]) {
          lamp(car, side * layout.x, layout.headY, layout.front, false, .7 * layout.scale);
          lamp(car, side * layout.x, layout.tailY, layout.rear, true, .5 * layout.scale);
        }
      }
      if (mesh.count === 0) { mesh.visible = false; return; } // no lit car in range: no empty draw, no instance upload (lane B draw sweep, 10-19)
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); mesh.dispose(); },
  };
}

/** `?trafficdemo=<compass heading°>` (testingHarness only): six slow cars ahead of the spawn along that heading, half
 * facing the camera and half away, so a headless night capture shows both head- and taillights. Capture aid only. */
export function trafficDemoEntries(viewer: { x: number; z: number }, groundY: number, headingDeg: number): VehicleEntry[] {
  const h = headingDeg * Math.PI / 180, dx = Math.sin(h), dz = -Math.cos(h), toward = Math.atan2(-dx, -dz), away = Math.atan2(dx, dz);
  const kinds = ['tesla', 'prius', 'robotaxi', 'subaru', 'tesla', 'prius'] as const;
  return [14, 22, 30, 40, 52, 66].map((ahead, i) => {
    const side = i % 2 ? 3.6 : -3.6, yaw = i % 2 ? away : toward;
    return { id: 991_001 + i, kind: kinds[i]!, flags: 0, driverId: 0, speedCmps: 12,
      x: Math.round((viewer.x + dx * ahead - dz * side) * 100), y: Math.round(groundY * 100),
      z: Math.round((viewer.z + dz * ahead + dx * side) * 100), yaw: Math.round(yaw / (Math.PI * 2) * 256) & 255 };
  });
}
