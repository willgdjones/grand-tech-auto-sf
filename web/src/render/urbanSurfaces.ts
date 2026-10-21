import { LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Texture, type IUniform, type Material, type Object3D } from 'three';
import { flags } from '@gtasf/shared/flags';
import { DISTRICTS, districtAt } from '../../../tools/map/src/districts';
import type { GraphicsPreset } from './graphicsPreset';
import type { ShopfrontContext } from './shopfrontSigns';
import { acquireSurface, addSurfaceRoof, addSurfacePavers, addBuildingWindowGrid } from './surfaceMaterials';
import { createUrbanFrontages } from './urbanFrontages';
import { createUrbanRoadMask } from './urbanRoadMask';
import { createUrbanContactMask } from './urbanContactMask';
import { MAX_PLAZAS, PLAZA_UNIFORMS } from './plazas';
import { wetSignal } from './weather/wetness';

// Atlas order matches tools/art/prompts/urban-surfaces.json. Classification uses source semantic
// palettes, never a green/brightness heuristic: mapped parks, scrub, sand and water pass through.
const palettes = DISTRICTS.map(district => ({
  id: district.id,
  rgb: district.ground.urban.map(channel => Math.round(channel * 255)),
  tile: district.defaultBuildingUse === 'civic' || district.id === 'fidi' ? 1
    : district.defaultBuildingUse === 'industrial' ? 3 : 0,
}));
export function urbanSurfaceTile(rgb: readonly number[]): number {
  return palettes.find(p => p.rgb.every((value, i) => Math.round((rgb[i] ?? -1) * 255) === value))?.tile ?? -1;
}
const classify = (polish: boolean) => palettes.map(({ id, rgb, tile }) =>
  `if (all(lessThan(abs(color.rgb - vec3(${rgb.map(v => `${v}.0/255.0`).join(',')})), vec3(0.0019)))) vUrbanTile = ${polish && id === 'soma' ? 6 : tile}.0;`).join('\n');
// residentialBlockGreens: the leafy residential neighbourhoods whose block-interior urban ground should read green
// (not every district sets defaultBuildingUse='residential'); downtown cores and parks are excluded.
const RES_GROUND = new Set(['mission', 'noe-valley', 'haight-ashbury', 'castro', 'hayes-valley', 'pacific-heights',
  'cow-hollow', 'marina', 'richmond', 'sunset', 'bernal-heights', 'potrero-hill', 'glen-park', 'excelsior',
  'western-addition', 'japantown', 'dogpatch', 'bayview']);
const residentialGroundClassify = () => palettes.filter(p => RES_GROUND.has(p.id)).map(({ rgb }) =>
  `if (all(lessThan(abs(color.rgb - vec3(${rgb.map(v => `${v}.0/255.0`).join(',')})), vec3(0.0019)))) vResGround = 1.0;`).join('\n');
// residentialBlockGreens: a chunk needs the road-distance mask only if any of its ground could set
// vResGround (i.e. it touches a RES_GROUND district). Sampling centre + corners catches border chunks;
// everything else binds a 1x1 all-zero mask so the green never fires there (perf: skips the per-texel
// nearestRoad grid for downtown/parks). Can't gate on defaultBuildingUse — most RES_GROUND districts
// leave it unset and dogpatch is 'industrial'.
function residentialChunk(ground: { x: number; z: number }): boolean {
  const xs = [ground.x * 256 + 1, (ground.x + 0.5) * 256, (ground.x + 1) * 256 - 1];
  const zs = [ground.z * 256 + 1, (ground.z + 0.5) * 256, (ground.z + 1) * 256 - 1];
  for (const x of xs) for (const z of zs) if (RES_GROUND.has(districtAt(x, z)?.id ?? '')) return true;
  return false;
}

// District-override park greens. Several marquee parks are baked with a DISTRICT park colour (not the default
// [0.26,0.42,0.21]) that does not match the tile-7 lawn classifier, so they classify as unclassified ground and get
// NO lawn treatment -- raw flat slabs. This registry gives each its own varied landscaping from ONE template: a
// world-space rectangle (centre `c`, orthonormal axes `u`/`v`, feather extents) that, on unclassified/park ground
// inside it, recolours the grass across a big section tone (deep mown green <-> drier yellow-green) with gentle
// trampled patches. Frames derive from the park's block corners (tools/park-frames.mjs). Grass only -- footpaths are
// separate roads* meshes. No texture fetch, no geometry, no draw calls. Each entry is gated by its own flag so they
// ship/toggle independently and stay byte-identical off.
interface DistrictPark {
  id: string; flag: 'doloresPark' | 'alamoSquareGreens' | 'districtParkGreens'; note: string;
  c: readonly [number, number];                       // centre (world x,z)
  u: readonly [number, number]; v: readonly [number, number]; // orthonormal park axes
  uf: readonly [number, number]; vf: readonly [number, number]; // smoothstep(in,out) feather on |u|,|v|
  green: readonly [number, number, number]; dry: readonly [number, number, number];
  worn: readonly [number, number, number]; wear: number; // worn-patch blend weight
}
const DISTRICT_PARKS: readonly DistrictPark[] = [
  { id: 'dolores', flag: 'doloresPark', note: 'Dolores Park (mission green [.23,.43,.18]); busy sunbathing park, wears through to bare earth',
    c: [-1633.7, 2703.4], u: [0.9985, 0.0538], v: [-0.0561, 0.9984], uf: [50, 57], vf: [142, 149],
    green: [0.20, 0.31, 0.13], dry: [0.39, 0.41, 0.20], worn: [0.39, 0.33, 0.20], wear: 0.60 },
  { id: 'alamo-square', flag: 'alamoSquareGreens', note: 'Alamo Square (western-addition green [.16,.33,.10]); completes the Painted Ladies postcard, lusher/less worn',
    c: [-2271.6, 864.0], u: [0.9925, -0.1226], v: [0.1138, 0.9935], uf: [72, 78], vf: [80, 86],
    green: [0.19, 0.30, 0.13], dry: [0.32, 0.38, 0.18], worn: [0.35, 0.31, 0.19], wear: 0.45 },
  { id: 'lafayette', flag: 'districtParkGreens', note: 'Lafayette Park (pacific-heights green [.17,.34,.11]); manicured hilltop lawn',
    c: [-1725.3, -814.6], u: [0.9683, -0.2497], v: [-0.2478, 0.9688], uf: [88, 95], vf: [79, 85],
    green: [0.19, 0.31, 0.13], dry: [0.33, 0.39, 0.19], worn: [0.34, 0.31, 0.19], wear: 0.32 },
  { id: 'alta-plaza', flag: 'districtParkGreens', note: 'Alta Plaza Park (pacific-heights green [.17,.34,.11]); terraced manicured lawn',
    c: [-2483.9, -782.9], u: [0.998, -0.0626], v: [-0.0881, 0.9961], uf: [82, 89], vf: [44, 51],
    green: [0.19, 0.31, 0.13], dry: [0.33, 0.39, 0.19], worn: [0.34, 0.31, 0.19], wear: 0.32 },
  { id: 'panhandle', flag: 'districtParkGreens', note: 'the Panhandle (haight green [.20,.37,.15]); long tree-shaded grass strip, a touch more worn/varied',
    c: [-3546.1, 1303.4], u: [0.995, 0.1003], v: [-0.1951, 0.9808], uf: [492, 500], vf: [40, 46],
    green: [0.20, 0.32, 0.14], dry: [0.34, 0.40, 0.20], worn: [0.35, 0.31, 0.19], wear: 0.40 },
];
const gf = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`); // GLSL float literal
const gv = (c: readonly [number, number, number]): string => `vec3(${gf(c[0])},${gf(c[1])},${gf(c[2])})`;
/** GLSL for all enabled district parks (each flag-gated, each in its own scope so locals never collide). */
function districtParkGreensGlsl(low: boolean): string {
  return DISTRICT_PARKS.map(p => flags[p.flag] ? `
