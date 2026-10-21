/** Rebuild the CC0 fleet from the sources documented in README.md. Single process, no Blender. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { BoxGeometry, CylinderGeometry, Color, AnimationMixer, Vector3, Quaternion, PropertyBinding } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import sharp from 'sharp';

const source = resolve(process.argv[2] || 'tools/assets/cache');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const output = join(repo, 'web/public/assets');
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
const audit = [];
const linear = (v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;

/** Bake the small colour palette into linear vertex colours; no runtime texture allocation. */
async function vertexColours(doc, paint) {
  const images = new Map();
  for (const texture of doc.getRoot().listTextures()) {
    images.set(texture, await sharp(texture.getImage()).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  }
  const material = doc.createMaterial('vertex-colours').setRoughnessFactor(.88).setMetallicFactor(0);
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const old = primitive.getMaterial(), texture = old?.getBaseColorTexture(), uv = primitive.getAttribute('TEXCOORD_0');
    if (!texture || !uv) continue;
    const { data, info } = images.get(texture);
    if (info.width * info.height > 1_000_000) throw new Error('Source texture exceeds 1 MP');
    const transform = old.getBaseColorTextureInfo()?.getExtension('KHR_texture_transform');
    const offset = transform?.getOffset() ?? [0, 0], scale = transform?.getScale() ?? [1, 1];
    if (transform?.getRotation()) throw new Error('Rotated source palette needs explicit baking');
    const colours = new Float32Array(uv.getCount() * 3);
    for (let i = 0; i < uv.getCount(); i++) {
      const p = uv.getElement(i, []);
      const x = Math.max(0, Math.min(info.width - 1, Math.floor((p[0] * scale[0] + offset[0]) * info.width)));
      const y = Math.max(0, Math.min(info.height - 1, Math.floor((p[1] * scale[1] + offset[1]) * info.height)));
      const index = (y * info.width + x) * 4;
      let rgb = Array.from(data.subarray(index, index + 3), v => v / 255);
      // Repaint the kit's orange/green/blue body panels, preserving tyres, glass and lamps.
      const [r, g, b] = rgb;
      const bodyPanel = (r > .65 && g > .3 && b < .5) ||
        (g > r * 1.3 && g > b * 1.2) || (b > .6 && b > r * 1.7 && g < .65);
      if (paint && mesh.getName().includes('body') && bodyPanel) {
        const brightness = Math.max(r, g, b);
        rgb = paint.map(v => v * (.8 + .2 * brightness));
      }
      colours.set(rgb.map(linear), i * 3);
    }
    primitive.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(colours));
    primitive.setAttribute('TEXCOORD_0', null).setMaterial(material);
  }
}

function geometry(doc, parent, name, shape, colour, xyz = [0, 0, 0]) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const primitive = doc.createPrimitive();
  for (const [attr, semantic] of [['position', 'POSITION'], ['normal', 'NORMAL']]) {
    primitive.setAttribute(semantic, doc.createAccessor().setType('VEC3').setBuffer(buffer)
      .setArray(new Float32Array(shape.getAttribute(attr).array)));
  }
  primitive.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer)
    .setArray(new Uint16Array(shape.index.array)));
  const c = new Color(colour);
  primitive.setMaterial(doc.createMaterial(colour).setBaseColorFactor([c.r, c.g, c.b, 1]).setRoughnessFactor(.85));
  const node = doc.createNode(name).setTranslation(xyz).setMesh(doc.createMesh(name).addPrimitive(primitive));
  parent.addChild(node); shape.dispose(); return node;
}
const box = (d, p, n, size, c, xyz) => geometry(d, p, n, new BoxGeometry(...size), c, xyz);
const cylinder = (d, p, n, radius, height, c, xyz) => geometry(d, p, n, new CylinderGeometry(radius, radius, height, 12), c, xyz);

function normalise(doc, dimensions) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const bounds = getBounds(scene);
  const scale = dimensions.map((v, i) => v / (bounds.max[i] - bounds.min[i]));
  const frame = doc.createNode('model-metre-frame').setScale(scale).setTranslation([
    -(bounds.min[0] + bounds.max[0]) / 2 * scale[0], -bounds.min[1] * scale[1],
    -(bounds.min[2] + bounds.max[2]) / 2 * scale[2],
  ]);
  for (const node of scene.listChildren()) frame.addChild(node);
  scene.addChild(frame); return scene;
}

