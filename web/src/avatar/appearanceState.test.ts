import { readFile } from 'node:fs/promises';
import { expect, test, vi } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { decodeAppearance, defaultAppearance, encodeAppearance, resolveLook } from '@gtasf/shared/content/cosmetics';
import { APPEARANCE_STORAGE_KEY, createAppearanceState } from './appearanceState';
import { createAvatarTemplate } from './riggedAvatar';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { flags: { ...actual.flags, characterLooks: true } };
});

test('saved wardrobe and identity choices follow profile tiers and replay onto the actual peer rig', async () => {
  const values = new Map<string, string>([['gtasf.outfit', '6']]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const state = createAppearanceState({ legacyOutfitCount: 4, storage });
  expect(state.current.outfit).toBe(2);
  state.set({ ...state.current, outfit: 7, hair: 6, hairColor: 4, accessory: 2, car: 3, stageRound: 63 });
  expect(state.current.stageRound).toBe(0); // Cosmetic changes cannot manufacture earned tiers.
  state.set({ ...state.current, sex: 'female', archetype: 'design' });
  expect(state.current).toMatchObject({ sex: 'female', archetype: 'design', outfit: 7, hair: 6, hairColor: 4, accessory: 2, car: 3 });
  expect(state.look.tier.index).toBe(0); // Applies before any network/profile exists.
  const bytes = await readFile(new URL('../../public/assets/avatars/hoodie.glb', import.meta.url));
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(Uint8Array.from(bytes).buffer, '');
  const template = createAvatarTemplate(gltf), local = template.createInstance(state.current.outfit, state.look);
  try {
    expect(local.outfit).toBe(7);
    expect(local.root.getObjectByName('prop-sketchbook')).toBeDefined();
    state.setRound({ id: 'series-d' }); local.applyLook(state.look);
    expect(state.look.outfit).toBe('tailored-suit');
    expect(local.root.getObjectByName('garment-tailored-suit')).toBeDefined();
    const saved = decodeAppearance(Number(values.get(APPEARANCE_STORAGE_KEY)));
    expect(saved.stageRound).toBe(0);
    const restored = createAppearanceState({ fallbackOutfit: 1, legacyOutfitCount: 4, storage });
    expect(restored.current).toEqual(saved);
    restored.setRound({ id: 'series-d' });
    expect(restored.encoded).toBe(state.encoded);
    // An APPEARANCE can arrive before its pose: render a late peer from that wire value.
    const cached = restored.encoded;
    const peer = template.createInstance(0, resolveLook(decodeAppearance(cached)));
    try {
      expect(peer.outfit).toBe(7);
      expect(peer.root.getObjectByName('garment-tailored-suit')).toBeDefined();
      expect(peer.root.getObjectByName('prop-sketchbook')).toBeDefined();
      restored.setRound({ id: 'bootstrapping' });
      restored.set({ ...restored.current, sex: 'male', archetype: 'climate', outfit: 5 });
      peer.applyLook(resolveLook(decodeAppearance(restored.encoded))); peer.update(.1, 'walk');
      expect(peer.outfit).toBe(5);
      expect(peer.root.getObjectByName('garment-hoodie')).toBeDefined();
      expect(peer.root.getObjectByName('prop-folding-bike')).toBeDefined();
      expect(local.outfit).toBe(7); // Remote changes do not mutate the local avatar.
    } finally { peer.dispose(); }
    state.setRound({ id: 'missing-round' }); local.applyLook(state.look);
    expect(state.look.tier.index).toBe(0);
    expect(state.current.sex).toBe('female');
  } finally { local.dispose(); template.dispose(); }

  values.set(APPEARANCE_STORAGE_KEY, String(encodeAppearance({ ...defaultAppearance('female', 'biotech'), stageRound: 63 })));
  expect(createAppearanceState({ legacyOutfitCount: 4, storage }).current).toMatchObject({ sex: 'female', archetype: 'biotech', stageRound: 0 });
  values.set(APPEARANCE_STORAGE_KEY, 'broken'); values.set('gtasf.outfit', '');
  expect(createAppearanceState({ fallbackOutfit: 3, legacyOutfitCount: 4, storage }).current.outfit).toBe(3);
  const blocked = createAppearanceState({ fallbackOutfit: 2, legacyOutfitCount: 4, storage: {
    getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); },
  } });
  blocked.set({ ...blocked.current, hair: 5, archetype: 'consumer' });
  blocked.setRound({ id: 'series-a' });
  expect(blocked.look).toMatchObject({ hair: 5, title: 'Consumer', outfit: 'blazer-watch' });
  expect(createAppearanceState({ fallbackOutfit: 1, legacyOutfitCount: 4, storage: null }).current.outfit).toBe(1);
});
