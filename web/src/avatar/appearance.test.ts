import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { Box3, Mesh, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { flags } from '@gtasf/shared/flags';
import { FOUNDER_ARCHETYPES, LOOK_TIERS, defaultAppearance, resolveLook } from '@gtasf/shared/content/cosmetics';
import { avatarLookChoices } from './appearance';
import { createAvatarTemplate } from './riggedAvatar';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { flags: { ...actual.flags, characterLooks: true, personalRides: true } };
});

it('dresses the shipped rig independently, keeps props on animated bones, fades and frees appearances', async () => {
  const bytes = await readFile(new URL('../../public/assets/avatars/hoodie.glb', import.meta.url));
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(Uint8Array.from(bytes).buffer, '');
  const template = createAvatarTemplate(gltf), local = template.createInstance(0), remote = template.createInstance(1);
  const initial = new Map<SkinnedMesh, typeof SkinnedMesh.prototype.geometry>();
  local.root.traverse(node => { if (node instanceof SkinnedMesh) initial.set(node, node.geometry); });
  const remoteColours: string[] = [];
  remote.root.traverse(node => { if (node instanceof Mesh) remoteColours.push(JSON.stringify(node.material)); });
  const ownedGeometries = new Set<object>(); let disposed = 0;

  for (const sex of ['male', 'female'] as const) for (const [index, archetype] of FOUNDER_ARCHETYPES.entries()) {
    const tier = LOOK_TIERS[index % LOOK_TIERS.length]!;
    const look = resolveLook({ ...defaultAppearance(sex, archetype.id), outfit: index % 8, hair: index % 8, hairColor: index % 8, accessory: index % 8 }, { id: tier.unlockRoundId });
    local.applyLook(look);
    expect(local.outfit).toBe(index % 8);
    expect(local.root.getObjectByName(`garment-${look.outfit}`)).toBeDefined();
    const bodyChanges = [...initial].filter(([mesh, geometry]) => mesh.name.startsWith('Casual_Body') && mesh.geometry !== geometry).length;
    expect(bodyChanges > 0).toBe(sex === 'female');
    const legs = local.root.getObjectByName('Casual_Legs_1') as SkinnedMesh;
    expect(legs.visible).toBe(true); // Fabric retains connected skin at the knees.
    if (tier.index > 0) expect(legs.geometry.getAttribute('skinWeight').array).toEqual(initial.get(legs)!.getAttribute('skinWeight').array);
    local.root.traverse(node => {
      if (!(node instanceof Mesh) || node instanceof SkinnedMesh || node.name === 'soft-contact-shadow') return;
      if (!ownedGeometries.has(node.geometry)) {
        ownedGeometries.add(node.geometry); node.geometry.addEventListener('dispose', () => disposed++);
      }
    });
    local.root.updateMatrixWorld(true);
    const cap = local.root.getObjectByName('appearance-Head')!;
    expect(cap.parent?.name).toBe('Head');
    const boneBefore = local.root.getObjectByName('WristL')!.getWorldPosition(new Vector3());
    for (let i = 0; i < 6; i++) local.update(.1, 'run', .35);
    local.root.updateMatrixWorld(true);
    expect(local.root.getObjectByName('WristL')!.getWorldPosition(new Vector3()).distanceTo(boneBefore)).toBeGreaterThan(.01);
    local.root.traverse(node => {
      if (node instanceof Mesh && node.name !== 'soft-contact-shadow') {
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) expect(material.opacity).toBe(.35);
      }
      if (node instanceof SkinnedMesh) { node.skeleton.update(); node.computeBoundingBox(); }
    });
    const bounds = new Box3().setFromObject(local.root, true);
    expect(bounds.min.y).toBeGreaterThan(-.3); expect(bounds.max.y).toBeLessThan(2.4);
    expect(bounds.getSize(new Vector3()).length()).toBeLessThan(3.5);
    local.update(.1, 'drive');
    for (const name of ['prop-laptop', 'prop-tote', 'prop-sketchbook', 'prop-phone-gimbal', 'prop-coffee', 'prop-folding-bike', 'backpack']) {
      const prop = local.root.getObjectByName(name); if (prop) expect(prop.visible).toBe(false);
    }
    local.update(.1, 'idle');
  }
  const after: string[] = [];
  remote.root.traverse(node => { if (node instanceof Mesh) after.push(JSON.stringify(node.material)); });
  expect(after).toEqual(remoteColours);
  for (const catalogue of Object.values(avatarLookChoices)) expect(catalogue.map(choice => choice.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  Object.assign(flags, { characterLooks: false });
  remote.applyLook(resolveLook(defaultAppearance('female', 'biotech')));
  expect(remote.root.getObjectByName('appearance-Head')).toBeUndefined();
  Object.assign(flags, { characterLooks: true });
  local.dispose(); local.dispose();
  expect(disposed).toBe(ownedGeometries.size);
  remote.update(.1, 'walk'); template.dispose(); template.dispose();
});
