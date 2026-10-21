// GPU pigeon flocks circling over the part of the city in view (graphics v2 phase 2 item 7).
// Adapted from jeantimex/tokyo src/world/birds.js (MIT, web/src/render/TOKYO-LICENSE.txt): one instanced
// mesh; each flock's anchor lives in a tiny texture and every bird is placed in the vertex shader from the
// time and per-bird random numbers. Simplified: no tree roosting, flocks re-anchor near the camera instead.
import {
  DataTexture, DoubleSide, Float32BufferAttribute, FloatType, InstancedBufferAttribute, InstancedBufferGeometry,
  Mesh, NearestFilter, RGBAFormat, ShaderMaterial, type Object3D, type Vector3,
} from 'three';

const FLOCK = 14;
const SPAN = 3.2; // wingspan (m): larger than life so they read from street level

export interface GpuBirds {
  update(camera: Vector3, seconds: number, dt: number, night: number): void;
  mount(root: Object3D): () => void;
  dispose(): void;
}

function geometry(count: number): InstancedBufferGeometry {
  const pos: number[] = [], wing: number[] = [];
  const tri = (...v: number[][]) => { for (const [x, y, z, w] of v) { pos.push(x!, y!, z!); wing.push(w!); } };
  const h = SPAN / 2;
  tri([0, 0, 0.42, 0], [0.09, 0, -0.1, 0], [-0.09, 0, -0.1, 0]);
  tri([0.09, 0, -0.1, 0], [0, 0, -0.5, 0], [-0.09, 0, -0.1, 0]);
  for (const s of [-1, 1]) {
    tri([s * 0.06, 0, 0.2, 0], [s * h * 0.5, 0, 0.16, 0.5], [s * 0.06, 0, -0.16, 0]);
    tri([s * h * 0.5, 0, 0.16, 0.5], [s * h * 0.5, 0, -0.1, 0.5], [s * 0.06, 0, -0.16, 0]);
    tri([s * h * 0.5, 0, 0.16, 0.5], [s * h, 0, -0.02, 1], [s * h * 0.5, 0, -0.1, 0.5]);
  }
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new Float32BufferAttribute(wing, 1));
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seed.set([Math.floor(i / FLOCK), Math.random(), Math.random(), Math.random()], i * 4);
  g.setAttribute('aSeed', new InstancedBufferAttribute(seed, 4));
  g.instanceCount = count;
  return g;
}

export function createGpuBirds(low: boolean): GpuBirds {
  const count = low ? 140 : 420;
  const flocks = Math.ceil(count / FLOCK);
  const data = new Float32Array(flocks * 4);
  const texture = new DataTexture(data, flocks, 1, RGBAFormat, FloatType);
  texture.minFilter = texture.magFilter = NearestFilter;
  const uniforms = { uTime: { value: 0 }, uDark: { value: 0 }, uFlocks: { value: texture } };
  const material = new ShaderMaterial({
    side: DoubleSide,
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aWing;
      attribute vec4 aSeed;
      uniform float uTime;
      uniform sampler2D uFlocks;
      varying float vShade;
      float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
      vec3 place(float t, vec3 anchor) {
        float f = aSeed.x;
        vec2 reach = 40.0 + 120.0 * vec2(hash(f + 1.0), hash(f + 5.0));
        vec3 c = vec3(
          reach.x * sin(t * (0.05 + 0.06 * hash(f + 8.0)) + 6.28 * hash(f + 2.0)),
          30.0 + 90.0 * pow(hash(f + 3.0), 2.0) + 10.0 * sin(t * 0.05 + 6.28 * hash(f + 4.0)),
          reach.y * sin(t * (0.05 + 0.06 * hash(f + 10.0)) + 6.28 * hash(f + 6.0)));
        float radius = 8.0 + 40.0 * aSeed.y, turn = (0.5 + aSeed.z) * 4.5 / radius * (hash(f + 7.0) < 0.5 ? -1.0 : 1.0);
        float a = t * turn + 6.28 * aSeed.w;
        vec3 own = vec3(cos(a) * radius, 6.0 * sin(t * 0.21 + 6.28 * aSeed.z) + 20.0 * (aSeed.w - 0.5), sin(a) * radius * 0.8);
        return anchor + c + own;
      }
      void main() {
        vec4 flock = texture2D(uFlocks, vec2((aSeed.x + 0.5) / ${flocks}.0, 0.5));
        vec3 p = place(uTime, flock.xyz), ahead = place(uTime + 0.25, flock.xyz);
        vec3 fwd = normalize(ahead - p + vec3(0.0, 0.0, 1e-4)), right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd)), up = cross(fwd, right);
        float beat = smoothstep(-0.2, 0.3, sin(uTime * 0.35 + 6.28 * aSeed.y));
        float lift = mix(0.18, sin(uTime * 8.0 * (0.85 + 0.3 * aSeed.z) + 6.28 * aSeed.w), beat) * 0.55;
        vec3 local = position * 0.7 * flock.w;
        local.y += abs(local.x) * lift * aWing;
        local.x *= 1.0 - 0.22 * abs(lift) * aWing;
        vShade = 0.75 + 0.25 * aWing;
        gl_Position = projectionMatrix * viewMatrix * vec4(p + right * local.x + up * local.y + fwd * local.z, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uDark;
      varying float vShade;
      void main() { gl_FragColor = vec4(vec3(0.82, 0.82, 0.84) * vShade * mix(1.0, 0.35, uDark), 1.0); }`,
  });
  const mesh = new Mesh(geometry(count), material);
  mesh.frustumCulled = false;
  mesh.name = 'gpuBirds';
  mesh.renderOrder = 1;
  // Flock anchors relative to the camera's ground; w = visible scale (fades in/out on re-anchor).
  const state = Array.from({ length: flocks }, () => ({ x: 0, y: 0, z: 0, scale: 0, fresh: true }));
  const REACH = 260;
  return {
    update(camera, seconds, dt, night) {
      uniforms.uTime.value = seconds;
      uniforms.uDark.value = night;
      const ground = camera.y - 2;
      state.forEach((f, i) => {
        const far = Math.hypot(f.x - camera.x, f.z - camera.z) > REACH * 1.6;
        if (f.fresh || (far && f.scale <= 0)) {
          f.x = camera.x + (Math.random() - 0.5) * REACH * 2;
          f.z = camera.z + (Math.random() - 0.5) * REACH * 2;
          f.y = ground;
          f.fresh = false;
        }
        // Birds shrink away when their flock is left behind, then reappear around the new view.
        // Pigeons roost after dark: flocks shrink away as night falls and return at dawn.
        f.scale = Math.min(1 - night, Math.max(0, f.scale + (far ? -dt : dt) / 3));
        data.set([f.x, f.y, f.z, f.scale], i * 4);
      });
      texture.needsUpdate = true;
      mesh.visible = night < 0.99 || state.some(f => f.scale > 0);
    },
    mount(root) {
      root.add(mesh);
      return () => { mesh.removeFromParent(); };
    },
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
