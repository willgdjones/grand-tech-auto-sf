/** Meshy characters -> runtime avatars (lane D, gtasf-laned-meshy-people-lu1vh). Input: tools/art/meshy-people.mjs output in
 * ignored tools/assets/cache/meshy-people/<id>/ (rigged.glb + idle/walking/running.glb, one Meshy auto-rig skeleton each).
 * Output web/public/assets/avatars/meshy-<id>.glb with clips idle/walk/run/sit, the key bones renamed to the hoodie rig's
 * names (Body, UpperArm.L, LowerArm.L, Wrist.L, UpperLeg.L, LowerLeg.L, Foot.L, Chest, Head ...) so riggedAvatar's drive pose,
 * riding poses and the VAT bake work unchanged, a uniform metre frame (feet at 0), ~7k triangles and a 512 px WebP texture.
 *   nice -n 10 node tools/assets/build-meshy-people.mjs [id...]
 * Writes tools/assets/report-meshy-people.json. Single process, no Blender. */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, meshopt, getBounds, simplify, weld, textureCompress, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { AnimationMixer, Vector3, Quaternion } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import sharp from 'sharp';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const cache = join(repo, 'tools/assets/cache/meshy-people'), output = join(repo, 'web/public/assets/avatars');
const HEIGHTS = { 'sfpd-officer': 1.8, 'tech-vest-man': 1.8, 'hoodie-woman': 1.66, 'business-woman': 1.68, 'jogger-woman': 1.67,
  'flannel-man': 1.82, 'denim-woman': 1.64, 'puffer-man': 1.78, 'skater-man': 1.76, 'founder-hoodie': 1.78, 'founder-blazer': 1.7, 'founder-bomber': 1.79 };
const RENAME = { Hips: 'Body', Spine02: 'Chest', LeftShoulder: 'Shoulder.L', RightShoulder: 'Shoulder.R', LeftArm: 'UpperArm.L', RightArm: 'UpperArm.R',
  LeftForeArm: 'LowerArm.L', RightForeArm: 'LowerArm.R', LeftHand: 'Wrist.L', RightHand: 'Wrist.R', LeftUpLeg: 'UpperLeg.L', RightUpLeg: 'UpperLeg.R',
  LeftLeg: 'LowerLeg.L', RightLeg: 'LowerLeg.R', LeftFoot: 'Foot.L', RightFoot: 'Foot.R', neck: 'Neck' };
const TRIS = 7000;
// Head map (gtasf-meshy-vat-close-faces-wu8uy): Meshy's atlas shatters the face into dozens of tiny islands, so a 512 px
// atlas smears it at <3 m. Head triangles get their own cylindrical UVs + a HEAD_W x HEAD_H texture baked from the 2048 px
// source, so the face is one contiguous region (~HEAD_W/4 px wide). Paid for by a lower body-atlas quality (BODY_Q).
// Head-mapped bodies are written as meshy-<id>.hm.glb (flag meshyHeadMaps picks the set; the production build ships one).
// NO_HEAD_MAP=1 rebuilds the original meshy-<id>.glb set (512 px atlas at q82), which the crowd VAT bake reads.
const NO_HEAD_MAP = process.env.NO_HEAD_MAP === '1';
const HEAD_W = Number(process.env.HEAD_W ?? 512), HEAD_H = HEAD_W / 2, BODY_Q = Number(process.env.BODY_Q ?? (NO_HEAD_MAP ? 82 : 70)), HEAD_Q = Number(process.env.HEAD_Q ?? 80);
const SUFFIX = NO_HEAD_MAP ? '.glb' : '.hm.glb';
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const report = [];

