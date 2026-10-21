import { Mesh, Sphere, type Camera, type Object3D } from 'three';

/** Per-chunk overlay detail that reads as noise beyond a block or two on a phone screen. */
const DETAIL = new Set(['Facade fronts', 'Facade storefront', 'Facade entrance', 'Building detail', 'Shopfront signs', 'Sodium posts']);
const HIDDEN_LAYER = 31;

/**
 * gtasf-c8sj: on Low, streamed-chunk detail meshes farther than `range` metres from the camera are moved
 * to a layer the camera does not render. Layers (not `visible`) so chunk reveal/LOD toggles stay authoritative.
 * The base building boxes and their facade shader still draw, so far buildings stay textured.
 */
export function createLowDetailCull(range = 200, every = 10) {
  const sphere = new Sphere();
  let frame = 0;
  return function update(scene: Object3D, camera: Camera): void {
    if (frame++ % every) return;
    const cx = camera.position.x, cz = camera.position.z, limit = range * range;
    for (const chunk of scene.children) {
      if (chunk.name !== 'GTASF_chunk') continue;
      chunk.traverse(object => {
        if (!(object instanceof Mesh) || !DETAIL.has(object.name)) return;
        const geometry = object.geometry;
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        if (!geometry.boundingSphere) return;
        sphere.copy(geometry.boundingSphere).applyMatrix4(object.matrixWorld);
        const dx = Math.max(0, Math.abs(sphere.center.x - cx) - sphere.radius), dz = Math.max(0, Math.abs(sphere.center.z - cz) - sphere.radius);
        const far = dx * dx + dz * dz > limit;
        if (far && !object.layers.isEnabled(HIDDEN_LAYER)) object.layers.set(HIDDEN_LAYER);
        else if (!far && object.layers.isEnabled(HIDDEN_LAYER)) object.layers.set(0);
      });
    }
  };
}
