import { Mesh, Vector3, type BufferAttribute, type BufferGeometry, type InterleavedBufferAttribute, type Object3D } from 'three';
import { flags } from '@gtasf/shared/flags';
import { DISTRICT_REGIONS, districtAt } from '../../../tools/map/src/districts';
import { SF_FRAME } from '../../../tools/map/src/config';
import { geodeticToWorld } from '../../../tools/map/src/geo';

const PIER_39 = geodeticToWorld(37.8087, -122.4098, SF_FRAME);

/** Land just outside every district box (e.g. the Embarcadero waterfront strip) borrows the nearest
 *  district's urban palette within 600 m (1300 m near Pier 39 only;
 *  golf courses are not park kinds in the bake, so a global 1300 m paved Harding Park [gtasf-2am9]), so it gets paving instead of the legacy flat green. */
function districtNear(x: number, z: number) {
  const inside = districtAt(x, z);
  if (inside) return inside;
  let best: (typeof DISTRICT_REGIONS)[number]['profile'] | undefined, bestD = Math.hypot(x - PIER_39[0], z - PIER_39[1]) < 500 ? 1300 : 600;
  for (const { bounds: [x0, z0, x1, z1], profile } of DISTRICT_REGIONS) {
    const d = Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
    if (d < bestD) { bestD = d; best = profile; }
  }
  return best;
}

// The pre-district map used this *linear*, quantized colour for every ordinary land triangle.
// Parks have a separate [66,107,54] colour. These are semantic palette values emitted by
// tools/map/src/pipeline/meshes.ts, not a general "green means grass" colour heuristic.
const LEGACY_LAND = [97, 110, 71] as const;
type Attribute = BufferAttribute | InterleavedBufferAttribute;

/** Apply the source district urban palette to older streamed maps without changing their geometry.
 * New district bakes already carry these colours and pass through unchanged. Actual mapped parks,
 * water, sand and scrub retain their original colours. Shared by the Low and PBR render paths.
 * Runs once at mount, needs no downloads/draw calls, and restores borrowed colour values on release.
 */
export function repairLegacyUrbanGround(root: Object3D, enabled: boolean = flags.terrain && flags.groundTextures): () => void {
  const changes: { geometry: BufferGeometry; attribute: Attribute; before: Attribute }[] = [];
  if (enabled) {
    const point = new Vector3();
    root.updateWorldMatrix(true, true);
    root.traverse(object => {
      if (!(object instanceof Mesh) || !/^terrain(?:_|$)/.test(object.name)) return;
      const geometry = object.geometry, original = geometry.getAttribute('color'), positions = geometry.getAttribute('position');
      if (!original || !positions || original.count !== positions.count) return;
      let before: Attribute | undefined;
      for (let i = 0; i < original.count; i++) {
        if (Math.round(original.getX(i) * 255) !== LEGACY_LAND[0]
          || Math.round(original.getY(i) * 255) !== LEGACY_LAND[1]
          || Math.round(original.getZ(i) * 255) !== LEGACY_LAND[2]) continue;
        point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        const urban = districtNear(point.x, point.z)?.ground.urban;
        if (!urban) continue;
        before ??= original.clone();
        // Match the map encoder's linear UNORM8 palette on both byte and float GLB decoders.
        original.setXYZ(i, Math.round(urban[0] * 255) / 255, Math.round(urban[1] * 255) / 255, Math.round(urban[2] * 255) / 255);
      }
      if (before) {
        // Keep the same GPU attribute so the normal chunk disposal releases its buffer.
        original.needsUpdate = true;
        changes.push({ geometry, attribute: original, before });
      }
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const { geometry, attribute, before } of changes) {
      if (geometry.getAttribute('color') !== attribute) continue;
      for (let i = 0; i < attribute.count; i++) attribute.setXYZ(i, before.getX(i), before.getY(i), before.getZ(i));
      attribute.needsUpdate = true;
    }
  };
}
