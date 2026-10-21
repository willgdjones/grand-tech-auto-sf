import { describe, expect, it, vi } from 'vitest';

// gtasf-l857 v2: exercise the atlas (textured) path with the relief flag ON (OFF by default).
vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: Object.freeze({ ...actual.flags, facadeReliefV2: true, graphicsV2: true, proceduralFacades: false }) };
});

import { MeshLambertMaterial } from 'three';
import { addBuildingFacades } from './facades';
import { createFacadeGround } from './facadeAtlas';

/** The ps2 Lambert shader anchors the facade injection replaces (same chunks three.js emits). */
function fakeShader() {
  return {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\nvoid main(){\n#include <worldpos_vertex>\n}',
    fragmentShader: ['#include <common>', 'void main(){', '#include <color_fragment>',
      '#include <emissivemap_fragment>', '}'].join('\n'),
  };
}
// Minimal textured call: addBuildingFacades only needs atlas && ground truthy to take the atlas path;
// the uniforms objects are spread into the shader, so empty maps are enough for a structure smoke.
const fakeAtlas = () => ({ stats: { materials: 0, lowMaterials: 0 }, uniforms: {}, lowUniforms: {} }) as never;

describe('facade relief v2 (gtasf-l857, facadeReliefV2)', () => {
  it('layers depth + per-building variety on TOP of the reviewed atlas (never replaces it)', () => {
    const ground = createFacadeGround(undefined);
    const material = new MeshLambertMaterial({ name: 'GTASF buildings' });
    addBuildingFacades(material, fakeAtlas(), ground, false, undefined, { value: 0 });

    expect(material.customProgramCacheKey()).toContain('-relief2');

    const shader = fakeShader();
    material.onBeforeCompile!(shader as never, undefined as never);

    // Still samples the reviewed facade atlas — this is a LAYER, not the proceduralFacades REPLACE path.
    expect(shader.fragmentShader).toContain('textureGrad(uFacadeAtlas');
    // The relief block: per-floor lintel/sill depth, recessed glazing off the atlas window mask, per-building hue.
    expect(shader.fragmentShader).toContain('facadeReliefV2');
    expect(shader.fragmentShader).toContain('float lintel');
    expect(shader.fragmentShader).toContain('float sill');
    expect(shader.fragmentShader).toContain('windowInk'); // recessed glazing reuses the atlas window ink
    ground.dispose();
  });

  it('builds the atlas path without errors when the flag is on (Low preset too)', () => {
    const ground = createFacadeGround(undefined);
    const material = new MeshLambertMaterial({ name: 'GTASF buildings Low' });
    expect(() => {
      addBuildingFacades(material, fakeAtlas(), ground, true, undefined, { value: 0.6 });
      material.onBeforeCompile!(fakeShader() as never, undefined as never);
    }).not.toThrow();
    expect(material.customProgramCacheKey()).toContain('-relief2');
    ground.dispose();
  });
});