const vehicles = [
  { id: 'prius', file: 'hatchback-sports', size: [1.76, 1.47, 4.54], paint: [.66, .73, .73] },
  { id: 'model3', file: 'sedan', size: [1.85, 1.44, 4.69], paint: [.88, .91, .94] },
  { id: 'outback', file: 'suv-luxury', size: [1.87, 1.67, 4.82], paint: [.2, .39, .3] },
  { id: 'muni-bus', file: 'van', size: [2.55, 3.05, 11.9], paint: [.9, .9, .86] },
  { id: 'robotaxi', file: 'suv-luxury', size: [1.94, 1.7, 4.8], paint: [.96, .96, .94] },
  { id: 'vc-supercar', file: 'race-future', size: [2.12, 1.08, 4.8], paint: [.8, .15, .75] },
];

async function save(doc, path, sourceFile) {
  // Static bind-pose bounds must be measured before quantization compensation of skin matrices.
  const bounds = getBounds(doc.getRoot().listScenes()[0]);
  // meshopt includes reorder + quantize. Do not quantize twice (would lose precision).
  await doc.transform(prune(), dedup(), resample(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 14, quantizeNormal: 10 }));
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  for (const accessor of doc.getRoot().listAccessors()) accessor.setBuffer(buffer);
  await doc.transform(prune());
  const bytes = await io.writeBinary(doc);
  if (path.startsWith('vehicles/') && bytes.byteLength >= 300_000) throw new Error(`${path} exceeds 300 KB`);
  await mkdir(join(output, path.split('/')[0]), { recursive: true });
  await writeFile(join(output, path), bytes);
  audit.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    source: sourceFile, sourceSha256: createHash('sha256').update(await readFile(join(source, sourceFile))).digest('hex'),
    bounds, animations: doc.getRoot().listAnimations().map(a => a.getName()), skins: doc.getRoot().listSkins().length,
    triangles: doc.getRoot().listMeshes().reduce((sum, m) => sum + m.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0),
  });
  console.log(`${path}: ${bytes.length} bytes`);
}

for (const v of vehicles) {
  const path = `kenney/Models/GLB format/${v.file}.glb`;
  const doc = await io.read(join(source, path));
  // The spare rear tyre belongs to an SUV, not a long-roof Outback-style wagon.
  if (v.id === 'outback') doc.getRoot().listNodes().find(n => n.getName() === 'wheel-back')?.dispose();
  // A flat-front city bus keeps the source running gear; a stretched delivery van would read poorly.
  if (v.id === 'muni-bus') doc.getRoot().listNodes().find(n => n.getName() === 'body')?.dispose();
  await vertexColours(doc, v.paint);
  const scene = normalise(doc, v.id === 'muni-bus' ? [2.55, .9, 8] : v.size);
  if (v.id === 'outback') for (const x of [-.65, .65]) box(doc, scene, 'roof-rail', [.055, .08, 2.45], '#252c30', [x, 1.7, -.15]);
  if (v.id === 'robotaxi') {
    box(doc, scene, 'sensor-roof-bar', [1.45, .10, .28], '#eeeeea', [0, 1.74, 0]);
    cylinder(doc, scene, 'lidar-base', .21, .13, '#e9ede9', [0, 1.85, 0]);
    const rotor = doc.createNode('lidar').setTranslation([0, 1.98, 0]); scene.addChild(rotor);
    cylinder(doc, rotor, 'lidar-puck', .24, .17, '#303a3e');
    box(doc, rotor, 'lidar-index', [.08, .06, .03], '#59c4b2', [0, 0, .24]);
    for (const x of [-.99, .99]) box(doc, scene, 'side-sensor', [.09, .14, .3], '#272f34', [x, 1.12, 1.35]);
  }
  if (v.id === 'muni-bus') {
    box(doc, scene, 'bus-body', [2.48, 2.25, 11.9], '#edece5', [0, 1.875, 0]);
    box(doc, scene, 'bus-chassis', [2.35, .32, 11.95], '#383d41', [0, .62, 0]);
    box(doc, scene, 'windshield', [2.22, 1.1, .04], '#294049', [0, 2.06, 5.97]);
    box(doc, scene, 'rear-window', [2.1, .8, .04], '#294049', [0, 2.2, -5.97]);
    for (const x of [-.98, .98]) box(doc, scene, 'bus-headlight', [.25, .2, .05], '#f5e8ad', [x, .98, 5.98]);
    for (const x of [-1.285, 1.285]) {
      box(doc, scene, 'transit-red-stripe', [.035, .4, 10.8], '#ae282c', [x, 1.22, 0]);
      for (let z = -4.6; z < 4.2; z += 1.4) box(doc, scene, 'bus-window', [.045, .8, 1.13], '#253c43', [x, 2.13, z]);
    }
    box(doc, scene, 'route-display', [1.85, .3, .035], '#272b24', [0, 2.77, 5.91]);
    box(doc, scene, 'roof-hvac', [1.6, .22, 2.3], '#d4d7d2', [0, 3.12, -1]);
    for (const z of [3.55, -.45]) box(doc, scene, 'double-door', [.05, 1.9, 1.1], '#30383a', [1.31, 1.4, z]);
  }
  if (v.id === 'vc-supercar') {
    for (const x of [-.72, .72]) box(doc, scene, 'spoiler-upright', [.09, .65, .16], '#282535', [x, 1.15, -1.85]);
    box(doc, scene, 'ridiculous-spoiler', [2.5, .12, .55], '#d528a4', [0, 1.48, -1.85]);
  }
  await save(doc, `vehicles/${v.id}.glb`, path);
}

