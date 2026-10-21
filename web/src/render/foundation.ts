import {
  Color, DirectionalLight, Fog, PCFSoftShadowMap, HemisphereLight, Material, Mesh, MeshLambertMaterial,
  LinearMipmapLinearFilter, LinearMipmapNearestFilter,
  ACESFilmicToneMapping, NoToneMapping, Scene, SRGBColorSpace, TextureLoader, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget,
  PerspectiveCamera, type Object3D, type Texture,
} from 'three';
import { createLowDetailCull } from './lowDetailCull';
import { flags } from '@gtasf/shared/flags';
import { enableLinearColorManagement } from './colorManagement';
import { drawingSize } from './sizing';
import type { QualityTier } from './qualityTier';
import { createSky, SKY_COLOURS } from './sky';
import { createPost } from './post';
import { addBuildingFacades } from './facades';
import { createFacadeAtlas, createFacadeGround, type FacadeAtlas, type FacadeGround } from './facadeAtlas';
import { createRealisticFacadeAtlas } from './realisticFacadeAtlas';
import { liveNightFloorTime, sampleTimeGrade, type TimeGrade } from './timeGrade';
import { clockOverride } from './timeOverride';
import { graphicsPreset, type GraphicsPreset } from './graphicsPreset';
import { sfLookEnabled } from './sky/grade';
import { configureRealisticRenderer, configureSunShadows, realisticFog, loadRealisticEnvironment } from './realistic';
import { createRealisticPost } from './realisticPost';
import { applyRealisticMaterials } from './realisticMaterials';
import { createRenderDebug, wantsRenderDebug } from './renderDebug';
import { addRoadTextures, createRoadTextures, type RoadTextures } from './roadTextures';
import { repairLegacyUrbanGround } from './urbanGround';
import { createUrbanSurfaces } from './urbanSurfaces';
import { createBlockCanopy } from './blockCanopy';
import { createShopfrontSigns } from './shopfrontSigns';
import { createBuildingDetail } from './buildingDetail';
import { createFrontFacadeMapping } from './frontFacadeMapping';
import { createFacadeStorefronts } from './props/facadeStorefronts';
import { createMayhemEffects } from './mayhem';
import { addNightRoadLight, createNightLights } from './nightLights';
import { characterNight } from './characterNight';
import { createLampLightMap } from './lampLightMap';
import { createVehicleLamps } from './vehicleLamps';
import { createWeatherFeed } from './weather/feed';
import { createWeatherGrade } from './weather/grade';
import { createFogBank } from './weather/fogBank';
import { createRain } from './weather/rain';
import { loadAtmosphereSky, type AtmosphereSky } from './sky/atmosphereSky';
import { applySolarPosition } from './weather/solar';
import { addFoliageCameraFade, addFoliageCanopyHide } from './props/foliageFade';
import { createWaterMirror } from './waterMirror';
import { createBayWater } from './bayWater';
import { createGpuBirds } from './gpuBirds';

export const HAZE = Object.freeze({ near: 100, far: 700 });

/** Preserve glTF linear COLOR_0, material factors and textures; never gamma-decode vertex colours. */
export function prepareWorldGeometry(root: Object3D, atlas?: FacadeAtlas, roadTextures?: RoadTextures, night?: { value: number }): () => void {
  const restoreGround = repairLegacyUrbanGround(root);
  const low = root.userData.gtasfLowDetail === true;
  const changed: { mesh: Mesh; material: Material | Material[] }[] = [];
  const variants = [new Map<Material, MeshLambertMaterial>(), new Map<Material, MeshLambertMaterial>()];
  let ground: FacadeGround | undefined;
  // Graphics v2 item 2: this chunk's NAIP aerial (when the bake attached one), sampled by the building shader
  // for real roof colours and the distant-wall tone. Uniforms exist (not ready) even without an aerial.
  const aerialInfo = root.userData.gtasfAerial as { url: string; bounds: [number, number, number, number] } | undefined;
  const aerial = { uAerial: { value: null as Texture | null }, uAerialReady: { value: 0 },
    uAerialBounds: { value: new Vector4(...(aerialInfo?.bounds ?? [0, 0, 1, 1])) } };
  let aerialReleased = false;
  if (flags.graphicsV2 && aerialInfo) new TextureLoader().load(aerialInfo.url, texture => {
    if (aerialReleased) { texture.dispose(); return; }
    texture.colorSpace = SRGBColorSpace; aerial.uAerial.value = texture; aerial.uAerialReady.value = 1;
  }, undefined, () => { /* No aerial: keep the atlas tone. */ });
  root.traverse(object => {
    if (!(object instanceof Mesh) || object.userData.gtasfBillboard || object.userData.gtasfStreetWire || object.userData.gtasfBuildingDetail) return;
    const colours = Boolean(object.geometry.getAttribute('color'));
    const table = variants[colours ? 1 : 0]!;
    function convert(source: Material): Material {
      // Signal lenses and authored luminous labels must stay unlit on the SA path,
      // and retain their opt-out marker for the subsequent realistic-material pass.
      if (source.userData.gtasfUnlit === true) return source;
      let material = table.get(source);
      if (material) return material;
      const input = source as Material & { color?: Color; map?: Texture | null; alphaMap?: Texture | null };
      material = new MeshLambertMaterial({
        name: `GTASF ${source.name || 'world'}`, color: input.color ?? new Color('white'),
        map: input.map ?? null, alphaMap: input.alphaMap ?? null,
        vertexColors: colours, flatShading: true, fog: true,
        side: source.side, transparent: source.transparent, opacity: source.opacity,
        alphaTest: source.alphaTest, depthWrite: source.depthWrite,
        alphaToCoverage: flags.graphicsV2 && source.alphaToCoverage,
      });
      if (flags.buildingFacades && source.name === 'buildings' && !input.map) {
        // Procedural mode keeps the per-chunk ground DataTexture (street height / storefront) but no atlas,
        // and needs the night uniform wired directly (the atlas path carries its own uFacadeNight).
        if (atlas || flags.proceduralFacades) ground ??= createFacadeGround(root.userData.gtasfFacadeGround);
        addBuildingFacades(material, atlas, ground, low, aerial, night);
      }
      if (roadTextures && source.name === 'roads' && !input.map) addRoadTextures(material, roadTextures, low);
      if (night && source.name === 'roads') addNightRoadLight(material, night);
      if (source.userData.gtasfFoliageCameraFade) addFoliageCameraFade(material);
      if (source.userData.gtasfFoliageCanopyHide) addFoliageCanopyHide(material, source.userData.gtasfFoliageCanopyHide); // critic R1
      table.set(source, material);
      return material;
    }
    changed.push({ mesh: object, material: object.material });
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const entry of changed) entry.mesh.material = entry.material;
    for (const table of variants) for (const material of table.values()) material.dispose();
    aerialReleased = true; aerial.uAerial.value?.dispose();
    ground?.dispose(); restoreGround();
  };
}

/** Scene setup is independent of WebGL so imported GLB transforms/colours can be checked directly. */
/** Graphics v2 fog targets (linear, via Color's sRGB hex conversion). */
/** HD water (gtasf-lxll) OFF: preview 2bc907c lost the Ferry chunk on HD (tan ground, no building). No water
 *  overlay or mirror runs on HD until that is root-caused; Low keeps its rippled water. */
