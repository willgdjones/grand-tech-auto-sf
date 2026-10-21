import { Color, type MeshLambertMaterial } from 'three';
import type { FacadeAtlas, FacadeGround } from './facadeAtlas';
import { districtFacadeGlsl } from './districtFacades';
import { PAINTED_LADY_SCHEME_COUNT, paintedLadyScheme } from './landmarks/paintedLadyPalette';
import { flags } from '@gtasf/shared/flags';
import { sfLookEnabled } from './sky/grade';
import { LIDAR_HIDE, LIDAR_HIDE_GLSL, lidarRoofsEnabled } from './lidarRoofs';
const lidarOn = lidarRoofsEnabled();

const V2 = flags.graphicsV2;
// gtasf-l857 v2: layer depth + per-building variety on TOP of the reviewed atlas (never replace it).
const RELIEF = flags.facadeReliefV2;
// gtasf-l857 task 2: per-building colour variety on the FAR tower tone, so the skyline isn't uniform grey.
const FARLOD = flags.farLodVariety;
// glassTowerReflect (lane A #1): a reflective sky sheen on tall mid-distance tower walls so FiDi/SoMa curtain
// walls read as glass, not flat matte boxes. Injected at the END of the facade wall block (final diffuseColor).
const GLASS = flags.glassTowerReflect;

const DISTRICT_FACADES = districtFacadeGlsl('ps2');
// Three converts the authored sRGB hex colours to linear shader values once.
const BODY_PAINT = Array.from({ length: PAINTED_LADY_SCHEME_COUNT }, (_, i) => new Color(paintedLadyScheme(i).body));

/** Original low-poly facade art, in world metres so adjacent chunks share a pattern.
 * Source buildings are merged/quantized GLBs. Their nonuniform node scale must be
 * resolved before projecting walls; roofs retain their existing source colours.
 */
