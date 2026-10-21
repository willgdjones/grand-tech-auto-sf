// Print triangles, meshes, materials, textures, animation clips and skin joints of GLB files (asset bake-offs).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f); const root = doc.getRoot();
  let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); tris += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
  const joints = root.listSkins().flatMap(s => s.listJoints().map(j => j.getName()));
  const mats = root.listMaterials().map(m => m.getName());
  console.log(f.split('/').pop(), 'tris', Math.round(tris), 'meshes', root.listMeshes().map(m=>m.getName()).join(','), '| mats', mats.join(','), '| tex', root.listTextures().length, '| anims', root.listAnimations().map(a => a.getName()).slice(0,30).join(','), '| joints', joints.length, process.env.JOINTS ? joints.join(',') : joints.slice(0,6).join(','));
}
