/**
 * Convert Meshy facade hero pieces (tools/art/meshy-facade-pieces.mjs -> ignored cache/meshy-facades/
 * *.glb) into instanceable GLBs under web/public/assets/facades-pbr
 * (gtasf-realistic-facade-meshy-pieces-xyrw, `realisticRender` + `realisticFacades` only).
 *
 *   nice -n 15 node tools/assets/build-facade-pieces.mjs [id...]
 *
 * Convention for instancing: metres, Y up, piece CENTRED on X, BOTTOM on Y=0, detail toward +Z
 * (the outward wall normal); `yaw` (deg about +Y) is tuned by eye per piece so the detailed face
 * points +Z. Scaled uniformly to a real-world HEIGHT. Two LODs:
 *   <asset>.glb      HD:  <=14k triangles, 992 px WebP PBR (<1 MP decoded)
 *   <asset>.low.glb  Low: ~3k triangles, 256 px base colour, no normal map (instanced en masse)
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

const repo = fileURLToPath(new URL('../../', import.meta.url));
const cache = join(repo, 'tools/assets/cache/meshy-facades');
const output = join(repo, 'web/public/assets/facades-pbr');
// Low is loaded once and GPU-instanced, so the per-instance cost is triangles (kept ~3k), not bytes.
const HD_TRIS = 14_000, LOW_TRIS = 3_000, LOW_MAX_BYTES = 300_000, HD_TEX = 992;

/**
 * Meshy job id -> runtime asset. `height` (m) is the real-world height each piece is scaled to.
 * `yaw` (deg about +Y) is set by eye so the detailed face points +Z (the outward wall normal);
 * pane 6 fine-tunes these in-browser against the realistic building walls.
 */
export const SPEC = {
  'bay-window': { asset: 'bay-window', label: 'Victorian bay window', height: 3.0, yaw: 0 },
  'fire-escape': { asset: 'fire-escape', label: 'Iron fire escape', height: 3.2, yaw: 90 },
  cornice: { asset: 'cornice', label: 'Roofline cornice', height: 0.8, yaw: 0 },
  awning: { asset: 'awning', label: 'Storefront awning', height: 1.1, yaw: 180 },
  storefront: { asset: 'storefront', label: 'Ground-floor storefront', height: 4.2, yaw: 0 },
  entrance: { asset: 'entrance', label: 'Ornate entrance', height: 4.0, yaw: 0 },
  balcony: { asset: 'balcony', label: 'Juliet balcony', height: 1.2, yaw: 0 },
};

await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});

const triangles = (doc) => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())
  .reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

/** Bake node transforms, apply yaw, then centre X/Z, sit the base on Y=0 and scale to target height. */
async function normalise(doc, spec) {
  await doc.transform(flatten(), joinMeshes({ keepNamed: false }));
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const nodes = doc.getRoot().listNodes().filter(n => n.getMesh());
  for (const node of nodes) {
    transformMesh(node.getMesh(), node.getWorldMatrix());
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
  if (spec.yaw) { const r = new Matrix4().makeRotationY(spec.yaw * Math.PI / 180); for (const node of nodes) transformMesh(node.getMesh(), r.elements); }
  const { min, max } = getBounds(scene);
  const s = spec.height / (max[1] - min[1]);
  const fit = new Matrix4().makeScale(s, s, s)
    .premultiply(new Matrix4().makeTranslation(-(min[0] + max[0]) / 2 * s, -min[1] * s, -(min[2] + max[2]) / 2 * s));
  for (const node of nodes) transformMesh(node.getMesh(), fit.elements);
  nodes.forEach((node, i) => node.setName(i ? `piece-${i}` : 'piece'));
  return getBounds(scene);
}

async function lod(doc, maxTris, textures, error = .03) {
  const tris = triangles(doc);
  await doc.transform(weld(), ...(tris > maxTris ? [simplify({ simplifier: MeshoptSimplifier, ratio: maxTris / tris, error, lockBorder: false })] : []));
  if (triangles(doc) > maxTris * 1.2) for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const positions = primitive.getAttribute('POSITION').getArray(), indices = primitive.getIndices();
    const target = Math.floor(maxTris * 3 * indices.getCount() / 3 / triangles(doc) / 3) * 3;
    const [result] = MeshoptSimplifier.simplify(Uint32Array.from(indices.getArray()), Float32Array.from(positions), 3, target, error, ['Permissive']);
    indices.setArray(result);
  }
  for (const [slots, size] of textures) {
    if (size === 0) {
      for (const material of doc.getRoot().listMaterials()) {
        if (slots.test('normalTexture')) material.setNormalTexture(null);
        if (slots.test('occlusionTexture')) material.setOcclusionTexture(null);
      }
    } else await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 82, slots }));
  }
  await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return triangles(doc);
}

