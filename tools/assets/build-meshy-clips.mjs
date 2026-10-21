/** Shared Meshy one-shot clips (lane D, meshyDeathClips; GTA V critic #9): forward/backward death falls for every Meshy body
 * from ONE file, instead of ~96 KB of clips baked into each body. Every Meshy auto-rig has the same 24-bone skeleton, so
 * rotation tracks transfer; the hip (Body) translation is retargeted per body at runtime (riggedAvatar pose()).
 * Input: tools/art/meshy-people.mjs `clips` output in tools/assets/cache/meshy-people/<SOURCE>/<name>.glb.
 * Output: web/public/assets/avatars/meshy-clips.glb (skeleton nodes + clips; no mesh, no texture).
 *   nice -n 10 node tools/assets/build-meshy-clips.mjs        # env SOURCE (default tech-vest-man), CLIPS, FPS */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = process.env.SOURCE ?? 'tech-vest-man', CLIPS = (process.env.CLIPS ?? 'dieforward,diebackward,hit').split(',');
const FPS = Number(process.env.FPS ?? 20); // a fall reads fine at 20 keys/s with linear interpolation
// TRIM=name:start-end,... keeps one window of a long library clip (seconds), rebased to t=0 (e.g. the reach-and-pull of a
// 5 s 'Open Door'). Clips without an entry keep their full length.
const TRIM = new Map((process.env.TRIM ?? '').split(',').filter(Boolean).map(entry => { const [name, range] = entry.split(':'); const [a, b] = range.split('-').map(Number); return [name, [a, b]]; }));
// OUT_NAME: pedIdleVariety's clips go in their own file (CLIPS=phonecall,lookaround,phonewalk OUT_NAME=meshy-idle-clips.glb) so
// prod's death-clip file doesn't grow while that flag is off.
const dir = join(repo, 'tools/assets/cache/meshy-people', SOURCE), output = join(repo, 'web/public/assets/avatars', process.env.OUT_NAME ?? 'meshy-clips.glb');
// Same bone renames as build-meshy-people.mjs, so tracks bind to the shipped bodies' node names.
const RENAME = { Hips: 'Body', Spine02: 'Chest', LeftShoulder: 'Shoulder.L', RightShoulder: 'Shoulder.R', LeftArm: 'UpperArm.L', RightArm: 'UpperArm.R',
  LeftForeArm: 'LowerArm.L', RightForeArm: 'LowerArm.R', LeftHand: 'Wrist.L', RightHand: 'Wrist.R', LeftUpLeg: 'UpperLeg.L', RightUpLeg: 'UpperLeg.R',
  LeftLeg: 'LowerLeg.L', RightLeg: 'LowerLeg.R', LeftFoot: 'Foot.L', RightFoot: 'Foot.R', neck: 'Neck' };
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(join(dir, `${CLIPS[0]}.glb`));
doc.getRoot().listAnimations()[0].setName(CLIPS[0]);
const nodes = new Map(doc.getRoot().listNodes().map(n => [n.getName(), n])), buffer = doc.getRoot().listBuffers()[0];
for (const name of CLIPS.slice(1)) { // copy each further clip's channels onto this document's nodes by name
  const source = (await io.read(join(dir, `${name}.glb`))).getRoot().listAnimations()[0], clip = doc.createAnimation(name);
  for (const channel of source.listChannels()) {
    const target = nodes.get(channel.getTargetNode()?.getName()); if (!target) continue;
    const s = channel.getSampler(), copy = acc => doc.createAccessor().setType(acc.getType()).setArray(acc.getArray().slice()).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(copy(s.getInput())).setOutput(copy(s.getOutput())).setInterpolation(s.getInterpolation());
    clip.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(channel.getTargetPath()).setSampler(sampler));
  }
}
// Rotations everywhere + the hip translation; scale and the other bones' (constant) translations stay each body's own.
for (const animation of doc.getRoot().listAnimations()) for (const channel of animation.listChannels()) {
  const [from, to] = TRIM.get(animation.getName()) ?? [0, Infinity];
  const keep = channel.getTargetPath() === 'rotation' || (channel.getTargetPath() === 'translation' && channel.getTargetNode()?.getName() === 'Hips');
  if (!keep) { const sampler = channel.getSampler(); channel.dispose(); sampler.dispose(); continue; }
  // Thin to FPS keys/s before resample() drops the linear-redundant ones.
  const s = channel.getSampler(), times = s.getInput().getArray(), values = s.getOutput().getArray(), size = s.getOutput().getElementSize();
  const keepIdx = [];
  let next = from;
  for (let i = 0; i < times.length; i++) if (times[i] >= from - 1e-6 && times[i] <= to + 1e-6 && (times[i] >= next - 1e-6 || i === times.length - 1)) { keepIdx.push(i); next = times[i] + 1 / FPS; }
  if (!keepIdx.length) keepIdx.push(times.length - 1);
  s.setInput(doc.createAccessor().setType('SCALAR').setArray(Float32Array.from(keepIdx, i => times[i] - Math.min(from, times[keepIdx[0]]))).setBuffer(buffer));
  s.setOutput(doc.createAccessor().setType(s.getOutput().getType()).setArray(Float32Array.from(keepIdx.flatMap(i => Array.from(values.subarray(i * size, i * size + size))))).setBuffer(buffer));
}
// Skeleton only: drop meshes, skins, materials and textures.
for (const node of doc.getRoot().listNodes()) { node.setMesh(null); node.setSkin(null); }
for (const skin of doc.getRoot().listSkins()) skin.dispose();
for (const mesh of doc.getRoot().listMeshes()) mesh.dispose();
for (const node of doc.getRoot().listNodes()) if (RENAME[node.getName()]) node.setName(RENAME[node.getName()]);
await doc.transform(prune({ keepLeaves: true }), resample({ tolerance: 2e-4 }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
// Every byte counts against the 87 MB cap: round the JSON chunk's float noise (node TRS, accessor bounds) to 5 significant
// digits (sub-micron at these scales) and re-pack the GLB.
const glb = await io.writeBinary(doc), jsonLength = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
const round = value => Array.isArray(value) ? value.map(round) : typeof value === 'number' && !Number.isInteger(value) ? Number(value.toPrecision(5)) : value;
for (const node of json.nodes ?? []) for (const key of ['translation', 'rotation', 'scale']) if (node[key]) node[key] = round(node[key]);
for (const accessor of json.accessors ?? []) for (const key of ['min', 'max']) if (accessor[key]) accessor[key] = round(accessor[key]);
let text = JSON.stringify(json); while (text.length % 4) text += ' ';
const jsonBytes = new TextEncoder().encode(text), bin = glb.subarray(20 + jsonLength);
const out = new Uint8Array(20 + jsonBytes.length + bin.length), view = new DataView(out.buffer);
view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
view.setUint32(12, jsonBytes.length, true); view.setUint32(16, 0x4e4f534a, true); out.set(jsonBytes, 20); out.set(bin, 20 + jsonBytes.length);
await writeFile(output, out);
console.log(`avatars/meshy-clips.glb: ${out.byteLength} bytes, clips ${doc.getRoot().listAnimations().map(a => `${a.getName()} ${a.listChannels().length}ch`).join(', ')} (source ${SOURCE}, ${FPS} fps)`);
