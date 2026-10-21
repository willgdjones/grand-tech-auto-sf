import { describe, expect, it } from 'vitest';
import { BufferGeometry, Color, Group, Mesh, MeshLambertMaterial, MeshStandardMaterial } from 'three';
import { addRealisticFacades } from './realisticFacades';
import { createRealisticFacadeAtlas, inspectRealisticManifest, REALISTIC_STYLES } from './realisticFacadeAtlas';
import { applyRealisticMaterials } from './realisticMaterials';

/** The MeshStandard shader anchors the facade injection relies on (same chunks three.js emits). */
function fakeShader() {
  return {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\nvoid main(){\n#include <worldpos_vertex>\n}',
    fragmentShader: [
      '#include <common>', 'void main(){', '#include <color_fragment>',
      '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>',
      '#include <normal_fragment_maps>', '#include <emissivemap_fragment>', '}',
    ].join('\n'),
  };
}

const VALID_MANIFEST = {
  version: 1, width: 1024, height: 1024,
  maps: {
    albedo: { path: '/art/facades-pbr/albedo.jpg', sha256: 'a'.repeat(64), colorSpace: 'srgb' },
    normal: { path: '/art/facades-pbr/normal.jpg', sha256: 'b'.repeat(64), colorSpace: 'linear' },
    arm: { path: '/art/facades-pbr/arm.jpg', sha256: 'c'.repeat(64), colorSpace: 'linear' },
  },
  cells: [{ id: 'brick', kind: 'brick', pixelRect: [16, 16, 480, 480], metres: [3, 3] }],
};

describe('realistic facade shader injection', () => {
  it('injects world-space facade GLSL, atlas samplers and uniforms', () => {
    const atlas = createRealisticFacadeAtlas(false);
    const material = new MeshStandardMaterial({ name: 'GTASF buildings' });
    addRealisticFacades(material, atlas, undefined, false);
    expect(material.customProgramCacheKey()).toContain('gtasf-real-facade');
    const shader = fakeShader();
    material.onBeforeCompile!(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('vFacadeWorld');
    // Albedo + PBR maps are sampled and results are threaded into the standard lighting chunks.
    expect(shader.fragmentShader).toContain('uRealAlbedo');
    expect(shader.fragmentShader).toContain('textureGrad(uRealNormal');
    expect(shader.fragmentShader).toContain('textureGrad(uRealArm');
    expect(shader.fragmentShader).toContain('roughnessFactor = mix(roughnessFactor, gtRough');
    expect(shader.fragmentShader).toContain('metalnessFactor = mix(metalnessFactor, gtMetal');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += gtEmission');
    // Atlas uniforms and the night clock are bound so the shader can sample + light windows.
    expect(shader.uniforms.uRealReady).toBeDefined();
    expect(shader.uniforms.uRealRects).toBeDefined();
    expect(shader.uniforms.uFacadeNight).toBeDefined();
    // Per-building painted-lady pastels for Victorian clapboard (gtasf-painted-lady-colour-variety-mv1y).
    expect(shader.uniforms.uPaintedLadies).toBeDefined();
    expect((shader.uniforms.uPaintedLadies!.value as unknown[]).length).toBe(7);
    expect(shader.fragmentShader).toContain('uPaintedLadies');
    // 8 primary + 8 alternate style slots; the shader picks a per-building variant (gtasf-realistic-facade-style-variety).
    expect((shader.uniforms.uRealRects!.value as unknown[]).length).toBe(16);
    expect(shader.fragmentShader).toContain('style + (variant > 0.5 ? 8 : 0)');
    atlas.dispose();
  });

  it('low preset binds the albedo-only path (no normal/ARM upload needed)', () => {
    const atlas = createRealisticFacadeAtlas(true);
    expect((atlas.uniforms.uRealHasPbr!.value as number)).toBe(0);
    const material = new MeshStandardMaterial({ name: 'GTASF buildings' });
    addRealisticFacades(material, atlas, undefined, true);
    expect(material.customProgramCacheKey()).toContain('low');
    atlas.dispose();
  });

  it('counts materials on the atlas and releases on dispose', () => {
    const atlas = createRealisticFacadeAtlas(false);
    const material = new MeshStandardMaterial({ name: 'GTASF buildings' });
    addRealisticFacades(material, atlas, undefined, false);
    expect(atlas.stats.materials).toBe(1);
    material.dispose();
    expect(atlas.stats.materials).toBe(0);
    atlas.dispose();
  });
});

describe('realistic facade manifest validation', () => {
  it('accepts a well-formed manifest', () => {
    expect(() => inspectRealisticManifest(VALID_MANIFEST)).not.toThrow();
  });
  it('resolves all fixed style slots (every style has a cell via fallback)', () => {
    // A single brick cell must still fill all 8 slots through the fallback chain.
    expect(REALISTIC_STYLES.length).toBe(8);
  });
  it('rejects a bad version, missing map, or out-of-bounds cell', () => {
    expect(() => inspectRealisticManifest({ ...VALID_MANIFEST, version: 2 })).toThrow();
    expect(() => inspectRealisticManifest({ ...VALID_MANIFEST, maps: { ...VALID_MANIFEST.maps, normal: undefined } })).toThrow();
    expect(() => inspectRealisticManifest({ ...VALID_MANIFEST, maps: { ...VALID_MANIFEST.maps, albedo: { path: '/etc/passwd', sha256: 'a'.repeat(64) } } })).toThrow();
    expect(() => inspectRealisticManifest({ ...VALID_MANIFEST, cells: [{ id: 'x', pixelRect: [0, 0, 2048, 10], metres: [3, 3] }] })).toThrow();
    expect(() => inspectRealisticManifest({ ...VALID_MANIFEST, cells: [] })).toThrow();
  });
});

describe('applyRealisticMaterials wires facades onto building walls', () => {
  function scene() {
    const group = new Group();
    const buildings = new Mesh(new BufferGeometry(), new MeshLambertMaterial({ color: new Color('#886644'), name: 'buildings' }));
    const roads = new Mesh(new BufferGeometry(), new MeshLambertMaterial({ color: new Color('#334455'), name: 'roads' }));
    // prepareWorldGeometry names the mounted Lambert material `GTASF <source>`; mimic that here.
    (buildings.material as MeshLambertMaterial).name = 'GTASF buildings';
    (roads.material as MeshLambertMaterial).name = 'GTASF roads';
    group.add(buildings, roads);
    return { group, buildings, roads };
  }

  it('injects the facade shader on GTASF buildings only, not roads', () => {
    const atlas = createRealisticFacadeAtlas(false);
    const { group, buildings, roads } = scene();
    const restore = applyRealisticMaterials(group, 'hd', atlas, undefined);
    const wall = buildings.material as unknown as MeshStandardMaterial;
    const road = roads.material as unknown as MeshStandardMaterial;
    expect(wall).toBeInstanceOf(MeshStandardMaterial);
    expect(wall.customProgramCacheKey()).toContain('gtasf-real-facade');
    // Roads keep the stock MeshStandard cache key (three.js default returns '').
    expect(road.customProgramCacheKey()).not.toContain('gtasf');
    expect(atlas.stats.materials).toBe(1);
    restore();
    atlas.dispose();
  });

  it('with no atlas, buildings convert to plain PBR without a facade shader', () => {
    const { group, buildings } = scene();
    applyRealisticMaterials(group, 'hd');
    const wall = buildings.material as unknown as MeshStandardMaterial;
    expect(wall).toBeInstanceOf(MeshStandardMaterial);
    // No facade shader injected → the stock MeshStandard cache key (not the gtasf facade key).
    expect(wall.customProgramCacheKey()).not.toContain('gtasf-real-facade');
  });
});