async function write(doc, path) {
  const bytes = Buffer.from(await io.writeBinary(doc));
  await writeFile(path, bytes);
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SPEC);
await mkdir(output, { recursive: true });
const manifestPath = join(repo, 'tools/assets/report-facade-pieces.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));
const ledger = JSON.parse(await readFile(join(repo, 'tools/art/meshy-ledger.json'), 'utf8'));
for (const id of ids) {
  const spec = SPEC[id], raw = join(cache, `${id}.glb`);
  if (!spec) throw new Error(`unknown id ${id}`);
  try { await access(raw); } catch { console.log(`${id}: no Meshy GLB yet, skipped`); continue; }
  const doc = await io.read(raw);
  const sourceTris = triangles(doc);
  const bounds = await normalise(doc, spec);
  const low = cloneDocument(doc);
  const hdTris = await lod(doc, HD_TRIS, [[/.*/, HD_TEX]]);
  const lowTris = await lod(low, LOW_TRIS, [[/normalTexture|occlusionTexture/, 0], [/baseColorTexture/, 256], [/metallicRoughnessTexture/, 128]], .12);
  const hd = await write(doc, join(output, `${spec.asset}.glb`));
  const lo = await write(low, join(output, `${spec.asset}.low.glb`));
  if (lo.bytes >= LOW_MAX_BYTES) throw new Error(`${id} Low is ${lo.bytes} bytes (budget ${LOW_MAX_BYTES})`);
  const refine = ledger.entries.findLast(e => e.id === `facade-${id}` && e.step === 'refine');
  manifest[spec.asset] = {
    label: spec.label, meshyJob: id, meshyTask: refine?.taskId ?? null,
    license: 'Meshy paid-plan output (commercial use)', creator: 'GTASF via Meshy 6 text-to-3D',
    hd: { url: `/assets/facades-pbr/${spec.asset}.glb`, triangles: Math.round(hdTris), ...hd },
    low: { url: `/assets/facades-pbr/${spec.asset}.low.glb`, triangles: Math.round(lowTris), ...lo },
    bounds: { min: bounds.min.map(v => +v.toFixed(3)), max: bounds.max.map(v => +v.toFixed(3)) },
  };
  console.log(`${id} -> ${spec.asset}: source ${Math.round(sourceTris)} tris; HD ${Math.round(hdTris)} tris ${hd.bytes} B; Low ${Math.round(lowTris)} tris ${lo.bytes} B; bounds ${JSON.stringify(manifest[spec.asset].bounds)}`);
}
const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(manifestPath, JSON.stringify(sorted, null, 2) + '\n');
await writeFile(join(repo, 'web/src/assets/realisticFacadePieces.ts'), `// Generated by tools/assets/build-facade-pieces.mjs (gtasf-realistic-facade-meshy-pieces-xyrw); see /assets/LICENSES.md.
// Meshy PBR facade hero pieces for the realisticFacades path. Metres, Y up, base on Y=0, detail toward +Z.
export const realisticFacadePieces: Readonly<Record<string, RealisticFacadePiece>> = ${JSON.stringify(sorted, null, 2)};
export interface RealisticFacadeFile { readonly url: string; readonly triangles: number; readonly bytes: number; readonly sha256: string }
export interface RealisticFacadePiece {
  readonly label: string; readonly meshyJob: string; readonly meshyTask: string | null;
  readonly license: string; readonly creator: string;
  readonly hd: RealisticFacadeFile; readonly low: RealisticFacadeFile;
  readonly bounds: { readonly min: readonly number[]; readonly max: readonly number[] };
}
`);
