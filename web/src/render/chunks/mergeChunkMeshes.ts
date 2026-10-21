import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Mesh, Vector3, type Object3D } from 'three';

/**
 * gtasf-c8sj: streamed chunks ship roads and terrain as many small same-material pieces (terrain_1, roads, roads_1,
 * roads_surface_join_0..8). Each is a draw call. Merge them into one float mesh per material,
 * expressed in the chunk root's space. Only plain meshes with identical attribute sets merge;
 * anything unusual is left untouched.
 */
export function mergeChunkRoadMeshes(root: Object3D, pattern = /^(?:roads|terrain)(?:_\d+|_surface_join(?:_\d+)?)?$/): number {
  return mergeMeshesByMaterial(root, object => pattern.test(object.name)).merged;
}

/** Merge every matching plain mesh under `root` into one mesh per material (+attribute set), in root space. */
export function mergeMeshesByMaterial(root: Object3D, test: (mesh: Mesh) => boolean, minimum = 2, disposeSources = true): { merged: number; meshes: Mesh[] } {
  root.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, Mesh[]>();
  root.traverse(object => {
    if (!(object instanceof Mesh) || !test(object) || Array.isArray(object.material)) return;
    if ((object as { isInstancedMesh?: boolean }).isInstancedMesh || (object as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
    if (object.geometry.morphAttributes.position || object.geometry.groups.length) return;
    const key = `${object.material.uuid}|${Object.keys(object.geometry.attributes).sort().join(',')}`;
    const list = groups.get(key) ?? []; list.push(object); groups.set(key, list);
  });
  let merged = 0; const results: Mesh[] = [];
  const local = new Matrix4(), normalMatrix = new Matrix3(), v = new Vector3();
  for (const list of groups.values()) {
    if (list.length < minimum) continue;
    const names = Object.keys(list[0]!.geometry.attributes);
    if (!names.includes('position')) continue;
    const sizes = names.map(name => list[0]!.geometry.getAttribute(name).itemSize);
    let vertexCount = 0, indexCount = 0;
    for (const mesh of list) { const count = mesh.geometry.getAttribute('position').count; vertexCount += count; indexCount += mesh.geometry.index?.count ?? count; }
    const arrays = sizes.map(size => new Float32Array(vertexCount * size));
    const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let vertexBase = 0, indexBase = 0;
    for (const mesh of list) {
      local.multiplyMatrices(inverse, mesh.matrixWorld); normalMatrix.getNormalMatrix(local);
      const geometry = mesh.geometry, count = geometry.getAttribute('position').count;
      names.forEach((name, a) => {
        const attribute = geometry.getAttribute(name), size = sizes[a]!, out = arrays[a]!;
        for (let i = 0; i < count; i++) {
          if (name === 'position' || name === 'normal') {
            v.set(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
            if (name === 'position') v.applyMatrix4(local); else v.applyMatrix3(normalMatrix).normalize();
            v.toArray(out, (vertexBase + i) * 3);
          } else for (let c = 0; c < size; c++) out[(vertexBase + i) * size + c] = attribute.getComponent(i, c);
        }
      });
      if (geometry.index) for (let i = 0; i < geometry.index.count; i++) index[indexBase + i] = geometry.index.getX(i) + vertexBase;
      else for (let i = 0; i < count; i++) index[indexBase + i] = vertexBase + i;
      vertexBase += count; indexBase += geometry.index?.count ?? count;
    }
    const geometry = new BufferGeometry();
    names.forEach((name, a) => geometry.setAttribute(name, new BufferAttribute(arrays[a]!, sizes[a]!)));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const first = list[0]!, result = new Mesh(geometry, first.material);
    result.name = first.name.replace(/_surface_join(?:_\d+)?$|_\d+$/, ''); result.userData = { ...first.userData };
    result.castShadow = first.castShadow; result.receiveShadow = first.receiveShadow; result.renderOrder = first.renderOrder;
    for (const mesh of list) { mesh.removeFromParent(); if (disposeSources) mesh.geometry.dispose(); }
    root.add(result); results.push(result); merged += list.length - 1;
  }
  return { merged, meshes: results };
}
