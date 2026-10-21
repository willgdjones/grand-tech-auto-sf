import { flags } from '@gtasf/shared/flags';
import type { MeshStandardMaterial } from 'three';
import type { RealisticFacadeAtlas } from './realisticFacadeAtlas';
import type { FacadeGround } from './facadeAtlas';
import { districtFacadeGlsl } from './districtFacades';

const DISTRICT_FACADES = districtFacadeGlsl('realistic');

/**
 * Inject a PBR facade shader into a building wall's MeshStandardMaterial for the realistic path
 * (gtasf-2rup, behind realisticRender + realisticFacades). Mirrors the ps2 `facades.ts` world-space
 * projection — walls are textured in metres so adjacent chunks share a pattern and roofs are excluded
 * — but drives MeshStandard lighting: it sets the albedo from a chosen atlas cell, perturbs the normal
 * from the OpenGL normal map, and feeds roughness/metalness/AO from the ARM map, so glass curtain
 * walls reflect the IBL environment while masonry stays matte. A ground-floor storefront band and
 * procedural window frames/sills give real relief even on plain CC0 wall scans; richer Scenario
 * texture modules drop in by adding atlas cells. Distant walls dissolve to the flat land-use colour to
 * avoid shimmer. Low preset (albedo-only atlas) skips the normal/ARM sampling.
 *
 * Call AFTER the MeshStandard material exists (realisticMaterials.ts). `ground` is the sourced terrain
 * height field (createFacadeGround) so the storefront band tracks the street on SF's hills.
 */
export function addRealisticFacades(material: MeshStandardMaterial, atlas: RealisticFacadeAtlas | undefined, ground: FacadeGround | undefined, low = false): void {
  const textured = Boolean(atlas);
  material.customProgramCacheKey = () => textured ? `gtasf-real-facade-v2-district${low ? '-low' : ''}` : 'gtasf-real-facade-flat-v2-district';
  if (atlas) {
    atlas.stats.materials++;
    material.userData.gtasfRealisticFacade = atlas.stats;
    material.addEventListener('dispose', () => { atlas.stats.materials--; });
  }
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uFacadeNight: { value: 0 } });
    if (textured) Object.assign(shader.uniforms, atlas!.uniforms, ground?.uniforms ?? {});

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vFacadeWorld;
varying vec3 vFacadeWorldNormal;
${textured && ground ? `uniform sampler2D uFacadeGround;
uniform float uFacadeGroundReady;
uniform vec4 uFacadeGroundGrid;
varying float vFacadeGround;
float facadeGroundAt(vec2 position) {
  float size = uFacadeGroundGrid.w;
  vec2 grid = clamp((position-uFacadeGroundGrid.xy)/uFacadeGroundGrid.z,vec2(0.0),vec2(size-1.0));
  vec2 lo = min(floor(grid),vec2(size-2.0));
  vec2 blend = grid-lo;
  vec2 uv = (lo+0.5)/size;
  float a = texture2D(uFacadeGround,uv).r;
  float b = texture2D(uFacadeGround,uv+vec2(1.0/size,0.0)).r;
  float c = texture2D(uFacadeGround,uv+vec2(0.0,1.0/size)).r;
  float d = texture2D(uFacadeGround,uv+vec2(1.0/size)).r;
  return mix(mix(a,b,blend.x),mix(c,d,blend.x),blend.y);
}` : ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vFacadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vFacadeWorldNormal = inverseTransformDirection(transformedNormal, viewMatrix);
${textured && ground ? 'vFacadeGround = uFacadeGroundReady > 0.5 && abs(vFacadeWorldNormal.y) < 0.35 ? facadeGroundAt(vFacadeWorld.xz) : vFacadeWorld.y;' : ''}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFacadeWorld;
varying vec3 vFacadeWorldNormal;
uniform float uFacadeNight;
${ground && textured ? 'uniform float uFacadeGroundReady;' : ''}
${DISTRICT_FACADES}
${textured ? `uniform sampler2D uRealAlbedo;
uniform sampler2D uRealNormal;
uniform sampler2D uRealArm;
uniform float uRealReady;
uniform float uRealHasPbr;
uniform vec4 uRealRects[16];
uniform vec2 uRealRepeats[16];
uniform vec2 uRealAtlasSize;
uniform vec3 uPaintedLadies[7];
${ground ? 'varying float vFacadeGround;' : ''}` : ''}
float facadeBand(float value, float lo, float hi, float aa) {
  return smoothstep(lo-aa, lo+aa, value) * (1.0-smoothstep(hi-aa, hi+aa, value));
}
float facadeRect(vec2 uv, vec2 lo, vec2 hi, vec2 aa) {
  return facadeBand(uv.x, lo.x, hi.x, aa.x) * facadeBand(uv.y, lo.y, hi.y, aa.y);
}
float facadeHash(vec2 p) { return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453); }`)
      // Compute the whole facade in one block so later chunks can read the results.
      .replace('#include <color_fragment>', `#include <color_fragment>
