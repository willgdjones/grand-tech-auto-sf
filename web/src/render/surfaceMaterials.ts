import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, Texture, Vector2, type Material } from 'three';
import { flags } from '@gtasf/shared/flags';
import { graphicsPreset } from './graphicsPreset';
import manifest from '../../public/art/surfaces/manifest.json';

export type SurfaceKind = 'asphalt' | 'sidewalk' | 'pavers' | 'roof' | 'stucco' | 'brick' | 'siding' | 'concrete';
export const SURFACE_METRES = Object.fromEntries(manifest.materials.map(m => [m.id, m.metres])) as Record<SurfaceKind, number[]>;
type Maps = { albedo: Texture; normal: Texture | null; roughness: Texture | null };
type Entry = { refs: number; abort: AbortController; maps?: Maps; retryAt?: number; bitmaps: ImageBitmap[]; ready: Promise<Maps | undefined> };
const cache = new Map<string, Entry>();

/** Neutral linear-data maps keep custom PBR samplers valid if a detail download fails. */
function neutralDetail(normal: boolean): Texture {
  const texture = new DataTexture(new Uint8Array(normal ? [128, 128, 255, 255] : [255, 255, 255, 255]), 1, 1);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Shared lazy tiles: Low loads albedo only (nullable detail maps); HD loads PBR.
 * Pass the renderer's effective Low tier when it overrides the saved preset.
 * Callers own a lease, not the textures. Flag-off performs no I/O. */
export function acquireSurface(kind: SurfaceKind, low = graphicsPreset() === 'low') {
  if (!flags.graphicsV2 || typeof window === 'undefined') return undefined;
  const key = `${kind}:${low ? 'albedo' : 'pbr'}`;
  let entry = cache.get(key);
  // Old failed leases keep their fallback; a new chunk can recover independently.
  // release() checks identity so an old lease cannot evict its replacement.
  if (entry?.retryAt !== undefined && Date.now() >= entry.retryAt) entry = undefined;
  if (!entry) {
    const source = manifest.materials.find(m => m.id === kind)!;
    const current: Entry = { refs: 0, abort: new AbortController(), bitmaps: [], ready: Promise.resolve(undefined) };
    current.ready = (async () => {
      const maps: Partial<Maps> = {};
      const deadline = setTimeout(() => current.abort.abort(), 15_000);
      try {
        for (const channel of (low ? ['albedo'] as const : ['albedo', 'normal', 'roughness'] as const)) {
          const response = await fetch(source.maps[channel].url, { signal: current.abort.signal });
          if (!response.ok) throw new Error('Surface unavailable');
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength > 500_000) throw new Error('Surface budget');
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }), { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
          if (current.abort.signal.aborted || bitmap.width !== 512 || bitmap.height !== 512) { bitmap.close(); throw new Error('Surface disposed or invalid'); }
          current.bitmaps.push(bitmap);
          const texture = new Texture(bitmap); texture.flipY = false;
          if (channel === 'albedo') texture.colorSpace = SRGBColorSpace;
          texture.wrapS = texture.wrapT = RepeatWrapping;
          texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
          texture.anisotropy = 4; texture.needsUpdate = true;
          maps[channel] = texture;
        }
        if (!maps.albedo) throw new Error('Surface missing albedo');
        const complete: Maps = { albedo: maps.albedo, normal: maps.normal ?? null, roughness: maps.roughness ?? null };
        current.maps = complete; return complete;
      } catch {
        current.retryAt = Date.now() + 30_000;
        // Colour is useful on its own. Keep it when only an HD detail channel
        // failed, including a deadline, but never resurrect a released lease.
        if (maps.albedo && current.refs > 0) {
          const complete: Maps = { albedo: maps.albedo,
            normal: maps.normal ?? (low ? null : neutralDetail(true)),
            roughness: maps.roughness ?? (low ? null : neutralDetail(false)) };
          current.maps = complete;
          return complete;
        }
        Object.values(maps).forEach(t => t?.dispose());
        current.bitmaps.forEach(b => b.close()); current.bitmaps.length = 0;
        return undefined;
      } finally { clearTimeout(deadline); }
    })();
    cache.set(key, current); entry = current;
  }
  entry.refs++;
  const owned = entry; let released = false;
  return { ready: owned.ready, metres: SURFACE_METRES[kind], release() {
    if (released) return; released = true;
    if (--owned.refs > 0) return;
    owned.abort.abort(); if (cache.get(key) === owned) cache.delete(key);
    if (owned.maps) Object.values(owned.maps).forEach(t => t?.dispose());
    owned.bitmaps.forEach(b => b.close()); owned.bitmaps.length = 0;
  } };
}

