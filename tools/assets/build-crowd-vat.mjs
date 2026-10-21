/** Crowd vertex-animation LOD (lane D, gtasf-laned-crowd-vat-y7x9d): the far instanced crowd as a low-poly LOD of the
 * same CC0 bodies the near pedestrians use (avatars/*.glb from build-people.mjs). Per body: meshoptimizer-simplify each
 * skinned primitive (~20% of its triangles), CPU-skin WALK_FRAMES evenly spaced walk poses + IDLE_FRAMES idle poses,
 * recompute normals per pose, and bake the material colour into vertex colours. Output (web/public/assets/avatars/):
 *   crowd-vat.json  — { walkFrames, idleFrames, walkSeconds, idleSeconds, quant, bodies: [{ id, vertices, triangles,
 *                       indexOffset, colourOffset, positionOffset, normalOffset }] } (byte offsets into the .bin)
 *   crowd-vat.bin   — per body: Uint16 indices | Uint8 RGB colours | Uint8 paint class | Int16 xyz positions [frame][vertex] (metres *
 *                     quant) | Int8 xyz normals [frame][vertex]; every section 4-byte aligned. Frames: walk then idle.
 * Run: node tools/assets/build-crowd-vat.mjs (after build-people.mjs). Single process, no Blender. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnimationMixer, BufferAttribute, BufferGeometry, Color, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const CC0_SET = ['business-man', 'casual-woman', 'casual-man', 'formal-woman', 'worker-man', 'beach-man', 'punk-woman', 'punk-man', 'hoodie'];
/** VAT_SET=meshy: the meshyPeople bodies (textured; UVs + a 256 px WebP per body) plus the hoodie, so far remote players
 * keep the body their near avatar wears. Output crowd-vat-meshy.{json,bin} + crowd-vat-meshy-<id>.webp. */
const MESHY_SET = ['meshy-founder-hoodie', 'meshy-founder-blazer', 'meshy-founder-bomber', 'meshy-hoodie-woman', 'meshy-tech-vest-man',
  'meshy-business-woman', 'meshy-jogger-woman', 'meshy-flannel-man', 'meshy-denim-woman', 'meshy-puffer-man', 'meshy-skater-man', 'hoodie'];
const SET = process.env.VAT_SET === 'meshy' ? 'meshy' : 'cc0';
export const CROWD_BODIES = SET === 'meshy' ? MESHY_SET : CC0_SET;
const OUT = SET === 'meshy' ? 'crowd-vat-meshy' : 'crowd-vat';
const WALK_FRAMES = 12, IDLE_FRAMES = 2, QUANT = 8192, RATIO = .2;
/** Paint classes per vertex: 255 = clothing (per-person hue shift), 128 = skin (per-person tone), 0 = keep (hair, eyes, hi-vis, shoes; 'Red' is the formal woman's hair). */
const CLOTH = new Set(['Suit', 'Tie', 'Red_Dark', 'LightBlue', 'Pink', 'Orange', 'LimeGreen', 'Grey', 'LightBrown', 'White', 'Black', 'Purple']);
const paintOf = name => CLOTH.has(name) ? 255 : /^Skin/.test(name) ? 128 : 0;
const repo = fileURLToPath(new URL('../../', import.meta.url));
const avatars = join(repo, 'web/public/assets/avatars');
await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const chunks = [], bodies = [];
let offset = 0, walkSeconds = 0, idleSeconds = 0;
const push = (typed) => {
  const at = offset, bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4); padded.set(bytes);
  chunks.push(padded); offset += padded.byteLength; return at;
};