float gtMask = 0.0;      // 1 on near-vertical walls that take facade art
float gtApply = 0.0;     // gtMask * distance detail fade
float gtRough = 0.95;    // target roughness for the wall
float gtMetal = 0.0;     // target metalness (glass/mullions reflect the IBL)
vec3 gtAlbedo = diffuseColor.rgb;
vec3 gtNormalW = normalize(vFacadeWorldNormal);
vec3 gtEmission = vec3(0.0);
{
  vec3 fN = normalize(vFacadeWorldNormal);
  if (abs(fN.y) < 0.35) {
    gtMask = 1.0;
    vec3 source = diffuseColor.rgb;
    vec2 tangent = normalize(vec2(-fN.z, fN.x));
    if (tangent.x < -0.001 || (abs(tangent.x) < 0.001 && tangent.y < 0.0)) tangent = -tangent;
    vec2 metres = vec2(dot(vFacadeWorld.xz, tangent), vFacadeWorld.y);
    vec2 win = metres / vec2(2.7, 3.2);           // procedural window bays
    vec2 aa = max(fwidth(win), vec2(0.0015));
    gtApply = (1.0 - smoothstep(0.12, 0.40, max(aa.x, aa.y)));  // near walls get full detail
    float variant = fract(sin(dot(floor(source * 255.0 + 0.5), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    // District + land-use use the same source registry as the PS2 renderer.
    bool office = source.b > source.r * 1.03;
    bool industrial = abs(source.r - source.g) < 0.012 && source.g > source.b * 1.025;
    bool retail = source.r > source.g * 1.10 && source.r < source.g * 1.17 && source.g > source.b * 1.18;
    float streetHeight = vFacadeWorld.y - ${ground && textured ? 'vFacadeGround' : '0.0'};
    bool groundReady = ${ground && textured ? 'uFacadeGroundReady > 0.5' : 'false'};
    ivec2 district = districtFacade(vFacadeWorld.xz, variant, groundReady, streetHeight, variant < 0.33 ? 3 : (variant < 0.5 ? 0 : 2));
    int style = district.x;
    if (office) style = 4;
    if (industrial) style = 5;
    bool shop = groundReady && streetHeight >= -0.2 && streetHeight < 3.8 && (retail || office || district.y == 1${flags.graphicsV2 ? ' || fract(variant * 53.0 + 0.71) < 0.3' : ''});
    if (shop) style = 6;
    bool glass = style == 4;

    // --- Base wall colour: sampled atlas cell, else a tinted land-use colour. ---
    gtAlbedo = source;
    float atlasDetail = 0.0;
    ${textured ? `if (uRealReady > 0.5) {
      // Per-building texture variety: half the buildings of each style use its alternate module
      // (slots 8-15); styles with only one module reuse their primary cell (no visible change).
      int cell = style + (variant > 0.5 ? 8 : 0);
      vec2 repeatM = uRealRepeats[cell];
      vec2 tileGrid = metres / repeatM;
      vec2 tileUv = fract(tileGrid);
      if (shop) tileUv.y = clamp(streetHeight / 3.8, 0.001, 0.999);
      vec4 rect = uRealRects[cell];
      vec2 inset = vec2(0.5) / uRealAtlasSize;
      vec2 span = rect.zw - 2.0 * inset;
      vec2 atlasUv = rect.xy + inset + tileUv * span;
      vec2 contUv = vec2(tileGrid.x, shop ? streetHeight / 3.8 : tileGrid.y);
      vec2 dx = dFdx(contUv) * span, dy = dFdy(contUv) * span;
      vec3 painted = textureGrad(uRealAlbedo, atlasUv, dx, dy).rgb;
      // Keep art to distance via mipmaps; dissolve to flat land-use only at the fog line.
      vec2 texel = fwidth(tileGrid) * rect.zw * uRealAtlasSize;
      atlasDetail = 1.0 - smoothstep(140.0, 360.0, max(texel.x, texel.y));
      // Subtle land-use tint keeps whole-building variety without animated noise.
      vec3 tint = mix(vec3(1.0), source / max(max(source.r, source.g), max(source.b, 0.001)), 0.10);
      painted *= tint * (0.95 + variant * 0.1);
      gtAlbedo = mix(source, painted, atlasDetail);
      // Victorian clapboard: repaint each building a distinct painted-lady pastel, keeping the board
      // light/dark pattern. Stable per-building hash (variant) → the real Alamo Square row spread.
      if (style == 3) {
        vec3 body = uPaintedLadies[int(mod(floor(variant * 7.0), 7.0))];
        float v = dot(gtAlbedo, vec3(0.299, 0.587, 0.114));
        gtAlbedo = mix(gtAlbedo, body * clamp(v / 0.55, 0.45, 1.35), 0.82 * atlasDetail);
      }
      if (uRealHasPbr > 0.5) {
        vec3 arm = textureGrad(uRealArm, atlasUv, dx, dy).rgb; // r=AO g=rough b=metal
        gtRough = mix(gtRough, clamp(arm.g, 0.05, 1.0), atlasDetail);
        gtMetal = mix(gtMetal, arm.b, atlasDetail);
        gtAlbedo *= mix(1.0, arm.r, 0.55 * atlasDetail);
        vec3 nTex = textureGrad(uRealNormal, atlasUv, dx, dy).xyz * 2.0 - 1.0;
        nTex.xy *= 0.85;
        vec3 T = vec3(tangent.x, 0.0, tangent.y);
        vec3 B = cross(fN, T); B *= sign(B.y + 1e-4);     // keep green channel pointing up
        gtNormalW = normalize(T * nTex.x + B * nTex.y + fN * max(nTex.z, 0.2));
      }
    }` : ''}

    // --- Procedural windows / storefront give real frames over the wall scan. ---
    float detail = gtApply;
    // The atlas wall scans already contain their own windows: a second procedural window grid on top
    // reads as two semi-transparent images (founder preview ghosting). Only plain walls, curtain glass
    // and the ground-floor storefront get procedural openings.
    if (!glass && !shop) detail *= 1.0 - atlasDetail;
    if (glass) {
      // Curtain wall: reflective glass with a thin mullion grid + per-floor spandrel band.
      vec2 cell = metres / vec2(1.7, 3.3);
      vec2 cuv = fract(cell);
      vec2 caa = max(fwidth(cell), vec2(0.0015));
      float mull = max(facadeBand(cuv.x, 0.0, 0.07, caa.x) + facadeBand(cuv.x, 0.93, 1.0, caa.x),
                       facadeBand(cuv.y, 0.0, 0.05, caa.y) + facadeBand(cuv.y, 0.90, 1.0, caa.y));
      float spandrel = facadeBand(cuv.y, 0.0, 0.14, caa.y);
      vec3 glazing = vec3(0.07, 0.11, 0.15) + smoothstep(0.2, 0.9, cuv.y) * vec3(0.05, 0.07, 0.09);
      vec3 mullion = vec3(0.16, 0.17, 0.18);
      gtAlbedo = mix(mix(glazing, gtAlbedo * 0.7, spandrel), mullion, min(mull, 1.0) * detail);
      float pane = (1.0 - min(mull, 1.0)) * (1.0 - spandrel);
      gtRough = mix(gtRough, mix(0.08, 0.5, min(mull, 1.0)), detail);
      gtMetal = mix(gtMetal, mix(0.55, 0.9, min(mull, 1.0)), detail);
      float lit = step(0.5, facadeHash(floor(cell) + variant * 5.0));
      gtEmission = vec3(0.95, 0.78, 0.5) * pane * lit * detail * uFacadeNight;
    } else {
      // Punched windows: recess, pale frame, divided glazing and a projecting sill shadow.
      vec2 uv = fract(win);
      float course = 1.0 - smoothstep(0.03, 0.06 + fwidth(metres.y), abs(fract(metres.y / 0.9) - 0.5));
      gtAlbedo *= 1.0 - course * 0.05 * detail;
      float recess = facadeRect(uv, vec2(0.20, 0.17), vec2(0.80, 0.84), aa);
      float frame = facadeRect(uv, vec2(0.22, 0.20), vec2(0.78, 0.82), aa);
      float glassR = facadeRect(uv, vec2(0.27, 0.25), vec2(0.73, 0.78), aa);
      float divider = max(facadeBand(uv.x, 0.485, 0.515, aa.x), facadeBand(uv.y, 0.52, 0.55, aa.y));
      float pane = glassR * (1.0 - divider);
      float shade = facadeHash(win);
      vec3 glazing = vec3(0.06, 0.09, 0.12) + smoothstep(0.3, 0.8, uv.y) * 0.07 + shade * 0.02;
      vec3 trim = min(gtAlbedo * 1.2 + 0.05, vec3(0.9));
      vec3 authored = mix(gtAlbedo, gtAlbedo * 0.5, recess);
      authored = mix(authored, trim, frame);
      authored = mix(authored, glazing, pane);
      float sill = facadeRect(uv, vec2(0.18, 0.195), vec2(0.82, 0.225), aa);
      authored = mix(authored, trim * 1.05, sill);
      if (shop) {
        // Ground-floor storefront: wide display window, dark reveal and a sign fascia.
        float display = facadeRect(uv, vec2(0.06, 0.08), vec2(0.94, 0.66), aa);
        float fascia = facadeBand(uv.y, 0.74, 0.96, aa.y);
        authored = mix(authored, vec3(0.05, 0.07, 0.09), display);
        authored = mix(authored, gtAlbedo * 0.8, fascia);
        pane = max(pane, display);
      }
      gtAlbedo = mix(gtAlbedo, authored, detail);
      gtRough = mix(gtRough, mix(gtRough, 0.12, pane), detail);   // glazing is smoother than the wall
      gtMetal = mix(gtMetal, mix(gtMetal, 0.25, pane), detail);
      float lit = step(0.42, facadeHash(floor(win) + variant * 7.0));
      gtEmission = vec3(0.95, 0.6, 0.3) * pane * (shop ? 0.7 : lit) * detail * uFacadeNight;
    }
    gtApply = gtMask * detail;
  }
}
diffuseColor.rgb = mix(diffuseColor.rgb, gtAlbedo, gtApply);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, gtRough, gtApply);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, gtMetal, gtApply);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(mix(normal, normalize((viewMatrix * vec4(gtNormalW, 0.0)).xyz), gtApply));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += gtEmission;`);
  };
  material.needsUpdate = true;
}
