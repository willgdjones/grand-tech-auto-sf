import { BufferGeometry, Int16BufferAttribute, Int8BufferAttribute, Group, Mesh, MeshStandardMaterial, Uint8BufferAttribute, ShapeUtils, Vector2 } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { decodeCompactMesh } from '@gtasf/shared/mapMesh';
import { flags } from '@gtasf/shared/flags';
import { decodeBuildingRecipe, isBuildingRecipe, type RecipeCollision } from '@gtasf/shared/mapRecipe';
import { isJoinRecipe } from '@gtasf/shared/mapJoinRecipe';
import { decodeCompactMeshInWorker } from './compactMeshWorker';
import { isHeightPredictedMesh } from '@gtasf/shared/mapHeightPredictor';

/** 1536 flat triangles = 55,296 attribute bytes; one existing bounded upload per frame. */
export async function loadCompactMesh(buffer: ArrayBuffer, collision?: RecipeCollision, height?: ArrayBuffer): Promise<Group> {
  if (!flags.compactMapAssets) throw new Error('COMPACT_MAP_ASSETS_DISABLED');
  const source = new Uint8Array(buffer), recipe = isBuildingRecipe(source), predicted = isHeightPredictedMesh(source);
  // GTCZ framing only; keep the source generator and polygon libraries in the worker.
  const surface = source.length >= 4 && new DataView(source.buffer, source.byteOffset, 4).getUint32(0, true) === 0x5a435447;
  if (recipe && !collision) throw new Error('MAP_RECIPE_COLLISION_REQUIRED');
  if ((predicted || surface) && !height) throw new Error('MAP_HEIGHT_FIELD_REQUIRED');
  const groups = predicted || surface || isJoinRecipe(source) ? await decodeCompactMeshInWorker(buffer, collision, height) : recipe ? await decodeBuildingRecipe(source, collision!, rings => ShapeUtils.triangulateShape(
    rings[0]!.map(p => new Vector2(p[0], p[1])), rings.slice(1).map(r => r.map(p => new Vector2(p[0], p[1])))), MeshoptDecoder)
    : await decodeCompactMesh(source, MeshoptDecoder);
  const root = new Group();
  root.name = 'GTASF compact map chunk';
  for (const { group, positions: source, indices, colors: faceColors } of groups) {
    const material = new MeshStandardMaterial({ name: group.name, vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
    for (let first = 0; first < group.triangles; first += 1536) {
      const count = Math.min(1536, group.triangles - first), positions = new Int16Array(count * 9), colors = new Uint8Array(count * 9), normals = new Int8Array(count * 9);
      for (let i = 0; i < count; i++) {
        const a = indices[(first + i) * 3]! * 4, b = indices[(first + i) * 3 + 1]! * 4, c = indices[(first + i) * 3 + 2]! * 4;
        const ux = source[b]! - source[a]!, uy = source[b + 1]! - source[a + 1]!, uz = source[b + 2]! - source[a + 2]!;
        const vx = source[c]! - source[a]!, vy = source[c + 1]! - source[a + 1]!, vz = source[c + 2]! - source[a + 2]!;
        const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], length = Math.hypot(...normal) || 1;
        for (let corner = 0; corner < 3; corner++) for (let axis = 0; axis < 3; axis++) {
          const target = i * 9 + corner * 3 + axis;
          positions[target] = source[indices[(first + i) * 3 + corner]! * 4 + axis]!;
          colors[target] = faceColors[(first + i) * 4 + axis]!;
          normals[target] = Math.round(normal[axis]! / length * 127);
        }
      }
      const geometry = new BufferGeometry().setAttribute('position', new Int16BufferAttribute(positions, 3, true))
        .setAttribute('normal', new Int8BufferAttribute(normals, 3, true)).setAttribute('color', new Uint8BufferAttribute(colors, 3, true));
      const mesh = new Mesh(geometry, material); mesh.name = group.name;
      mesh.position.fromArray(group.translation); mesh.scale.fromArray(group.scale); root.add(mesh);
    }
  }
  return root;
}
