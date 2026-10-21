/**
 * Deploy-#4 car build (gtasf-v21-sa-cars-uoon): rgsdev FBX -> fixed multi-colour GLB via
 * fbxVehicle.mjs, plus each car's procedural add-ons (roof rails / lidar rotor+sensors / spoiler),
 * meshopt-compressed under the 300 KB budget. This is the successor to the reverted in-build swap;
 * the bugs that forced the revert (monochrome bodies, static wheels, dropped normals) are fixed in
 * fbxVehicle.mjs and validated fleet-wide.
 *
 * DELIBERATELY SEPARATE from build.mjs and defaulting to a PREVIEW dir: running it does NOT touch the
 * live Kenney fleet. Deploy #4, after pane 6 verifies the look (orientation / wheel spin / colours),
 * runs it straight into the live assets dir:
 *
 *     node tools/assets/build-cars.mjs web/public/assets      # deploy #4 (live)
 *     node tools/assets/build-cars.mjs                        # preview-only (tools/assets/preview-cars)
 *
 * It also re-adds the rgsdev source: see tools/assets/sources.json (rgsdev) + download.mjs before #4.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { BoxGeometry, CylinderGeometry, Color } from 'three';
import { fbxVehicle } from './fbxVehicle.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(process.argv[2] || join(repo, 'tools/assets/preview-cars'));
const cache = resolve(process.argv[3] || join(repo, 'tools/assets/cache'));
const RGS = 'rgsdev/Free Low Poly Vehicles Pack by Rgsdev';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

/** Add a flat-coloured primitive node (box/cylinder add-on) to a parent, in metre space. */
function geometry(doc, parent, name, shape, colour, xyz = [0, 0, 0]) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const primitive = doc.createPrimitive();
  for (const [attr, semantic] of [['position', 'POSITION'], ['normal', 'NORMAL']]) {
    primitive.setAttribute(semantic, doc.createAccessor().setType('VEC3').setBuffer(buffer)
      .setArray(new Float32Array(shape.getAttribute(attr).array)));
  }
  primitive.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint16Array(shape.index.array)));
  const c = new Color(colour);
  primitive.setMaterial(doc.createMaterial(colour).setBaseColorFactor([c.r, c.g, c.b, 1]).setRoughnessFactor(0.85));
  const node = doc.createNode(name).setTranslation(xyz).setMesh(doc.createMesh(name).addPrimitive(primitive));
  parent.addChild(node); shape.dispose(); return node;
}
const box = (d, p, n, size, c, xyz) => geometry(d, p, n, new BoxGeometry(...size), c, xyz);
const cylinder = (d, p, n, radius, height, c, xyz) => geometry(d, p, n, new CylinderGeometry(radius, radius, height, 12), c, xyz);

const fbxCars = [
  { id: 'prius', model: 'Hatchback', size: [1.76, 1.47, 4.54], paint: [0.66, 0.73, 0.73] },
  { id: 'model3', model: 'Sedan', size: [1.85, 1.44, 4.69], paint: [0.88, 0.91, 0.94] },
  { id: 'outback', model: 'SUV', size: [1.87, 1.67, 4.82], paint: [0.2, 0.39, 0.3], rails: true },
  { id: 'robotaxi', model: 'SUV', size: [1.94, 1.7, 4.8], paint: [0.96, 0.96, 0.94], lidar: true },
  { id: 'vc-supercar', model: 'Sports', size: [2.12, 1.08, 4.8], paint: [0.8, 0.15, 0.75], spoiler: true },
];

async function save(doc, path) {
  await doc.transform(prune(), dedup(), resample(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 14, quantizeNormal: 10 }));
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  for (const accessor of doc.getRoot().listAccessors()) accessor.setBuffer(buffer);
  await doc.transform(prune());
  const bytes = await io.writeBinary(doc);
  if (bytes.byteLength >= 300_000) throw new Error(`${path} exceeds 300 KB (${bytes.byteLength})`);
  await mkdir(join(output, path.split('/')[0]), { recursive: true });
  await writeFile(join(output, path), bytes);
  return bytes.byteLength;
}

for (const v of fbxCars) {
  const rel = `${RGS}/${v.model}/${v.model}.fbx`;
  const doc = await fbxVehicle(join(cache, rel), v.size, v.paint);
  const scene = doc.getRoot().getDefaultScene();
  if (v.rails) for (const x of [-0.65, 0.65]) box(doc, scene, 'roof-rail', [0.055, 0.08, 2.45], '#252c30', [x, 1.7, -0.15]);
  if (v.lidar) {
    box(doc, scene, 'sensor-roof-bar', [1.45, 0.10, 0.28], '#eeeeea', [0, 1.74, 0]);
    cylinder(doc, scene, 'lidar-base', 0.21, 0.13, '#e9ede9', [0, 1.85, 0]);
    const rotor = doc.createNode('lidar').setTranslation([0, 1.98, 0]); scene.addChild(rotor);
    cylinder(doc, rotor, 'lidar-puck', 0.24, 0.17, '#303a3e');
    box(doc, rotor, 'lidar-index', [0.08, 0.06, 0.03], '#59c4b2', [0, 0, 0.24]);
    for (const x of [-0.99, 0.99]) box(doc, scene, 'side-sensor', [0.09, 0.14, 0.3], '#272f34', [x, 1.12, 1.35]);
  }
  if (v.spoiler) {
    for (const x of [-0.72, 0.72]) box(doc, scene, 'spoiler-upright', [0.09, 0.65, 0.16], '#282535', [x, 1.15, -1.85]);
    box(doc, scene, 'ridiculous-spoiler', [2.5, 0.12, 0.55], '#d528a4', [0, 1.48, -1.85]);
  }
  const bytes = await save(doc, `vehicles/${v.id}.glb`);
  const nodes = doc.getRoot().listNodes().map((n) => n.getName());
  const wheels = nodes.filter((n) => /^wheel-(front|back)-(left|right)$/.test(n)).length;
  const extras = [v.rails && 'rails', v.lidar && (nodes.includes('lidar') ? 'lidar✓' : 'lidar✗'), v.spoiler && 'spoiler'].filter(Boolean).join('+') || 'base';
  console.log(`${v.id}: ${(bytes / 1024).toFixed(1)} KB, ${doc.getRoot().listMaterials().length} mats, ${wheels} wheels, ${extras}`);
}
console.log(`\nwrote 5 cars -> ${output}`);
