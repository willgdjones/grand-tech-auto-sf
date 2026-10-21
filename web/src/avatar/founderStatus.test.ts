import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { Group, Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { defaultAppearance, resolveLook } from '@gtasf/shared/content/cosmetics';
import { flags } from '@gtasf/shared/flags';
import { createAvatarTemplate } from './riggedAvatar';
import { createFounderStatus, withFounderStatus } from './founderStatus';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { flags: { ...actual.flags, characterLooks: true } };
});

it('grounds real animated assistants, hides blocked or seated followers, and removes status on down-rounds', async () => {
  const bytes = await readFile(new URL('../../public/assets/avatars/hoodie.glb', import.meta.url));
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(Uint8Array.from(bytes).buffer, '');
  const template = createAvatarTemplate(gltf), scene = new Group(), owner = new Group(); scene.add(owner);
  let loaded = true, blocked = false;
  const environment = { scene, heightAt: (x: number, z: number) => x * .2 + z * .1, collides: () => blocked, isLoaded: () => loaded };
  const status = createFounderStatus(environment, look => template.createInstance(0, look))!;
  const look = resolveLook(defaultAppearance(), { id: 'decacorn' });
  status.setLook(look); status.update(.1, owner, 'idle', 1, 0);
  const followers = status.root.children.filter(node => node.name !== 'founder-jet');
  expect(followers).toHaveLength(2);
  const jet = status.root.getObjectByName('founder-jet')!; expect(jet.position.y).toBe(45);
  for (const follower of followers) expect(follower.position.y).toBeCloseTo(environment.heightAt(follower.position.x, follower.position.z));
  const before = followers[0]!.position.clone(); owner.position.set(2, .4, 1); owner.rotation.y = .5;
  for (let i = 0; i < 20; i++) status.update(.1, owner, 'walk', .4, i * 100);
  expect(followers[0]!.position.distanceTo(before)).toBeGreaterThan(.5);
  for (const follower of followers) {
    expect(follower.position.y).toBeCloseTo(environment.heightAt(follower.position.x, follower.position.z));
    follower.traverse(node => { if (node instanceof Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) expect(material.opacity).toBe(.4); });
  }
  blocked = true; status.update(.1, owner, 'walk'); expect(followers.every(node => !node.visible)).toBe(true);
  blocked = false; loaded = false; status.update(.1, owner, 'walk'); expect(followers.every(node => !node.visible)).toBe(true);
  loaded = true; status.update(.1, owner, 'idle'); expect(followers.every(node => node.visible)).toBe(true);
  status.update(.1, owner, 'drive'); expect(followers.every(node => !node.visible)).toBe(true);
  expect(jet.visible).toBe(true);
  status.update(.1, owner, 'idle'); expect(followers.every(node => node.visible)).toBe(true);
  status.setLook(resolveLook(defaultAppearance(), { id: 'unicorn' }));
  expect(status.root.children).toHaveLength(1); expect(jet.parent).toBeNull();
  status.setLook(resolveLook(defaultAppearance())); expect(status.root.children).toHaveLength(0);
  status.dispose(); status.dispose(); expect(status.root.parent).toBeNull();
  const wrapped = withFounderStatus(template, environment)!;
  const founder = wrapped.createInstance(2, look); scene.add(founder.root);
  founder.update(.1, 'walk');
  expect(scene.children.filter(node => node.name === 'founder-status')).toHaveLength(1);
  expect(scene.getObjectByName('founder-assistant')).toBeDefined();
  founder.applyLook(resolveLook(defaultAppearance()));
  expect(scene.getObjectByName('founder-status')).toBeUndefined();
  founder.applyLook(look); wrapped.dispose(); wrapped.dispose();
  expect(scene.getObjectByName('founder-status')).toBeUndefined();
  expect(founder.root.parent).toBeNull();
  expect(() => wrapped.createInstance()).toThrow('disposed');
  Object.assign(flags, { characterLooks: false });
  expect(createFounderStatus(environment, () => { throw new Error('Flag-off must not create avatars'); })).toBeNull();
  Object.assign(flags, { characterLooks: true });
});

it('forwards the optional avatar members (pose, setTier) through the founder-status wrapper', () => {
  // Regression (10-19): the wrapper dropped pose() and setTier(), so with characterLooks on (prod) meshyDeathClips, walker
  // flinch/habit clips and meshyTierDress were silent no-ops on every wrapped avatar.
  const calls: string[] = [];
  const base = { root: new Group(), outfit: 0, setOutfit() {}, applyLook() {}, update() {}, dispose() {},
    setTier(tier: number) { calls.push(`tier ${tier}`); },
    pose(clip: string, seconds: number) { calls.push(`pose ${clip} ${seconds}`); return clip === 'dieforward'; } };
  const wrapped = withFounderStatus({ createInstance: () => base, dispose() {} },
    { scene: new Group(), heightAt: () => 0, collides: () => false, isLoaded: () => true })!.createInstance(0);
  expect(wrapped.pose?.('dieforward', .3)).toBe(true);
  expect(wrapped.pose?.('nope', .1)).toBe(false);
  wrapped.setTier?.(2);
  expect(calls).toEqual(['pose dieforward 0.3', 'pose nope 0.1', 'tier 2']);
  wrapped.dispose();
  expect(wrapped.pose?.('dieforward', .3)).toBe(false); // disposed: no pose
});
