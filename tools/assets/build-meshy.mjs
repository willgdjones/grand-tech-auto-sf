/**
 * Convert Meshy-generated PBR vehicles (tools/art/meshy.mjs -> ignored cache/meshy/*.glb) into the
 * realistic fleet under web/public/assets/vehicles-pbr (gtasf-u9n0, `realisticRender` only).
 *
 *   nice -n 15 node tools/assets/build-meshy.mjs [id...]
 *
 * Same conventions as build.mjs: metres, Y up, forward +Z, X/Z centred, wheels on ground Y=0,
 * meshopt (reorder + quantize) compression. Each car gets two files:
 *   <asset>.glb      HD:  <=30k triangles, 992 px WebP base colour / normal / metal-rough (<1 MP decoded)
 *   <asset>.low.glb  Low: ~5k triangles on a fresh baked atlas, 512 px base colour + 128 px metal-rough, no normal map (<300 KB)
 * Existing CC0 assets keep their length so collision/physics bounds stay comparable.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, dedup, flatten, getBounds, join as joinMeshes, meshopt, prune, simplify, textureCompress, transformMesh, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { Matrix4 } from 'three';
import sharp from 'sharp';
import { bakeLow } from './meshy-low-bake.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const cache = join(repo, 'tools/assets/cache/meshy');
const output = join(repo, 'web/public/assets/vehicles-pbr');
const HD_TRIS = 30_000, LOW_MAX_BYTES = 300_000, HD_TEX = 992;
// gtasf-g7050: the Low LOD used to simplify across Meshy's fragmented UV seams (error .1 + meshopt 'Permissive'), which
// tore the texture: phone Low cars looked shattered. Low now simplifies positions only, gets a fresh box-projected atlas
// and has its base colour / metal-rough baked from the source (meshy-low-bake.mjs).
const LOW_TRIS = 5_000, LOW_ERROR = .05, LOW_TEX = 512, LOW_BAKE = 1024;

/**
 * Meshy job id -> runtime asset. `length` (m) is used only for new assets; existing ones match the
 * CC0 manifest. `yaw` (degrees about +Y) is set by eye after the auto long-axis alignment so the
 * bonnet faces +Z.
 */
export const SPEC = {
  robotaxi: { asset: 'robotaxi', label: 'Robotaxi (parody electric crossover)', yaw: 0 },
  sedan: { asset: 'model3', label: 'Electric sedan', yaw: 0 },
  hatchback: { asset: 'prius', label: 'Hybrid hatchback', yaw: 0 },
  suv: { asset: 'outback', label: 'Trail wagon SUV', yaw: 0 },
  bus: { asset: 'muni-bus', label: 'City bus', yaw: 0, front: 'manual' },
  'cable-car': { asset: 'powell-cable-car', label: 'Powell cable car', yaw: 0, front: 'manual' },
  supercar: { asset: 'vc-supercar', label: 'VC supercar', yaw: 0 },
  cab: { asset: 'cab', label: 'Yellow cab', length: 4.85, yaw: 0 },
  van: { asset: 'van', label: 'Delivery van', length: 5.9, yaw: 0 },
  'food-truck': { asset: 'food-truck', label: 'Food truck', length: 6.6, yaw: 0 },
  scooter: { asset: 'scooter', label: 'Rental e-scooter', length: 1.1, yaw: 0 },
};

await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});

/** Existing CC0 lengths (Z extent) from the generated manifest, so swapped models keep footprints. */
async function cc0Lengths() {
  const text = await readFile(join(repo, 'web/src/assets/manifest.ts'), 'utf8');
  const json = text.slice(text.indexOf('{'), text.indexOf('\n} as const') + 2);
  const assets = JSON.parse(json.replace(/,\s*}/g, '}'));
  return Object.fromEntries(Object.entries(assets).map(([id, a]) => [id, a.bounds.max[2] - a.bounds.min[2]]));
}

const triangles = (doc) => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())
  .reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