const HD_WATER_MIRROR = false;
/** gtasf-r9f6: warm daylight haze the distance fades into (soft golden, not orange). */
const SF_LOOK_HAZE = new Color('#e9cfa6');
const sfLookOn = sfLookEnabled();
/** Street-level fog distances from the current grade, before the SF-look height scaling. */
const hazeBase = { near: 0, far: 0 };
// stormHaze: rain/fog storm slate (horizon/haze) and its deeper zenith, so a storm reads dark grey, not washed white.
const STORM_SLATE = new Color('#6a7580'), STORM_ZENITH = new Color('#505a66');
// rainOvercast: cool neutral post tint and blue-grey haze under rain.
const RAIN_TINT = new Vector3(0.95, 0.98, 1.03), RAIN_HAZE = new Color('#8a96a3');
// nightWarmth (critic #15): a dusky sodium-tinted night haze, so distant blocks fade into light pollution, not navy.
const V2_NIGHT_HAZE = new Color(flags.nightWarmth ? '#221d2b' : '#0c1a33'), V2_DAWN_HAZE = new Color('#e7b9b4'), V2_DUSK_FILL = new Color('#cdbba8'), V2_PROBE = new Color(), V2_PROBE_RAW = new Color();
const WARM_FILL = new Color('#ffbe7a'); // warm bounce tone for the anti-sun shadow fill (flags.warmShadowFill)

export function createCityScene(enabled: boolean, tier: QualityTier = 'medium') {
  const scene = new Scene();
  // gtasf-dr19: the scene sits at the origin and never moves, so freezing its local matrix stops the
  // per-frame force-cascade that otherwise re-multiplies every static chunk/scenery node (freezeSceneMatrix).
  if (flags.freezeSceneMatrix) scene.matrixAutoUpdate = false;
  scene.background = new Color(SKY_COLOURS.horizon);
  const haze = new Fog(SKY_COLOURS.horizon, HAZE.near, HAZE.far);
  scene.fog = enabled ? haze : null;
  // aerialFarHaze: shared uniform the far-LOD materials fade toward (the current haze colour, updated per frame by
  // the render loop). One object referenced by every far material so a single copy() updates them all.
  const farHaze = { color: { value: new Color(SKY_COLOURS.horizon) } };
  const sky = enabled ? createSky(tier === 'low') : undefined;
  // proceduralFacades (gtasf-l857) replaces the whole-wall atlas with a procedural shader, so the atlas
  // image is not created/fetched; the building meshes still get addBuildingFacades (procedural branch).
  const facadeAtlas = enabled && flags.buildingFacades && !flags.proceduralFacades ? createFacadeAtlas() : undefined;
  const shopfrontSigns = enabled && flags.buildingFacades ? createShopfrontSigns() : undefined;
  const roadTextures = enabled ? createRoadTextures() : undefined;
  const nightLights = enabled && flags.nightLighting ? createNightLights() : undefined;
  // chunkCompileAsync: the render foundation sets this, so a facade rebuild (atlas page arrived) warms its new programs too.
  let warmFacades: ((root: Object3D) => void) | undefined, holdFacades: ((group: Object3D) => Promise<unknown> | undefined) | undefined;
  const frontFacades = enabled ? createFrontFacadeMapping({ low: tier === 'low', night: facadeAtlas?.uniforms.uFacadeNight,
    onRebuilt: root => warmFacades?.(root), hold: group => holdFacades?.(group) }) : undefined;
  const buildingDetail = enabled && flags.buildingDetail ? createBuildingDetail({ night: facadeAtlas?.uniforms.uFacadeNight }) : undefined;
  // Meshy ground-floor storefronts (flag OFF by default -> undefined -> every call below is a no-op).
  // HD only, like buildingDetail's hero pieces: constructing this starts the GLB downloads, and on phones (Low) they
  // pushed the first load to 15.31 MB, over the 15 MB budget (1.2 load check, Oct 7).
  const storefronts = enabled && flags.storefrontPieces && tier !== 'low' && graphicsPreset() === 'hd' ? createFacadeStorefronts() : undefined;
  const mayhem = enabled && 'playfulMayhem' in flags && flags.playfulMayhem ? createMayhemEffects(scene, { low: tier === 'low' }) : undefined;
  if (sky) scene.add(sky.mesh);
  const ambient = new HemisphereLight('#e5eff3', '#73695c', 1.4);
  const sun = new DirectionalLight('#ffe6b9', 1.5);
  sun.position.set(-100, 140, 50);
  scene.add(ambient, sun);
  // Warm shadow fill (flags.warmShadowFill): a dim warm key from opposite the sun, aimed + scaled each frame in the
  // grade block to lift the shadowed faces the graphicsV2 low-sun ambient cut crushes. Created only when the flag is
  // on, so OFF adds no light to the scene (byte-identical). No shadow casting (it is a fill, not a key).
  const fill = flags.warmShadowFill ? new DirectionalLight('#ffbe7a', 0) : undefined;
  if (fill) { fill.name = 'Warm shadow fill'; scene.add(fill); }
  const mounts = new Set<() => void>();
  return {
    /** chunkCompileAsync: how the render foundation warms a rebuilt chunk's facade programs. */
    setWarm(warm: (root: Object3D) => void, hold?: (group: Object3D) => Promise<unknown> | undefined) { warmFacades = warm; holdFacades = hold; },
    scene, haze, farHaze, sky, sun, ambient, fill, facadeAtlas, roadTextures, shopfrontSigns, nightLights, buildingDetail, storefronts, mayhem,
    /** Takes scene membership, borrows source geometry/materials/textures until unmount. */
    /** Cheap far-LOD mount for the aerial mid-ground ring (aerialFarChunks). Flat fog-lit Lambert that keeps the
     *  per-building vertex colour (land-use tone) and any baked texture, but NOT the procedural facade window
     *  shader — at 1-4 km that shader aliases into speckle shimmer, so a flat per-building tone reads cleaner and
     *  is cheaper. No front facades / signs / lights / detail / storefronts / shadows / water. */
    mountFar(root: Object3D): () => void {
      if (root.parent) throw new Error('Geometry must be detached before mounting');
      const changed: { mesh: Mesh; material: Material | Material[] }[] = [];
      const created = new Set<Material>();
      const convert = (mesh: Mesh, source: Material): Material => {
        const input = source as Material & { color?: Color; map?: Texture | null; alphaMap?: Texture | null };
        const material = new MeshLambertMaterial({ name: `GTASF far ${source.name || 'world'}`,
          color: input.color ?? new Color('white'), map: input.map ?? null, alphaMap: input.alphaMap ?? null,
          vertexColors: Boolean(mesh.geometry.getAttribute('color')), flatShading: true, fog: true, side: source.side,
          transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest, depthWrite: source.depthWrite });
        const wantHaze = flags.aerialFarHaze, wantFacade = flags.aerialFarFacade, wantTowerTone = flags.aerialFarTowerTone;
        if (wantHaze || wantFacade || wantTowerTone) {
          // Two optional far-LOD fragment tweaks, both keyed off view depth (vFogDepth) and applied BEFORE the scene
          // fog so fog layers its own weaker ramp on top. aerialFarFacade (first): a cheap window grid on the massing;
          // aerialFarHaze (second): fade the lit colour toward the scene haze tone. One program per flag combo.
          material.customProgramCacheKey = () => `gtasf-far-v2${wantFacade ? '-fac' : ''}${wantHaze ? '-haze' : ''}${wantTowerTone ? '-tt' : ''}`;
          material.onBeforeCompile = shader => {
            if (wantHaze) shader.uniforms.uFarHaze = farHaze.color;
            if (wantFacade || wantTowerTone) {
              // World position + object normal for the facade grid and the tower-tone height key (fog gives view depth but not world coords).
              shader.vertexShader = 'varying vec3 vFarWorld;\nvarying vec3 vFarNrm;\n' + shader.vertexShader.replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\n  vFarWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vFarNrm = normal;');
            }
            const decls = (wantHaze ? 'uniform vec3 uFarHaze;\n' : '') + ((wantFacade || wantTowerTone) ? 'varying vec3 vFarWorld;\nvarying vec3 vFarNrm;\n' : '');
            const facade = wantFacade
              // Window grid: a dark line per ~3.6 m floor and per ~6 m column, only on near-vertical faces
              // (farWall ~0 on roofs), anti-aliased with fwidth so it averages to a flat tone — not speckle — as the
              // band frequency crosses the pixel. Carried out to the far skyline (so the deep FiDi towers read as
              // windowed massing, not blank tan slabs) and faded softly into the haze past ~5 km.
              ? '  float farWall = 1.0 - smoothstep(0.35, 0.6, abs(vFarNrm.y));\n'
                + '  float farHoriz = abs(vFarNrm.x) > abs(vFarNrm.z) ? vFarWorld.z : vFarWorld.x;\n'
                + '  float farFloor = vFarWorld.y / 3.6, farColumn = farHoriz / 6.0;\n'
                + '  float farGrid = max(smoothstep(0.5 - 1.5 * fwidth(farFloor), 0.5, abs(fract(farFloor) - 0.5)),\n'
                + '    0.6 * smoothstep(0.5 - 1.5 * fwidth(farColumn), 0.5, abs(fract(farColumn) - 0.5))) * farWall;\n'
                + '  gl_FragColor.rgb *= 1.0 - 0.22 * farGrid * (1.0 - smoothstep(3500.0, 5200.0, vFogDepth));\n'
              : '';
            const haze = wantHaze
              // Reaches its 0.55 cap by ~2.3 km; starts past the inner far ring (~550 m) so the seam with the detailed
              // near chunks stays soft, like the reference skyline receding into haze.
              ? '  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFarHaze, 0.55 * smoothstep(550.0, 2300.0, vFogDepth));\n'
              : '';
            const towerTone = wantTowerTone
              // Gap 2: far-LOD towers wash to flat pale slabs against the bright sky. Deepen + cool tall massing by
              // world height (low warm rooftops below ~45 m untouched; full effect by ~140 m) so the FiDi towers read
              // as steel/glass with depth. After the fog, like the window grid, so it survives the haze to the skyline.
              ? '  float farTall = smoothstep(45.0, 140.0, vFarWorld.y);\n'
                + '  gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.58, 0.64, 0.80), 0.6 * farTall);\n'
              : '';
            // Haze grades the far colour BEFORE the scene fog; the window grid + tower tone darken AFTER the fog so
            // they survive the haze and reach the deep skyline (otherwise they wash out before they're visible).
            shader.fragmentShader = decls + shader.fragmentShader.replace('#include <fog_fragment>',
              '#ifdef USE_FOG\n' + haze + '#endif\n#include <fog_fragment>\n#ifdef USE_FOG\n' + facade + towerTone + '#endif');
          };
        }
        created.add(material); return material;
      };
      if (enabled) root.traverse(object => {
        if (!(object instanceof Mesh) || object.userData.gtasfUnlit === true) return;
        changed.push({ mesh: object, material: object.material });
        object.material = Array.isArray(object.material) ? object.material.map(source => convert(object, source)) : convert(object, object.material);
      });
      scene.add(root);
      let released = false;
      return () => {
        if (released) return; released = true;
        scene.remove(root);
        for (const entry of changed) entry.mesh.material = entry.material;
        for (const material of created) material.dispose();
      };
    },
    mountGeometry(root: Object3D): () => void {
      if (root.parent) throw new Error('Geometry must be detached before mounting');
      const restore = enabled ? prepareWorldGeometry(root, facadeAtlas, roadTextures, nightLights?.nightUniform) : () => {};
      const releaseSigns = shopfrontSigns?.mount(root);
      const releaseLights = nightLights?.mount(root);
      const releaseFronts = frontFacades?.mount(root);
      const releaseDetail = buildingDetail?.mount(root);
      const releaseStore = storefronts?.mount(root);
      scene.add(root);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        scene.remove(root); releaseSigns?.(); releaseLights?.(); releaseDetail?.(); releaseFronts?.(); releaseStore?.(); restore(); mounts.delete(release);
      };
      mounts.add(release);
      return release;
    },
    dispose(): void { for (const release of mounts) release(); sky?.dispose(); facadeAtlas?.dispose(); roadTextures?.dispose(); shopfrontSigns?.dispose(); nightLights?.dispose(); buildingDetail?.dispose(); frontFacades?.dispose(); storefronts?.dispose(); mayhem?.dispose(); },
  };
}

