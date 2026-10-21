import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { CAR_DECAL_PLACEMENTS, RIDE_DECAL_PLACEMENTS, createLogoDecal, loadLogoTexture } from './logoDecal';

describe('logo decal', () => {
  it('builds one textured plane per placement, sharing a material, and disposes cleanly', () => {
    const texture = new Texture();
    const decal = createLogoDecal(texture, CAR_DECAL_PLACEMENTS);
    expect(decal.root).toBeInstanceOf(Group);
    const meshes = decal.root.children.filter((o): o is Mesh => o instanceof Mesh);
    expect(meshes.length).toBe(CAR_DECAL_PLACEMENTS.length); // one plane per door
    const material = meshes[0]!.material as MeshStandardMaterial;
    expect(material.map).toBe(texture);
    expect(material.transparent).toBe(true);
    expect(meshes.every(m => m.material === material)).toBe(true); // shared material
    // doors mirror on x and face opposite ways
    expect(meshes[0]!.position.x).toBeCloseTo(-meshes[1]!.position.x, 5);
    expect(meshes[0]!.rotation.y).toBeCloseTo(-meshes[1]!.rotation.y, 5);

    const geo = meshes[0]!.geometry;
    decal.dispose();
    expect(material.map).toBe(texture); // texture is the caller's; decal frees only its own geo+material
    expect(() => geo.getAttribute('position')).not.toThrow();
  });

  it('ride placements lie flat (face up) and are small', () => {
    expect(RIDE_DECAL_PLACEMENTS.length).toBeGreaterThan(0);
    for (const p of RIDE_DECAL_PLACEMENTS) {
      expect(p.rx).toBeCloseTo(-Math.PI / 2, 5); // flat on the deck, facing up
      expect(p.size ?? 0.5).toBeLessThan(0.3);
    }
    const decal = createLogoDecal(new Texture(), RIDE_DECAL_PLACEMENTS);
    expect(decal.root.children.length).toBe(RIDE_DECAL_PLACEMENTS.length);
    decal.dispose();
  });

  it('loadLogoTexture sets sRGB colour space via an injected loader', async () => {
    const fake = new Texture();
    const texture = await loadLogoTexture('https://assets.example/logo.webp', { loadAsync: async () => fake });
    expect(texture).toBe(fake);
    expect(texture.colorSpace).toBe('srgb');
  });
});