// districtParkGreens -- ${p.note}. Keyed on the park's world rect; grass only (footpaths untouched); edge-feathered.
if((urbanTileIn<-0.5 || urbanTileIn>6.5)) {
  vec2 M=vUrbanMetres; vec2 C=M-vec2(${gf(p.c[0])},${gf(p.c[1])});
  float u=dot(C,vec2(${gf(p.u[0])},${gf(p.u[1])})); float v=dot(C,vec2(${gf(p.v[0])},${gf(p.v[1])}));
  float ins=(1.0-smoothstep(${gf(p.uf[0])},${gf(p.uf[1])},abs(u)))*(1.0-smoothstep(${gf(p.vf[0])},${gf(p.vf[1])},abs(v)));
  if(ins>0.001) {
    float near=1.0-smoothstep(25.0,${low ? '90.0' : '140.0'},length(M-cameraPosition.xz));
    float fine=lawnNoise(M*2.1); float sect=lawnNoise(M/26.0+3.1); float wear=lawnNoise(M/6.5+7.7);
    vec3 col=mix(${gv(p.green)},${gv(p.dry)},smoothstep(0.42,0.80,sect));
    col=mix(col,${gv(p.worn)},smoothstep(0.58,0.86,wear)*${gf(p.wear)});
    col*=1.0+(fine-0.5)*0.16*near;
    diffuseColor.rgb=mix(diffuseColor.rgb,col,ins);
  }
}` : '').join('');
}

/** One shared 0.885MP albedo atlas. No new draw calls, geometries or per-frame CPU work. */
export function createUrbanSurfaces(preset: GraphicsPreset, enabled: boolean = flags.groundTextures && (flags.hdUrbanSurfaces || flags.graphicsV2)) {
  const polish = flags.graphicsV2, low = preset === 'low';
  // realisticLightingV2 (GTA-pivot lane A #2): on the IBL/ACES HD path the road MeshStandardMaterial would
  // carry 6 uUrbanTile samplers + 3 asphalt PBR maps + masks + the new scene.environment envMap + sun-shadow
  // sampler, exceeding MAX_TEXTURE_IMAGE_UNITS(16). Route ROADS to the packed-atlas sample instead (dropping
  // the 6 tile samplers; identical albedo content, from the full atlas rather than the sliced tiles) so the
  // road program fits while keeping asphalt normal/roughness for realistic lighting response. Terrain keeps
  // its 6 tiles (no asphalt maps → it stays under the limit). Flag off: v2 is false, byte-identical.
  const v2 = polish && !low && flags.realisticLightingV2;
  // wetRoads (#5): drive a wet darken + grazing sky sheen on the ground from uWet (0..1). No new samplers.
  const wetFx = flags.wetRoads;
  if (!enabled || (low && !polish)) return undefined;
  const uniforms: Record<string, IUniform> = { uUrbanAtlas: { value: null }, uUrbanReady: { value: 0 },
    ...(wetFx ? { uWet: flags.wetLampStreaks ? wetSignal : { value: 0 }, uSkyColour: { value: null } } : {}) };
  const tiles: Texture[] = [], tileImages: ImageBitmap[] = [];
  if (polish) for (let i = 0; i < 6; i++) uniforms[`uUrbanTile${i}`] = { value: null };
  const asphalt = polish && !low ? acquireSurface('asphalt', false) : undefined;
  if (asphalt) Object.assign(uniforms, { uAsphaltReady: { value: 0 }, uAsphaltAlbedo: { value: null }, uAsphaltNormal: { value: null }, uAsphaltRough: { value: null } });
  const abort = new AbortController(), mounts = new Set<() => void>();
  let texture: Texture | undefined, bitmap: ImageBitmap | undefined, disposed = false;
  const stats = { state: 'loading', bytes: 0, materials: 0 };
  function clearAtlas() {
    uniforms.uUrbanReady!.value = 0;
    texture?.dispose(); texture = undefined; bitmap?.close(); bitmap = undefined;
    for (const map of tiles) map.dispose(); tiles.length = 0;
    for (const tile of tileImages) tile.close(); tileImages.length = 0;
    uniforms.uUrbanAtlas!.value = null;
    if (polish) for (let i = 0; i < 6; i++) uniforms[`uUrbanTile${i}`]!.value = null;
  }
  void asphalt?.ready.then(maps => {
    if (!maps || disposed) return;
    uniforms.uAsphaltAlbedo!.value = maps.albedo; uniforms.uAsphaltNormal!.value = maps.normal;
    uniforms.uAsphaltRough!.value = maps.roughness; uniforms.uAsphaltReady!.value = 1;
  });
  const ready = (async () => {
    if (typeof window === 'undefined') { stats.state = 'fallback'; return false; }
    const deadline = setTimeout(() => abort.abort(), 15_000);
    try {
      const response = await fetch(low ? '/art/urban-surfaces-low.webp' : '/art/urban-surfaces.webp', { signal: abort.signal });
      if (!response.ok) throw new Error('Urban texture unavailable');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 500_000) throw new Error('Urban texture transfer budget');
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }), {
        imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none',
      });
      if (disposed || abort.signal.aborted || image.width !== (low ? 576 : 1152) || image.height !== (low ? 384 : 768)) { image.close(); throw new Error('Urban atlas disposed or invalid'); }
      bitmap = image;
      if (polish) {
        // Each surface owns its full mip chain. Cropping out the wrapped gutters avoids
        // cross-tile atlas bleed even at grazing angles, with no extra network requests.
        const cell = low ? 192 : 384, gutter = low ? 4 : 8, size = cell - gutter * 2;
        for (let i = 0; i < 6; i++) {
          const tile = await createImageBitmap(image, (i % 3) * cell + gutter, Math.floor(i / 3) * cell + gutter, size, size,
            { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
          if (disposed || abort.signal.aborted) { tile.close(); throw new Error('Urban tile disposed'); }
          tileImages.push(tile);
          const map = new Texture(tile); map.name = `SF urban surface ${i}`;
          map.colorSpace = SRGBColorSpace; map.flipY = false;
          map.wrapS = map.wrapT = RepeatWrapping; map.magFilter = LinearFilter;
          map.minFilter = LinearMipmapLinearFilter; map.generateMipmaps = true; map.anisotropy = low ? 4 : 8;
          map.needsUpdate = true; tiles.push(map); uniforms[`uUrbanTile${i}`]!.value = map;
        }
        if (v2) {
          // Keep the full atlas alongside the sliced tiles so the road program can sample it (see `v2` note).
          texture = new Texture(image); texture.name = 'SF urban surfaces';
          texture.colorSpace = SRGBColorSpace; texture.flipY = false;
          texture.minFilter = texture.magFilter = LinearFilter; texture.generateMipmaps = false;
          texture.needsUpdate = true; uniforms.uUrbanAtlas!.value = texture;
        } else { bitmap.close(); bitmap = undefined; }
      } else {
        texture = new Texture(image); texture.name = 'SF urban surfaces';
        texture.colorSpace = SRGBColorSpace; texture.flipY = false;
        texture.minFilter = texture.magFilter = LinearFilter; texture.generateMipmaps = false;
        texture.needsUpdate = true; uniforms.uUrbanAtlas!.value = texture;
      }
      uniforms.uUrbanReady!.value = 1;
      stats.state = 'ready'; stats.bytes = bytes.byteLength; return true;
    } catch { clearAtlas(); if (!disposed) stats.state = 'fallback'; return false; }
    finally { clearTimeout(deadline); }
  })();
  function mount(root: Object3D): () => void {
    const changes: { mesh: Mesh; before: Material | Material[] }[] = [];
    const converted = new Map<Material, Material>();
    let frontages: ReturnType<typeof createUrbanFrontages> | undefined;
    let roadMask: ReturnType<typeof createUrbanRoadMask> | undefined;
    // residentialBlockGreens: real context for residential chunks (builds the road-distance grid),
    // undefined otherwise (createUrbanRoadMask returns a 1x1 all-zero mask so the green never fires).
    const roadMaskContext = flags.residentialBlockGreens && polish && root.userData.gtasfShopfrontContext
      && residentialChunk((root.userData.gtasfShopfrontContext as ShopfrontContext).ground)
      ? root.userData.gtasfShopfrontContext as ShopfrontContext : undefined;
    // groundContactAO: per-chunk building-distance mask for contact shadows at building bases (any chunk with
    // footprints, citywide — not just residential). Context-less chunks get a 1x1 all-1 mask (AO never fires).
    let contactMask: ReturnType<typeof createUrbanContactMask> | undefined;
    const contactContext = flags.groundContactAO && polish && root.userData.gtasfShopfrontContext
      ? root.userData.gtasfShopfrontContext as ShopfrontContext : undefined;
    if (polish && root.userData.gtasfShopfrontContext) {
      const soma = palettes.find(p => p.id === 'soma')!;
      let hasSoma = false;
      root.traverse(object => {
        if (hasSoma || !(object instanceof Mesh) || !/^terrain(?:_|$)/.test(object.name)) return;
        const colors = object.geometry.getAttribute('color');
        if (!colors) return;
        for (let i = 0; i < colors.count && !hasSoma; i++) {
          hasSoma = Math.round(colors.getX(i) * 255) === soma.rgb[0]
            && Math.round(colors.getY(i) * 255) === soma.rgb[1]
            && Math.round(colors.getZ(i) * 255) === soma.rgb[2];
        }
      });
      // Only SoMa chunks need the 16KB mask, including split terrain meshes at district borders.
      if (hasSoma) frontages = createUrbanFrontages(root.userData.gtasfShopfrontContext as ShopfrontContext);
    }
    root.traverse(object => {
      if (!(object instanceof Mesh) || (!polish && root.userData.gtasfLowDetail === true)) return;
      const terrain = /^terrain(?:_|$)/.test(object.name), roads = /^roads(?:_|$)/.test(object.name);
      const kerb = /kerb/i.test(object.name);
      // roofToneVariety / coarseWindowGrid extend the buildings-material branch to Low too (so phones get the
      // varied roofscape and the distant window grid); the roof texture itself stays HD-only inside addSurfaceRoof.
      const roof = polish && /^buildings(?:_|$)/.test(object.name) && (!low || flags.roofToneVariety || flags.coarseWindowGrid);
      if (roof) {
        // The graphics preview uses SA materials. Compose the roof texture over the
        // existing facade shader; leave PBR buildings to their existing roof hook.
        const inputs = Array.isArray(object.material) ? object.material : [object.material];
        if (inputs.some(material => !(material as MeshStandardMaterial).isMeshStandardMaterial)) {
          changes.push({ mesh: object, before: object.material });
          const roofMaterial = (source: Material): Material => {
            const previous = converted.get(source); if (previous) return previous;
            if ((source as MeshStandardMaterial).isMeshStandardMaterial) return source;
            const material = source.clone();
            material.onBeforeCompile = (shader, renderer) => source.onBeforeCompile(shader, renderer);
            material.customProgramCacheKey = () => source.customProgramCacheKey();
            addSurfaceRoof(material, low); addBuildingWindowGrid(material); converted.set(source, material); stats.materials++;
            return material;
          };
          object.material = Array.isArray(object.material) ? object.material.map(roofMaterial) : roofMaterial(object.material);
        }
        return;
      }
      const ferry = polish && object.name === 'Ferry Building geometry' && object.parent?.userData.landmarkId === 'ferry-building';
      const apron = polish && object.name === 'Ferry plaza terrain transition';
      if ((!terrain && !roads && !kerb && !ferry && !apron) || (terrain && !object.geometry.hasAttribute('color'))) return;
      // shoreSeams: sea-level water-coloured terrain shows the bay plane instead of lit pale-blue wedges (flags.ts).
      const shore = flags.shoreSeams && terrain;
      function convert(source: Material): Material {
        const previous = converted.get(source); if (previous) return previous;
        const asphaltPbr = Boolean(asphalt && roads);
        const pavingPbr = polish && !low && apron;
        const input = source as MeshStandardMaterial;
        // The SA road hooks use shared shader chunks; preserve their composition while giving
        // HD asphalt fragment-lit normal/roughness response. Other surface paths retain their material.
        const material = (asphaltPbr || pavingPbr) && !input.isMeshStandardMaterial ? new MeshStandardMaterial({
          name: source.name, color: input.color, map: input.map ?? null, vertexColors: input.vertexColors,
          roughness: .94, metalness: 0, side: source.side, transparent: source.transparent,
          opacity: source.opacity, alphaTest: source.alphaTest, depthWrite: source.depthWrite,
        }) : source.clone();
        const kind = terrain ? 'terrain' : roads ? 'roads' : ferry ? 'ferry-paving' : apron ? 'ferry-apron' : 'kerb';
        // Ground surfaces that receive the building-base contact AO (not the Ferry's authored paving).
        const groundKind = terrain || roads || kerb;
        if (polish && terrain) frontages ??= createUrbanFrontages();
        if (flags.residentialBlockGreens && polish && terrain) roadMask ??= createUrbanRoadMask(roadMaskContext);
        if (flags.groundContactAO && polish && groundKind) contactMask ??= createUrbanContactMask(contactContext);
        material.customProgramCacheKey = () => `${source.customProgramCacheKey()}:urban-v9-${flags.hillsideScrub ? 1 : 0}:${kind}:${low}:${polish}:fp${flags.ferryPlazaPaving ? 1 : 0}${flags.ferryPlazaSetts ? 's' : ''}:rg${flags.residentialBlockGreens ? 1 : 0}:ao${flags.groundContactAO ? 1 : 0}:lr${flags.legibleLowRoads ? 1 : 0}:pg${flags.richParkGreens ? 1 : 0}:dp${flags.doloresPark ? 1 : 0}:as${flags.alamoSquareGreens ? 1 : 0}:dpg${flags.districtParkGreens ? 1 : 0}:cp${flags.civicPaving ? 1 : 0}:us${flags.unionSquarePlazaLow ? 1 : 0}:v2${v2 ? 1 : 0}:wet${wetFx ? 1 : 0}${shore ? ':sh' : ''}`;
        material.onBeforeCompile = (shader, renderer) => {
          source.onBeforeCompile(shader, renderer);
          Object.assign(shader.uniforms, uniforms);
          // Roads sample the packed atlas instead of the 6 sliced tiles on the realisticLightingV2 path, to
          // free the tile samplers for the IBL envMap + sun shadow (see `v2` note). Terrain keeps its tiles.
          const useTiles = polish && !(v2 && roads);
          if (polish && terrain && frontages) {
            shader.uniforms.uUrbanFrontages = { value: frontages.texture };
            shader.uniforms.uUrbanOrigin = { value: frontages.origin };
            shader.uniforms.uPlazas = PLAZA_UNIFORMS.uPlazas; shader.uniforms.uPlazaCount = PLAZA_UNIFORMS.uPlazaCount;
          }
          const resGreens = flags.residentialBlockGreens && terrain && polish;
          if (resGreens && roadMask) {
            shader.uniforms.uUrbanRoadMask = { value: roadMask.texture };
            shader.uniforms.uUrbanRoadOrigin = { value: roadMask.origin };
          }
          const contactAO = flags.groundContactAO && groundKind && polish;
          if (contactAO && contactMask) {
            shader.uniforms.uUrbanBuildingMask = { value: contactMask.texture };
            shader.uniforms.uUrbanBuildingOrigin = { value: contactMask.origin };
          }
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\nvarying vec2 vUrbanMetres; varying float vUrbanTile;${resGreens ? '\nvarying float vResGround;' : ''}${shore ? '\nvarying float vShoreWet; varying float vShoreY;' : ''}`)
            .replace('#include <color_vertex>', `#include <color_vertex>${shore ? `
vShoreWet = 0.0;
#ifdef USE_COLOR
if (all(lessThan(abs(color.rgb - vec3(26.0/255.0,59.0/255.0,105.0/255.0)), vec3(0.0019)))) vShoreWet = 1.0;
#endif` : ''}
vUrbanTile = ${kerb ? '5.0' : apron ? '1.0' : '-1.0'};${resGreens ? '\nvResGround = 0.0;' : ''}
#ifdef USE_COLOR
${terrain ? classify(polish) + (polish ? `
if (all(lessThan(abs(color.rgb - vec3(66.0/255.0,107.0/255.0,54.0/255.0)), vec3(0.0019)))) vUrbanTile = 7.0;
if (all(lessThan(abs(color.rgb - vec3(97.0/255.0,110.0/255.0,71.0/255.0)), vec3(0.0019)))) vUrbanTile = 8.0;` : '') + (resGreens ? '\n' + residentialGroundClassify() : '') : roads ? 'if (color.r <= color.g * 1.5) vUrbanTile = color.r > 0.40 && color.g > 0.40 ? 0.0 : 2.0;' : ferry ? 'if (position.y >= 0.0 && position.y < 0.21 && normal.y > 0.9) vUrbanTile = 1.0;' : ''}
#endif`)
            .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvUrbanMetres=(modelMatrix*vec4(transformed,1.0)).xz;${shore ? 'vShoreY=(modelMatrix*vec4(transformed,1.0)).y;' : ''}`);
          // shoreSeams: sea-level water vertices drop to >= 6 m under the bay plane (-0.4 m), so the plane is the water and a
          // shoreline triangle meets it on a level waterline. A vertex move, not a discard (keeps early-z on phones).
          if (shore) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_COLOR
// Only ever lowered, and well below the plane: a near-plane seabed z-fights it at grazing range.
if (vShoreWet > 0.5) { float shoreWorldY = (modelMatrix*vec4(transformed,1.0)).y; if (shoreWorldY < 1.5) transformed.y -= max(0.0, shoreWorldY + 6.0); }
#endif`);
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
varying vec2 vUrbanMetres; varying float vUrbanTile;${resGreens ? '\nvarying float vResGround;' : ''}${shore ? '\nvarying float vShoreWet; varying float vShoreY;' : ''}
uniform sampler2D uUrbanAtlas; uniform float uUrbanReady;${wetFx ? '\nuniform float uWet; uniform vec3 uSkyColour;' : ''}
${contactAO ? 'uniform sampler2D uUrbanBuildingMask; uniform vec2 uUrbanBuildingOrigin;' : ''}
${polish && terrain ? `uniform sampler2D uUrbanFrontages; uniform vec2 uUrbanOrigin; uniform vec4 uPlazas[${MAX_PLAZAS}]; uniform float uPlazaCount;
${resGreens ? 'uniform sampler2D uUrbanRoadMask; uniform vec2 uUrbanRoadOrigin;' : ''}
float lawnHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float lawnNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(lawnHash(i),lawnHash(i+vec2(1.0,0.0)),f.x),mix(lawnHash(i+vec2(0.0,1.0)),lawnHash(i+1.0),f.x),f.y);}` : ''}
${useTiles ? Array.from({length: 6}, (_, i) => `uniform sampler2D uUrbanTile${i};`).join('\n') : ''}
vec3 urbanSample(float tile, vec2 metres, float scale) {
  ${useTiles ? `${Array.from({length: 5}, (_, i) => `if (tile < ${i + .5}) return texture2D(uUrbanTile${i}, metres/scale).rgb;`).join('\n')}
  return texture2D(uUrbanTile5, metres/scale).rgb;` : `
  vec2 cell=vec2(mod(tile,3.0),floor(tile/3.0));
  vec2 uv=(cell*${low ? '192.0' : '384.0'}+vec2(${low ? '4.5' : '8.5'})+fract(metres/scale)*${low ? '183.0' : '367.0'})/vec2(${low ? '576.0,384.0' : '1152.0,768.0'});
  return texture2D(uUrbanAtlas,uv).rgb;`}
}`)
            // After existing road textures and before lighting; both Lambert and Standard use this chunk.
            .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>${shore ? `
