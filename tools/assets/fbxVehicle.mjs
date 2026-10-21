/**
 * Fixed rgsdev FBX -> GLB car converter for deploy #4 (gtasf-v21-sa-cars-uoon).
 *
 * This is the corrected successor to the reverted in-build converter (973d83d), which produced
 * MONOCHROME bodies (took only material[0] of each multi-material mesh) and STATIC wheels (baked all
 * geometry flat, so no `wheel-*` nodes for the loader to animate). This module fixes both and also
 * carries normals (the old one dropped them, giving flat/dark lighting):
 *
 *   1. Multi-material split: each mesh is split by geometry.groups into one primitive per material,
 *      coloured by that material's name (body* -> paint, else CAR_MATERIAL, else the FBX colour).
 *   2. Named wheel nodes: meshes named `<Model>_wheel_<front|rear>_<left|right>` become nodes named
 *      `wheel-front/back-left/right` (the pattern web/src/vehicles/models/vehicle.ts animates), with
 *      geometry re-centred on the wheel so the node pivot is the axle — spin/steer work.
 *   3. Normals transformed by the orient basis so lighting is correct.
 *
 * It is DELIBERATELY NOT wired into build.mjs: the live fleet stays the Kenney cars until deploy #4
 * explicitly imports this + rebuilds AND pane 6 verifies the look (orientation/colours/wheels) in
 * game. Run `node tools/assets/fbxVehicle.mjs` to structurally validate the conversion on the Sedan.
 */
import { readFile } from 'node:fs/promises';
import { Document } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { Box3, Color, Matrix3, Matrix4, Vector3 } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** Named overrides; everything starting with "body" takes the car's paint colour. */
const CAR_MATERIAL = {
  tires: '#111113', windows: '#1b2a30', headlights: '#f3e7a8', 'rear lights': '#aa2320',
  wheels: '#8c8c90', 'body black': '#141414',
};
const WHEEL_NAME = /wheel[_-](front|rear|back)[_-](left|right)/i;

function colourFor(name, material, paint) {
  const mapped = CAR_MATERIAL[name];
  if (mapped) { const c = new Color(mapped); return [c.r, c.g, c.b]; }
  if (name.startsWith('body')) return paint;
  if (material?.color) return [material.color.r, material.color.g, material.color.b];
  return [0.53, 0.53, 0.53];
}

/** Groups of index-ranges keyed by materialIndex (whole mesh as one group if ungrouped). */
function groupsByMaterial(geometry) {
  const groups = geometry.groups && geometry.groups.length
    ? geometry.groups
    : [{ start: 0, count: geometry.index ? geometry.index.count : geometry.attributes.position.count, materialIndex: 0 }];
  const byMaterial = new Map();
  for (const group of groups) {
    const mi = group.materialIndex ?? 0;
    if (!byMaterial.has(mi)) byMaterial.set(mi, []);
    byMaterial.get(mi).push(group);
  }
  return byMaterial;
}

/** Expand a material's groups into flat (non-indexed) position + normal arrays in the target frame. */
function collect(geometry, groups, point, normalMatrix, centre) {
  const pos = geometry.attributes.position, nrm = geometry.attributes.normal, index = geometry.index;
  const positions = [], normals = [];
  const p = new Vector3(), n = new Vector3();
  for (const group of groups) {
    const end = group.start + group.count;
    for (let k = group.start; k < end; k++) {
      const vi = index ? index.array[k] : k;
      p.fromBufferAttribute(pos, vi).applyMatrix4(point);
      if (centre) p.sub(centre);
      positions.push(p.x, p.y, p.z);
      if (nrm) { n.fromBufferAttribute(nrm, vi).applyMatrix3(normalMatrix).normalize(); normals.push(n.x, n.y, n.z); }
    }
  }
  return { positions: new Float32Array(positions), normals: nrm ? new Float32Array(normals) : null };
}