/** Inverse of a column-major 4x4 inverse-bind matrix's translation: the joint's bind-space position. */
function jointPosition(ibm) {
  const m = ibm, a = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]], t = [m[12], m[13], m[14]];
  // IBM = [R t; 0 1] -> joint = -R^-1 t (R is a rotation*scale; invert the 3x3 generally).
  const det = a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const inv = [[(a[1][1] * a[2][2] - a[1][2] * a[2][1]) / det, (a[0][2] * a[2][1] - a[0][1] * a[2][2]) / det, (a[0][1] * a[1][2] - a[0][2] * a[1][1]) / det],
    [(a[1][2] * a[2][0] - a[1][0] * a[2][2]) / det, (a[0][0] * a[2][2] - a[0][2] * a[2][0]) / det, (a[0][2] * a[1][0] - a[0][0] * a[1][2]) / det],
    [(a[1][0] * a[2][1] - a[1][1] * a[2][0]) / det, (a[0][1] * a[2][0] - a[0][0] * a[2][1]) / det, (a[0][0] * a[1][1] - a[0][1] * a[1][0]) / det]];
  return inv.map(row => -(row[0] * t[0] + row[1] * t[1] + row[2] * t[2]));
}
const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };

/** Split head triangles (skin weight to Head + its descendants > .5 on all 3 vertices) into their own primitive with a
 * cylindrical UV map around the neck->head axis (face at u=.5, seam at the back) and a baked HEAD_W x HEAD_H texture
 * sampled from the full-resolution source through the old UVs. Runs on the simplified mesh, before textureCompress. */