export function createRenderFoundation(options: {
  canvas: HTMLCanvasElement;
  enabled?: boolean;
  tier?: QualityTier;
  atmosphere?: boolean;
  /** Explicit isolated renderer options; live play uses the shared feature switches. */
  weather?: boolean;
  sun?: boolean;
  /** Injectable wall clock for isolated renderer checks; live play uses Date.now. */
  now?: () => number;
}) {
  const enabled = options.enabled ?? flags.ps2Render;
  // An explicit low drawing tier must also disable the expensive realistic passes/materials.
  const preset: GraphicsPreset = options.tier === 'low' ? 'low' : graphicsPreset();
  // realisticRender is HD-only (founder deploy #6): Low + auto-on-weak devices keep the ps2 renderer path
  // (graphicsPreset() returns 'low' for phones/coarse/weak and the ?gfx=low override). The realistic
  // renderer's ACES/shadows/PBR/HDRI passes only run at the 'hd' preset; 'low' falls through to ps2 below.
  // graphicsV2 polishes the SA (ps2) look (founder: polish SA, realistic parked), so it takes precedence over
  // realisticRender: with graphicsV2 on, HD runs the ps2 path with the v2 grade, sky, haze and shadows.
  const realistic = enabled && 'realisticRender' in flags && Boolean(flags.realisticRender) && !flags.graphicsV2 && preset === 'hd';
  // realisticLightingV2 (lane A #2): the realistic ACES + HDRI IBL + SSAO post on the LIVE graphicsV2 HD path, as a
  // hybrid — graphicsV2's scene (takram sky, water, v2 facades) still builds, but renders through the realistic
  // post instead of the ps2 post, with the grade-driven env/fog/sun keeping the time-of-day moods. HD only.
  const realisticV2 = enabled && flags.graphicsV2 && 'realisticLightingV2' in flags && Boolean(flags.realisticLightingV2) && preset === 'hd';
  // Either realistic path drives ACES/env/SSAO + the realistic post instead of the ps2 createPost.
  const realisticLit = realistic || realisticV2;
  const tier = options.tier ?? (preset === 'low' || matchMedia('(pointer: coarse)').matches ? 'low' : 'medium');
  // Pin linear colour management before any grade colour is built, so the SA
  // time-of-day sky lerp blends sRGB-hex keyframes in linear space (see colorManagement.ts).
  enableLinearColorManagement();
  const renderer = new WebGLRenderer({ canvas: options.canvas, antialias: !enabled, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  const city = createCityScene(enabled, tier);
  // chunkCompileAsync (lane D, gtasf-wsqvc follow-up): a streamed chunk's programs (the per-style facade fronts above all)
  // otherwise compile + link on its FIRST DRAW, blocking that frame (lane C's post-READY onFirstUse long tasks). Start them
  // when the chunk mounts instead, after its material patches: compileAsync links on the driver's threads
  // (KHR_parallel_shader_compile), and programs already built are a cheap cache hit. sceneCompileEarly only covers boot.
  let compileCamera: PerspectiveCamera | undefined;
  // The program key's output colour space comes from the CURRENT render target: 'srgb' on the canvas, 'srgb-linear' for any
  // render target, and frames draw the scene into the post pipeline's target. Compiling against the canvas made every warmed
  // program a throwaway (a measured key diff on one facade material showed exactly that one difference). So compile with a
  // 1x1 target bound; keys are computed synchronously inside compileAsync.
  let compileTarget: WebGLRenderTarget | undefined;
  const compileFor = (root: Object3D) => {
    // Reviewer 18:0x: in daytime the night-only street lighting may never draw in a minutes-long session, so warming it is
    // pure patch/link cost on phones. Hide it while compileAsync collects (it only gathers visible objects, synchronously);
    // at dusk those programs compile at first draw, exactly as with the flag off.
    const hidden: Object3D[] = [];
    if ((city.nightLights?.nightUniform.value ?? 0) < .05) root.traverse(o => { if (o.name === 'Night street lighting' && o.visible) { o.visible = false; hidden.push(o); } });
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(compileTarget ??= new WebGLRenderTarget(1, 1));
    try { return renderer.compileAsync(root, compileCamera ??= new PerspectiveCamera(), city.scene); }
    finally { renderer.setRenderTarget(previous); for (const o of hidden) o.visible = true; }
  };
  // Lane C's 19:1x gate: chunks mounted during boot were warmed BEFORE the first frame applied the time-of-day state (fog, the
  // night value), so their warm keys didn't match the draw (a second variant of each base material) and the daytime
  // night-lighting skip saw no night value yet. Queue warm-ups until the first frame has rendered, then run them.
  const pendingWarm: Object3D[] = [];
  const warmChunk = (root: Object3D) => {
    if (!flags.chunkCompileAsync) return;
    if (!rendered) { pendingWarm.push(root); return; }
    void compileFor(root).catch(() => {});
  };
  // chunkCompileHold: after the first frame (never at boot, where the spawn view must have its fronts), a freshly built
  // facade group stays hidden until compileAsync has linked its programs.
  let rendered = false;
  city.setWarm(warmChunk, group => flags.chunkCompileAsync && flags.chunkCompileHold && rendered
    ? compileFor(group) : undefined);
  const urbanSurfaces = enabled ? createUrbanSurfaces(preset) : undefined;
  // gtasf-cf1a: instanced backyard/block-interior canopy mass for the residential aerial leafiness gap.
  const blockCanopy = enabled && !realistic && flags.graphicsV2 && flags.blockInteriorCanopy ? createBlockCanopy(preset) : undefined;
  const lowDetailCull = tier === 'low' && flags.lowDetailCull ? createLowDetailCull(150) : undefined;
  const lampMap = enabled && flags.nightLighting ? createLampLightMap(renderer, tier === 'low') : undefined;
  // vehicleNightLamps (lane D): visible head/tail lamp glow on moving cars at night, one instanced draw.
  const vehicleLamps = enabled && flags.graphicsV2 && flags.nightLighting && flags.vehicleNightLamps ? createVehicleLamps(tier === 'low') : undefined;
  if (vehicleLamps) city.scene.add(vehicleLamps.mesh);
  // Graphics v2 phase 2 item 5: HD Bay/lake mirror; Low gets rippled sky-tinted water without a reflection pass.
  const waterMirror = enabled && !realistic && (preset !== 'hd' || HD_WATER_MIRROR) ? createWaterMirror(renderer, city.scene, { hd: HD_WATER_MIRROR && enabled && !realistic && flags.graphicsV2 && preset === 'hd' && tier !== 'low', sky: city.sky }) : undefined;
  // bayWaterRead: a distant Bay-water surface so the far (aerialFarClipWater-removed) Bay reads as water, not a
  // flat orange fog void, from the air. Below sea level so land + near water occlude it; shows only open water.
  const bayWater = enabled && !realistic ? createBayWater(city.scene) : undefined;
  // Graphics v2 phase 2 item 7: instanced GPU pigeon flocks (fewer on Low).
  const birds = enabled && flags.graphicsV2 && 'gpuBirds' in flags && flags.gpuBirds ? createGpuBirds(tier === 'low') : undefined;
  const releaseBirds = birds?.mount(city.scene);
  let birdSeconds = 0;
  const post = enabled && !realisticLit ? createPost(renderer, flags.graphicsV2 && preset === 'low' ? 'low' : tier, { ssao: preset === 'hd' && sfLookOn }) : undefined;
  const maximum = renderer.capabilities.maxTextureSize;
  let disposed = false;
  let lastGradeAt = -Infinity;
  const gradeEpoch = Date.now();
  // Realistic renderer (founder teleop look, behind realisticRender): ACES + shadows + HDRI IBL +
  // PBR materials + the realistic post pipeline, chosen by the HD/Low graphics preset. Flag OFF keeps
  // the ps2Render path below byte-identical. The realistic post is created lazily on first render
  // (it needs the camera + drawing size); the HDRI env loads async with a graceful null fallback.
  // Realistic procedural facades (gtasf-2rup): a shared PBR atlas (albedo/normal/ARM) applied to
  // building walls per district. Only loads with both flags on; coupled to `realistic`, which is HD-only
  // (deploy #6), so the full (non-albedo-only) atlas is always used — Low keeps the ps2 path with no atlas.
  const realisticFacadeAtlas = realistic && 'realisticFacades' in flags && Boolean(flags.realisticFacades)
    ? createRealisticFacadeAtlas(false) : undefined;
  let realisticPost: ReturnType<typeof createRealisticPost> | undefined;
  let realisticTint: TimeGrade['tint'] | undefined; // last timeGrade tint, for the lazily created realisticV2 post
  let realisticEnv: Awaited<ReturnType<typeof loadRealisticEnvironment>> | undefined;
  const environmentLoad = realisticLit ? new AbortController() : undefined;
  let drawWidth = 1, drawHeight = 1;
  const sunDir = new Vector3(0.4, 1, 0.3).normalize(); // current sun direction, for shadow follow
  let noonClear = 0; // noonClearHaze: 0..1, high clear sun relaxes the street-level distanceHaze pull-in
  // Graphics v2 (HD only, ps2 path): soft sun shadows from the grade's directional light. Buildings cast,
  // the world receives; a softened, partial-strength shadow keeps the hazy SA look (never pitch black).
  const v2Shadows = enabled && !realisticLit && flags.graphicsV2 && preset === 'hd';
  if (v2Shadows) {
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFSoftShadowMap;
    configureSunShadows(city.sun, 'hd', 150);
    city.sun.shadow.intensity = 0.55; city.sun.shadow.radius = 3;
    city.scene.add(city.sun.target);
  }
  // Graphics v2 phase 2 item 6: physically based takram sky on HD (lazy; the dome stays until it is ready,
  // then becomes a clouds/stars overlay). Any failure keeps the existing dome.
  let atmosphereSky: AtmosphereSky | undefined, probed = false;
  let aerialComposer: import('./sky/aerialComposer').AerialComposer | undefined;
  // The physical atmosphere sky (HDR radiance) renders on the realisticLit path too: it is the correct sky for
  // ACES (the ps2 base city.sky dome is authored for NoToneMapping and whites out under filmic tone mapping). It
  // is a scene mesh, so realisticPost renders it; loading it flips city.sky to its stars/glow overlay.
  if (enabled && flags.graphicsV2 && preset === 'hd' && city.sky) {
    void loadAtmosphereSky(renderer).then(sky => {
      if (!sky || disposed) { sky?.dispose(); return; }
      atmosphereSky = sky; city.scene.add(sky.mesh); city.sky?.setOverlay(true);
      if (baseGrade) sky.applyGrade(baseGrade);
      // gtasf-kpi9: full takram aerial perspective in a HalfFloat pmndrs composer (flag off: never imported).
      if ('aerialPerspectiveHd' in flags && flags.aerialPerspectiveHd) {
        void import('./sky/aerialComposer').then(m => m.createAerialComposer({ renderer, scene: city.scene, sky, width: drawWidth, height: drawHeight }))
          .then(composer => { if (!composer || disposed) { composer?.dispose(); return; } aerialComposer = composer; }, () => { /* Keep the ps2 post. */ });
      }
    });
  }
  if (realisticLit) {
    configureRealisticRenderer(renderer, preset);
    // The procedural IBL env map and the SA HemisphereLight both supply sky ambient; at full env
    // intensity they double-count and wash the scene out (overexposed golden-hour Ferry/Mission that
    // triggered the #6 rollback). Dial the env down so it reads as reflections on metal/glass rather
    // than a second flood of ambient, leaving the grade's ambient + sun as the primary lighting.
    city.scene.environmentIntensity = 0.3;
    configureSunShadows(city.sun, preset);
    city.scene.add(city.sun.target); // directional shadow needs its target in the graph
    const initialGrade = sampleTimeGrade((options.now ?? clockOverride())?.() ?? Date.now());
    loadRealisticEnvironment(renderer, initialGrade, undefined, environmentLoad?.signal).then(env => {
      if (disposed) { env.dispose(); return; }
      realisticEnv = env;
      // A time override may change while the asynchronous HDRI lookup is pending.
      if (baseGrade) env.update?.(baseGrade);
      if (env.texture) city.scene.environment = env.texture;
    }).catch(() => { /* Environment unavailable; keep the direct scene lighting. */ });
  }
  const atmosphere = enabled && (options.atmosphere ?? ('saAtmosphere' in flags && Boolean(flags.saAtmosphere)));
  const weather = createWeatherFeed(atmosphere && (options.weather ?? flags.weather));
  const weatherGrade = createWeatherGrade(), solar = atmosphere && (options.sun ?? flags.sun);
  // Karl the Fog: low fog bank driven by the live weather feed (weatherGrade.state.fog). ?fog=<0..1>
  // overrides the live density for demo/capture (SF is often clear, so the live signal can read 0).
  const fogBank = enabled && flags.fogBank ? createFogBank(city.scene) : undefined;
  const fogOverride = ((): number | undefined => {
    if (typeof location === 'undefined') return undefined;
    const raw = new URLSearchParams(location.search).get('fog');
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined;
  })();
  const demoFogGrey = new Color('#b9c6d0');
  // Rain streaks driven by the live feed (weatherGrade.state.rain). ?rain=<0..1> overrides for demo/capture.
  const rainFx = enabled && flags.rainRender ? createRain(city.scene) : undefined;
  const rainOverride = ((): number | undefined => {
    if (typeof location === 'undefined') return undefined;
    const raw = new URLSearchParams(location.search).get('rain');
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined;
  })();
  let baseGrade: TimeGrade | undefined, lastAtmosphereFrame = performance.now(), lastMayhemFrame = performance.now(), appliedNight = -1;
  // stormHaze: last storm level (0..1), read by the fog bank's per-frame density below.
  let stormLevel = 0;
  // ?debug=render overlay: show the ACTIVE renderer + passes so a silent ps2 fallback is obvious (gtasf-6s1i).
  const renderDebug = createRenderDebug(wantsRenderDebug(), () => ({
    active: realistic ? 'realistic' : 'ps2',
    preset,
    toneMapping: renderer.toneMapping === ACESFilmicToneMapping ? 'ACESFilmic'
      : renderer.toneMapping === NoToneMapping ? 'None' : `#${renderer.toneMapping}`,
    outputColorSpace: renderer.outputColorSpace === SRGBColorSpace ? 'sRGB' : String(renderer.outputColorSpace),
    shadows: renderer.shadowMap.enabled,
    ibl: Boolean(city.scene.environment),
    iblSource: realisticEnv ? (realisticEnv.update ? `procedural (${realisticEnv.basename})` : `hdri ${realisticEnv.basename}`) : 'none',
    realisticFacades: Boolean(realisticFacadeAtlas),
    storefronts: realistic && 'storefrontPieces' in flags && Boolean(flags.storefrontPieces),
    post: realistic
      ? (renderer.shadowMap.enabled ? 'realistic/hd: SSAO+bloom+ACES+SMAA' : 'realistic/low: ACES direct (no SSAO/SMAA/bloom)')
      : (post ? 'ps2 post (bloom+grade)' : 'direct'),
  }));
  return {
    ...city, renderer, tier, weather,
    /** shoreSeams: the map coastline (water rings) for the bay plane's land mask. */
    setCoastline(rings: readonly (readonly (readonly [number, number])[])[]): void {
      bayWater?.setCoastline(rings, texture => renderer.initTexture(texture));
      // The mask's canvas is freed after upload; a context restore rebuilds it from the rings instead of re-uploading 1x1.
      if (bayWater && flags.coastlineCanvasUpload) renderer.domElement.addEventListener('webglcontextrestored', () => bayWater.restoreCoastline());
    },
    mountGeometry(root: Object3D): () => void {
      const release = city.mountGeometry(root);
      if (!realistic) {
        if (v2Shadows) root.traverse(object => {
          if (!(object instanceof Mesh)) return;
          object.receiveShadow = true;
          if (/^buildings(?:_|$)/.test(object.name) && root.userData.gtasfLowDetail !== true) object.castShadow = true;
        });
        const restoreSurfaces = urbanSurfaces?.mount(root);
        const releaseCanopy = blockCanopy?.mount(root);
        if (flags.graphicsV2 && preset === 'hd' && tier !== 'low') {
          const limit = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          root.traverse(object => {
            if (!(object instanceof Mesh)) return;
            for (const material of [object.material].flat()) {
              const input = material as Material & { map?: Texture | null; alphaMap?: Texture | null };
              for (const texture of [input.map, input.alphaMap]) {
                // Keep authored nearest/pixel filters and non-mipmapped labels intact.
                if (!texture?.generateMipmaps || (texture.minFilter !== LinearMipmapLinearFilter
                  && texture.minFilter !== LinearMipmapNearestFilter) || texture.anisotropy >= limit) continue;
                texture.anisotropy = limit; texture.needsUpdate = true;
              }
            }
          });
        }
        lampMap?.mount(root);
        let releaseWater: (() => void) | undefined;
        try { releaseWater = waterMirror?.mount(root); } catch (error) { console.warn('water overlay skipped', error); }
        warmChunk(root); // after every material patch above (lamp map, water), or the programs would be rebuilt at draw
        return () => { releaseWater?.(); releaseCanopy?.(); restoreSurfaces?.(); release(); };
      }
      // Swap the mounted PS2 Lambert/facade materials to PBR for the realistic path (restored first).
      // Building walls additionally get the procedural PBR facade shader; the per-chunk sourced ground
      // lets its storefront band follow SF's hills (gtasf-2rup).
      const ground = realisticFacadeAtlas ? createFacadeGround(root.userData.gtasfFacadeGround) : undefined;
      const restoreMaterials = applyRealisticMaterials(root, preset, realisticFacadeAtlas, ground);
      const restoreSurfaces = urbanSurfaces?.mount(root);
      warmChunk(root);
      return () => { restoreSurfaces?.(); restoreMaterials(); ground?.dispose(); release(); };
    },
    resize(width: number, height: number, dpr = devicePixelRatio): void {
      const size = drawingSize(tier, width, height, dpr, 1, maximum);
      if (!size || disposed) return;
      // The physical drawing buffer and post targets share one pixel budget on every device.
      renderer.setPixelRatio(1);
      renderer.setSize(size.width, size.height, false);
      drawWidth = size.width; drawHeight = size.height;
      post?.resize(size.width, size.height);
      realisticPost?.setSize(size.width, size.height);
      aerialComposer?.setSize(size.width, size.height);
    },
    render(camera: PerspectiveCamera, bloom = true, seconds?: number, groundY?: number): void {
      if (disposed) return;
      // chunkCompileHold applies only after the first frame; chunkCompileAsync's boot-time warm-ups run once it's drawn.
      if (!rendered) { rendered = true; queueMicrotask(() => { for (const root of pendingWarm.splice(0)) if (root.parent) void compileFor(root).catch(() => {}); }); }
      // Advance cosmetic mayhem particles/decal fades every frame (cheap: nothing moves when idle).
      if (city.mayhem) { const m = performance.now(); city.mayhem.update((m - lastMayhemFrame) / 1000); lastMayhemFrame = m; }
      lowDetailCull?.(city.scene, camera);
      // Clock: an injected clock (tests/capture), else a time-of-day override — URL `?time=`/`?hour=`
      // or the Game-options toggle (timeOverride.ts) — resolved PER FRAME so the toggle applies live
      // without a reload (the override makes `now` jump, which re-samples the grade at once).
      // `clockOverride()` is undefined with no override, so default real-time play is unchanged.
      const now = (options.now ?? clockOverride())?.() ?? (seconds === undefined ? Date.now() : gradeEpoch + seconds * 1000);
      let gradeChanged = false;
      if (atmosphere && Math.abs(now - lastGradeAt) >= 30_000) {
        lastGradeAt = now;
        // liveNightKey: the live clock's 02:00-05:30 colours/ambient hold the 02:00 look (timeGrade.liveNightFloorTime).
        baseGrade = sampleTimeGrade(solar && flags.liveNightKey ? liveNightFloorTime(now) : now);
        if (solar) applySolarPosition(baseGrade, now);
        if (realisticEnv?.update) city.scene.environment = realisticEnv.update(baseGrade);
        gradeChanged = true;
      }
      if (atmosphere && baseGrade && (gradeChanged || weather)) {
        const frame = performance.now(), dt = (frame - lastAtmosphereFrame) / 1000; lastAtmosphereFrame = frame;
        const grade = weather ? weatherGrade.update(baseGrade, weather.current(), dt) : baseGrade;
        if (fogOverride !== undefined && grade !== baseGrade) {
          // Demo/capture only (?fog=): force the whole weather system foggy so the haze/sky grey together
          // with the fog bank. The live grade keeps Karl deliberately mild (grade.ts); this is heavier so a
          // single capture shows the effect. Only the ?fog path hits this.
          weatherGrade.state.fog = fogOverride; weatherGrade.state.influence = 1;
          const f = fogOverride;
          grade.horizon.lerp(demoFogGrey, f * 0.26); grade.zenith.copy(grade.horizon);
          grade.sunIntensity *= 1 - 0.34 * f;
          grade.fogNear = Math.max(80, grade.fogNear - f * 42);
          grade.fogFar = Math.max(230, grade.fogFar * (1 - f * 0.52));
        }
        if (rainOverride !== undefined) {
          // Demo/capture (?rain=): drive the live rain signal; the overcast below handles the whole look.
          weatherGrade.state.rain = rainOverride; weatherGrade.state.influence = 1;
          weatherGrade.state.cloudCover = Math.max(weatherGrade.state.cloudCover, 0.55);
        }
        const wet = weatherGrade.state.rain * weatherGrade.state.influence;
        // rainNightDark: the pale-grey overcast below is a DAYLIGHT look; at night it lifted the navy sky + ambient to
        // #b9c6d0 so a rainy night read as grey daylight. Fade the overcast grade by night; `wet` itself (wet roads,
        // lamp streaks, shadows, storm slate) keeps full strength.
        const overcastWet = flags.rainNightDark ? wet * (1 - 0.85 * grade.night) : wet;
        if (wet > 0.001 && grade !== baseGrade) {
          // Rain overcasts the sky (live feed OR ?rain): grey the horizon/zenith, neutralise and DROP the
          // direct sun — which softens/kills the hard sun shadows — and lift the diffuse ambient, so rain reads
          // as a flat overcast rather than sunny rain. grade is reset from the base each frame, so no compounding.
          grade.horizon.lerp(demoFogGrey, 0.75 * overcastWet); grade.zenith.lerp(grade.horizon, 0.7 * overcastWet);
          grade.sunColour.lerp(demoFogGrey, 0.72 * overcastWet);
          // Grey the diffuse fill too, else the buildings stay golden-lit by the ungreyed ambient.
          grade.ambientColour.lerp(demoFogGrey, 0.66 * overcastWet); grade.groundColour.lerp(demoFogGrey, 0.5 * overcastWet);
          grade.sunIntensity *= 1 - 0.85 * overcastWet;
          grade.ambientIntensity *= 1 + 0.22 * overcastWet;
          if (flags.rainOvercast) {
            // rainOvercast (critique #14): the post tint still carried the time-of-day orange, so rain read as sunny
            // streaks over a pumpkin frame. Pull the tint to a cool overcast neutral and drop ~0.6 EV, and push the
            // haze/fog toward a blue-grey slate (the STORM_SLATE below then darkens it further when stormHaze is on).
            grade.tint.lerp(RAIN_TINT, overcastWet).multiplyScalar(Math.pow(2, -0.6 * overcastWet));
            grade.horizon.lerp(RAIN_HAZE, 0.5 * overcastWet); grade.cloud.lerp(RAIN_HAZE, 0.6 * overcastWet);
          }
        }
        // stormHaze: the pale overcast grey above (+ the ?fog/Karl grey) washes a storm out to near-white — sky,
        // distance haze and the fog bank (which takes the haze colour) all go pale. Pull them to a storm slate.
        const storm = flags.stormHaze && grade !== baseGrade
          ? Math.min(1, wet + 0.5 * (fogOverride ?? weatherGrade.state.fog * weatherGrade.state.influence)) : 0;
        // rainNightDark: the mid-grey slate is also a daylight darkener; at night it LIFTS the navy sky/fill/haze,
        // so fade its colour pulls by night too (stormLevel itself — lights-on bias, fog bank — keeps full storm).
        const stormTint = flags.rainNightDark ? storm * (1 - 0.85 * grade.night) : storm;
        if (storm > 0.001) {
          grade.horizon.lerp(STORM_SLATE, 0.6 * stormTint); grade.zenith.lerp(STORM_ZENITH, 0.6 * stormTint);
          grade.ambientColour.lerp(STORM_SLATE, 0.3 * stormTint);
        }
        const wetU = urbanSurfaces?.uniforms;
        if (flags.wetRoads && wetU?.uWet && wetU.uSkyColour) {
          // Wet-road sheen: drive the ground darken + sky reflection from the (greyed) rain signal + sky colour.
          wetU.uWet.value = wet;
          wetU.uSkyColour.value = ((wetU.uSkyColour.value as Color | null) ?? new Color()).copy(grade.horizon);
        }
        city.haze.color.copy(grade.horizon);
        const fog = realistic ? realisticFog(grade) : { near: grade.fogNear, far: grade.fogFar };
        city.haze.near = fog.near; city.haze.far = fog.far; hazeBase.near = fog.near; hazeBase.far = fog.far;
        if (flags.graphicsV2 && !realistic) {
          // Graphics v2 atmosphere: denser distance haze that warms toward the sun when it is low (golden hour/dusk).
          const lowSun = 1 - Math.min(1, Math.max(0, (grade.sunDirection.y - 0.08) / 0.47));
          // hazeRecede (Teleoperator): soften the golden sun-wash on the distance so mid/far buildings RECEDE into a
          // warm haze instead of glowing (they get the stronger warm-beige pull below). Preview #1 value when off.
          city.haze.color.lerp(grade.sunColour, (flags.hazeRecede ? 0.13 : 0.28) * lowSun * (1 - grade.night));
          // Time-matched fog colour: deep navy at night (distant towers silhouette against it with lit windows),
          // a faint rose at dawn (5:30-7:30 SF), on top of the golden-hour warmth above.
          city.haze.color.lerp(V2_NIGHT_HAZE, 0.55 * grade.night);
          const dawn = Math.max(0, 1 - Math.abs(grade.hour - 6.5) / 1.0) * (1 - grade.night);
          city.haze.color.lerp(V2_DAWN_HAZE, 0.25 * dawn);
          if (sfLookOn) {
            // SF look (gtasf-r9f6, all tiers): distance fades into a warm haze in daylight too (reference: golden, hazy
            // skyline), not only at golden hour. Night keeps the navy haze above.
            const day = 1 - grade.night;
            // hazeRecede pulls the distance harder toward the soft warm beige haze (reference: a hazy warm skyline
            // that recedes, not a saturated golden glow) — stays WARM, just less punchy/contrasty.
            city.haze.color.lerp(SF_LOOK_HAZE, (flags.hazeRecede ? 0.48 : 0.22) * day * (1 - 0.8 * storm));
            // No near/far shrink: it read fine at street level but washed the whole skyline out from the air (A/B Oct 7).
          }
        }
        (city.scene.background as Color).copy(grade.horizon); city.sky?.applyGrade(grade,flags.nightLighting); atmosphereSky?.applyGrade(grade);
        if (atmosphereSky) {
          // The physical sky is near-black at night; the SA dome (stars, city glow) owns the night sky.
          // skyDawnGuard (critic N10, gtasf-yzssn): with the sun just below/at the horizon the physical atmosphere renders
          // near-black while the grade is still 'day', and under heavy cloud the SA dome's overlay clouds then sat on that
          // black (HD-only black-and-white marbling at overcast dawn). Use the SA dome unless the sun is clearly up and
          // the sky isn't overcast.
          // night < .35 too: with liveNightKey the key light points at the night key (above the horizon) after dusk.
          const sunUp = grade.sunDirection.y > 0.06 && grade.night < 0.35;
          const overcastSky = weather ? Math.max(weatherGrade.state.cloudCover, wet * 0.98) * weatherGrade.state.influence : 0;
          // Review (2026-10-15-sky-dawn-guard.md): the cloud term only applies while the sun is low, so daytime overcast keeps
          // the physical sky; only the dawn/dusk + heavy-cloud case (the marbling) moves to the SA dome.
          const lowSunOvercast = overcastSky >= 0.6 && grade.sunDirection.y < 0.15;
          const physical = grade.night < 0.5 && (!flags.skyDawnGuard || (sunUp && !lowSunOvercast));
          atmosphereSky.mesh.visible = physical; city.sky?.setOverlay(physical);
          // Aerial-perspective lite: distant geometry fades into the physical sky's own horizon colour.
          // Read back only when the grade changes (the weather path runs this block every frame); cache it.
          if (physical && !aerialComposer && (gradeChanged || !probed)) {
            atmosphereSky.horizonColour(camera, V2_PROBE_RAW);
            // Never feed black/NaN into the fog (preview: black band on the Lombard horizon): accept the probe
            // only when it is finite and at least half as bright as the grade's own haze colour.
            const luma = (c: Color) => c.r * .2126 + c.g * .7152 + c.b * .0722, probe = luma(V2_PROBE_RAW);
            if (Number.isFinite(probe) && probe >= luma(city.haze.color) * 0.5) { V2_PROBE.copy(V2_PROBE_RAW); probed = true; }
          }
          if (physical && probed && !aerialComposer) city.haze.color.lerp(V2_PROBE, 0.5 * Math.max(0, 1 - grade.night * 2));
        }
        if (weather) city.sky?.applyWeather(Math.max(weatherGrade.state.cloudCover, wet * 0.98), weatherGrade.state.influence);
        // The fog bank tracks the cool fog tint the haze already lerps toward, so it blends with the horizon.
        // stormHaze: after every warm/daylight haze pull, settle the distance haze on the storm slate too.
        stormLevel = storm;
        if (storm > 0.001) city.haze.color.lerp(STORM_SLATE, 0.55 * stormTint);
        fogBank?.setColour(city.haze.color, storm);
        // weatherNight: heavy overcast / fog / rain bring the lights on earlier and during the day (GTA storm
        // look). Bias the night factor toward 1 by the weather darkness, strongest while it is daylight so it
        // fades out at real night (already fully lit). Clear weather => overcast 0 => the base grade.night.
        const overcast = flags.weatherNight
          ? (weatherGrade.state.cloudCover * 0.45 + weatherGrade.state.fog * 0.3 + weatherGrade.state.rain * 0.45) * weatherGrade.state.influence : 0;
        // stormHaze: a real storm (rain) may push the lights-on bias further (0.42 -> 0.6) so storefronts read through it.
        const night = flags.nightLighting ? Math.min(1, grade.night + Math.min(0.6, overcast) * (1 - grade.night) * (0.7 + 0.3 * stormLevel)) : 0;
        if (gradeChanged || Math.abs(night - appliedNight) > 0.01) {
          appliedNight = night;
          if (city.facadeAtlas) city.facadeAtlas.uniforms.uFacadeNight!.value = night;
          if (realisticFacadeAtlas) realisticFacadeAtlas.uniforms.uFacadeNight!.value = night;
          city.shopfrontSigns?.setNight(night); city.nightLights?.setNight(night);
          characterNight.value = night; // avatarNightFill: people's night lift (characterNight.ts)
        }
        city.ambient.color.copy(grade.ambientColour); city.ambient.groundColor.copy(grade.groundColour); city.ambient.intensity = grade.ambientIntensity;
        if (flags.graphicsV2 && !realistic) {
          // Graphics v2: less flat fill while the sun is low, so golden hour/dusk keep contrast and colour instead
          // of a milky lavender wash (dev look at ?time=dusk).
          const lowSunFill = 1 - Math.min(1, Math.max(0, (grade.sunDirection.y - 0.06) / 0.44));
          city.ambient.intensity = grade.ambientIntensity * (1 - 0.22 * lowSunFill * (1 - grade.night));
          // Dusk's lavender fill tinted the whole frame purple: pull the fill toward a warm neutral while the sun is low.
          city.ambient.color.lerp(V2_DUSK_FILL, 0.4 * lowSunFill * (1 - grade.night) * (1 - wet));
        }
        city.sun.color.copy(grade.sunColour); city.sun.intensity = grade.sunIntensity; city.sun.position.copy(grade.sunDirection).multiplyScalar(200);
        // Overcast rain reads as flat diffuse light with no hard sun shadow. Fade the shadow intensity as rain
        // builds, and stop the sun casting entirely past moderate rain (which also skips the shadow pass — a
        // perf win under rain). Set absolutely from the v2 base each frame, so wet=0 keeps the 0.55 base + cast.
        if (v2Shadows) { city.sun.shadow.intensity = 0.55 * Math.max(0, 1 - 1.6 * wet); city.sun.castShadow = wet < 0.42; }
        if (city.fill) {
          // Lift the shadowed (anti-sun) faces the low-sun ambient cut crushes to muddy dark: a dim warm directional
          // from OPPOSITE the sun, raking low across the shadow side. Strongest at low sun (golden hour/dusk) where the
          // crush is worst, off at night; a warm bounce tone, not the global ambient — so no milky wash.
          const lowSun = 1 - Math.min(1, Math.max(0, (grade.sunDirection.y - 0.06) / 0.44));
          city.fill.position.set(-grade.sunDirection.x, 0.42, -grade.sunDirection.z).multiplyScalar(200);
          city.fill.color.copy(grade.sunColour).lerp(WARM_FILL, 0.5);
          city.fill.intensity = 0.55 * (0.35 + 0.65 * lowSun) * (1 - grade.night);
        }
        sunDir.copy(grade.sunDirection);
        if (flags.noonClearHaze) {
          // Same high-sun window as neutralDaylight (0 by golden hour); cloud/rain bring the veil back.
          const d = Math.max(0, Math.min(1, (grade.sunDirection.y - 0.35) / 0.4));
          const cloud = weather ? weatherGrade.state.cloudCover * weatherGrade.state.influence : 0;
          noonClear = d * d * (3 - 2 * d) * (1 - Math.min(1, cloud * 1.5));
        }
        post?.setGrade(grade.tint);
        if (realisticV2) { realisticTint = grade.tint; realisticPost?.setGrade(grade.tint); }
      }
      if ((realistic || v2Shadows) && city.sun.castShadow) {
        // Keep the ortho shadow volume centred on the player as they move.
        city.sun.position.copy(camera.position).addScaledVector(sunDir, 240);
        city.sun.target.position.copy(camera.position);
        city.sun.target.updateMatrixWorld();
      }
      // gtasf-cf1a: show the block-interior canopy only from an aerial vantage (it is occluded + costly at street level).
      if (blockCanopy && groundY !== undefined && Number.isFinite(groundY)) blockCanopy.update(camera.position.y - groundY);
      // SF look (gtasf-r9f6): haze tuned for street level washed the whole skyline out from aerial / title views. Scale
      // the fog distance with the camera's height above the player's ground (x1 at street level, up to x4 high up).
      // drawFar is the UNtightened far that drives camera.far (draw distance / far-LOD + chunk-streaming boundary).
      // distanceHaze tightens only the FOG density below, never drawFar, so the drawn set + streaming boundary are
      // identical to flag-off — that decoupling is what removed the ~3 fps ferry-waterfront hitch and lets it run on
      // Low. (Shrinking camera.far with the fog was the regression: at the waterfront the camera never lifts, so the
      // tighter far plane sat on a far-LOD/stream boundary and churned.)
      let drawFar = city.haze.far;
      if (sfLookOn && groundY !== undefined && Number.isFinite(groundY) && hazeBase.far > 0) {
        // aerialSkylineHaze (gtasf look gap, Teleoperator reference): the shipped altitude ramp (x1 street ->
        // x4 only very high up) still fogged the FiDi skyline into the haze from a ~170 m aerial (fog far drives
        // camera.far, so the towers were both over-fogged and near the clip plane). A steeper ramp lets the
        // Transamerica / Bay Bridge / Salesforce Tower read from the air with atmospheric depth, matching the
        // reference. Street level (k=1) is unchanged, so no gameplay / phone-fps cost; the extra draw distance
        // only applies when the camera lifts well above the ground (aerial / title fly-over).
        const k = flags.aerialSkylineHaze
          ? 1 + Math.min(7, Math.max(0, camera.position.y - groundY - 25) / 28)
          : 1 + Math.min(3, Math.max(0, camera.position.y - groundY - 25) / 120);
        drawFar = hazeBase.far * k;
        let fogNear = hazeBase.near * k, fogFar = drawFar;
        if (flags.distanceHaze) {
          // distanceHaze (gtasf look gap vs docs/sf-data/teleoperator-reference.png): the altitude ramp holds
          // k=1 at street level, so mid-to-far blocks sit at the grade's full fog far (~800 m at golden) and
          // read crisp/flat where the reference's distance recedes into a warm veil (atmospheric perspective).
          // Pull the FOG IN at eye level (~0.70 -> fog far ~560 m) for denser street-level distance haze, fading
          // back to the ramp by ~45 m up so aerial / title fly-overs keep their skyline reach. camera.far stays on
          // drawFar (untightened), so only fog density changes — all tiers, no draw/stream cost. Flag-off and the
          // aloft ramp are byte-identical.
          const street = 1 - Math.min(1, Math.max(0, camera.position.y - groundY - 6) / 40);
          // noonClearHaze (critic openingDrive #3): at clear noon the 0.70 pull-in fully hazed the Ferry from the opening
          // drive (~600 m, fog far ~570 m), a bleached frame. High sun relaxes it back to the grade's far (~820 m).
          const kFog = 1 - 0.3 * street * (1 - noonClear);
          fogNear *= kFog; fogFar *= kFog;
        }
        city.haze.near = fogNear; city.haze.far = fogFar;
      }
      if (camera.far < drawFar + 100) {
        camera.far = drawFar + 100;
        camera.updateProjectionMatrix();
      }
      // aerialFarHaze: keep the far-LOD ring fading toward the live haze tone (golden/noon/navy-night). One copy,
      // only when the flag is on; the shared uniform updates every far material at once.
      if (flags.aerialFarHaze) city.farHaze.color.value.copy(city.haze.color);
      city.sky?.update(camera, seconds);
      fogBank?.update(camera, seconds ?? performance.now() / 1000, (fogOverride ?? weatherGrade.state.fog * weatherGrade.state.influence) * (1 - 0.4 * stormLevel));
      rainFx?.update(camera, seconds ?? performance.now() / 1000, rainOverride ?? weatherGrade.state.rain * weatherGrade.state.influence);
      lampMap?.update(city.scene, camera.position, city.nightLights?.footprints ?? [], city.nightLights?.stats.night ?? 0, performance.now());
      vehicleLamps?.update(city.scene, camera, city.nightLights?.stats.night ?? 0);
      waterMirror?.update(camera, seconds);
      bayWater?.update(camera, seconds, city.scene.fog?.color);
      if (birds) { const t = performance.now() / 1000; birds.update(camera.position, t, Math.min(0.1, Math.max(0, t - birdSeconds)), city.nightLights?.stats.night ?? 0); birdSeconds = t; }
      if (realisticLit) {
        if (!realisticPost) {
          // realisticLightingV2: graded output keeps the sky out of ACES and re-applies the timeGrade chain.
          realisticPost = createRealisticPost({ renderer, scene: city.scene, camera, preset, width: drawWidth, height: drawHeight, graded: realisticV2 });
          if (realisticTint) realisticPost.setGrade(realisticTint);
        }
        realisticPost.render(camera);
      } else if (aerialComposer && atmosphereSky?.mesh.visible) aerialComposer.render(camera);
      else if (post) post.render(city.scene, camera, bloom);
      else renderer.render(city.scene, camera);
      renderDebug?.update();
    },
    postBytes(): number { return post?.bytes() ?? 0; },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      environmentLoad?.abort();
      aerialComposer?.dispose();
      if (atmosphereSky) { city.scene.remove(atmosphereSky.mesh); atmosphereSky.dispose(); }
      renderer.setAnimationLoop(null);
      releaseBirds?.(); birds?.dispose(); waterMirror?.dispose(); bayWater?.dispose(); fogBank?.dispose(); rainFx?.dispose(); weather?.dispose(); lampMap?.dispose(); vehicleLamps?.dispose(); urbanSurfaces?.dispose(); blockCanopy?.dispose(); city.dispose(); realisticFacadeAtlas?.dispose(); post?.dispose(); realisticPost?.dispose(); realisticEnv?.dispose(); renderDebug?.dispose(); renderer.dispose();
    },
  };
}
