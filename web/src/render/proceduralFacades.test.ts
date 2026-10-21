import { describe, expect, it, vi } from 'vitest';

// gtasf-l857: exercise the procedural facade path (flag OFF by default), so force it on for this file.
vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: Object.freeze({ ...actual.flags, proceduralFacades: true }) };
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

describe('procedural facade shader (gtasf-l857)', () => {
  it('builds a per-building procedural wall with no atlas sampling', () => {
    const ground = createFacadeGround(undefined);
    const material = new MeshLambertMaterial({ name: 'GTASF buildings' });
    // Real call shape from foundation.ts: no atlas, a ground DataTexture, and a night uniform.
    addBuildingFacades(material, undefined, ground, false, undefined, { value: 0 });

    expect(material.customProgramCacheKey()).toContain('gtasf-building-facade-proc');

    const shader = fakeShader();
    material.onBeforeCompile!(shader as never, undefined as never);

    // The procedural branch generates the wall from per-building attributes via districtFacade()...
    expect(shader.fragmentShader).toContain('districtFacade(');
    expect(shader.fragmentShader).toContain('procedural facades');
    // ...covering brick, glass curtain wall and the storefront band...
    expect(shader.fragmentShader).toContain('brick');
    expect(shader.fragmentShader).toContain('mullion');
    expect(shader.fragmentShader).toContain('Storefront band');
    // ...and it must NOT sample the facade atlas image (the whole point of the flag).
    expect(shader.fragmentShader).not.toContain('uFacadeAtlas');
    expect(shader.fragmentShader).not.toContain('textureGrad(uFacadeAtlas');

    // Ground (street height / storefront / contact) and the night-window uniform are wired.
    expect(shader.uniforms.uFacadeGround).toBeDefined();
    expect(shader.uniforms.uFacadeGroundReady).toBeDefined();
    expect(shader.uniforms.uFacadeNight).toBeDefined();
    // The vertex shader samples the per-chunk ground field for street height.
    expect(shader.vertexShader).toContain('vFacadePosition');
    expect(shader.vertexShader).toContain('facadeGroundAt');

    ground.dispose();
  });

  it('wires the passed night uniform so windows can glow', () => {
    const ground = createFacadeGround(undefined);
    const night = { value: 0.7 };
    const material = new MeshLambertMaterial({ name: 'GTASF buildings' });
    addBuildingFacades(material, undefined, ground, false, undefined, night);
    const shader = fakeShader();
    material.onBeforeCompile!(shader as never, undefined as never);
    // The same object is bound (driven by foundation.ts:394), not a fresh { value: 0 }.
    expect(shader.uniforms.uFacadeNight).toBe(night);
    expect(shader.fragmentShader).toContain('facadeEmission');
    ground.dispose();
  });
});
