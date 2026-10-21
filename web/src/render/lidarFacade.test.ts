import { describe, expect, it, vi } from 'vitest';

// gtasf-6w9a: the LiDAR replacement walls get the atlas facade but must NOT discard themselves under
// their own footprint. Force lidarRoofs on so addBuildingFacades injects the LiDAR-hide path.
vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: Object.freeze({ ...actual.flags, lidarRoofs: true, graphicsV2: true, proceduralFacades: false }) };
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

function compiled(opts?: { noLidarHide?: boolean }) {
  const ground = createFacadeGround(undefined);
  const material = new MeshLambertMaterial({ name: 'GTASF buildings' });
  addBuildingFacades(material, fakeAtlas(), ground, false, undefined, undefined, opts);
  const shader = fakeShader();
  material.onBeforeCompile!(shader as never, undefined as never);
  const key = material.customProgramCacheKey();
  ground.dispose();
  return { frag: shader.fragmentShader, key };
}

describe('LiDAR buildings get the atlas facade, not a placeholder (gtasf-6w9a)', () => {
  it('a normal building (lidarRoofs on) still discards under a LiDAR footprint', () => {
    const { frag, key } = compiled();
    expect(frag).toContain('lidarHidden(vFacadePosition.xz)');
    expect(frag).toContain('discard');
    expect(key).toContain('-lh');
  });

  it('a LiDAR replacement wall (noLidarHide) keeps the facade but never discards itself', () => {
    const { frag, key } = compiled({ noLidarHide: true });
    expect(frag).not.toContain('lidarHidden(');
    expect(frag).not.toContain('discard; // replaced by the LiDAR');
    expect(frag).toContain('textureGrad(uFacadeAtlas'); // it still gets the real atlas facade
    expect(key).toContain('-nolh');
    expect(key).not.toContain('-lh'); // distinct cache key so the two programs never collide
  });
});
