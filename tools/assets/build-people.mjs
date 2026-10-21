/** CC0 pedestrian/player bodies (lane D, gtasf-laned-cc0-characters-km1i6): Quaternius Ultimate Modular Men/Women
 * characters that share the hoodie's rig. Each is downloaded from its CC0 Poly Pizza listing (pinned sha256), keeps
 * Idle/Walk/Run (renamed idle/walk/run), gains the same GTASF-authored seated loop as the hoodie (build.mjs), is
 * normalised to a standing height and meshopt-compressed to web/public/assets/avatars/<id>.glb.
 * Run: node tools/assets/build-people.mjs [cacheDir]. Single process, no Blender. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { AnimationMixer, Vector3, Quaternion, PropertyBinding } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Every listing below shows "Public Domain (CC0)" on its own Poly Pizza page (checked 2026-10-14). */
export const PEOPLE = [
  { id: 'business-man', title: 'Business Man', page: 'https://poly.pizza/m/JFrLIKqvCH', height: 1.78,
    url: 'https://static.poly.pizza/e599abbe-7d73-488c-9d7e-3ead281e705c.glb', sha256: '82b81257c1e94cd9ee48cb1dcbe5ff506e81c9ce67cd0c5af542d8712dca546e' },
  { id: 'casual-man', title: 'Casual Character', page: 'https://poly.pizza/m/kZ3DmIoGip', height: 1.76,
    url: 'https://static.poly.pizza/90a9e2d4-053f-42f1-99a2-8f5e1180ea7f.glb', sha256: 'fea7e71271203e7073f1a073fa1208de7402df276f87f80e149bf7589b5d46b4' },
  { id: 'beach-man', title: 'Beach Character', page: 'https://poly.pizza/m/DojKLcO34E', height: 1.75,
    url: 'https://static.poly.pizza/f771a536-1c18-4a47-bb56-ceea4b603455.glb', sha256: '67c366f8c1e9ba3d3767213bc8660579a4f8028ed647a33c53d05596e8dd888c' },
  { id: 'worker-man', title: 'Worker', page: 'https://poly.pizza/m/Yg2bQZO6Hj', height: 1.77,
    url: 'https://static.poly.pizza/3a5f3056-ffe6-42eb-bd52-122afcbd22b2.glb', sha256: '9c28614f465b7dc105f908c20c22fc045f4b07caf8c5ef0e9f8049eceb6dd38d' },
  { id: 'punk-man', title: 'Punk', page: 'https://poly.pizza/m/BTALZymknF', height: 1.76,
    url: 'https://static.poly.pizza/e56f23b5-3270-406f-8924-f77cad980c43.glb', sha256: '94afa8718093cc7f9e51cdc0b35f4432c1c2f1901177f98fbbbcb4c6fd79b163' },
  { id: 'casual-woman', title: 'Animated Woman (casual)', page: 'https://poly.pizza/m/qJ2gsTUBHL', height: 1.66,
    url: 'https://static.poly.pizza/ba7a1955-ea51-4cb9-a561-188bdef0a6c7.glb', sha256: 'a2212729826b718e59e698211ed3951c22459b48733b1ee6a24fac0abf74dca8' },
  { id: 'formal-woman', title: 'Animated Woman (formal)', page: 'https://poly.pizza/m/nIItLV9nxS', height: 1.67,
    url: 'https://static.poly.pizza/46d6db5a-3c9f-4238-8cdf-8eb7194498dc.glb', sha256: 'a6522fe53d15de21130a957d1bf2b8a9a58d4e4e9a12af646645b667a9bb2d17' },
  { id: 'punk-woman', title: 'Punk', page: 'https://poly.pizza/m/djXoqejw6w', height: 1.65,
    url: 'https://static.poly.pizza/1d368679-1d9a-4d5c-9095-877144b02d00.glb', sha256: '77cbb6838bf207fc948848ddb389ea43d4bb30c52ec62c5a2fc84bbf35c88c52' },
];

const cache = resolve(process.argv[2] || 'tools/assets/cache/people');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const output = join(repo, 'web/public/assets/avatars');
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
await mkdir(cache, { recursive: true }); await mkdir(output, { recursive: true });
const report = [];