// Kenney running gear + an open Powell-style timber body. No trolley pole: cable propulsion.
{
  const path = 'train/Models/GLB format/train-tram-classic.glb';
  const doc = await io.read(join(source, path));
  const root = doc.getRoot().listNodes().find(n => n.getName() === 'train-tram-classic');
  root.setMesh(null);
  doc.getRoot().listNodes().find(n => n.getName() === 'collector')?.dispose();
  await vertexColours(doc);
  const scene = normalise(doc, [2.25, .8, 6.1]);
  box(doc, scene, 'timber-deck', [2.35, .25, 8.2], '#9a6337', [0, .85, 0]);
  box(doc, scene, 'clerestory-roof', [2.55, .22, 8.45], '#c9b181', [0, 3.05, 0]);
  box(doc, scene, 'clerestory-top', [1.25, .22, 5.8], '#e6d6ad', [0, 3.25, -.3]);
  for (const x of [-1.08, 1.08]) {
    for (let z = -3.7; z <= 3.7; z += 1.48) box(doc, scene, 'brass-roof-post', [.08, 2.05, .08], '#ceac59', [x, 1.93, z]);
    box(doc, scene, 'running-board', [.32, .12, 7.8], '#866037', [x * 1.2, .58, 0]);
    box(doc, scene, 'closed-cabin-panel', [.12, .85, 3.8], '#832d26', [x, 1.38, -1.65]);
    for (const z of [-3, -2, -1, 0]) box(doc, scene, 'cabin-window', [.06, .8, .76], '#577979', [x, 2.25, z]);
    box(doc, scene, 'open-bench-seat', [.43, .13, 2.9], '#bd8647', [x * .7, 1.2, 2.1]);
    box(doc, scene, 'open-bench-back', [.10, .5, 2.9], '#9d6032', [x * .42, 1.46, 2.1]);
  }
  for (const z of [-4, 4]) {
    box(doc, scene, 'end-panel', [2.25, .78, .14], '#832d26', [0, 1.35, z]);
    box(doc, scene, 'destination-board', [1.65, .3, .07], '#efe1b9', [0, 2.8, z]);
  }
  await save(doc, 'vehicles/powell-cable-car.glb', path);
}