/** World-metre roof projection composes after facade shading and leaves vertical fronts intact. */
export function addSurfaceRoof(material: Material, low: boolean): void {
  addHorizontalSurface(material, 'roof', low);
}

/** Warm stone finish for a dedicated horizontal plaza mesh, preserving the approved paving hue. */
export function addSurfacePavers(material: Material, low: boolean): void {
  addHorizontalSurface(material, 'pavers', low);
}

/**
 * coarseWindowGrid: a cheap procedural window grid on baked building WALLS, gated to appear only past the near
 * facade-atlas range, so the mid-distance coarse towers (blank pale/tan boxes from the air) read as windowed.
 * Same grid as aerialFarFacade (per ~3.6 m floor, per ~6 m column, near-vertical faces, fwidth anti-aliased), but
 * keyed off camera distance so near buildings (covered by their atlas fronts) and the deep skyline stay untouched.
 */
export function addBuildingWindowGrid(material: Material): void {
  if (!flags.coarseWindowGrid || !flags.graphicsV2) return;
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${key}:coarse-window-grid-v1`;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = 'varying vec3 vWgWorld; varying vec3 vWgNrm;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vWgWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vWgNrm = normalize((modelMatrix * vec4(normal, 0.0)).xyz);');
    shader.fragmentShader = 'varying vec3 vWgWorld; varying vec3 vWgNrm;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        float wgDist = length(vWgWorld - cameraPosition);
        // Appear past the atlas range (~180-420 m) and fade out by ~3.4 km, where the far-LOD ring takes over (its
        // aerialFarFacade grid now applies after the fog so it carries the skyline). Keeping the streamed grid's
        // range tight avoids paying the grid cost on distant dense low-rise blocks that the haze erases anyway.
        float wgRange = smoothstep(180.0, 420.0, wgDist) * (1.0 - smoothstep(2500.0, 3400.0, wgDist));
        if (wgRange > 0.0) {
          float wgWall = 1.0 - smoothstep(0.35, 0.6, abs(vWgNrm.y));
          float wgH = abs(vWgNrm.x) > abs(vWgNrm.z) ? vWgWorld.z : vWgWorld.x;
          float wgFloor = vWgWorld.y / 3.6, wgCol = wgH / 6.0;
          float wgGrid = max(smoothstep(0.5 - 1.5 * fwidth(wgFloor), 0.5, abs(fract(wgFloor) - 0.5)),
            0.6 * smoothstep(0.5 - 1.5 * fwidth(wgCol), 0.5, abs(fract(wgCol) - 0.5))) * wgWall;
          diffuseColor.rgb *= 1.0 - 0.32 * wgGrid * wgRange;
        }
      }`);
  };
}

