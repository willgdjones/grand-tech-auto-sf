import { expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial, MeshStandardMaterial,
  ShaderLib, Texture, type IUniform, type WebGLRenderer } from 'three';
import { prepareWorldGeometry } from './foundation';
import { applyRealisticMaterials } from './realisticMaterials';
import { createRoadTextures } from './roadTextures';

it('keeps prepared road tiles and live night fill in Standard shaders, including coarse tiles and feature-off paths', async () => {
  const tiles = createRoadTextures(true)!;
  await tiles.ready; // Node has no window, so the real loader deliberately makes no requests.
  const asphalt = new Texture(), lowAsphalt = new Texture();
  tiles.uniforms.uRoadAsphalt!.value = asphalt; tiles.lowUniforms.uRoadAsphalt!.value = lowAsphalt;
  const shader = () => ({ uniforms: {} as Record<string, IUniform>,
    vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader });
  for (const coarse of [false, true]) for (const textured of [false, true]) for (const lit of [false, true]) {
    const root = new Group(); root.userData.gtasfLowDetail = coarse;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0,0,0, 1,0,0, 0,0,1], 3));
    geometry.setAttribute('color', new Float32BufferAttribute([.12,.14,.15, .3,.1,.06, .5,.52,.5], 3));
    const source = new MeshLambertMaterial({ name: 'roads', vertexColors: true });
    const first = new Mesh(geometry, source), second = new Mesh(geometry, source); root.add(first, second);
    const night = { value: 0 }, release = prepareWorldGeometry(root, undefined, textured ? tiles : undefined, lit ? night : undefined);
    const prepared = first.material, originalHook = prepared.onBeforeCompile;
    const restore = applyRealisticMaterials(root, 'hd'), material = first.material as unknown as MeshStandardMaterial;
    expect(material).toBeInstanceOf(MeshStandardMaterial); expect(second.material).toBe(material);
    expect(material.vertexColors).toBe(true); expect(material.metalness).toBe(0);
    const program = shader(); material.onBeforeCompile(program as never, undefined as unknown as WebGLRenderer);
    expect(program.vertexShader.includes('vRoadMetres=(modelMatrix*vec4(transformed,1.0)).xz')).toBe(textured);
    for (const tile of ['uRoadAsphalt', 'uRoadCobbles', 'uRoadSlabs']) {
      expect(program.fragmentShader.includes(`texture2D(${tile},`)).toBe(textured);
    }
    if (textured) {
      expect(program.uniforms.uRoadAsphalt!.value).toBe(coarse ? lowAsphalt : asphalt);
      // The async loader's ready bit and clock value remain shared, not snapshotted at conversion.
      expect(program.uniforms.uRoadReady).toBe(tiles.uniforms.uRoadReady);
      tiles.uniforms.uRoadReady!.value = 1;
      expect(program.uniforms.uRoadReady!.value).toBe(1);
    } else expect(program.uniforms.uRoadReady).toBeUndefined();
    expect(program.fragmentShader.includes('totalEmissiveRadiance +=')).toBe(lit);
    if (lit) {
      expect(program.uniforms.uRoadNight).toBe(night); night.value = .75;
      expect(program.uniforms.uRoadNight!.value).toBe(.75);
    } else expect(program.uniforms.uRoadNight).toBeUndefined();
    expect(program.fragmentShader).toContain('#include <lights_physical_pars_fragment>');
    expect(material.customProgramCacheKey()).toBe(`${prepared.customProgramCacheKey()}:pbr-roads-v1`);
    restore(); restore(); expect(first.material).toBe(prepared); expect(prepared.onBeforeCompile).toBe(originalHook);
    release(); expect(first.material).toBe(source); expect(tiles.stats.materials).toBe(0);
    geometry.dispose(); source.dispose();
  }
  tiles.dispose(); asphalt.dispose(); lowAsphalt.dispose();
});
