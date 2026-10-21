import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, LOD, Mesh, MeshLambertMaterial, MeshStandardMaterial, Texture } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { flags } from '@gtasf/shared/flags';
import { createVehicleTemplate, loadRealisticExtraTemplate, loadVehicleTemplate } from './vehicle';
import { graphicsPreset } from '../../render/graphicsPreset';
import * as polish from './polish';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags } };
});
vi.mock('../../render/graphicsPreset', async importOriginal => {
  const actual = await importOriginal<typeof import('../../render/graphicsPreset')>();
  return { ...actual, graphicsPreset: vi.fn(actual.graphicsPreset) };
});
const originalFlags = { ps2Render: flags.ps2Render, realisticRender: flags.realisticRender, driving: flags.driving, vehiclePolish: flags.vehiclePolish, pbrCarsV2: flags.pbrCarsV2, graphicsV2: flags.graphicsV2 };
afterEach(() => { vi.restoreAllMocks(); vi.mocked(graphicsPreset).mockReset(); Object.assign(flags, originalFlags); });

describe('trimmed CC0 vehicle loading', () => {
  it('loads every personal car and preserves finite far-LOD colours for single-material trim', async () => {
    for (const id of ['prius', 'model3', 'outback', 'vc-supercar'] as const) {
      const bytes = await readFile(new URL(`../../../public/assets/vehicles/${id}.glb`, import.meta.url));
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(Uint8Array.from(bytes).buffer, '');
      const template = createVehicleTemplate(id, gltf), car = template.createInstance();
      expect(car.root.getObjectByName('chrome-front-bumper'), id).toBeDefined();
      expect(car.root.getObjectByName('wheel-front-left'), id).toBeDefined();
      const lod = car.root.children.find(object => object instanceof LOD) as LOD;
      const far = lod.levels[1]!.object as Mesh;
      const colours = Array.from(far.geometry.getAttribute('color').array);
      expect(colours.every(Number.isFinite), id).toBe(true);
      expect(colours.some(value => value > .4), id).toBe(true);
      expect(template.budget.farDraws).toBe(1);
      template.dispose();
    }
  });
});

describe('realistic (Meshy PBR) vehicle templates', () => {
  const gltf = (name: string) => {
    const scene = new Group(), material = new MeshStandardMaterial({ map: new Texture(), metalness: 1, roughness: 1 });
    scene.add(Object.assign(new Mesh(new BoxGeometry(2, 1.5, 4.7), material), { name }));
    return { scene } as unknown as GLTF;
  };
  it('keeps authored PBR materials, uses the Low model as far LOD and disposes its textures', () => {
    const near = gltf('body'), far = gltf('body');
    const nearPaint = (near.scene.children[0] as Mesh).material as MeshStandardMaterial;
    const farPaint = (far.scene.children[0] as Mesh).material as MeshStandardMaterial;
    nearPaint.emissive.setHex(0x112233);
    farPaint.emissive.setHex(0xffffff); // Shipped Low GLB: emissive mask removed, white factor left.
    const template = createVehicleTemplate('cab', near, undefined, { preset: 'hd', far });
    const car = template.createInstance();
    const lod = car.root.children.find(object => object instanceof LOD) as LOD;
    const body = lod.levels[0]!.object.getObjectByName('body') as Mesh;
    expect(body.material).toBeInstanceOf(MeshStandardMaterial);
    expect(body.castShadow).toBe(true);
    expect(car.root.getObjectByName('chrome-front-bumper')).toBeUndefined();
    expect(lod.levels[1]!.object.getObjectByName('body')).toBeDefined();
    expect(farPaint.emissive.getHex()).toBe(0);
    expect(nearPaint.emissive.getHex()).toBe(0x112233);
    expect(template.budget.triangles).toBe(12);
    let disposed = 0;
    (body.material as MeshStandardMaterial).map!.addEventListener('dispose', () => disposed++);
    template.dispose();
    expect(disposed).toBe(1);
  });

  it('uses the coloured CC0/Lambert fleet on Low without requesting PBR vehicles or extras', async () => {
    Object.assign(flags, { ps2Render: true, realisticRender: true, driving: true, vehiclePolish: true, pbrCarsV2: false });
    vi.mocked(graphicsPreset).mockReturnValue('low');
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => gltf('body'));
    vi.spyOn(polish, 'loadVehicleTextures').mockResolvedValue(undefined);
    const template = (await loadVehicleTemplate('prius'))!, car = template.createInstance();
    expect(load.mock.calls.map(([url]) => url)).toEqual(['/assets/vehicles/prius.glb']);
    const body = car.root.getObjectByName('body') as Mesh;
    expect(body.material).toBeInstanceOf(MeshLambertMaterial);
    for (const id of ['cab', 'van', 'food-truck', 'scooter'] as const) expect(await loadRealisticExtraTemplate(id)).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
    template.dispose();
  });

  it('pbrCarsV2 loads the Meshy .low.glb on graphicsV2 Low and demotes its PBR materials to Lambert', async () => {
    Object.assign(flags, { driving: true, graphicsV2: true, pbrCarsV2: true });
    vi.mocked(graphicsPreset).mockReturnValue('low');
    // A one-mesh "car" whose body uses a MeshStandard (PBR) material, as the Meshy GLBs do.
    const standard = () => { const g = new Group(); const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ metalness: 1, color: 0x335577 })); mesh.name = 'body'; g.add(mesh); return { scene: g } as unknown as GLTF; };
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => standard());
    const template = (await loadVehicleTemplate('prius'))!, car = template.createInstance();
    expect(load.mock.calls.map(([url]) => url)).toEqual(['/assets/vehicles-pbr/prius.low.glb']);
    const body = car.root.getObjectByName('body') as Mesh;
    expect(body.material).toBeInstanceOf(MeshLambertMaterial);
    expect(body.material).not.toBeInstanceOf(MeshStandardMaterial);
    template.dispose();
  });

});