export function addBuildingFacades(material: MeshLambertMaterial, atlas?: FacadeAtlas, ground?: FacadeGround, low = false,
  aerial?: Record<string, { value: unknown }>, night?: { value: number }, opts: { noLidarHide?: boolean } = {}): void {
  // gtasf-6w9a: the LiDAR replacement walls ARE the LiDAR buildings, so they must not discard themselves
  // where the LiDAR footprints are hidden; everything else hides the baked building under a LiDAR footprint.
  const lidarHide = lidarOn && !opts.noLidarHide;
  const textured = Boolean(atlas && ground);
  // gtasf-l857: procedural whole-wall facades (no atlas image) built from per-building attributes. Keeps the
  // per-chunk ground DataTexture (street height / storefront) and a directly-wired night-window emission.
  const procedural = !textured && flags.proceduralFacades;
  const withGround = textured || (procedural && Boolean(ground));
  const gReady = withGround ? 'uFacadeGroundReady > 0.5' : 'false';
  const gHeight = withGround ? '(vFacadePosition.y - vFacadeGround)' : '0.0';
  material.customProgramCacheKey = () => (textured ? 'gtasf-building-facade-atlas-night-v6-paint'
    : procedural ? 'gtasf-building-facade-proc-v1' : 'gtasf-building-facade-v1') + (V2 ? '-gfx2' : '') + (textured && RELIEF ? '-relief2' : '') + (textured && V2 && FARLOD ? '-farlod' : '') + (GLASS ? '-glass' : '') + (lidarOn ? (lidarHide ? '-lh' : '-nolh') : '');
  if (atlas) {
    atlas.stats.materials++;
    if (low) atlas.stats.lowMaterials++;
    material.userData.gtasfFacadeAtlas = atlas.stats;
    material.userData.gtasfFacadeLow = low;
    material.addEventListener('dispose', () => { atlas.stats.materials--; if (low) atlas.stats.lowMaterials--; });
  }
  material.onBeforeCompile = shader => {
    if (textured) Object.assign(shader.uniforms, low ? atlas!.lowUniforms : atlas!.uniforms, ground!.uniforms,
      { uFacadeBodyPaint: { value: BODY_PAINT } });
    else {
      shader.uniforms.uFacadeNight = procedural && night ? night : { value: 0 };
      if (procedural && ground) Object.assign(shader.uniforms, ground.uniforms);
    }
    if (V2) Object.assign(shader.uniforms, aerial ?? { uAerial: { value: null }, uAerialReady: { value: 0 }, uAerialBounds: { value: [0, 0, 1, 1] } });
    if (lidarHide) Object.assign(shader.uniforms, LIDAR_HIDE); // gtasf-6w9a prototype blocks
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vFacadePosition;
varying vec3 vFacadeNormal;
${withGround ? `uniform sampler2D uFacadeGround;
uniform float uFacadeGroundReady;
uniform vec4 uFacadeGroundGrid;
varying float vFacadeGround;
float facadeGroundAt(vec2 position) {
  float size = uFacadeGroundGrid.w;
  vec2 grid = clamp((position-uFacadeGroundGrid.xy)/uFacadeGroundGrid.z,vec2(0.0),vec2(size-1.0));
  vec2 low = min(floor(grid),vec2(size-2.0));
  vec2 blend = grid-low;
  vec2 uv = (low+0.5)/size;
  float a = texture2D(uFacadeGround,uv).r;
  float b = texture2D(uFacadeGround,uv+vec2(1.0/size,0.0)).r;
  float c = texture2D(uFacadeGround,uv+vec2(0.0,1.0/size)).r;
  float d = texture2D(uFacadeGround,uv+vec2(1.0/size)).r;
  return mix(mix(a,b,blend.x),mix(c,d,blend.x),blend.y);
}` : ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vFacadePosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vFacadeNormal = inverseTransformDirection(transformedNormal, viewMatrix);
${withGround ? 'vFacadeGround = uFacadeGroundReady > 0.5 && abs(vFacadeNormal.y) < 0.35 ? facadeGroundAt(vFacadePosition.xz) : 0.0;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFacadePosition;
varying vec3 vFacadeNormal;
uniform float uFacadeNight;${lidarHide ? LIDAR_HIDE_GLSL : ''}
${V2 ? `uniform sampler2D uAerial; uniform float uAerialReady; uniform vec4 uAerialBounds;
// NAIP aerial covering this chunk: north-up, top row = min z (texture flipY puts the top row at v = 1).
vec3 aerialAt(vec2 xz) {
  vec2 t = clamp((xz - uAerialBounds.xy) / (uAerialBounds.zw - uAerialBounds.xy), 0.0, 1.0);
  return texture2D(uAerial, vec2(t.x, 1.0 - t.y)).rgb;
}` : ''}
${textured || procedural ? DISTRICT_FACADES : ''}
${textured ? `uniform sampler2D uFacadeAtlas;
uniform float uFacadeAtlasReady;
uniform vec4 uFacadeRects[8];
uniform vec2 uFacadeRepeats[8];
uniform vec2 uFacadeAtlasSize;
uniform vec3 uFacadeBodyPaint[${PAINTED_LADY_SCHEME_COUNT}];` : ''}
${withGround ? `uniform float uFacadeGroundReady;
varying float vFacadeGround;` : ''}
float facadeBand(float value, float lo, float hi, float aa) {
  return smoothstep(lo-aa, lo+aa, value) * (1.0-smoothstep(hi-aa, hi+aa, value));
}
float facadeRect(vec2 uv, vec2 lo, vec2 hi, vec2 aa) {
  return facadeBand(uv.x, lo.x, hi.x, aa.x) * facadeBand(uv.y, lo.y, hi.y, aa.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${lidarHide ? 'if (lidarHidden(vFacadePosition.xz)) discard; // replaced by the LiDAR prototype mesh' : ''}
vec3 facadeEmission = vec3(0.0);
// Only near-vertical walls receive facade art. This also excludes all roof faces.
vec3 facadeNormal = normalize(vFacadeNormal);
if (abs(facadeNormal.y) < 0.35) {
  vec3 sourceWall = diffuseColor.rgb;
  vec2 tangent = normalize(vec2(-facadeNormal.z, facadeNormal.x));
  // Canonicalise the tangent so opposite faces use the same handedness.
  if (tangent.x < -0.001 || (abs(tangent.x) < 0.001 && tangent.y < 0.0)) tangent = -tangent;
  vec2 metres = vec2(dot(vFacadePosition.xz, tangent), vFacadePosition.y);
  vec2 grid = metres / vec2(2.7, 3.2);
  vec2 uv = fract(grid);
  vec2 aa = max(fwidth(grid), vec2(0.002));
  float detail = 1.0-smoothstep(0.10, 0.34, max(aa.x, aa.y));
  vec3 wall = diffuseColor.rgb;
  // Subtle horizontal masonry courses and a shaded floor/cornice band.
  float course = 1.0-smoothstep(0.025, 0.055 + fwidth(metres.y), abs(fract(metres.y / 0.28)-0.5));
  wall *= 1.0-course*0.055*detail;
  wall *= 1.0-facadeBand(uv.y, 0.025, 0.065, aa.y)*0.20*detail;
  float cornice = facadeBand(uv.y, 0.070, 0.10, aa.y);
  wall = mix(wall, min(wall*1.22, vec3(0.86)), cornice*detail);
  // Recess, pale stone frame, divided blue glass and a projecting sill shadow.
  float recess = facadeRect(uv, vec2(0.18,0.19), vec2(0.82,0.85), aa);
  float frame = facadeRect(uv, vec2(0.20,0.22), vec2(0.80,0.84), aa);
  float glass = facadeRect(uv, vec2(0.245,0.27), vec2(0.755,0.79), aa);
  float divider = max(facadeBand(uv.x,0.485,0.515,aa.x), facadeBand(uv.y,0.53,0.55,aa.y));
  float pane = glass * (1.0-divider);
  float reflection = smoothstep(0.32,0.78,uv.y)*0.065;
  // Stable pane variation makes rows readable without animated noise or textures.
  float shade = fract(sin(dot(floor(grid),vec2(12.9898,78.233)))*43758.5453);
  vec3 glazing = vec3(0.055,0.085,0.115) + reflection + shade*0.025;
  vec3 trim = min(diffuseColor.rgb*1.17 + vec3(0.045),vec3(0.86));
  vec3 authored = mix(wall, wall*0.48, recess);
  authored = mix(authored, trim, frame);
  authored = mix(authored, glazing, pane);
  float sill = facadeRect(uv,vec2(0.16,0.205),vec2(0.84,0.235),aa);
  authored = mix(authored,trim*1.05,sill);
  ${V2 ? `// Graphics v2: past the point where windows can be drawn, keep their average coverage (a darker,
  // slightly blue-grey wall) instead of fading to a flat plain wall, so distant towers still read windowed.
  vec3 farWall = diffuseColor.rgb * 0.74 + vec3(0.02, 0.035, 0.05);
  diffuseColor.rgb = mix(farWall, authored, detail);` : 'diffuseColor.rgb = mix(diffuseColor.rgb,authored,detail);'}
  facadeEmission = vec3(0.8,0.43,0.16)*pane*step(0.42,shade)*detail*uFacadeNight;
  ${procedural ? `// gtasf-l857 procedural facades: per-building style + colour on top of the authored window base; no atlas image.
  bool office = sourceWall.b > sourceWall.r * 1.03;
  bool industrial = abs(sourceWall.r - sourceWall.g) < 0.012 && sourceWall.g > sourceWall.b * 1.025;
  bool retail = sourceWall.r > sourceWall.g * 1.10 && sourceWall.r < sourceWall.g * 1.17 && sourceWall.g > sourceWall.b * 1.18;
  float variant = fract(sin(dot(floor(sourceWall*255.0+0.5),vec3(12.9898,78.233,37.719)))*43758.5453);
  bool groundReady = ${gReady};
  float streetHeight = ${gHeight};
  ivec2 district = districtFacade(vFacadePosition.xz, variant, groundReady, streetHeight, variant < 0.55 ? 0 : 1);
  int style = district.x;
  if (office) style = 2;
  if (industrial) style = 4;
  bool shop = groundReady && streetHeight >= -0.1 && streetHeight < 3.6 && (office || retail || district.y == 1 || fract(variant*53.0+0.71) < 0.3);
  // SF stucco pastels on masonry/stucco; glass/office towers take a cool per-building glass tint.
  if (style == 2) {
    vec3 glassTint[4] = vec3[4](vec3(0.82,0.92,1.08), vec3(0.84,1.02,0.96), vec3(1.06,0.95,0.82), vec3(0.86,0.88,0.92));
    diffuseColor.rgb *= glassTint[int(floor(fract(variant*11.0+0.2)*4.0))];
  } else {
    vec3 pastel[6] = vec3[6](vec3(0.98,0.90,0.78), vec3(0.93,0.84,0.80), vec3(0.84,0.90,0.84), vec3(0.84,0.88,0.96), vec3(0.97,0.94,0.86), vec3(0.90,0.86,0.92));
    diffuseColor.rgb *= mix(vec3(1.0), pastel[int(floor(fract(variant*29.0+0.37)*6.0))], 0.55);
  }
  // Surface material on the wall area (windows kept clean): brick running bond on masonry/industrial,
  // a fine stucco grain elsewhere. Glass towers (style 2) get their curtain wall in a later pass.
  float wallMask = (1.0 - recess) * detail;
  if (style == 3 || style == 4) {
    float course = 0.095, blen = 0.22;                 // brick course + length in metres (incl. mortar)
    float row = floor(metres.y / course);
    float bx = metres.x / blen + 0.5 * mod(row, 2.0);  // half-brick offset on alternate courses
    float mortar = max(facadeBand(fract(metres.y / course), 0.0, 0.16, fwidth(metres.y / course) + 0.02),
                       facadeBand(fract(bx), 0.0, 0.10, fwidth(bx) + 0.02));
    vec3 brick = mix(diffuseColor.rgb * vec3(1.05, 0.95, 0.88), mix(diffuseColor.rgb, vec3(0.80, 0.78, 0.74), 0.6), mortar);
    diffuseColor.rgb = mix(diffuseColor.rgb, brick, wallMask);
  } else if (style != 2) {
    float grain = fract(sin(dot(floor(metres * 20.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    diffuseColor.rgb *= 1.0 + grain * 0.06 * wallMask;
  }
  // Glass curtain wall on office/glass towers: floor-slab spandrels, a mullion grid and a sky-reflection gradient.
  if (style == 2) {
    float floorH = 3.4, mull = 1.4;
    float slab = facadeBand(fract(metres.y / floorH), 0.0, 0.14, fwidth(metres.y / floorH) + 0.01);
    float mullion = max(facadeBand(fract(metres.x / mull), 0.0, 0.06, fwidth(metres.x / mull) + 0.01),
                        facadeBand(fract(metres.y / (floorH * 0.5)), 0.0, 0.05, fwidth(metres.y / (floorH * 0.5)) + 0.01));
    float reflect = fract(metres.y / floorH) * 0.12 + 0.04;
    float panePick = fract(sin(dot(floor(vec2(metres.x / mull, metres.y / floorH)), vec2(17.3, 91.1)) + variant * 13.0) * 43758.5453);
    vec3 glass = diffuseColor.rgb * (0.9 + reflect) + vec3(0.04, 0.05, 0.07) * step(0.82, panePick);
    glass = mix(glass, diffuseColor.rgb * 0.70, slab);     // darker opaque spandrel at each slab
    glass = mix(glass, diffuseColor.rgb * 0.55, mullion);  // dark aluminium mullion frame
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, detail);
  }
  // Masonry cornice: a pale stone belt course every 4 floors reads as a horizontal cornice line.
  if (style == 3 || style == 4) {
    float belt = (1.0 - step(0.5, mod(floor(metres.y / 3.2), 4.0)))
      * facadeBand(fract(metres.y / 3.2), 0.0, 0.12, fwidth(metres.y / 3.2) + 0.01);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.77, 0.70), belt * 0.5 * detail);
  }
  // Storefront band: a darker glazed shopfront on the first ~3.6 m; a gentle plinth otherwise.
  if (shop) diffuseColor.rgb *= 0.84;
  else if (groundReady && streetHeight < 3.6) diffuseColor.rgb *= 0.91;
  // Contact darkening toward the sourced ground so buildings sit on the street instead of floating.
  if (groundReady) diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 3.5, max(streetHeight, 0.0)));
  // Night window glow reuses the authored pane mask; occupied rooms vary per building.
  float occProc = fract(sin(dot(floor(grid), vec2(51.71, 17.19)) + variant*7.0)*43758.5453);
  vec3 lampProc = occProc > 0.88 ? vec3(0.48,0.67,0.80) : vec3(0.92,0.49,0.17);
  facadeEmission = lampProc * pane * (shop ? 0.65 : step(0.42, occProc)) * detail * uFacadeNight;` : ''}
  ${textured ? `if (uFacadeAtlasReady > 0.5) {
    // Source land-use palette ratios survive the per-building shade factor.
    bool office = sourceWall.b > sourceWall.r * 1.03;
    bool industrial = abs(sourceWall.r-sourceWall.g) < 0.012 && sourceWall.g > sourceWall.b * 1.025;
    bool retail = sourceWall.r > sourceWall.g * 1.10 && sourceWall.r < sourceWall.g * 1.17 && sourceWall.g > sourceWall.b * 1.18;
    // Stable source colour varies whole buildings; no animated or per-fragment random selection.
    float variant = fract(sin(dot(floor(sourceWall*255.0+0.5),vec3(12.9898,78.233,37.719)))*43758.5453);
    float streetHeight = vFacadePosition.y-vFacadeGround;
    ivec2 district = districtFacade(vFacadePosition.xz, variant, uFacadeGroundReady > 0.5, streetHeight, variant < 0.55 ? 0 : 1);
    int style = district.x;
    if (office) style = 2;
    if (industrial) style = 4;
    // Graphics v2: SF has ground-floor shops well beyond downtown, so ~30% of other buildings (stable per
    // building) also get the storefront band; v1 only shopfronts offices, retail and the downtown districts.
    bool shop = uFacadeGroundReady > 0.5 && streetHeight >= -0.1 && streetHeight < 3.6 && (office || retail || district.y == 1${V2 ? ' || fract(variant*53.0+0.71) < 0.3' : ''});
    if (shop) style = 6;
    vec2 repeatM = uFacadeRepeats[style];
    vec2 tileGrid = metres / repeatM;
    vec2 tileUv = fract(tileGrid);
    // Ground floors follow the sourced terrain; upper storeys remain horizontally tiled.
    if (shop) tileUv.y = clamp(streetHeight/3.6,0.001,0.999);
    vec4 rect = uFacadeRects[style];
    vec2 inset = vec2(0.5)/uFacadeAtlasSize;
    vec2 atlasSpan = rect.zw-2.0*inset;
    vec2 atlasUv = rect.xy + inset + tileUv*atlasSpan;
    // Mipmapped atlas (facadeAtlas.ts, PLAN-v2.1 §4): sample with manual gradients from the
    // continuous pre-fract tile coordinate, so the correct mip is picked without a bright seam at
    // every tile wrap. Shop fronts tile horizontally but map height to the sourced ground.
    vec2 contUv = vec2(tileGrid.x, shop ? streetHeight/3.6 : tileGrid.y);
    vec3 painted = textureGrad(uFacadeAtlas,atlasUv,dFdx(contUv)*atlasSpan,dFdy(contUv)*atlasSpan).rgb;
    // Emissive variant of the reviewed atlas: only its blue/teal glazing emits,
    // preserving painted mullions and dark rooms rather than lighting whole walls.
    float luminance = dot(painted,vec3(0.2126,0.7152,0.0722));
    float windowInk = smoothstep(0.002,0.035,painted.b-painted.r)
      * (1.0-smoothstep(0.28,0.43,luminance));
    // The Victorian tile has pale curtains and teal trim: light the curtain
    // opening itself, not the coloured frame around it.
    if (style==0) windowInk = facadeRect(tileUv,vec2(0.415,0.17),vec2(0.625,0.72),max(fwidth(tileGrid),vec2(0.002)))
      * smoothstep(0.06,0.25,luminance);
    vec2 rooms = floor(tileGrid*(style==2 ? vec2(12.0,8.0) : vec2(style==1 ? 2.0 : 1.0,1.0)));
    float occupied = fract(sin(dot(rooms,vec2(51.71,17.19))+variant*7.0)*43758.5453);
    vec3 lampColour = occupied > 0.88 ? vec3(0.48,0.67,0.80) : vec3(0.92,0.49,0.17);
    if (style==5) windowInk=0.0;
    if (style==0) {
      // Repaint AFTER classifying source land use and sampling the window mask.
      // The cropped Victorian cell has its decorated window/sill in the centre
      // and a cornice across the top; leave those authored pixels untouched.
      vec2 paintAa = max(fwidth(tileGrid),vec2(0.002));
      float surround = facadeRect(tileUv,vec2(0.28,0.025),vec2(0.75,0.90),paintAa);
      float clapboard = (1.0-surround)*(1.0-smoothstep(0.88,0.92,tileUv.y));
      // District style choice also uses variant. Scramble it so districts that
      // choose clapboard in only part of that range still get all seven hues.
      int paintIndex = int(floor(fract(variant*17.0+0.13)*${PAINTED_LADY_SCHEME_COUNT.toFixed(1)}));
      vec3 body = uFacadeBodyPaint[paintIndex]*clamp(luminance/0.76,0.35,1.25);
      painted = mix(painted,body,clapboard*0.92);
    }
    vec3 subtleTint = mix(vec3(1.0),sourceWall/max(max(sourceWall.r,sourceWall.g),max(sourceWall.b,0.001)),0.12);
    painted *= subtleTint * (0.96+variant*0.08);
    ${V2 && !low ? `// Graphics v2 downtown facades (HD only: Low keeps the atlas, gtasf-pooa). Glass/office towers: a per-building glass tint (blue, green, bronze,
    // smoky), a darker spandrel band at each floor slab and a sprinkling of brighter reflective panes.
    if (style == 2) {
      vec3 glassTint[4] = vec3[4](vec3(0.82,0.92,1.08), vec3(0.84,1.02,0.96), vec3(1.06,0.95,0.82), vec3(0.86,0.88,0.92));
      painted *= glassTint[int(floor(fract(variant*11.0+0.2)*4.0))];
      float slab = 1.0 - smoothstep(0.0, 0.06 + fwidth(tileGrid.y), fract(tileGrid.y));
      painted *= 1.0 - 0.22 * slab;
      float pane = fract(sin(dot(floor(tileGrid * vec2(3.0, 1.0)), vec2(17.3, 91.1)) + variant * 13.0) * 43758.5453);
      painted += vec3(0.05, 0.06, 0.07) * step(0.82, pane) * (1.0 - slab);
    }
    // Masonry downtown (stone/brick/concrete): a pale stone belt course every 4 floors, read as a cornice line.
    if (style == 3 || style == 4) {
      float floorIndex = floor(metres.y / 3.2);
      float belt = (1.0 - step(0.5, mod(floorIndex, 4.0))) * facadeBand(fract(metres.y / 3.2), 0.0, 0.12, fwidth(metres.y / 3.2) + 0.01);
      painted = mix(painted, vec3(0.80, 0.77, 0.70), belt * 0.65);
    }
    ` : ''}${V2 ? `// Graphics v2: neighbourhood palette variety (SF stucco pastels) on masonry/stucco styles, so a block of
    // identical boxes reads as distinct buildings; glass towers and shopfronts keep their own art.
    if (style != 2 && style != 6) {
      vec3 pastel[6] = vec3[6](vec3(0.98,0.90,0.78), vec3(0.93,0.84,0.80), vec3(0.84,0.90,0.84), vec3(0.84,0.88,0.96), vec3(0.97,0.94,0.86), vec3(0.90,0.86,0.92));
      painted *= mix(vec3(1.0), pastel[int(floor(fract(variant*29.0+0.37)*6.0))], 0.55);
    }
    ${low ? '' : `// Weathering: soft grime streaks under each window row and a darker plinth at street level.
    float streak = smoothstep(0.0, 0.35, fract(tileGrid.y)) * (1.0 - smoothstep(0.35, 0.5, fract(tileGrid.y)));
    painted *= 1.0 - 0.06 * streak * (0.5 + 0.5 * fract(sin(floor(tileGrid.x) * 91.7) * 4375.5));
    if (uFacadeGroundReady > 0.5) painted *= mix(0.86, 1.0, smoothstep(0.0, 0.6, streetHeight));`}` : ''}
    ${RELIEF ? `// gtasf-l857 v2 (facadeReliefV2): layer depth + per-building variety ON TOP of the reviewed atlas
    // sample — never replace it. Albedo only, cheap ALU, HD + phone.
    {
      // Per-floor relief: each atlas tile is ~one storey. A shadow just under the floor slab (lintel) and a
      // lit ledge at its base (sill) give every window row readable depth without any window geometry.
      float reliefAa = fwidth(tileGrid.y) + 0.004;
      float fy = fract(tileGrid.y);
      float lintel = facadeBand(fy, 0.80, 0.99, reliefAa);
      float sill = facadeBand(fy, 0.01, 0.09, reliefAa);
      painted *= 1.0 - 0.28 * lintel;
      painted += painted * 0.13 * sill;
      // Vertical pier shadow between window bays (the wall reveal on each side of a window reads recessed).
      float reliefAax = fwidth(tileGrid.x) + 0.004;
      float fx = fract(tileGrid.x);
      float pier = facadeBand(fx, 0.0, 0.07, reliefAax) + facadeBand(fx, 0.93, 1.0, reliefAax);
      painted *= 1.0 - 0.12 * pier * (1.0 - windowInk);
      // Glazing sits set-back behind the wall plane: darken + cool the atlas window ink so panes read recessed.
      painted *= 1.0 - 0.34 * windowInk;
      painted += vec3(-0.02, -0.008, 0.022) * windowInk;
      // Stable per-building tint + brightness so a block of near-identical boxes separates into distinct
      // buildings. The plain glass/office towers (style 2) are the worst "identical grey box" offenders, so
      // they get it TOO — a per-building glass/stone cast (slate, powder blue, green-glass, lavender-grey,
      // sand, teal-grey, bronze, sage). Victorians (style 0) already carry painted-lady colour, so tint them
      // only gently; shopfront glazing (style 6) keeps its own art but still takes the brightness spread.
      vec3 facadeTints[8] = vec3[8](
        vec3(0.80,0.88,1.02), vec3(0.86,1.00,0.94), vec3(1.04,0.96,0.84), vec3(0.90,0.88,0.96),
        vec3(0.99,0.94,0.85), vec3(0.84,0.91,0.91), vec3(1.03,0.91,0.85), vec3(0.89,0.93,0.85));
      vec3 facadeTint = facadeTints[int(floor(fract(variant * 19.0 + 0.23) * 8.0))];
      float facadeValue = 0.86 + 0.26 * fract(variant * 8.0 + 0.2);   // stable per-building brightness
      float tintAmt = style == 0 ? 0.12 : style == 2 ? 0.30 : style == 6 ? 0.0 : 0.22;
      painted *= mix(vec3(1.0), facadeTint, tintAmt) * facadeValue;
    }
    ` : ''}if (uFacadeGroundReady > 0.5 && streetHeight < 3.6) painted *= shop ? 0.84 : 0.91;
    // Mipmaps carry the art to distance without shimmer; keep facade detail across the readable
    // city and only dissolve to the flat land-use colour as walls reach the fog line.
    vec2 span = fwidth(tileGrid)*rect.zw*uFacadeAtlasSize;
    float atlasDetail = 1.0-smoothstep(120.0,340.0,max(span.x,span.y));
    ${V2 ? `// Graphics v2: fade distant walls to the tile's own average colour (a coarse mip of the same art), not the
    // flat source colour, so far buildings keep their facade tone instead of turning plain grey.
    vec3 tileAverage = textureLod(uFacadeAtlas, rect.xy + rect.zw * 0.5, 7.0).rgb * subtleTint * (0.96+variant*0.08) * 0.92;
    ${FARLOD ? `// Far-LOD skyline variety (gtasf-l857 task 2): vary the distant tower tone per building so the skyline
    // reads as individual buildings, not one grey/lavender field. Seed from the building block position (towers
    // often share a source colour, so a position hash separates them where 'variant' cannot). SF skyline tones.
    {
      vec3 skylineTints[6] = vec3[6](vec3(0.88,0.85,0.79), vec3(0.93,0.88,0.78), vec3(0.78,0.84,0.93),
        vec3(0.92,0.83,0.72), vec3(0.82,0.85,0.88), vec3(0.83,0.89,0.82));
      float skylineSeed = fract(fract(sin(dot(floor(vFacadePosition.xz / 32.0), vec2(27.17, 61.73))) * 43758.5453) + variant);
      tileAverage *= mix(vec3(1.0), skylineTints[int(floor(skylineSeed * 6.0))], 0.5) * (0.80 + 0.36 * fract(skylineSeed * 7.0 + 0.3));
    }
    ` : ''}tileAverage = mix(tileAverage, aerialAt(vFacadePosition.xz) * 0.9, 0.4 * uAerialReady); // aerial far tone
    diffuseColor.rgb = mix(tileAverage, painted, atlasDetail);` : 'diffuseColor.rgb = mix(diffuseColor.rgb,painted,atlasDetail);'}
    ${sfLookEnabled() ? `// Contact AO (gtasf-r9f6, SF look): walls darken toward the sourced ground over the first ~3.5 m, so
    // buildings sit ON the street instead of floating (reference: soft contact shading). No extra pass or texture.
    if (uFacadeGroundReady > 0.5) diffuseColor.rgb *= mix(0.66, 1.0, smoothstep(0.0, 3.5, max(streetHeight, 0.0)));` : ''}
    facadeEmission = mix(facadeEmission,lampColour*windowInk*(shop ? 0.65 : step(0.42,occupied))*uFacadeNight,atlasDetail);
  }` : ''}${GLASS ? `
  // glassTowerReflect: turn tall mid-distance tower walls into reflective GLASS instead of flat matte boxes, so the
  // FiDi/SoMa curtain walls read like the Teleoperator reference's deeper steel-and-glass towers. We are at the END
  // of the wall block (abs(facadeNormal.y) < 0.35), so diffuseColor is the FINAL wall colour for every path (atlas,
  // procedural, authored) and nothing downstream overwrites it. Real glass reads DARK head-on and mirror-BRIGHT at
  // grazing angles, so deepen+cool the base toward a steel-glass tone and then reflect the sky (Fresnel), ramped in
  // by WORLD HEIGHT (low-rise stays matte) and camera distance (the near authored fronts own the near look), banded
  // by floor so it reads as a curtain wall. ~16 ALU, no new uniforms/samplers; HD + Low. Byte-identical off.
  {
    float grDist = length(vFacadePosition - cameraPosition);
    float grRange = smoothstep(150.0, 420.0, grDist) * (1.0 - smoothstep(2500.0, 3400.0, grDist));
    float grTall = smoothstep(22.0, 55.0, vFacadePosition.y);
    float grBase = grRange * grTall;
    if (grBase > 0.001) {
      vec3 grV = normalize(cameraPosition - vFacadePosition);
      float grFres = pow(1.0 - clamp(abs(dot(facadeNormal, grV)), 0.0, 1.0), 2.5);
      vec3 grSky = vec3(0.66, 0.76, 0.95);              // cool sky mirror
      vec3 grGlass = vec3(0.34, 0.40, 0.50);            // deep steel-glass base
      #if NUM_DIR_LIGHTS > 0
      float grWarm = clamp((directionalLights[0].color.r - directionalLights[0].color.b) * 0.7, 0.0, 0.6);
      grSky = mix(grSky, vec3(0.95, 0.84, 0.66), grWarm);     // warm sky at golden hour
      grGlass = mix(grGlass, vec3(0.46, 0.40, 0.36), grWarm);
      #endif
      float grFloor = vFacadePosition.y / 3.6;
      float grBand = smoothstep(0.5, 0.5 - 1.5 * fwidth(grFloor), abs(fract(grFloor) - 0.5)); // 1 in glazing
      vec3 grCol = mix(diffuseColor.rgb, grGlass, 0.42);                        // deepen toward steel-glass
      grCol = mix(grCol, grSky, clamp(grFres * (0.38 + 0.5 * grBand), 0.0, 0.92)); // sky reflection, banded
      diffuseColor.rgb = mix(diffuseColor.rgb, grCol, grBase);
    }
  }` : ''}
}${V2 && !low ? `
else if (facadeNormal.y > 0.65) {
  // Graphics v2 roofs: tar/gravel noise and procedural rooftop units (AC boxes, water tanks) on a 7 m grid,
  // so the city reads as lived-in from the hills instead of flat-topped boxes. Fades out with distance.
  vec2 roofCell = floor(vFacadePosition.xz / 7.0), roofUv = fract(vFacadePosition.xz / 7.0);
  float roofAa = max(fwidth(vFacadePosition.x), fwidth(vFacadePosition.z));
  float roofDetail = 1.0 - smoothstep(0.25, 0.9, roofAa);
  float grit = fract(sin(dot(floor(vFacadePosition.xz * 2.3), vec2(12.9898, 78.233))) * 43758.5453);
  // Real roof colour from the NAIP aerial when this chunk has one (item 2), else the source colour.
  vec3 roofBase = mix(diffuseColor.rgb, aerialAt(vFacadePosition.xz) * 1.05, uAerialReady);
  vec3 roof = roofBase * (0.9 + grit * 0.12);
  float pick = fract(sin(dot(roofCell, vec2(41.3, 289.1))) * 43758.5453);
  vec2 size = pick < 0.5 ? vec2(0.22, 0.16) : vec2(0.14);
  vec2 centre = vec2(0.3 + 0.4 * fract(pick * 13.7), 0.3 + 0.4 * fract(pick * 7.3));
  float unit = facadeRect(roofUv, centre - size, centre + size, vec2(roofAa / 7.0 + 0.004));
  float tank = pick > 0.86 ? 1.0 - smoothstep(0.10, 0.10 + roofAa / 7.0 + 0.01, length(roofUv - centre)) : 0.0;
  float show = step(0.55, pick);
  roof = mix(roof, vec3(0.62, 0.63, 0.62), unit * show * (1.0 - tank));
  roof = mix(roof, vec3(0.42, 0.33, 0.24), tank);
  diffuseColor.rgb = mix(diffuseColor.rgb, roof, roofDetail);
}` : ''}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += facadeEmission;');
  };
  material.needsUpdate = true;
}