#ifdef USE_COLOR
// shoreSeams: vShoreWet interpolates the exact water-palette weight across a triangle; the wet vertices sit under the
// bay plane (begin_vertex), so above it recover the land vertices' colour from the mix and a shoreline slope reads as
// ground, not a lit blue wedge. Inland lakes (>1.5 m) keep theirs.
if (vShoreWet > 0.001 && vShoreY < 1.5) {
  float shoreW = min(vShoreWet, 0.9);
  vec3 shoreLand = max((vColor.rgb - shoreW*vec3(26.0/255.0,59.0/255.0,105.0/255.0))/(1.0-shoreW), vec3(0.0));
  diffuseColor.rgb *= shoreLand/max(vColor.rgb, vec3(0.004));
}
#endif` : ''}
${polish && terrain ? `float urbanTileIn=vUrbanTile; float urbanPlaza=0.0;
// Authored plazas (gtasf-7moo): mapped lawn inside a plaza rectangle becomes civic granite paving.
for(int i=0;i<${MAX_PLAZAS};i++){ if(float(i)>=uPlazaCount) break; vec4 r=uPlazas[i];
  // Mapped lawn (tile>6.5)${flags.unionSquarePlazaLow ? ' OR unclassified ground (tile<-0.5: Union Square\'s lawn is baked with a non-park green that never classifies as tile 7, so the >6.5 gate alone left it green)' : ''} inside the rect becomes granite. Civic paving/roads (tiles 0-6) stay.
  if((urbanTileIn>6.5${flags.unionSquarePlazaLow ? ' || urbanTileIn<-0.5' : ''}) && vUrbanMetres.x>r.x && vUrbanMetres.x<r.z && vUrbanMetres.y>r.y && vUrbanMetres.y<r.w) { urbanTileIn=1.0; urbanPlaza=1.0; } }
if(urbanTileIn>6.5) {
  // Lawns and dry hillside: mottled, mown and patchy instead of one flat colour (no texture fetch).
  vec2 m=vUrbanMetres; float near=1.0-smoothstep(25.0,${low ? '90.0' : '140.0'},length(m-cameraPosition.xz));
  float large=lawnNoise(m/11.0), mid=lawnNoise(m/2.7), fine=lawnNoise(m*2.1);
${flags.richParkGreens ? `  if(urbanTileIn<7.5) {
    // richParkGreens: parks read as varied landscaping, not one vivid flat green. Three desaturated greens
    // (mown lawn / drier yellow-green / shrub-hedge beds) selected by the SAME three noises already fetched above,
    // plus a soft mowing stripe. Dry hillside (tile 8) keeps its own path below.
    vec3 pMid=vec3(0.22,0.33,0.15), pDry=vec3(0.36,0.42,0.19), pShrub=vec3(0.13,0.22,0.10);
    vec3 park=mix(pMid,pDry,smoothstep(0.46,0.82,large));
    park=mix(park,pShrub,smoothstep(0.40,0.24,mid)*0.70);
    float pStripe=step(0.5,fract(m.y/5.0));
    park*=1.0+(fine-0.5)*0.18*near+(pStripe-0.5)*0.06*near;
    diffuseColor.rgb=park;
  } else {` : ''}
  vec3 lawn=diffuseColor.rgb*(0.80+0.34*large)*(0.92+0.14*mid);
  lawn=mix(lawn,lawn*vec3(1.16,1.08,0.74),smoothstep(0.62,0.92,large)*(urbanTileIn>7.5?0.75:0.45));
  float stripe=step(0.5,fract(m.y/5.0));
  lawn*=1.0+(fine-0.5)*0.22*near+(urbanTileIn<7.5?(stripe-0.5)*0.07*near:0.0);
  diffuseColor.rgb=lawn;
${flags.richParkGreens ? '  }' : ''}
}
${districtParkGreensGlsl(low)}` : 'float urbanTileIn=vUrbanTile;'}
if(uUrbanReady>0.5 && urbanTileIn>=-0.01 && urbanTileIn<6.5) {
  float tile=floor(urbanTileIn+0.5);
  ${polish && terrain ? 'if(tile<5.5) {' : ''}
  vec3 surface=urbanSample(tile,vUrbanMetres,tile==2.0 || tile==3.0 ? 5.0 : 3.0);
  // Industrial ground gets a little aggregate wear, without inventing parking markings or geometry.
  if(tile==3.0) surface=mix(surface,urbanSample(4.0,vUrbanMetres,2.0),0.12);
  float detail=1.0-smoothstep(${low ? '55.0,105.0' : '90.0,170.0'},length(vUrbanMetres-cameraPosition.xz));
  diffuseColor.rgb=mix(diffuseColor.rgb,surface,detail);
  ${polish ? `if(tile==0.0 || tile==1.0 || tile==5.0) {
    // Moscone (including 37.7840,-122.4010) and FiDi are civic paving, not SoMa's
    // industrial palette. Ferry's authored plaza also selects tile 1. Use the
    // atlas only for subdued grain/joints, never its cool grey base albedo.
    vec3 pavingBase=vec3(0.72,0.66,0.55);
    float grain=clamp((dot(surface,vec3(0.2126,0.7152,0.0722))-0.35)*0.20,-0.05,0.05);
    float pavingDetail=1.0-smoothstep(${low ? '18.0,65.0' : '25.0,85.0'},length(vUrbanMetres-cameraPosition.xz));
    diffuseColor.rgb=pavingBase+vec3(grain*pavingDetail);
${flags.civicPaving && terrain && !ferry ? `    // civicPaving: the broad civic concrete (SoMa/Moscone/FiDi sidewalks and downtown plazas) is a flat tan sheet
    // -- only the Ferry plaza had authored pavers. Score it into ~2 m slabs carried by per-slab TONE (the paving
    // read, like ferryPlazaPaving), with hairline fwidth-AA joints that are barely darker and gone by ~24 m so no
    // dark net forms at distance. Skips the authored granite plazas (urbanPlaza, handled below). One hash + a
    // couple of mixes, no texture fetch.
    if(urbanPlaza<0.5) {
      vec2 cpW=vUrbanMetres; float cpDist=length(cpW-cameraPosition.xz);
      float cpNear=1.0-smoothstep(${low ? '20.0,72.0' : '28.0,96.0'},cpDist);
      vec2 cpG=cpW/2.0, cpF=fract(cpG); float cpAA=fwidth(cpG.x)+fwidth(cpG.y);
      float cpJoint=(1.0-smoothstep(0.0,0.02+cpAA,min(min(cpF.x,1.0-cpF.x),min(cpF.y,1.0-cpF.y))))*(1.0-smoothstep(12.0,24.0,cpDist));
      float cpTone=fract(sin(dot(floor(cpG),vec2(127.1,311.7)))*43758.5453)*0.12-0.06;
      vec3 cpPaved=diffuseColor.rgb*(1.0+cpTone*cpNear);
      cpPaved=mix(cpPaved,cpPaved*0.90,cpJoint);
      diffuseColor.rgb=mix(diffuseColor.rgb,cpPaved,cpNear);
    }
` : ''}
${resGreens ? `    // residentialBlockGreens: inside residential blocks the back/front-yard ground reads as varied lawn/garden
    // green instead of tan paving. The carriageway and backyards are the SAME tile-0 terrain surface here (residential
    // streets have no separate asphalt mesh), so a per-chunk road-distance mask gates the green: only ground that is
    // (a) residential urban-ground (vResGround, the district vertex colour) AND (b) past the carriageway+sidewalk
    // (roadDist above the threshold) goes green. Streets and sidewalks stay grey. Civic paving (tile 1/5) is untouched.
    if (vResGround > 0.5) {
      float roadDist=texture2D(uUrbanRoadMask,(vUrbanMetres-uUrbanRoadOrigin)/256.0).r;
      float interior=smoothstep(0.30,0.52,roadDist); // ~11 m -> ~19 m from the road centreline, soft edge
      if (interior > 0.0) {
        vec2 gm=vUrbanMetres;
        // Mottled lawn/garden, not one flat tone, at garden scale (~4-7 m blocks, not high-frequency fuzz).
        // Three LOW-frequency noises -- the SAME count as the flat-green baseline, so no added shader cost --
        // select three greens (mown lawn / drier yellower grass / dark shrub-hedge) plus sparse warm patio
        // patches where the two garden noises coincide; all reuse these three fetches, no extra noise/hash.
        float gPatch=lawnNoise(gm/7.0), gBed=lawnNoise(gm/4.2), gFine=lawnNoise(gm*1.7);
        vec3 lawnMid=vec3(0.24,0.34,0.15), lawnLight=vec3(0.39,0.44,0.19), shrub=vec3(0.14,0.23,0.10);
        vec3 green=mix(lawnMid, lawnLight, smoothstep(0.50,0.82,gPatch));   // lighter/yellower dry-lawn patches
        green=mix(green, shrub, smoothstep(0.42,0.26,gBed)*0.80);           // darker shrub/hedge beds (low gBed)
        // Bare patio/path/dirt: soft warm-tan patches where both garden noises run high (a minority of area,
        // soft-edged via smoothstep) so they read as yard features, not a grid -- reuses gPatch/gBed/gFine.
        float patio=smoothstep(0.72,0.93, gPatch*gBed + (gFine-0.5)*0.12);
        green=mix(green, vec3(0.50,0.47,0.40), patio*0.55);
        float gNear=1.0-smoothstep(25.0,${low ? '90.0' : '150.0'},length(gm-cameraPosition.xz));
        green*=1.0+(gFine-0.5)*0.16*gNear;
        diffuseColor.rgb=mix(diffuseColor.rgb,green,interior);
      }
    }
` : ''}${ferry && flags.ferryPlazaPaving ? `    // ferryPlazaPaving (gap #2): authored Embarcadero plaza — ~1.5 m stone pavers carried by per-paver tone (the
    // joints are hairline + barely darker + gone by ~20 m, so no dark net), warm brick-band rows, grid aligned to
    // the Ferry Building, fwidth anti-aliased and faded past ~28 m. Ferry surface only.
    vec2 fpW=vUrbanMetres; float fpDist=length(fpW-cameraPosition.xz);
    float fpNear=1.0-smoothstep(6.0,28.0,fpDist);
    // Align the paver grid to the Ferry Building (~53.76 deg) so courses run with the plaza, not diagonally.
    vec2 fpM=mat2(0.5918,-0.8061,0.8061,0.5918)*fpW;
    vec2 fpG=fpM/1.5, fpF=fract(fpG); float fpAA=fwidth(fpG.x)+fwidth(fpG.y);
    // Hairline joints (~2 cm), anti-aliased, barely darker than the stone and gone by ~20 m: the per-paver TONE
    // carries the paving read, not a grid, so it never reads as a dark net across the plaza.
    float fpJoint=(1.0-smoothstep(0.0,0.014+fpAA,min(min(fpF.x,1.0-fpF.x),min(fpF.y,1.0-fpF.y))))*(1.0-smoothstep(10.0,20.0,fpDist));
    float fpTone=fract(sin(dot(floor(fpG),vec2(127.1,311.7)))*43758.5453)*0.14-0.07;
    float fpBand=step(0.5,fract(fpM.y/5.6));
    vec3 fpPaver=diffuseColor.rgb*(1.0+fpTone); fpPaver=mix(fpPaver,fpPaver*vec3(1.03,0.99,0.92),fpBand*0.28);
    fpPaver=mix(fpPaver,fpPaver*0.93,fpJoint);
    diffuseColor.rgb=mix(diffuseColor.rgb,fpPaver,fpNear);
${flags.ferryPlazaSetts ? `    // ferryPlazaSetts (critique #4): the hairline pavers above fade out by ~28 m, so the plaza still read as one flat
    // beige deck. Add a second, coarser course that stays to ~90 m: 3 x 1.5 m granite slabs (stagger every other row)
    // with soft fwidth-AA joints at ~0.86 (a joint read, never a dark net), per-slab tone, and broad grime/wear patches
    // (6 m and 17 m value noise) that never fade, so the far plaza is not one flat sheet either.
    vec2 fsG=vec2(fpM.x/3.0+0.5*floor(fpM.y/1.5), fpM.y/1.5), fsF=fract(fsG); float fsAA=fwidth(fsG.x)+fwidth(fsG.y);
    float fsJoint=(1.0-smoothstep(0.0,0.02+fsAA*1.5,min(min(fsF.x,1.0-fsF.x),min(fsF.y,1.0-fsF.y))))*(1.0-smoothstep(45.0,90.0,fpDist));
    float fsTone=fract(sin(dot(floor(fsG),vec2(269.5,183.3)))*43758.5453)*0.10-0.05;
    vec2 fsN=fpW/6.0, fsI=floor(fsN), fsU=fract(fsN); fsU=fsU*fsU*(3.0-2.0*fsU);
    #define FSH(v) fract(sin(dot(v,vec2(127.1,311.7)))*43758.5453)
    float fsGrime=mix(mix(FSH(fsI),FSH(fsI+vec2(1.0,0.0)),fsU.x),mix(FSH(fsI+vec2(0.0,1.0)),FSH(fsI+1.0),fsU.x),fsU.y);
    vec2 fsN2=fpW/17.0, fsI2=floor(fsN2), fsU2=fract(fsN2); fsU2=fsU2*fsU2*(3.0-2.0*fsU2);
    float fsWear=mix(mix(FSH(fsI2),FSH(fsI2+vec2(1.0,0.0)),fsU2.x),mix(FSH(fsI2+vec2(0.0,1.0)),FSH(fsI2+1.0),fsU2.x),fsU2.y);
    #undef FSH
    diffuseColor.rgb*=(1.0+fsTone*(1.0-smoothstep(30.0,90.0,fpDist)))*(0.90+0.10*fsGrime)*(0.93+0.11*fsWear);
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*0.86,fsJoint);
` : ''}` : ''}  }` : ''}
  ${polish && terrain ? '}' : ''}
  ${polish && terrain ? `if(tile==6.0) {
    // Linear-light concrete/sandstone; keep the far surface warm instead of returning
    // to the baked blue-grey industrial palette. Roads and parks never enter this branch.
    vec3 concrete=vec3(0.52,0.48,0.40);
    float paving=texture2D(uUrbanFrontages,(vUrbanMetres-uUrbanOrigin)/256.0).r;
    vec3 slab=mix(concrete,urbanSample(0.0,vUrbanMetres,3.0)*vec3(1.02,1.0,0.95),0.55);
    vec3 pavers=mix(vec3(0.44,0.38,0.29),urbanSample(1.0,vUrbanMetres,3.0)*vec3(1.20,1.10,0.92),0.52);
    float pattern=1.0-smoothstep(${low ? '18.0,65.0' : '25.0,85.0'},length(vUrbanMetres-cameraPosition.xz));
    diffuseColor.rgb=mix(concrete,mix(slab,pavers,paving),pattern);
  }` : ''}
}`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${polish && terrain ? `if(urbanTileIn>=-0.01 && urbanTileIn<6.5 && urbanPlaza<0.5) {
  // Distant urban ground: block-scale tone breakup where the near textures have faded (hillsides like the Castro).
  float far=smoothstep(80.0,200.0,length(vUrbanMetres-cameraPosition.xz));
  float macro=lawnNoise(vUrbanMetres/38.0)*0.6+lawnNoise(vUrbanMetres/9.0)*0.4;
  diffuseColor.rgb*=mix(1.0,0.84+0.30*macro,far);
${flags.hillsideScrub ? `  // Steep unbuilt urban slopes (Corona Heights, Twin Peaks flanks) read as dry grass and scrub, not grey lots.
  float urbanUp=dot(normalize(normal),normalize((viewMatrix*vec4(0.0,1.0,0.0,0.0)).xyz));
  // Starts at ~10 deg, full by ~21 deg: the visible Corona Heights flank is gentler than the old 28 deg gate.
  float hillside=1.0-smoothstep(0.93,0.985,urbanUp);
  if(hillside>0.0) {
    // Golden dry grass with dark green scrub clumps at two scales, contrasty enough to read from the street.
    float patches=lawnNoise(vUrbanMetres/25.0), clumps=lawnNoise(vUrbanMetres/6.0), tuft=lawnNoise(vUrbanMetres/1.7);
    vec3 grass=mix(vec3(0.50,0.42,0.22),vec3(0.38,0.36,0.18),patches)*(0.86+0.28*tuft);
    float shrub=smoothstep(0.52,0.70,clumps*0.65+patches*0.35);
    vec3 dry=mix(grass,vec3(0.13,0.19,0.08)*(0.8+0.4*tuft),shrub);
    diffuseColor.rgb=mix(diffuseColor.rgb,dry,hillside);
  }` : ''}
}
if(urbanPlaza>0.5) {
  // Union Square granite: 1.5 m slabs with dark joints, per-slab tone and a darker radial band.
  vec2 m=vUrbanMetres; vec2 slab=floor(m/1.5); vec2 f=fract(m/1.5);
  float joint=1.0-smoothstep(0.0,0.035,min(min(f.x,1.0-f.x),min(f.y,1.0-f.y)));
  float tone=lawnHash(slab)*0.10-0.05;
  vec3 granite=vec3(0.62,0.60,0.56)+tone+(lawnNoise(m*1.7)-0.5)*0.05;
  float bandMask=step(0.5,fract((abs(m.x-(uPlazas[0].x+uPlazas[0].z)*0.5)+abs(m.y-(uPlazas[0].y+uPlazas[0].w)*0.5))/9.0));
  granite*=mix(1.0,0.86,bandMask);
  float near=1.0-smoothstep(30.0,120.0,length(m-cameraPosition.xz));
  diffuseColor.rgb=mix(granite,granite*0.62,joint*near);
}` : ''}
${contactAO ? `// groundContactAO (look-gap item 5): soft contact shadow / ambient occlusion where the ground meets a
// building base. The per-chunk mask stores distance-to-nearest-footprint-edge (~0 at the wall, 1 past ~6 m);
// darken the diffuse albedo close to the wall so buildings read as grounded with occlusion in the street
// canyon instead of floating on flat-lit ground. One texture fetch + a smoothstep; runs on HD and Low.
float buildDist=texture2D(uUrbanBuildingMask,(vUrbanMetres-uUrbanBuildingOrigin)/256.0).r;
// Concentrate the darkening in the first ~70% of the band so it reads as a contact shadow hugging the wall
// (darkest at the base, gone by ~9 m) rather than a broad, flat dimming of the whole street.
diffuseColor.rgb*=mix(0.42,1.0,smoothstep(0.0,0.72,buildDist));` : ''}
${flags.legibleLowRoads && low && roads ? `
// legibleLowRoads: Low has no IBL and no tonemapping, so the dark asphalt albedo renders the near carriageway
// near-black -- a jagged dark slab against the lighter sidewalks, much darker than the aerialRoadRead-greyed
// distant road. Floor the road albedo to a legible asphalt grey at all distances (mirrors aerialRoadRead's
// max(color, ~0.30)); only lifts pixels darker than the floor, so lane paint and lighter wear stay. HD is
// untouched (stays dark via PBR + IBL). [gtasf-hkka]
diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.30, 0.29, 0.27));` : ''}
${flags.warmGroundGrade && roads ? `
// warmGroundGrade (teleoperator look #2): the carriageway reads cool-grey-flat against the warm sidewalks and
// buildings (on Low it has no warm bounce at all — that is polish/HD-only below). Nudge the road albedo toward a
// warm asphalt tone, scaled by how warm the sun is, so night/overcast stay neutral. Road materials only; off is
// byte-identical. Compounds gently with the HD warm bounce; the main gain is the untreated Low carriageway.
#if NUM_DIR_LIGHTS > 0
float roadWarm=clamp((directionalLights[0].color.r-directionalLights[0].color.b)*0.6,0.0,0.6);
diffuseColor.rgb*=mix(vec3(1.0),vec3(1.08,1.0,0.89),roadWarm);
#endif` : ''}`)
            .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
