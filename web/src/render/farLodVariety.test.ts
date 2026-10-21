import { describe, expect, it, vi } from 'vitest';

// gtasf-l857 task 2: exercise the atlas path with far-LOD skyline variety ON (OFF by default).
vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: Object.freeze({ ...actual.flags, farLodVariety: true, graphicsV2: true }) };
});

import { MeshLambertMaterial } from 'three';
import { addBuildingFacades } from './facades';
import { createFacadeGround } from './facadeAtlas';

function fakeShader() {
  return {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\nvoid main(){\n#include <worldpos_vertex>\n}',
    fragmentShader: ['#include <common>', 'void main(){', '#include <color_fragment>',
      '#include <emissivemap_fragment>', '}'].join('\n'),
  };
}
const fakeAtlas = () => ({ stats: { materials: 0, lowMaterials: 0 }, uniforms: {}, lowUniforms: {} }) as never;

describe('far-LOD skyline variety (gtasf-l857 task 2, farLodVariety)', () => {
  it('varies the distant tower tone per building, only on the far (tileAverage) tone', () => {
    const ground = createFacadeGround(undefined);
    const material = new MeshLambertMaterial({ name: 'GTASF buildings' });
    addBuildingFacades(material, fakeAtlas(), ground, false, undefined, { value: 0 });

    expect(material.customProgramCacheKey()).toContain('-farlod');

    const shader = fakeShader();
    material.onBeforeCompile!(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain('Far-LOD skyline variety');
    expect(shader.fragmentShader).toContain('skylineTints');
    expect(shader.fragmentShader).toContain('tileAverage *='); // it modulates the FAR tone, not near painted
    // Still the reviewed atlas underneath; the near wall (painted) is untouched by this block.
    expect(shader.fragmentShader).toContain('textureGrad(uFacadeAtlas');
    ground.dispose();
  });
});