function addHorizontalSurface(material: Material, kind: 'roof' | 'pavers', low: boolean): void {
  const paving = kind === 'pavers';
  if (!flags.graphicsV2) return;
  const roofVar = kind === 'roof' && flags.roofToneVariety;
  // Low gets ONLY the per-building roof tone-variety shader (no roof-texture lease); HD/paving keep the textured path.
  if (low && !roofVar) return;
  const lease = low ? null : acquireSurface(kind, false);
  if (!low && !lease) return;
  const uniforms = { uRoofReady: { value: 0 }, uRoofAlbedo: { value: null as Texture | null }, uRoofNormal: { value: null as Texture | null }, uRoofRough: { value: null as Texture | null }, uRoofMetres: { value: new Vector2(...((lease?.metres ?? [1, 1]) as [number, number])) } };
  let disposed = false;
  if (lease) {
    material.addEventListener('dispose', () => { disposed = true; lease.release(); });
    void lease.ready.then(maps => {
      if (!maps || disposed) return;
      uniforms.uRoofAlbedo.value = maps.albedo; uniforms.uRoofNormal.value = maps.normal; uniforms.uRoofRough.value = maps.roughness; uniforms.uRoofReady.value = 1;
    });
  }
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${key}:metric-horizontal-v2:${kind}:rtv${flags.roofToneVariety ? 1 : 0}`;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer); Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRoofWorld; varying vec3 vRoofNormal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRoofWorld=(modelMatrix*vec4(transformed,1.0)).xyz; vRoofNormal=inverseTransformDirection(transformedNormal,viewMatrix);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vRoofWorld; varying vec3 vRoofNormal;
uniform sampler2D uRoofAlbedo; uniform sampler2D uRoofNormal; uniform sampler2D uRoofRough;
uniform vec2 uRoofMetres; uniform float uRoofReady;${roofVar ? `
float rtHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float rtNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(rtHash(i),rtHash(i+vec2(1.0,0.0)),f.x),mix(rtHash(i+vec2(0.0,1.0)),rtHash(i+1.0),f.x),f.y);}` : ''}`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
float roofWeight = uRoofReady * step(0.7,vRoofNormal.y) * (1.0-smoothstep(${paving ? '25.0,85.0' : '100.0,220.0'},distance(vRoofWorld,cameraPosition)));
vec2 roofUv = vRoofWorld.xz/uRoofMetres;
${paving ? '' : 'if(roofWeight>0.0) diffuseColor.rgb=mix(diffuseColor.rgb,texture2D(uRoofAlbedo,roofUv).rgb,roofWeight);'}${roofVar ? `
// roofToneVariety: the roof texture above fades out past ~100 m, so far/aerial roofs fell back to one flat base
// tone. Give roof up-faces a per-building tar/gravel grey variation at ALL distances (realistic, no colour), so
// the roofscape reads varied from the air.
float roofFace = step(0.7,vRoofNormal.y);
if(roofFace>0.0){
  float rb = rtNoise(vRoofWorld.xz/17.0), rf = rtNoise(vRoofWorld.xz/3.3);
  vec3 tv = diffuseColor.rgb*(0.74+0.5*rb);
  tv = mix(tv, tv*vec3(1.05,1.0,0.88), smoothstep(0.52,0.80,rb));
  tv = mix(tv, vec3(0.72,0.72,0.71), smoothstep(0.90,0.975,rb)*0.55);
  tv *= 0.94+0.12*rf;
  diffuseColor.rgb = mix(diffuseColor.rgb, tv, roofFace);
}` : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if(roofWeight>0.0) {
  roughnessFactor=mix(roughnessFactor,max(${paving ? '0.85' : '0.0'},texture2D(uRoofRough,roofUv).r),roofWeight);
  ${paving ? `float grain=clamp((dot(texture2D(uRoofAlbedo,roofUv).rgb,vec3(0.2126,0.7152,0.0722))-0.35)*0.18,-0.035,0.035);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.72,0.66,0.55)+vec3(grain),roofWeight);` : ''}
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if(roofWeight>0.0) {
  vec3 roofN=texture2D(uRoofNormal,roofUv).xyz*2.0-1.0;
  ${paving ? 'roofN.xy*=0.35;' : ''}
  vec3 worldN=normalize(vRoofNormal);
  vec3 tangent=normalize(vec3(1.0,0.0,0.0)-worldN*worldN.x);
  vec3 bitangent=-normalize(cross(worldN,tangent));
  vec3 detailN=normalize(mat3(viewMatrix)*(tangent*roofN.x+bitangent*roofN.y+worldN*roofN.z));
  normal=normalize(mix(normal,detailN,roofWeight));
}`);
  };
}