async function headMap(doc, id) {
  const skin = doc.getRoot().listSkins()[0], joints = skin?.listJoints() ?? [];
  const head = joints.find(n => n.getName() === 'Head'); if (!head) throw new Error(`${id}: no Head joint`);
  const under = new Set(); const walk = n => { under.add(n); n.listChildren().forEach(walk); }; walk(head);
  const headJoints = new Set(joints.flatMap((n, i) => under.has(n) ? [i] : []));
  const ibm = skin.getInverseBindMatrices(), at = name => { const i = joints.findIndex(n => n.getName() === name); return i < 0 ? null : jointPosition(ibm.getElement(i, [])); };
  const headPos = at('Head'), neckPos = at('Neck') ?? at('Chest'), left = at('UpperArm.L'), right = at('UpperArm.R');
  if (!neckPos || !left || !right) throw new Error(`${id}: missing Neck/UpperArm joints`);
  const up = norm(sub(headPos, neckPos)), side = norm(sub(left, right));
  let forward = norm(cross(side, up));
  const primitive = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives()).find(p => p.getAttribute('JOINTS_0'));
  const material = primitive.getMaterial(), texture = material?.getBaseColorTexture();
  if (!texture) throw new Error(`${id}: no base colour texture`);
  const position = primitive.getAttribute('POSITION'), uv0 = primitive.getAttribute('TEXCOORD_0'), indices = primitive.getIndices();
  const jointsA = primitive.getAttribute('JOINTS_0'), weightsA = primitive.getAttribute('WEIGHTS_0');
  const headWeight = new Float32Array(position.getCount()), jv = [], wv = [];
  for (let v = 0; v < headWeight.length; v++) { jointsA.getElement(v, jv); weightsA.getElement(v, wv); for (let k = 0; k < 4; k++) if (headJoints.has(jv[k])) headWeight[v] += wv[k]; }
  const tris = indices.getArray(), headTris = [], bodyTris = [];
  for (let t = 0; t < tris.length; t += 3) (Math.min(headWeight[tris[t]], headWeight[tris[t + 1]], headWeight[tris[t + 2]]) > .5 ? headTris : bodyTris).push(tris[t], tris[t + 1], tris[t + 2]);
  if (headTris.length < 300) throw new Error(`${id}: only ${headTris.length / 3} head triangles`);
  // Axis frame: centre = mean of head vertices projected off the axis; face direction sign = where the head bulges (nose/face
  // sits ahead of the neck->head axis; the back of the skull + hair is rounder) — fall back to the cross product if unclear.
  const p = [], used = [...new Set(headTris)], pts = used.map(v => position.getElement(v, []));
  const centre = pts.reduce((c, q) => c.map((x, i) => x + q[i] / pts.length), [0, 0, 0]);
  const heights = pts.map(q => dot(sub(q, centre), up)), hMin = Math.min(...heights), hMax = Math.max(...heights);
  const reach = dir => Math.max(...pts.map(q => dot(sub(q, centre), dir)));
  if (reach(forward.map(x => -x)) > reach(forward) * 1.04) forward = forward.map(x => -x);
  const sideAxis = norm(cross(up, forward));
  const cyl = q => { const d = sub(q, centre); return [.5 + Math.atan2(dot(d, sideAxis), dot(d, forward)) / (2 * Math.PI), 1 - (dot(d, up) - hMin) / (hMax - hMin)]; };
  // Unweld the head (per-triangle vertices) so triangles straddling the back seam can wrap u past 1 (REPEAT sampler).
  const count = headTris.length, attrs = {};
  for (const semantic of primitive.listSemantics()) attrs[semantic] = { src: primitive.getAttribute(semantic), out: [] };
  const newUv = new Float32Array(count * 2), oldUv = new Float32Array(count * 2), radius = new Float32Array(count), shifted = new Uint8Array(count);
  for (let t = 0; t < count; t += 3) {
    const uvs = [0, 1, 2].map(k => cyl(position.getElement(headTris[t + k], [])));
    const wraps = Math.max(...uvs.map(c => c[0])) - Math.min(...uvs.map(c => c[0])) > .5;
    if (wraps) uvs.forEach((c, k) => { if (c[0] < .5) { c[0] += 1; shifted[t + k] = 1; } });
    for (let k = 0; k < 3; k++) {
      const v = headTris[t + k];
      for (const a of Object.values(attrs)) a.out.push(...a.src.getElement(v, []));
      newUv.set(uvs[k], (t + k) * 2); oldUv.set(uv0.getElement(v, []), (t + k) * 2);
      const d = sub(position.getElement(v, []), centre); radius[t + k] = Math.hypot(dot(d, sideAxis), dot(d, forward));
    }
  }
  // Squeeze the wrapped seam back into [0,1] (the back-of-head column is simply duplicated) so meshopt can quantize the UVs.
  let maxU = 1; for (let i = 0; i < newUv.length; i += 2) maxU = Math.max(maxU, newUv[i]);
  for (let i = 0; i < newUv.length; i += 2) newUv[i] /= maxU;
  // Bake: rasterise each head triangle in new-UV space; per texel, barycentric -> old UV -> bilinear sample of the source.
  const { data: src, info } = await sharp(Buffer.from(texture.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = HEAD_W, H = HEAD_H, out = new Uint8Array(W * H * 3), filled = new Uint8Array(W * H);
  const sample = (u, v) => {
    const x = ((u % 1) + 1) % 1 * info.width - .5, y = Math.min(1, Math.max(0, v)) * info.height - .5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const px = (xx, yy) => ((Math.min(info.height - 1, Math.max(0, yy)) * info.width) + ((xx % info.width) + info.width) % info.width) * 3;
    return [0, 1, 2].map(c => (src[px(x0, y0) + c] * (1 - fx) + src[px(x0 + 1, y0) + c] * fx) * (1 - fy) + (src[px(x0, y0 + 1) + c] * (1 - fx) + src[px(x0 + 1, y0 + 1) + c] * fx) * fy);
  };
  // Rasterise triangle t (unwelded index) in new-UV space; visit(texel, w0, w1, w2).
  const raster = (t, visit) => {
    const a = [newUv[t * 2] * W, newUv[t * 2 + 1] * H], b = [newUv[t * 2 + 2] * W, newUv[t * 2 + 3] * H], c = [newUv[t * 2 + 4] * W, newUv[t * 2 + 5] * H];
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]); if (Math.abs(area) < 1e-9) return;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + .5, py = y + .5;
      const w1 = ((px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])) / area, w2 = ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) / area, w0 = 1 - w1 - w2;
      if (w0 < -.02 || w1 < -.02 || w2 < -.02) continue; // slight overdraw closes hairline gaps between triangles
      visit(y * W + x, w0, w1, w2);
    }
  };
  // The projection isn't injective where layers overlap (long hair over a cheek/ear, collar under hair): each texel belongs to
  // the OUTERMOST surface; a triangle that loses most of its texels goes back to the body atlas with its original UVs.
  const depth = new Float32Array(W * H).fill(-1), owner = new Int32Array(W * H).fill(-1);
  for (let t = 0; t < count; t += 3) raster(t, (k, w0, w1, w2) => { const r = w0 * radius[t] + w1 * radius[t + 1] + w2 * radius[t + 2]; if (r > depth[k]) { depth[k] = r; owner[k] = t; } });
  const keep = new Uint8Array(count / 3);
  for (let t = 0; t < count; t += 3) { let total = 0, own = 0; raster(t, k => { total++; if (owner[k] === t || depth[k] - (radius[t] + radius[t + 1] + radius[t + 2]) / 3 < .016 * (hMax - hMin)) own++; }); keep[t / 3] = total === 0 || own / total > .8 ? 1 : 0; }
  for (let t = 0; t < count; t += 3) if (keep[t / 3]) raster(t, (k, w0, w1, w2) => {
    if (owner[k] !== t && filled[k]) return;
    const u = w0 * oldUv[t * 2] + w1 * oldUv[t * 2 + 2] + w2 * oldUv[t * 2 + 4], v = w0 * oldUv[t * 2 + 1] + w1 * oldUv[t * 2 + 3] + w2 * oldUv[t * 2 + 5];
    out.set(sample(u, v), k * 3); filled[k] = 1;
  });
  const demoted = []; for (let t = 0; t < count; t += 3) if (!keep[t / 3]) demoted.push(headTris[t], headTris[t + 1], headTris[t + 2]);
  bodyTris.push(...demoted);
  // Dilate into empty texels so bilinear/mip sampling never pulls in black at island edges.
  for (let pass = 0; pass < 6; pass++) {
    const next = filled.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = y * W + x; if (filled[k]) continue;
      let r = 0, g = 0, bl = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = (x + dx + W) % W, yy = y + dy; if (yy < 0 || yy >= H) continue; const q = yy * W + xx; if (filled[q]) { r += out[q * 3]; g += out[q * 3 + 1]; bl += out[q * 3 + 2]; n++; } }
      if (n) { out[k * 3] = r / n; out[k * 3 + 1] = g / n; out[k * 3 + 2] = bl / n; next[k] = 1; } }
    filled.set(next);
  }
  const png = await sharp(Buffer.from(out), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  const buffer = doc.getRoot().listBuffers()[0];
  const headTexture = doc.createTexture(`head-${id}`).setImage(new Uint8Array(png)).setMimeType('image/png');
  const headMaterial = material.clone().setName(`${material.getName() || 'body'}-head`).setBaseColorTexture(headTexture);
  const headPrimitive = doc.createPrimitive().setMaterial(headMaterial).setMode(primitive.getMode());
  // Re-weld: kept corners share a vertex per (source vertex, seam shift), so only the back-seam column is duplicated.
  const slot = new Map(), firstOf = [], headIndex = [];
  for (let v = 0; v < count; v++) if (keep[Math.floor(v / 3)]) {
    const key = headTris[v] * 2 + shifted[v];
    if (!slot.has(key)) { slot.set(key, firstOf.length); firstOf.push(v); }
    headIndex.push(slot.get(key));
  }
  for (const [semantic, a] of Object.entries(attrs)) {
    const size = a.src.getElementSize(), all = semantic === 'TEXCOORD_0' ? newUv : a.out, picked = [];
    for (const v of firstOf) for (let e = 0; e < size; e++) picked.push(all[v * size + e]);
    const Array_ = semantic === 'TEXCOORD_0' ? Float32Array : a.src.getArray().constructor, array = new Array_(picked);
    headPrimitive.setAttribute(semantic, doc.createAccessor().setType(a.src.getType()).setArray(array).setNormalized(a.src.getNormalized()).setBuffer(buffer));
  }
  headPrimitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(headIndex)).setBuffer(buffer));
  primitive.listParents().find(x => x.propertyType === 'Mesh').addPrimitive(headPrimitive);
  primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(bodyTris)).setBuffer(buffer));
  compactPrimitive(primitive); // drop the head-only vertices the body no longer references
  return { headTriangles: count / 3 - demoted.length / 3, demoted: demoted.length / 3, bodyTriangles: bodyTris.length / 3 };
}