for (const person of PEOPLE) {
  const raw = join(cache, `${person.id}.glb`);
  let bytes;
  try { bytes = await readFile(raw); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(person.url);
    if (!response.ok) throw new Error(`${person.id}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== person.sha256) throw new Error(`${person.id}: source checksum changed; review provenance before updating`);
  await writeFile(raw, bytes);
  const doc = await io.readBinary(new Uint8Array(bytes));
  const keep = new Map([['CharacterArmature|Idle', 'idle'], ['CharacterArmature|Walk', 'walk'], ['CharacterArmature|Run', 'run']]);
  for (const animation of doc.getRoot().listAnimations()) {
    if (keep.has(animation.getName())) animation.setName(keep.get(animation.getName()));
    else animation.dispose();
  }
  // The hoodie's GTASF-authored sitting loop (build.mjs), solved on this body's own bind proportions.
  const decoded = await io.writeBinary(await io.readBinary(new Uint8Array(bytes)));
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength), '');
  const mixer = new AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations.find(a => a.name === 'CharacterArmature|Idle')).play();
  mixer.update(0); gltf.scene.updateMatrixWorld(true);
  const bone = name => gltf.scene.getObjectByName(PropertyBinding.sanitizeNodeName(name));
  function aim(name, childName, direction) {
    const node = bone(name), child = bone(childName);
    const current = child.getWorldPosition(new Vector3()).sub(node.getWorldPosition(new Vector3())).normalize();
    const desired = new Quaternion().setFromUnitVectors(current, new Vector3(...direction).normalize()).multiply(node.getWorldQuaternion(new Quaternion()));
    node.quaternion.copy(node.parent.getWorldQuaternion(new Quaternion()).invert().multiply(desired));
    gltf.scene.updateMatrixWorld(true);
  }
  bone('Body').position.y -= .0038; gltf.scene.updateMatrixWorld(true);
  for (const side of ['L', 'R']) {
    aim(`UpperLeg.${side}`, `LowerLeg.${side}`, [0, 0, 1]);
    aim(`LowerLeg.${side}`, `LowerLeg.${side}_end`, [0, -1, 0]);
    const ankle = bone(`LowerLeg.${side}_end`).getWorldPosition(new Vector3()), foot = bone(`Foot.${side}`);
    foot.position.copy(foot.parent.worldToLocal(ankle)); gltf.scene.updateMatrixWorld(true);
    aim(`UpperArm.${side}`, `LowerArm.${side}`, [side === 'L' ? .15 : -.15, -1, .2]);
    aim(`LowerArm.${side}`, `Wrist.${side}`, [0, -.3, 1]);
  }
  const sit = doc.createAnimation('sit');
  const times = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1, 2]));
  for (const node of doc.getRoot().listNodes()) {
    const posed = bone(node.getName());
    if (!posed || !posed.isBone) continue;
    for (const [path, type, value] of [['translation', 'VEC3', posed.position.toArray()], ['rotation', 'VEC4', posed.quaternion.toArray()], ['scale', 'VEC3', posed.scale.toArray()]]) {
      const middle = [...value];
      if (node.getName() === 'Body' && path === 'translation') middle[1] += .00004;
      const values = doc.createAccessor().setType(type).setArray(new Float32Array([...value, ...middle, ...value]));
      const sampler = doc.createAnimationSampler().setInput(times).setOutput(values).setInterpolation('LINEAR');
      sit.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
    }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
  // Uniform metre frame: feet at y=0, centred, standing height `person.height`.
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0], bounds = getBounds(scene);
  const s = person.height / (bounds.max[1] - bounds.min[1]);
  const frame = doc.createNode('model-metre-frame').setScale([s, s, s])
    .setTranslation([-(bounds.min[0] + bounds.max[0]) / 2 * s, -bounds.min[1] * s, -(bounds.min[2] + bounds.max[2]) / 2 * s]);
  for (const node of scene.listChildren()) frame.addChild(node);
  scene.addChild(frame);
  for (const material of doc.getRoot().listMaterials()) material.setRoughnessFactor(.92).setMetallicFactor(0);
  await doc.transform(prune(), dedup(), resample(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 14, quantizeNormal: 10 }));
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  for (const accessor of doc.getRoot().listAccessors()) accessor.setBuffer(buffer);
  await doc.transform(prune());
  const out = await io.writeBinary(doc);
  if (out.byteLength >= 600_000) throw new Error(`${person.id} exceeds 600 KB (hoodie.glb is 535 KB)`);
  await writeFile(join(output, `${person.id}.glb`), out);
  report.push({ id: person.id, path: `avatars/${person.id}.glb`, bytes: out.byteLength, sha256: createHash('sha256').update(out).digest('hex'),
    source: person.page, sourceUrl: person.url, sourceSha256: person.sha256, license: 'CC0-1.0', creator: 'Quaternius',
    animations: doc.getRoot().listAnimations().map(a => a.getName()) });
  console.log(`avatars/${person.id}.glb: ${out.byteLength} bytes`);
}
await writeFile(join(repo, 'tools/assets/report-people.json'), JSON.stringify(report, null, 2) + '\n');
