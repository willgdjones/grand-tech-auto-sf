/** Isolated GPU acceptance entry, built only by tools/render-check.mjs. Never imported by the app. */
import { Box3, Group, Mesh, PerspectiveCamera, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createRenderFoundation } from './foundation';
import { createBillboard, createCreativeTexture } from './screens/screenMesh';
import type { QualityTier } from './qualityTier';

const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
const tier: QualityTier = new URLSearchParams(location.search).get('tier') === 'low' ? 'low' : 'medium';
const foundation = createRenderFoundation({ canvas, tier });
foundation.resize(innerWidth, innerHeight);
const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 0.08, 1500);
const boardDistance = Math.max(10, 8 / (2 * Math.tan(25 * Math.PI / 180) * camera.aspect * 0.85));
camera.position.set(0, 4, boardDistance); camera.lookAt(0, 4, 0);
const creative = document.createElement('canvas'); creative.width = 512; creative.height = 256;
const context = creative.getContext('2d')!;
context.fillStyle = '#fff'; context.fillRect(0, 0, 512, 256);
context.fillStyle = '#101820'; context.font = 'bold 52px Arial'; context.fillText('GO BUILD.', 26, 75);
context.font = '18px Arial'; context.fillText('SF TECH WEEK · OCT 5–11', 28, 117);
context.font = '12px Arial'; context.fillText('Readable 12 px text • hills, haze, no blown highlights', 28, 153);
const patchColours = ['#fff', '#808080', '#000', '#f00', '#0f0', '#00f', '#ff0', '#0ff'];
for (let i = 0; i < patchColours.length; i++) {
  context.fillStyle = patchColours[i]!; context.fillRect(i * 64, 192, 64, 64);
}
const texture = createCreativeTexture(creative), board = createBillboard(8, 4, texture);
board.position.y = 4; foundation.scene.add(board);
const pixelBytes = new Uint8Array(4), projected = new Vector3();
function pixel(x: number, y: number) {
  const gl = foundation.renderer.getContext();
  gl.readPixels(Math.max(0, Math.min(canvas.width - 1, Math.floor(x))), Math.max(0, Math.min(canvas.height - 1, Math.floor(y))), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBytes);
  return Array.from(pixelBytes.slice(0, 3));
}
function samples(bloom: boolean) {
  foundation.render(camera, bloom);
  return patchColours.map((_colour, index) => {
    projected.set(((index + 0.5) / 8 - 0.5) * 8, -1.5, 0).applyMatrix4(board.matrixWorld).project(camera);
    return pixel((projected.x * 0.5 + 0.5) * canvas.width, (projected.y * 0.5 + 0.5) * canvas.height);
  });
}
const fixture = {
  samples,
  bloomProof() {
    const result = [0.75, 0.8, 0.85, 0.9, 0.95].map(gain => {
      board.material.uniforms.gain!.value = gain;
      return { gain, plain: samples(false)[0], bloom: samples(true)[0] };
    });
    board.material.uniforms.gain!.value = 0.8;
    return result;
  },
  farSamples() {
    board.position.z = -800; board.scale.setScalar((boardDistance + 800) / boardDistance);
    const result = samples(false);
    board.position.z = 0; board.scale.setScalar(1);
    return result;
  },
  skySamples() {
    board.visible = false; foundation.render(camera, false);
    const result = [pixel(canvas.width / 2, canvas.height / 2), pixel(canvas.width / 2, canvas.height * 0.95)];
    board.visible = true;
    return result;
  },
  stats() { return { width: canvas.width, height: canvas.height, postBytes: foundation.postBytes(), tier, colourSpace: foundation.renderer.outputColorSpace }; },
  async mountMap() {
    type Chunk = { id: string; x: number; z: number; lods: { path: string }[] };
    const manifest = await fetch('/map/manifest.json').then(r => { if (!r.ok) throw new Error('MAP_NOT_BUILT'); return r.json(); }) as { chunks: Chunk[]; chunkSize: number; sourceDigests: unknown[] };
    const graph = await fetch('/map/roadgraph.json').then(r => r.json()) as { edges: { name: string; points: [number, number, number][] }[] };
    const crooked = graph.edges.filter(e => e.name === 'Lombard Street').sort((a, b) => b.points.length - a.points.length)[0];
    if (!crooked) throw new Error('NO_LOMBARD_GEOMETRY');
    const middle = crooked.points[Math.floor(crooked.points.length / 2)]!;
    const cx = Math.floor(middle[0] / manifest.chunkSize), cz = Math.floor(middle[2] / manifest.chunkSize);
    const selected = manifest.chunks.filter(c => Math.abs(c.x - cx) <= 1 && Math.abs(c.z - cz) <= 1);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const world = new Group();
    let vertices = 0, colourVertices = 0;
    // Sequential fixture IO bounds peak decode memory; runtime streaming is a separate B02 owner.
    for (const chunk of selected) {
      const gltf = await loader.loadAsync(`/map/${chunk.lods[0]!.path}`);
      gltf.scene.position.set(chunk.x * manifest.chunkSize, 0, chunk.z * manifest.chunkSize);
      gltf.scene.traverse(object => {
        if (!(object instanceof Mesh)) return;
        vertices += object.geometry.getAttribute('position').count;
        colourVertices += object.geometry.getAttribute('color')?.count ?? 0;
      });
      world.add(gltf.scene);
    }
    foundation.mountGeometry(world);
    board.visible = false;
    camera.position.set(middle[0] + 120, middle[1] + 130, middle[2] + 150);
    camera.lookAt(...middle);
    foundation.render(camera);
    const bounds = new Box3().setFromObject(world);
    return { chunks: selected.map(c => c.id), vertices, colourVertices, sources: manifest.sourceDigests.length, sourceDigests: manifest.sourceDigests, bounds: [bounds.min.toArray(), bounds.max.toArray()], target: middle };
  },
};
declare global { interface Window { renderCheck: typeof fixture } }
window.renderCheck = fixture;
foundation.renderer.setAnimationLoop(() => foundation.render(camera));
canvas.dataset.ready = 'true';