/** Bake every node transform, then rotate/scale/centre so the model sits on Y=0 facing +Z. */
async function normalise(doc, spec, length) {
  await doc.transform(flatten(), joinMeshes({ keepNamed: false }));
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const nodes = doc.getRoot().listNodes().filter(n => n.getMesh());
  for (const node of nodes) {
    transformMesh(node.getMesh(), node.getWorldMatrix());
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
  let { min, max } = getBounds(scene);
  const autoYaw = (max[0] - min[0]) > (max[2] - min[2]) ? Math.PI / 2 : 0; // long axis -> Z
  const rotate = new Matrix4().makeRotationY(autoYaw + (spec.yaw ?? 0) * Math.PI / 180);
  for (const node of nodes) transformMesh(node.getMesh(), rotate.elements);
  ({ min, max } = getBounds(scene));
  // Bonnet heuristic: the end whose last 15% is lower is the front; turn it to +Z.
  if (spec.front !== 'manual') {
    const span = max[2] - min[2], top = { front: -Infinity, back: -Infinity };
    for (const node of nodes) for (const primitive of node.getMesh().listPrimitives()) {
      const p = primitive.getAttribute('POSITION');
      for (let i = 0, v = []; i < p.getCount(); i++) {
        p.getElement(i, v);
        if (v[2] > max[2] - span * .15) top.front = Math.max(top.front, v[1]);
        else if (v[2] < min[2] + span * .15) top.back = Math.max(top.back, v[1]);
      }
    }
    if (top.front > top.back) {
      for (const node of nodes) transformMesh(node.getMesh(), new Matrix4().makeRotationY(Math.PI).elements);
      ({ min, max } = getBounds(scene));
    }
    console.log(`${spec.asset}: end heights +Z ${top.front.toFixed(2)} / -Z ${top.back.toFixed(2)}${top.front > top.back ? ' -> turned 180' : ''}`);
  }
  const s = length / (max[2] - min[2]);
  const fit = new Matrix4().makeScale(s, s, s)
    .premultiply(new Matrix4().makeTranslation(-(min[0] + max[0]) / 2 * s, -min[1] * s, -(min[2] + max[2]) / 2 * s));
  for (const node of nodes) transformMesh(node.getMesh(), fit.elements);
  nodes.forEach((node, i) => node.setName(i ? `body-${i}` : 'body'));
  return getBounds(scene);
}

async function lod(doc, maxTris, textures, error = .02) {
  const tris = triangles(doc);
  await doc.transform(weld(), ...(tris > maxTris ? [simplify({ simplifier: MeshoptSimplifier, ratio: maxTris / tris, error, lockBorder: false })] : []));
  for (const [slots, size] of textures) {
    if (size === 0) {
      for (const material of doc.getRoot().listMaterials()) {
        if (slots.test('normalTexture')) material.setNormalTexture(null);
        // Removing the headlight mask must also remove its white multiplier, or every body pixel
        // becomes emissive and the small LOD renders as a glowing white silhouette.
        if (slots.test('emissiveTexture')) material.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
        if (slots.test('occlusionTexture')) material.setOcclusionTexture(null);
      }
    } else {
      await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 82, slots }));
    }
  }
  await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return triangles(doc);
}

async function write(doc, path) {
  const bytes = Buffer.from(await io.writeBinary(doc));
  await writeFile(path, bytes);
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

const lengths = await cc0Lengths();
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SPEC);
await mkdir(output, { recursive: true });
const manifestPath = join(repo, 'tools/assets/report-meshy.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));
const ledger = JSON.parse(await readFile(join(repo, 'tools/art/meshy-ledger.json'), 'utf8'));
for (const id of ids) {
  const spec = SPEC[id], raw = join(cache, `${id}.glb`);
  if (!spec) throw new Error(`unknown id ${id}`);
  try { await access(raw); } catch { console.log(`${id}: no Meshy GLB yet, skipped`); continue; }
  const doc = await io.read(raw);
  const sourceTris = triangles(doc);
  const length = lengths[spec.asset] ?? spec.length;
  const bounds = await normalise(doc, spec, length);
  const low = cloneDocument(doc);
  const baked = await bakeLow(low, { tris: LOW_TRIS, error: LOW_ERROR, bakeSize: LOW_BAKE, padding: 4 });
  console.log(`${id}: Low bake ${JSON.stringify(baked)}`);
  const hdTris = await lod(doc, HD_TRIS, [[/.*/, HD_TEX]]);
  const lowTris = await lod(low, LOW_TRIS, [[/normalTexture|emissiveTexture|occlusionTexture/, 0], [/baseColorTexture/, LOW_TEX], [/metallicRoughnessTexture/, 128]]);
  const hd = await write(doc, join(output, `${spec.asset}.glb`));
  const lo = await write(low, join(output, `${spec.asset}.low.glb`));
  if (lo.bytes >= LOW_MAX_BYTES) throw new Error(`${id} Low is ${lo.bytes} bytes (budget ${LOW_MAX_BYTES})`);
  const refine = ledger.entries.findLast(e => e.id === id && e.step === 'refine');
  manifest[spec.asset] = {
    label: spec.label, meshyJob: id, meshyTask: refine?.taskId ?? null,
    license: 'Meshy paid-plan output (commercial use)', creator: 'GTASF via Meshy 6 text-to-3D',
    hd: { url: `/assets/vehicles-pbr/${spec.asset}.glb`, triangles: Math.round(hdTris), ...hd },
    low: { url: `/assets/vehicles-pbr/${spec.asset}.low.glb`, triangles: Math.round(lowTris), ...lo },
    bounds: { min: bounds.min.map(v => +v.toFixed(3)), max: bounds.max.map(v => +v.toFixed(3)) },
  };
  console.log(`${id} -> ${spec.asset}: source ${Math.round(sourceTris)} tris; HD ${Math.round(hdTris)} tris ${hd.bytes} B; Low ${Math.round(lowTris)} tris ${lo.bytes} B; bounds ${JSON.stringify(manifest[spec.asset].bounds)}`);
}
const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(manifestPath, JSON.stringify(sorted, null, 2) + '\n');
await writeFile(join(repo, 'web/src/assets/realisticVehicles.ts'), `// Generated by tools/assets/build-meshy.mjs (gtasf-u9n0); see /assets/LICENSES.md.
// Meshy PBR vehicles for the realisticRender path. Metres, Y up, +Z forward, ground origin.
export const realisticVehicleAssets: Readonly<Record<string, RealisticVehicleAsset>> = ${JSON.stringify(sorted, null, 2)};
export interface RealisticVehicleFile { readonly url: string; readonly triangles: number; readonly bytes: number; readonly sha256: string }
export interface RealisticVehicleAsset {
  readonly label: string; readonly meshyJob: string; readonly meshyTask: string | null;
  readonly license: string; readonly creator: string;
  readonly hd: RealisticVehicleFile; readonly low: RealisticVehicleFile;
  readonly bounds: { readonly min: readonly number[]; readonly max: readonly number[] };
}
`);