${polish ? `#if NUM_DIR_LIGHTS > 0
float pavingTile=floor(urbanTileIn+0.5);
if(urbanTileIn>=-0.01 && (pavingTile==0.0 || pavingTile==1.0 || pavingTile==5.0 || pavingTile==6.0)) {
  // Golden-hour sky fill is deliberately blue. On light paving, soften that cast
  // toward warm bounced light without lifting shadows or adding emissive light.
  // The sun's red/blue balance disables this correction under the blue night light.
  float warmBounce=clamp((directionalLights[0].color.r-directionalLights[0].color.b)*0.55,0.0,0.72);
  vec3 bounce=reflectedLight.indirectDiffuse/max(diffuseColor.rgb,vec3(0.001));
  float bounceLight=dot(bounce,vec3(0.2126,0.7152,0.0722));
  reflectedLight.indirectDiffuse=mix(reflectedLight.indirectDiffuse,diffuseColor.rgb*bounceLight*vec3(1.04,1.0,0.94),warmBounce);
}
#endif` : ''}${wetFx ? `
if (uWet > 0.0001) {
  // Wet ground (#5): darken the lit surface and add a grazing-angle sky-coloured sheen as a fake reflection
  // (no env/IBL on the ps2 path). vUrbanMetres is world xz; roads sit near y=0, so the camera-height / distance
  // ratio approximates the view grazing angle — strongest down the street, fading right under the camera.
  float wetDist = length(cameraPosition.xz - vUrbanMetres);
  float wetNdotV = cameraPosition.y / sqrt(cameraPosition.y * cameraPosition.y + wetDist * wetDist + 0.01);
  float wetFres = pow(1.0 - clamp(wetNdotV, 0.0, 1.0), 2.2);
  reflectedLight.indirectDiffuse *= mix(1.0, 0.58, uWet);
  reflectedLight.directDiffuse *= mix(1.0, 0.58, uWet);
  reflectedLight.indirectDiffuse += uSkyColour * (uWet * wetFres * 0.95);
}` : ''}`);
        };
        if (asphaltPbr) {
          const urbanCompile = material.onBeforeCompile;
          material.onBeforeCompile = (shader, renderer) => {
            urbanCompile.call(material, shader, renderer);
            shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vAsphaltWorldNormal;')
              .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvAsphaltWorldNormal=inverseTransformDirection(transformedNormal,viewMatrix);');
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vAsphaltWorldNormal; uniform float uAsphaltReady;
uniform sampler2D uAsphaltAlbedo; uniform sampler2D uAsphaltNormal; uniform sampler2D uAsphaltRough;`)
              .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float asphaltWeight=uAsphaltReady*step(1.5,vUrbanTile)*(1.0-step(2.5,vUrbanTile))*(1.0-smoothstep(60.0,150.0,length(vUrbanMetres-cameraPosition.xz)));