export async function fbxVehicle(fbxPath, dimensions, paint) {
  const buffer = await readFile(fbxPath);
  const group = new FBXLoader().parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  group.updateMatrixWorld(true);
  const meshes = [];
  group.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o); });
  if (!meshes.length) throw new Error(`${fbxPath}: no meshes`);

  // Orientation: smallest extent = up, longest horizontal = length, front from the headlights centroid.
  const whole = new Box3().setFromObject(group);
  const size = whole.getSize(new Vector3()), centre = whole.getCenter(new Vector3());
  const axes = [['x', size.x], ['y', size.y], ['z', size.z]];
  const heightAxis = axes.slice().sort((a, b) => a[1] - b[1])[0][0];
  const horizontal = axes.filter(([a]) => a !== heightAxis).sort((a, b) => b[1] - a[1]);
  const lengthAxis = horizontal[0][0], widthAxis = horizontal[1][0];
  const head = headlightCentroid(meshes);
  const frontSign = head ? ((head[lengthAxis] - centre[lengthAxis]) >= 0 ? 1 : -1) : 1;
  const unit = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
  const basis = new Matrix4().makeBasis(unit[widthAxis], unit[heightAxis], unit[lengthAxis].clone().multiplyScalar(frontSign)).invert();

  const doc = new Document();
  const buf = doc.createBuffer(), scene = doc.createScene();
  doc.getRoot().setDefaultScene(scene);

  for (const mesh of meshes) {
    const point = new Matrix4().multiplyMatrices(basis, mesh.matrixWorld);
    const normalMatrix = new Matrix3().getNormalMatrix(point);
    const wheel = mesh.name.match(WHEEL_NAME);
    let centreOriented = null, nodeName = mesh.name || 'part';
    if (wheel) {
      const c = new Box3().setFromObject(mesh).getCenter(new Vector3()).applyMatrix4(basis);
      centreOriented = c;
      const fb = /rear|back/i.test(wheel[1]) ? 'back' : 'front';
      nodeName = `wheel-${fb}-${wheel[2].toLowerCase()}`;
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const gltfMesh = doc.createMesh(nodeName);
    for (const [mi, groups] of groupsByMaterial(mesh.geometry)) {
      const material = mats[mi] || mats[0];
      const name = (material?.name || mesh.name || '').toLowerCase();
      const { positions, normals } = collect(mesh.geometry, groups, point, normalMatrix, centreOriented);
      if (!positions.length) continue;
      const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(positions));
      if (normals) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(normals));
      const [r, g, b] = colourFor(name, material, paint);
      prim.setMaterial(doc.createMaterial(name || 'part').setBaseColorFactor([linear(r), linear(g), linear(b), 1]).setRoughnessFactor(0.7).setMetallicFactor(name === 'wheels' ? 0.1 : 0));
      gltfMesh.addPrimitive(prim);
    }
    const node = doc.createNode(nodeName).setMesh(gltfMesh);
    if (centreOriented) node.setTranslation([centreOriented.x, centreOriented.y, centreOriented.z]);
    scene.addChild(node);
  }
  normalise(doc, dimensions);
  return doc;
}

/** Centroid (model space) of any mesh/group whose material name mentions "headlight". */
function headlightCentroid(meshes) {
  const sum = new Vector3(); let n = 0; const p = new Vector3();
  for (const mesh of meshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const [mi, groups] of groupsByMaterial(mesh.geometry)) {
      if (!/head/i.test(mats[mi]?.name || '')) continue;
      const pos = mesh.geometry.attributes.position, index = mesh.geometry.index;
      for (const group of groups) for (let k = group.start; k < group.start + group.count; k++) {
        const vi = index ? index.array[k] : k;
        p.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld); sum.add(p); n++;
      }
    }
  }
  return n ? sum.divideScalar(n) : null;
}

/** Scale + centre the whole model to the target metre dims, ground at y=0 (parent frame node). */
function normalise(doc, dimensions) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const bounds = getBounds(scene);
  const scale = dimensions.map((v, i) => v / (bounds.max[i] - bounds.min[i]));
  const frame = doc.createNode('model-metre-frame').setScale(scale).setTranslation([
    -(bounds.min[0] + bounds.max[0]) / 2 * scale[0], -bounds.min[1] * scale[1],
    -(bounds.min[2] + bounds.max[2]) / 2 * scale[2],
  ]);
  for (const node of scene.listChildren()) frame.addChild(node);
  scene.addChild(frame);
  return scene;
}

// Structural validation (no rendering): colours, wheel nodes, dims. Run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const fbx = process.argv[2] || 'tools/assets/cache/rgsdev/Free Low Poly Vehicles Pack by Rgsdev/Sedan/Sedan.fbx';
  const doc = await fbxVehicle(fbx, [1.76, 1.47, 4.54], [0.75, 0.78, 0.8]);
  const root = doc.getRoot();
  const mats = root.listMaterials().map((m) => `${m.getName()}=${m.getBaseColorFactor().slice(0, 3).map((v) => v.toFixed(2)).join(',')}`);
  const wheelNodes = root.listNodes().map((n) => n.getName()).filter((n) => /^wheel-(front|back)-(left|right)$/.test(n));
  const bounds = getBounds(root.getDefaultScene());
  const dims = [0, 1, 2].map((i) => (bounds.max[i] - bounds.min[i]).toFixed(2));
  console.log(`materials (${mats.length}): ${mats.join(' | ')}`);
  console.log(`wheel-pattern nodes (${wheelNodes.length}): ${wheelNodes.join(', ')}`);
  console.log(`dims (L/W/H order x,y,z): ${dims.join(' x ')}  (target 1.76 x 1.47 x 4.54)`);
  const ok = mats.length >= 6 && wheelNodes.length === 4;
  console.log(ok ? 'PASS: multi-colour + 4 animatable wheels' : 'FAIL: check split/wheel naming');
  process.exit(ok ? 0 : 1);
}
