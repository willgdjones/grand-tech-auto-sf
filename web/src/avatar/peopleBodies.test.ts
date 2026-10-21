import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { Mesh, PropertyBinding, SkinnedMesh, Vector3 } from 'three';
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createAvatarTemplate } from './riggedAvatar';
import { CC0_BODIES, MESHY_BODIES } from './peopleAssets';

/** Every body any pool can show (player wardrobe, near NPCs, crowd, VAT): clothed, rigged, never stuck in a T-pose.
 * Guards against base/underwear meshes (e.g. the disqualified Universal Base Characters) ever entering a pool. */
// meshy-clips.glb is the shared one-shot clip file (meshyDeathClips: skeleton + clips, no mesh), not a body.
const MESHY = (await readdir(new URL('../../public/assets/avatars/', import.meta.url))).filter(f => /^meshy-.*\.glb$/.test(f) && !f.endsWith('clips.glb')).map(f => f.slice(0, -4));
// Both pools regardless of flags (meshyPeople picks one at runtime); MESHY also covers the meshyHeadMaps *.hm.glb set.
const POOL = ['hoodie', ...CC0_BODIES, ...MESHY_BODIES, ...MESHY] as const;
const textures = new Map<string, boolean>();
const load = async (id: string) => {
  // Node can't decode embedded images in three's GLTFLoader: note whether the body is textured, then strip the images.
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(fileURLToPath(new URL(`../../public/assets/avatars/${id}.glb`, import.meta.url)));
  textures.set(id, doc.getRoot().listTextures().length > 0);
  for (const texture of doc.getRoot().listTextures()) texture.dispose();
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
  const bytes = await io.writeBinary(doc);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
};
const world = (root: Object3D, name: string) => root.getObjectByName(name)!.getWorldPosition(new Vector3());

describe('CC0 body pool', () => {
  it.each(POOL)('%s is clothed, fully skinned and animates out of the bind pose', async id => {
    const gltf = await load(id);
    for (const clip of ['idle', 'walk', 'run', 'sit']) expect(gltf.animations.some(a => a.name === clip), `${id} has ${clip}`).toBe(true);
    const materials = new Set<string>(), textured = textures.get(id)!;
    gltf.scene.traverse(node => {
      if (!(node instanceof Mesh)) return;
      expect(node instanceof SkinnedMesh, `${id}: ${node.name} is skinned`).toBe(true);
      for (const material of [node.material].flat()) materials.add(material.name);
    });
    const clothing = [...materials].filter(name => !/^(Skin|Hair|Eye|Eyebrows|Moustache|Earrings)/.test(name));
    // Flat-colour bodies need >=3 clothing materials; a textured (Meshy) body carries its clothing in the texture.
    expect(textured || clothing.length >= 3, `${id} wears clothes (${[...materials].join(', ')})`).toBe(true);
    // The clips must BIND to this body: every walk track resolves to a bone, and a stride visibly rotates the leg
    // (these bodies' bind pose is already arms-down, so an unbound clip would otherwise pass the arm check).
    const walk = gltf.animations.find(a => a.name === 'walk')!;
    for (const track of walk.tracks) expect(gltf.scene.getObjectByName(PropertyBinding.parseTrackName(track.name).nodeName), `${id} walk track ${track.name} binds`).toBeTruthy();
    // Real human scale in metres, measured on the skinned mesh (a dropped node scale once made Meshy bodies 177 m tall).
    gltf.scene.updateMatrixWorld(true);
    let low = Infinity, high = -Infinity; const v = new Vector3();
    gltf.scene.traverse(node => { if (!(node instanceof SkinnedMesh)) return; const p = node.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i += 7) { node.getVertexPosition(i, v).applyMatrix4(node.matrixWorld); low = Math.min(low, v.y); high = Math.max(high, v.y); } });
    expect(high - low, `${id} skinned height in metres`).toBeGreaterThan(1.4);
    expect(high - low, `${id} skinned height in metres`).toBeLessThan(2.1);
    const template = createAvatarTemplate(gltf), person = template.createInstance();
    person.update(0, 'walk'); for (let i = 0; i < 3; i++) person.update(.1, 'walk');
    const stride = person.root.getObjectByName('UpperLegL')!.quaternion.clone();
    for (let i = 0; i < 4; i++) person.update(.1, 'walk');
    expect(stride.angleTo(person.root.getObjectByName('UpperLegL')!.quaternion), `${id} walk moves the leg`).toBeGreaterThan(5 * Math.PI / 180);
    for (const clip of ['idle', 'walk'] as const) {
      for (let i = 0; i < 6; i++) person.update(.1, clip);
      person.root.updateMatrixWorld(true);
      for (const side of ['L', 'R']) {
        // A T-pose holds the wrists at shoulder height; idle and walk keep them well below.
        const drop = world(person.root, `UpperArm${side}`).y - world(person.root, `Wrist${side}`).y;
        expect.soft(drop, `${id} ${clip} ${side} arm hangs (not T-pose)`).toBeGreaterThan(.15);
      }
    }
    person.dispose(); template.dispose();
  });

  it.each(['crowd-vat', 'crowd-vat-meshy'])('the %s crowd is baked only from pool bodies', async name => {
    const header = JSON.parse(await readFile(new URL(`../../public/assets/avatars/${name}.json`, import.meta.url), 'utf8')) as { bodies: { id: string }[] };
    expect(header.bodies.length).toBeGreaterThan(0);
    for (const body of header.bodies) expect(POOL as readonly string[], `VAT body ${body.id}`).toContain(body.id);
  });
});
