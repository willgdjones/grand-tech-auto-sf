/** Short-lived real-asset smoke entry, never imported by the game. */
import { PerspectiveCamera } from 'three';
import { createRenderFoundation } from '../foundation';
import { loadLombardWorld, LOMBARD_SPAWN } from './world';

const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
const foundation = createRenderFoundation({ canvas, tier: 'medium' });
foundation.resize(innerWidth, innerHeight);
const camera = new PerspectiveCamera(55, innerWidth / innerHeight, .1, 1500);
let focus: { x: number; y: number; z: number; yaw: number } = { ...LOMBARD_SPAWN }, running = true, maxUploads = 0;
const world = (await loadLombardWorld({ mountGeometry: foundation.mountGeometry, tier: 'medium', position: focus, enabled: true }))!;
camera.position.set(focus.x + 100, focus.y + 100, focus.z + 130);
camera.lookAt(focus.x + 70, focus.y - 15, focus.z);
function frame() {
  if (!running) return;
  world.update(focus); maxUploads = Math.max(maxUploads, world.stats.uploadsThisFrame);
  foundation.render(camera); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const fixture = {
  ready: () => world.stats.mounted >= 9 && world.stats.loading === 0 && world.stats.queuedUploads === 0,
  evidence: () => ({ ...world.stats, maxUploads, ground: world.heightAt(focus.x, focus.z), surface: world.surfaceHeightAt(focus.x, focus.z), cameraBoxes: world.cameraBoxes.length, colliding: world.collidesCircle(focus.x, focus.z), geometries: foundation.renderer.info.memory.geometries, chunks: world.manifest.chunks.length }),
  async move() {
    const target = world.manifest.chunks[0]!;
    focus = { x: target.x * 256 + 128, y: 0, z: target.z * 256 + 128, yaw: 0 };
    await world.ensureAround(focus);
    focus.y = world.heightAt(focus.x, focus.z)!;
    return { ...fixture.evidence(), oldGround: world.heightAt(LOMBARD_SPAWN.x, LOMBARD_SPAWN.z) };
  },
  dispose() { running = false; world.dispose(); foundation.render(camera); return { geometries: foundation.renderer.info.memory.geometries, boxes: world.cameraBoxes.length }; },
};
Object.assign(window, { mapSmoke: fixture });
declare global { interface Window { mapSmoke: typeof fixture } }