/** Copy `from`'s first animation into `doc` as `name`, retargeting channels to doc's nodes by name. */
function adoptClip(doc, from, name) {
  const source = from.getRoot().listAnimations()[0]; if (!source) throw new Error(`${name}: no animation`);
  const nodes = new Map(doc.getRoot().listNodes().map(n => [n.getName(), n])), buffer = doc.getRoot().listBuffers()[0];
  const clip = doc.createAnimation(name);
  for (const channel of source.listChannels()) {
    const target = nodes.get(channel.getTargetNode()?.getName()); if (!target) continue;
    const s = channel.getSampler();
    const copy = acc => doc.createAccessor().setType(acc.getType()).setArray(acc.getArray().slice()).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(copy(s.getInput())).setOutput(copy(s.getOutput())).setInterpolation(s.getInterpolation());
    clip.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(channel.getTargetPath()).setSampler(sampler));
  }
  return clip;
}

/** GTASF-authored seated pose for this rig (Meshy names), as a 3-key static clip — like build.mjs does for the hoodie. */
async function addSit(doc) {
  // Rotation output accessors of the idle clip, by target bone name (for the arm correction below).
  const idleTracks = new Map(doc.getRoot().listAnimations().filter(a => a.getName() === 'idle').flatMap(a => a.listChannels())
    .filter(c => c.getTargetPath() === 'rotation').map(c => [c.getTargetNode().getName(), c.getSampler().getOutput()]));
  // three's GLTFLoader can't decode embedded images in node: pose a texture-free copy.
  const bare = await io.readBinary(await io.writeBinary(doc));
  for (const t of bare.getRoot().listTextures()) t.dispose();
  const bytes = await io.writeBinary(bare);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const mixer = new AnimationMixer(gltf.scene); mixer.clipAction(gltf.animations.find(a => a.name === 'idle')).play(); mixer.update(0);
  gltf.scene.updateMatrixWorld(true);
  const bone = name => gltf.scene.getObjectByName(name);
  const at = o => o.getWorldPosition(new Vector3());
  function aim(name, childName, direction) {
    const node = bone(name), child = bone(childName);
    const current = at(child).sub(at(node)).normalize();
    const desired = new Quaternion().setFromUnitVectors(current, new Vector3(...direction).normalize()).multiply(node.getWorldQuaternion(new Quaternion()));
    node.quaternion.copy(node.parent.getWorldQuaternion(new Quaternion()).invert().multiply(desired)); gltf.scene.updateMatrixWorld(true);
  }
  const ground = Math.min(at(bone('LeftFoot')).y, at(bone('RightFoot')).y);
  for (const side of ['Left', 'Right']) {
    aim(`${side}UpLeg`, `${side}Leg`, [0, 0, 1]); aim(`${side}Leg`, `${side}Foot`, [0, -1, 0]);
    aim(`${side}Arm`, `${side}ForeArm`, [side === 'Left' ? .15 : -.15, -1, .2]); aim(`${side}ForeArm`, `${side}Hand`, [0, -.3, 1]);
  }
  // Drop the hips so the feet rest on the floor the standing pose stood on (seat at knee height).
  const drop = Math.min(at(bone('LeftFoot')).y, at(bone('RightFoot')).y) - ground, hips = bone('Hips');
  const world = at(hips).add(new Vector3(0, -drop, 0)); hips.position.copy(hips.parent.worldToLocal(world)); gltf.scene.updateMatrixWorld(true);
  // Meshy's 'Idle 1' holds the arms out like the A-pose bind. Lower the upper arms toward the sides with one constant local
  // correction per arm (measured at the idle's first frame), applied to every idle key so its breathing motion survives.
  mixer.stopAllAction(); const idleClip = gltf.animations.find(a => a.name === 'idle');
  mixer.clipAction(idleClip).play(); mixer.setTime(0); gltf.scene.updateMatrixWorld(true);
  for (const side of ['Left', 'Right']) for (const [name, child, dir] of [[`${side}Arm`, `${side}ForeArm`, [side === 'Left' ? .18 : -.18, -1, .05]], [`${side}ForeArm`, `${side}Hand`, [side === 'Left' ? .06 : -.06, -1, .12]]]) {
    // Upper arm first, then the forearm in the corrected arm's frame (kept posed so the child aim sees it).
    const node = bone(name), before = node.quaternion.clone();
    aim(name, child, dir);
    const correction = before.clone().invert().multiply(node.quaternion);
    const track = idleTracks.get(name);
    if (track) { const values = track.getArray(), q = new Quaternion();
      for (let i = 0; i < values.length; i += 4) { q.fromArray(values, i).multiply(correction).normalize(); q.toArray(values, i); }
      track.setArray(values); }
  }
  // Re-apply the seated pose from a fresh idle frame for the sit clip below.
  mixer.stopAllAction(); mixer.clipAction(idleClip).play(); mixer.setTime(0); gltf.scene.updateMatrixWorld(true);
  for (const side of ['Left', 'Right']) {
    aim(`${side}UpLeg`, `${side}Leg`, [0, 0, 1]); aim(`${side}Leg`, `${side}Foot`, [0, -1, 0]);
    aim(`${side}Arm`, `${side}ForeArm`, [side === 'Left' ? .15 : -.15, -1, .2]); aim(`${side}ForeArm`, `${side}Hand`, [0, -.3, 1]);
  }
  { const d = Math.min(at(bone('LeftFoot')).y, at(bone('RightFoot')).y) - ground, h = bone('Hips');
    h.position.copy(h.parent.worldToLocal(at(h).add(new Vector3(0, -d, 0)))); gltf.scene.updateMatrixWorld(true); }
  const sit = doc.createAnimation('sit'), buffer = doc.getRoot().listBuffers()[0];
  const times = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1, 2])).setBuffer(buffer);
  for (const node of doc.getRoot().listNodes()) {
    const posed = gltf.scene.getObjectByName(node.getName()); if (!posed?.isBone) continue;
    for (const [path, type, value] of [['translation', 'VEC3', posed.position.toArray()], ['rotation', 'VEC4', posed.quaternion.toArray()], ['scale', 'VEC3', posed.scale.toArray()]]) {
      const values = doc.createAccessor().setType(type).setArray(new Float32Array([...value, ...value, ...value])).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(times).setOutput(values).setInterpolation('LINEAR');
      sit.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
    }
  }
  mixer.stopAllAction();
}

