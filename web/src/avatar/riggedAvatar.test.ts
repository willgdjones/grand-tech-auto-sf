import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { Box3, Mesh, MeshLambertMaterial, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createAvatarTemplate } from './riggedAvatar';
import type { RideAnimation } from './ridingPoses';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { flags: { ...actual.flags, personalRides: true } };
});

describe('independent animated players', () => {
  it('places the real avatar above every ride deck and reaches the handlebars without walking legs', async () => {
    const bytes = await readFile(new URL('../../public/assets/avatars/hoodie.glb', import.meta.url));
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(Uint8Array.from(bytes).buffer, '');
    const template = createAvatarTemplate(gltf), rider = template.createInstance(), pedestrian = template.createInstance();
    const pedestrianLeg = pedestrian.root.getObjectByName('UpperLegL')!.quaternion.clone();
    const cases: [RideAnimation, number, Vector3 | null][] = [
      ['scooter', .145, new Vector3(.19, 1.01, .34)], ['skateboard', .123, null],
      ['ebike', .24, new Vector3(.18, .87, .5)], ['onewheel', .343, null], ['segway', .205, new Vector3(.17, 1.17, .025)],
    ];
    for (const [clip, deck, hand] of cases) {
      for (let i = 0; i < 5; i++) rider.update(.1, clip);
      rider.root.updateMatrixWorld(true);
      const bounds = new Box3();
      rider.root.traverse(node => {
        if (!(node instanceof SkinnedMesh)) return;
        node.skeleton.update(); node.computeBoundingBox();
        bounds.union(node.boundingBox!.clone().applyMatrix4(node.matrixWorld));
      });
      expect.soft(bounds.min.y, `${clip} soles above ground`).toBeGreaterThan(.03);
      expect.soft(Math.abs(bounds.min.y - deck), `${clip} soles meet deck`).toBeLessThan(.09);
      expect.soft(bounds.max.y, `${clip} finite human silhouette`).toBeLessThan(2.25);
      if (hand) for (const side of ['L', 'R']) {
        const grip = hand.clone(); if (side === 'R') grip.x *= -1;
        expect.soft(rider.root.getObjectByName(`Wrist${side}`)!.getWorldPosition(new Vector3()).distanceTo(grip), `${clip} ${side} hand reaches bar`).toBeLessThan(.18);
      }
      const leg = rider.root.getObjectByName('UpperLegL')!.quaternion.clone();
      for (let i = 0; i < 5; i++) rider.update(.1, clip);
      expect.soft(rider.root.getObjectByName('UpperLegL')!.quaternion.angleTo(leg), `${clip} legs hold stance`).toBeLessThan(.001);
      expect(pedestrian.root.getObjectByName('UpperLegL')!.quaternion.angleTo(pedestrianLeg)).toBeLessThan(.001);
    }
    for (let i = 0; i < 5; i++) rider.update(.1, 'walk');
    expect(rider.root.children[0]!.rotation.y).toBeCloseTo(0);
    template.dispose();
  });
  it('keeps outfits independent and the driving hands distinct from the passenger pose', async () => {
    const bytes = await readFile(new URL('../../public/assets/avatars/hoodie.glb', import.meta.url));
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(Uint8Array.from(bytes).buffer, '');
    const template = createAvatarTemplate(gltf), driver = template.createInstance(1), passenger = template.createInstance(2);
    const palette = (root: typeof driver.root) => {
      const colours: number[] = [];
      root.traverse(object => { if (object instanceof Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material instanceof MeshLambertMaterial && material.name === 'Purple') colours.push(material.color.getHex()); });
      return colours;
    };
    expect(palette(driver.root)).not.toEqual(palette(passenger.root));
    const previous = palette(passenger.root);
    driver.setOutfit(3); expect(driver.outfit).toBe(3); expect(palette(passenger.root)).toEqual(previous);
    for (let i = 0; i < 5; i++) { driver.update(.1, 'drive'); passenger.update(.1, 'sit'); }
    expect(driver.root.getObjectByName('UpperArmL')!.quaternion.angleTo(passenger.root.getObjectByName('UpperArmL')!.quaternion)).toBeGreaterThan(.2);
    expect(driver.root.getObjectByName('soft-contact-shadow')!.visible).toBe(false);
    driver.root.updateMatrixWorld(true);
    driver.root.traverse(object => { if (object instanceof SkinnedMesh) { object.skeleton.update(); object.computeBoundingBox(); } });
    const box = new Box3().setFromObject(driver.root, true);
    expect(box.min.y).toBeGreaterThan(-.1);
    expect(box.max.y).toBeLessThan(1.6);
    template.dispose();
  });
  it('animates and fades one player without mutating another, and disposes shared data last', async () => {
    const bytes = await readFile(new URL('../../public/assets/avatars/hoodie.glb', import.meta.url));
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(Uint8Array.from(bytes).buffer, '');
    const template = createAvatarTemplate(gltf), local = template.createInstance(), remote = template.createInstance();
    const localLeg = local.root.getObjectByName('UpperLegL')!, remoteLeg = remote.root.getObjectByName('UpperLegL')!;
    expect(localLeg).toBeDefined(); expect(remoteLeg).toBeDefined();
    const still = remoteLeg.quaternion.clone();
    for (let i = 0; i < 6; i++) local.update(.05, 'run', .3);
    expect(localLeg.quaternion.angleTo(still)).toBeGreaterThan(.1);
    expect(remoteLeg.quaternion.angleTo(still)).toBeLessThan(.001);
    let localSkin: SkinnedMesh | undefined, remoteSkin: SkinnedMesh | undefined;
    local.root.traverse(object => { if (object instanceof SkinnedMesh) localSkin = object; });
    remote.root.traverse(object => { if (object instanceof SkinnedMesh) remoteSkin = object; });
    expect(localSkin!.skeleton).not.toBe(remoteSkin!.skeleton);
    expect(localSkin!.geometry).toBe(remoteSkin!.geometry);
    remote.root.traverse(object => {
      if (object instanceof Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) expect(material.opacity).toBe(1);
    });
    let geometryDisposals = 0;
    localSkin!.geometry.addEventListener('dispose', () => geometryDisposals++);
    local.dispose(); local.dispose();
    expect(geometryDisposals).toBe(0);
    remote.update(.1, 'walk');
    template.dispose(); template.dispose();
    expect(geometryDisposals).toBe(1);
    expect(() => template.createInstance()).toThrow('disposed');
  });
});