for (const id of CROWD_BODIES) {
  // three's GLTFLoader can't decode embedded images in node: export the base-colour texture, then strip images.
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(join(avatars, `${id}.glb`)), image = doc.getRoot().listTextures()[0]?.getImage();
  // meshopt quantizes texcoords and stores the dequantization as KHR_texture_transform on the material's texture info;
  // three applies it at runtime, so the bake must apply it to the raw UVs too.
  const info = doc.getRoot().listMaterials().map(m => m.getBaseColorTextureInfo()).find(Boolean);
  const uvTransform = info?.getExtension('KHR_texture_transform');
  const uvOffset = uvTransform?.getOffset() ?? [0, 0], uvScale = uvTransform?.getScale() ?? [1, 1];
  if (uvTransform?.getRotation()) throw new Error(`${id}: rotated texture transform not supported`);
  // Textured bodies: decode the base colour once (512 px RGB) to sample per-vertex colours.
  const texture = image ? await sharp(Buffer.from(image)).resize(512, 512).removeAlpha().raw().toBuffer({ resolveWithObject: true }) : undefined;
  const sample = (u, w) => { const x = Math.min(511, Math.max(0, Math.floor(u * 512))), y = Math.min(511, Math.max(0, Math.floor(w * 512))), k = (y * 512 + x) * 3;
    return [texture.data[k] / 255, texture.data[k + 1] / 255, texture.data[k + 2] / 255]; };
  const srgbToLinear = c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
  const bytes = await io.writeBinary(doc);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const walk = gltf.animations.find(a => a.name === 'walk'), idle = gltf.animations.find(a => a.name === 'idle');
  if (!walk || !idle) throw new Error(`${id}: needs walk + idle clips`);
  walkSeconds = Math.max(walkSeconds, walk.duration); idleSeconds = Math.max(idleSeconds, idle.duration);
  const parts = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(object => {
    if (!(object instanceof SkinnedMesh)) return;
    const source = object.geometry, position = source.getAttribute('position'), uv = texture ? source.getAttribute('uv') : undefined;
    const index = source.index ? Uint32Array.from(source.index.array) : Uint32Array.from({ length: position.count }, (_, i) => i);
    // Quantized (meshopt) positions are padded/normalized Int16: read through the attribute, not its raw array.
    const flat = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) flat.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
    // The source is unwelded (flat-shaded: every face owns its corners), so weld by bind position first; otherwise every
    // edge is a border and nothing simplifies. A welded corner keeps its first source vertex's skin weights.
    const canonical = new Map(), weld = new Uint32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const key = `${Math.round(flat[i * 3] * 1e4)},${Math.round(flat[i * 3 + 1] * 1e4)},${Math.round(flat[i * 3 + 2] * 1e4)}`;
      if (!canonical.has(key)) canonical.set(key, i);
      weld[i] = canonical.get(key);
    }
    const welded = index.map(i => weld[i]);
    // Sloppy clustering for every body. Textured (Meshy) bodies have a very fragmented UV atlas, so a UV-preserving LOD stays
    // ~8k vertices; instead each kept vertex takes its colour from the texture at its own UV (sampled below).
    // Meshy bodies keep ~2x the CC0 density (phone Low's nearest pedestrians are this LOD; VAT draws measured ~free).
    const target = Math.max(3, Math.floor(welded.length * (texture ? .4 : RATIO) / 3) * 3);
    const [simplified, err] = MeshoptSimplifier.simplifySloppy(welded, flat, 3, null, target, .06);
    if (process.env.VAT_DEBUG) console.log(object.name, welded.length / 3, "->", simplified.length / 3, "err", err.toFixed(4), "uniq", canonical.size);
    const used = [...new Set(simplified)].sort((a, b) => a - b), remap = new Map(used.map((v, i) => [v, i]));
    parts.push({ mesh: object, used, uv, index: Uint32Array.from(simplified, v => remap.get(v)), colour: new Color().copy(object.material.color ?? new Color(1, 1, 1)), paint: paintOf(object.material.name) });
  });
  const vertices = parts.reduce((n, p) => n + p.used.length, 0);
  if (vertices > 65535) throw new Error(`${id}: ${vertices} vertices exceed Uint16 indices`);
  const indices = [], colours = new Uint8Array(vertices * 3), paints = new Uint8Array(vertices);
  let base = 0;
  for (const part of parts) {
    for (const v of part.index) indices.push(v + base);
    paints.fill(part.paint, base, base + part.used.length);
    for (let i = 0; i < part.used.length; i++) {
      let rgb = [part.colour.r, part.colour.g, part.colour.b];
      if (texture && part.uv) { // texture colour (sRGB -> linear, like three's vertex colours) x material colour
        const source = part.used[i], u = part.uv.getX(source) * uvScale[0] + uvOffset[0], w = part.uv.getY(source) * uvScale[1] + uvOffset[1];
        rgb = sample(u, w).map((c, k) => srgbToLinear(c) * rgb[k]);
      }
      colours.set(rgb.map(c => Math.round(Math.min(1, c) * 255)), (base + i) * 3);
    }
    part.base = base; base += part.used.length;
  }
  const frames = WALK_FRAMES + IDLE_FRAMES, positions = new Int16Array(frames * vertices * 3), normals = new Int8Array(frames * vertices * 3);
  const mixer = new AnimationMixer(gltf.scene), v = new Vector3();
  const temp = new BufferGeometry(), tempPos = new Float32Array(vertices * 3);
  temp.setIndex(indices); temp.setAttribute('position', new BufferAttribute(tempPos, 3));
  for (let f = 0; f < frames; f++) {
    mixer.stopAllAction();
    const isWalk = f < WALK_FRAMES, clip = isWalk ? walk : idle, k = isWalk ? f / WALK_FRAMES : (f - WALK_FRAMES) / IDLE_FRAMES;
    const action = mixer.clipAction(clip); action.reset().play(); mixer.setTime(k * clip.duration);
    gltf.scene.updateMatrixWorld(true);
    for (const part of parts) {
      part.mesh.skeleton.update();
      part.used.forEach((source, i) => {
        part.mesh.getVertexPosition(source, v).applyMatrix4(part.mesh.matrixWorld);
        tempPos.set([v.x, v.y, v.z], (part.base + i) * 3);
      });
    }
    temp.getAttribute('position').needsUpdate = true; temp.computeVertexNormals();
    const n = temp.getAttribute('normal').array;
    for (let i = 0; i < vertices * 3; i++) {
      positions[f * vertices * 3 + i] = Math.max(-32767, Math.min(32767, Math.round(tempPos[i] * QUANT)));
      normals[f * vertices * 3 + i] = Math.round(Math.max(-1, Math.min(1, n[i])) * 127);
    }
  }
  bodies.push({ id, vertices, triangles: indices.length / 3,
    indexOffset: push(Uint16Array.from(indices)), colourOffset: push(colours), paintOffset: push(paints), positionOffset: push(positions), normalOffset: push(normals) });
  console.log(`${id}: ${vertices} vertices, ${indices.length / 3} triangles`);
}
const bin = new Uint8Array(offset); let at = 0; for (const c of chunks) { bin.set(c, at); at += c.byteLength; }
await writeFile(join(avatars, `${OUT}.bin`), bin);
await writeFile(join(avatars, `${OUT}.json`), JSON.stringify({ walkFrames: WALK_FRAMES, idleFrames: IDLE_FRAMES, walkSeconds, idleSeconds, quant: QUANT, bodies }, null, 1) + '\n');
console.log(`${OUT}.bin: ${bin.byteLength} bytes`);
