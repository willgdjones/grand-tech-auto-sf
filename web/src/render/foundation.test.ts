import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { createCityScene, HAZE, prepareWorldGeometry } from './foundation';
import { BLOOM, bloomChannel } from './post';
import { SKY_COLOURS } from './sky';
import { drawingSize } from './sizing';

describe('PS2 scene foundation', () => {
  it('keeps linear glTF vertex colours and chunk transforms intact through mount/unmount', () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const colours = new Float32BufferAttribute(new Float32Array(geometry.attributes.position!.count * 3).fill(0.214041), 3);
    geometry.setAttribute('color', colours);
    const source = new MeshStandardMaterial({ color: '#ffffff' }), texture = new Texture();
    source.map = texture;
    const mesh = new Mesh(geometry, source), root = new Group();
    root.position.set(-1024, 0, -2304); mesh.position.set(128, 81, 128); mesh.scale.set(128, 32, 128); root.add(mesh);
    const city = createCityScene(true), release = city.mountGeometry(root);
    expect(root.parent).toBe(city.scene);
    expect(mesh.geometry.getAttribute('color')).toBe(colours);
    expect(colours.getX(0)).toBeCloseTo(0.214041, 6);
    expect(mesh.position.toArray()).toEqual([128, 81, 128]);
    expect(mesh.scale.toArray()).toEqual([128, 32, 128]);
    expect(mesh.material).toMatchObject({ flatShading: true, vertexColors: true, map: texture, fog: true });
    const owned = mesh.material, dispose = vi.spyOn(owned, 'dispose'), sourceDispose = vi.spyOn(source, 'dispose');
    release(); release();
    expect(root.parent).toBeNull(); expect(mesh.material).toBe(source);
    expect(dispose).toHaveBeenCalledOnce(); expect(sourceDispose).not.toHaveBeenCalled();
    city.dispose(); geometry.dispose(); source.dispose(); texture.dispose();
  });

  it('has a linear gradient horizon matching the fog, with a feature-off path', () => {
    const city = createCityScene(true);
    expect(city.sky!.horizon.equals(city.haze.color)).toBe(true);
    expect(city.sky!.horizon.r).toBeCloseTo(new Color(SKY_COLOURS.horizon).r, 8);
    expect(city.sky!.horizon.r).toBeLessThan(0.65); // Not the sRGB byte fraction (197 / 255).
    expect(city.sky!.zenith.equals(city.sky!.horizon)).toBe(false);
    expect(city.scene.fog).toBe(city.haze);
    const disabled = createCityScene(false);
    expect(disabled.scene.fog).toBeNull(); expect(disabled.sky).toBeUndefined();
    city.dispose(); disabled.dispose();
  });

  it('shares converted materials but preserves individual meshes and caller ownership', () => {
    const source = new MeshStandardMaterial({ color: '#c3b69c' }), geometry = new BoxGeometry();
    const first = new Mesh(geometry, source), second = new Mesh(geometry, source), root = new Group();
    root.add(first, second);
    const release = prepareWorldGeometry(root);
    expect(first.material).toBe(second.material);
    expect(first.material.color.equals(source.color)).toBe(true);
    release(); expect(first.material).toBe(source); expect(second.material).toBe(source);
    geometry.dispose(); source.dispose();
  });

  it('leaves white-ad headroom and black-text contrast even at maximum glow', () => {
    for (let i = 0; i <= 100; i++) {
      const base = i / 100, bright = bloomChannel(base, 1);
      expect(bright).toBeGreaterThanOrEqual(base);
      expect(bright).toBeLessThanOrEqual(1);
      if (base < 1) expect(bright).toBeLessThan(1);
    }
    expect(bloomChannel(0, 1)).toBe(0);
    expect(bloomChannel(0.8, 1)).toBeCloseTo(0.812, 6);
    expect(BLOOM.strength).toBeLessThan(0.07);
    expect(HAZE.far).toBeGreaterThan(HAZE.near);
  });

  it('caps high-DPR drawing buffers before allocating scene and bloom targets', () => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      const size = drawingSize(tier, 390, 844, 3)!;
      expect(size.width * size.height).toBeLessThanOrEqual(tier === 'low' ? 800_000 : tier === 'medium' ? 1_500_000 : 2_100_000);
    }
  });
});