/** Skinned (idle frame 0) world height of a GLB, images stripped so three can parse it in node. */
async function skinnedHeight(bytes) {
  const doc = await io.readBinary(bytes);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression') e.dispose();
  const plain = await io.writeBinary(doc);
  const gltf = await new GLTFLoader().parseAsync(plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength), '');
  const mixer = new AnimationMixer(gltf.scene), idle = gltf.animations.find(a => a.name === 'idle'); if (idle) mixer.clipAction(idle).play(); mixer.update(0);
  gltf.scene.updateMatrixWorld(true);
  let min = Infinity, max = -Infinity; const v = new Vector3();
  gltf.scene.traverse(o => { if (!o.isSkinnedMesh) return; const p = o.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i += 5) { o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld); min = Math.min(min, v.y); max = Math.max(max, v.y); } });
  return max - min;
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : (await readdir(cache)).filter(id => HEIGHTS[id]);
for (const id of ids) {
  const dir = join(cache, id);
  const doc = await io.read(join(dir, 'rigged.glb'));
  for (const animation of doc.getRoot().listAnimations()) animation.dispose(); // Meshy's bind-pose placeholder clip
  for (const [file, name] of [['idle.glb', 'idle'], ['walking.glb', 'walk'], ['running.glb', 'run']]) adoptClip(doc, await io.read(join(dir, file)), name);
  await addSit(doc);
  for (const node of doc.getRoot().listNodes()) if (RENAME[node.getName()]) node.setName(RENAME[node.getName()]);
  // Uniform metre frame: feet at y=0, centred, standing height from the prompt spec.
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0], bounds = getBounds(scene);
  const s = HEIGHTS[id] / (bounds.max[1] - bounds.min[1]);
  const frame = doc.createNode('model-metre-frame').setScale([s, s, s])
    .setTranslation([-(bounds.min[0] + bounds.max[0]) / 2 * s, -bounds.min[1] * s, -(bounds.min[2] + bounds.max[2]) / 2 * s]);
  for (const node of scene.listChildren()) frame.addChild(node);
  scene.addChild(frame);
  for (const material of doc.getRoot().listMaterials()) material.setRoughnessFactor(.9).setMetallicFactor(0);
  const triangles = () => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  const before = triangles();
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, TRIS / before), error: .002, lockBorder: false }));
  const head = NO_HEAD_MAP ? null : await headMap(doc, id);
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: BODY_Q, pattern: /^(?!head-)/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [HEAD_W, HEAD_H], quality: HEAD_Q, pattern: /^head-/ }),
    prune(), dedup(), resample(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 14, quantizeNormal: 10 }));
  if (head) console.log(`${id}: head map ${head.headTriangles} head (${head.demoted} overlapped -> body atlas) / ${head.bodyTriangles} body tris`);
  const buffer = doc.getRoot().listBuffers()[0];
  for (const accessor of doc.getRoot().listAccessors()) accessor.setBuffer(buffer);
  await doc.transform(prune());
  // The optimisation passes can drop Meshy's 0.01 mesh-node scale while its positions stay in centimetres (a 177 m tall
  // body). Measure the real skinned idle height in three and correct the root frame until it matches the spec height.
  let out = await io.writeBinary(doc);
  for (let pass = 0; pass < 3; pass++) {
    const height = await skinnedHeight(out), ratio = HEIGHTS[id] / height;
    if (Math.abs(ratio - 1) < .02) break;
    frame.setScale(frame.getScale().map(v => v * ratio)); frame.setTranslation(frame.getTranslation().map(v => v * ratio));
    out = await io.writeBinary(doc);
    console.log(`${id}: skinned height ${height.toFixed(2)} -> corrected x${ratio.toFixed(4)}`);
  }
  const finalHeight = await skinnedHeight(out);
  if (Math.abs(finalHeight / HEIGHTS[id] - 1) > .03) throw new Error(`${id}: skinned height ${finalHeight} != ${HEIGHTS[id]}`);
  await writeFile(join(output, `meshy-${id}${SUFFIX}`), out);
  report.push({ id, path: `avatars/meshy-${id}${SUFFIX}`, bytes: out.byteLength, sha256: createHash('sha256').update(out).digest('hex'), trianglesBefore: before, triangles: triangles(),
    animations: doc.getRoot().listAnimations().map(a => a.getName()), source: 'Meshy-6 (existing plan credits) via tools/art/meshy-people.mjs; rig + clips by Meshy auto-rig/animation API' });
  console.log(`avatars/meshy-${id}${SUFFIX}: ${out.byteLength} bytes, ${before} -> ${triangles()} tris`);
}
await writeFile(join(repo, NO_HEAD_MAP ? 'tools/assets/report-meshy-people.json' : 'tools/assets/report-meshy-people-hm.json'), JSON.stringify(report, null, 2) + '\n');