vec2 asphaltUv=vUrbanMetres/3.0;
if(asphaltWeight>0.0){
  // gtasf-road-smooth: read as smooth, slightly worn MID-GREY asphalt, not dark gravel. Desaturate the
  // aggregate, compress its bright/dark contrast toward the mean, then lift the whole surface to mid grey.
  vec3 asphaltAlb=texture2D(uAsphaltAlbedo,asphaltUv).rgb;
  float asphaltLum=dot(asphaltAlb,vec3(0.299,0.587,0.114));
  asphaltAlb=mix(vec3(asphaltLum),asphaltAlb,0.4);          // de-speckle the aggregate colour
  asphaltAlb=mix(vec3(0.16),asphaltAlb,0.5)+0.065;          // compress value contrast + lift to mid grey
  diffuseColor.rgb=mix(diffuseColor.rgb,asphaltAlb,asphaltWeight);
  roughnessFactor=mix(roughnessFactor,max(0.82,texture2D(uAsphaltRough,asphaltUv).r),asphaltWeight);
}`)
              .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if(asphaltWeight>0.0){
  vec3 n=normalize(vAsphaltWorldNormal);
  vec3 t=normalize(vec3(1.0,0.0,0.0)-n*n.x);
  vec3 b=-normalize(cross(n,t));
  vec3 detail=texture2D(uAsphaltNormal,asphaltUv).xyz*2.0-1.0;
  // gtasf-road-smooth: the asphalt normal at noon read as dark lumpy rubble (the sun lit every bump).
  // Drop the bump almost entirely, and fade what little remains out by ~55 m so only the very near road
  // has any tooth at all; the rest reads as flat worn asphalt.
  detail.xy*=0.07;
  float asphaltNear=1.0-smoothstep(15.0,55.0,length(vUrbanMetres-cameraPosition.xz));
  vec3 mapped=normalize(mat3(viewMatrix)*(t*detail.x+b*detail.y+n*detail.z));
  normal=normalize(mix(normal,mapped,asphaltWeight*asphaltNear));
}`);
          };
        }
        if (pavingPbr) addSurfacePavers(material, false);
        material.needsUpdate = true; converted.set(source, material); stats.materials++; return material;
      }
      changes.push({ mesh: object, before: object.material });
      object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
    });
    let released = false;
    const release = () => {
      if (released) return; released = true;
      for (const { mesh, before } of changes) mesh.material = before;
      for (const material of converted.values()) { material.dispose(); stats.materials--; }
      frontages?.texture.dispose();
      roadMask?.texture.dispose();
      contactMask?.texture.dispose();
      mounts.delete(release);
    };
    mounts.add(release); return release;
  }
  return { ready, stats, uniforms, mount,
    dispose() {
      if (disposed) return; disposed = true; abort.abort(); asphalt?.release();
      for (const release of mounts) release();
      clearAtlas();
      stats.state = 'disposed';
    },
  };
}
