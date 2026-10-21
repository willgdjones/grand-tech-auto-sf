// Print the skinned (idle-posed) world bounds of avatar GLBs (strips images so three can parse in node). Lane D debug aid.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { AnimationMixer, Box3, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression') e.dispose();
  const bytes = await io.writeBinary(doc);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const mixer = new AnimationMixer(gltf.scene); const idle = gltf.animations.find(a => a.name === 'idle'); if (idle) mixer.clipAction(idle).play(); mixer.update(0);
  gltf.scene.updateMatrixWorld(true);
  const box = new Box3(), v = new Vector3(); let meshScale = '';
  gltf.scene.traverse(o => { if (o instanceof SkinnedMesh) { meshScale += ` mesh ${o.name} worldScale=${o.getWorldScale(new Vector3()).toArray().map(n => n.toFixed(4))} bindMode=${o.bindMode}`;
    const p = o.geometry.getAttribute('position'); for (let i = 0; i < p.count; i += 7) box.expandByPoint(o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld)); } });
  console.log(file.split('/').pop(), 'min', box.min.toArray().map(n => n.toFixed(2)), 'max', box.max.toArray().map(n => n.toFixed(2)), meshScale);
}