{
  const path = 'hoodie.glb';
  const doc = await io.read(join(source, path));
  const keep = new Map([['CharacterArmature|Idle', 'idle'], ['CharacterArmature|Walk', 'walk'], ['CharacterArmature|Run', 'run']]);
  for (const animation of doc.getRoot().listAnimations()) {
    if (keep.has(animation.getName())) animation.setName(keep.get(animation.getName()));
    else animation.dispose();
  }
  // GTASF-authored sitting loop, derived from Quaternius's neutral idle pose.
  // Solve limb directions in world space because this rig has independently parented foot bones.
  const bytes = await readFile(join(source, path));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const mixer = new AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations.find(a => a.name === 'CharacterArmature|Idle')).play();
  mixer.update(0); gltf.scene.updateMatrixWorld(true);
  const bone = name => gltf.scene.getObjectByName(PropertyBinding.sanitizeNodeName(name));
  function aim(name, childName, direction) {
    const node = bone(name), child = bone(childName);
    const current = child.getWorldPosition(new Vector3()).sub(node.getWorldPosition(new Vector3())).normalize();
    const q = new Quaternion().setFromUnitVectors(current, new Vector3(...direction).normalize());
    const desired = q.multiply(node.getWorldQuaternion(new Quaternion()));
    node.quaternion.copy(node.parent.getWorldQuaternion(new Quaternion()).invert().multiply(desired));
    gltf.scene.updateMatrixWorld(true);
  }
  bone('Body').position.y -= .0038; // native armature scale is 100: lower the hips 38 cm.
  gltf.scene.updateMatrixWorld(true);
  for (const side of ['L', 'R']) {
    aim(`UpperLeg.${side}`, `LowerLeg.${side}`, [0, 0, 1]);
    aim(`LowerLeg.${side}`, `LowerLeg.${side}_end`, [0, -1, 0]);
    const ankle = bone(`LowerLeg.${side}_end`).getWorldPosition(new Vector3());
    const foot = bone(`Foot.${side}`);
    foot.position.copy(foot.parent.worldToLocal(ankle));
    gltf.scene.updateMatrixWorld(true);
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
  const bounds = getBounds(doc.getRoot().listScenes()[0]);
  const scale = 1.75 / (bounds.max[1] - bounds.min[1]);
  normalise(doc, bounds.max.map((v, i) => (v - bounds.min[i]) * scale));
  for (const material of doc.getRoot().listMaterials()) material.setRoughnessFactor(.92).setMetallicFactor(0);
  await save(doc, 'avatars/hoodie.glb', path);
}

await writeFile(join(repo, 'tools/assets/report.json'), JSON.stringify(audit, null, 2) + '\n');
const labels = {
  prius: ['Hybrid hatchback', 'Prius'], model3: ['Electric sedan', 'Tesla Model 3'],
  outback: ['Trail wagon', 'Subaru Outback'], 'muni-bus': ['City bus', 'SF Muni'],
  robotaxi: ['Robotaxi', 'Generic white autonomous taxi'],
  'powell-cable-car': ['Powell cable car', 'Powell cable car'],
  'vc-supercar': ['VC supercar', 'An absurd supercar'], hoodie: ['Hoodie avatar', 'Quaternius Hoodie Character'],
};
const manifest = Object.fromEntries(audit.map(entry => {
  const id = entry.path.split('/')[1].replace('.glb', '');
  const [label, inspiration] = labels[id];
  return [id, { url: '/assets/' + entry.path, kind: entry.path.startsWith('avatars/') ? 'avatar' : 'vehicle',
    label, inspiration, bytes: entry.bytes, sha256: entry.sha256,
    license: 'CC0-1.0', creator: id === 'hoodie' ? 'Quaternius' : 'Kenney',
    sourceUrl: id === 'hoodie' ? 'https://poly.pizza/m/gKLBoRsyKe' : id === 'powell-cable-car' ? 'https://kenney.nl/assets/train-kit' : 'https://kenney.nl/assets/car-kit',
    bounds: entry.bounds, animations: entry.animations,
  }];
}));
await mkdir(join(repo, 'web/src/assets'), { recursive: true });
await writeFile(join(repo, 'web/src/assets/manifest.ts'), `// Generated by tools/assets/build.mjs; see /assets/LICENSES.md for licence/adaptation details.
// Metres, Y up, +Z forward; ground origin. World north remains -Z. Bounds are static bind bounds.
export const modelAssets = ${JSON.stringify(manifest, null, 2)} as const;
export type ModelAssetId = keyof typeof modelAssets;
export type VehicleAssetId = Exclude<ModelAssetId, 'hoodie'>;
export const avatarClips = ['idle', 'walk', 'run', 'sit'] as const;
export type AvatarClip = (typeof avatarClips)[number];
export const vehicleAssetIds = Object.keys(modelAssets).filter((id): id is VehicleAssetId => id !== 'hoodie');
`);
