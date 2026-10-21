import { Box3, BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, Group, type InstancedMesh, LOD, Matrix3, Mesh, MeshLambertMaterial, MeshStandardMaterial, type MeshStandardMaterialParameters, Object3D, RepeatWrapping, SRGBColorSpace, Vector2, Vector3 } from 'three';
import { flags } from '@gtasf/shared/flags';
import { readFacadeBuildings, type FacadeWall } from './facadeBuildings';
import { sampleHeight } from './chunks/terrain';
import { buildRooftopClutter } from './rooftopClutter';
import { assignFacadeStyle, type FrontStyle, type SideStyle } from './facadeStyles';
import { createFrontAtlas, type FrontCell } from './frontFacadeAtlas';
import { acquireSurface, SURFACE_METRES } from './surfaceMaterials';
import type { ShopfrontContext } from './shopfrontSigns';

/** Daylight sky-reflection strength on glass per style (matte fronts have no environment map). */
const GLASS: Partial<Record<FrontStyle, number>> = { tower: .55, office: .3 };
/** ?debug=facades: log per chunk why buildings/walls get no atlas front (diagnostics only). */
const FACADE_DEBUG = typeof location !== 'undefined' && /[?&]debug=facades\b/.test(location.search);
type FrontMaterial = MeshStandardMaterial | MeshLambertMaterial;
type Batch = { positions: number[]; normals: number[]; uv: number[]; rects: number[]; colours: number[]; shop: number[]; material: FrontMaterial };
const blank = (material: FrontMaterial): Batch => ({ positions: [], normals: [], uv: [], rects: [], colours: [], shop: [], material });

/** Chunk-local, merged front panels. No render-loop footprint work or collision changes. */
const STOREFRONT_STYLES = new Set<FrontStyle>(['shop', 'mix', 'brk', 'office']);
export function createFrontFacadeMapping(options: { low: boolean; night?: { value: number }; onRebuilt?: (root: Object3D) => void;
  /** chunkCompileHold: start compiling a freshly built facade group; a returned promise keeps it hidden until it resolves. */
  hold?: (group: Object3D) => Promise<unknown> | undefined }) {
  // Low/phone (gtasf-pooa): Lambert instead of PBR on every front/side panel; the map/colour/emissive hooks
  // used below exist in both. PBR-only parameters are dropped so Lambert never warns about them.
  // HD (no working polygonOffset at distance on the PBR path) needs a real gap from the source box, or
  // the box facade shader z-fights through and the front looks ghosted/double-layered.
  const lift = options.low ? .015 : .12;
  const surface = (params: MeshStandardMaterialParameters): FrontMaterial => {
    if (!options.low) return new MeshStandardMaterial(params);
    const { roughness: _r, metalness: _m, envMapIntensity: _e, roughnessMap: _rm, normalMap: _n, ...lambert } = params;
    return new MeshLambertMaterial(lambert);
  };
  if (!flags.graphicsV2 || typeof document === 'undefined') return undefined;
  const atlas = createFrontAtlas(), mounts = new Set<() => void>();
  let disposed = false;
  const night = options.night ?? { value: 0 };
  const shopGlow = flags.lowStorefrontGlow && options.low; // lowStorefrontGlow (Low panels only)
  // Phase 2 item 7: lit windows switch on/off at night; this ticks every 45s so occupancy changes slowly.
  const windowClock = { value: 0 };
  const fallbackTiles = new Map<SideStyle | 'glass', CanvasTexture>();
  function fallbackTile(kind: SideStyle | 'glass') {
    const cached = fallbackTiles.get(kind); if (cached) return cached;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d')!, pixels = context.createImageData(64, 64);
    const base = kind === 'brick' ? [177, 139, 112] : [218, 211, 195];
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const grain = ((Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0) % 17 - 8;
      const joint = kind === 'brick' ? y % 16 < 2 || (x + (Math.floor(y / 16) % 2) * 16) % 32 < 2
        : kind === 'siding' && y % 16 === 0;
      for (let channel = 0; channel < 3; channel++) pixels.data[(y * 64 + x) * 4 + channel] = base[channel]! + grain - (joint ? 18 : 0);
      pixels.data[(y * 64 + x) * 4 + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    if (kind === 'glass') {
      // One original office window module, 3 x 3.6 metres. Never an empty grey fallback.
      context.fillStyle = '#b4bbc0'; context.fillRect(0, 0, 64, 64);
      const reflection = context.createLinearGradient(0, 5, 0, 54);
      reflection.addColorStop(0, '#708a9a'); reflection.addColorStop(1, '#445969');
      context.fillStyle = reflection; context.fillRect(5, 5, 54, 48);
      context.fillStyle = '#c2c8ca'; context.fillRect(31, 5, 2, 48);
      context.fillStyle = '#859297'; context.fillRect(0, 59, 64, 5);
    }
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping; texture.anisotropy = 4;
    fallbackTiles.set(kind, texture); return texture;
  }
  function frontMaterial(cell: FrontCell) {
    const material = surface({ map: cell.colour, roughness: .95, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    // towerGlassMask: tower cells take every pane as glass (see the flag); other styles are unchanged.
    const fixTower = flags.towerGlassMask && cell.style === 'tower';
    // frontUniformFold (gtasf-wsqvc, OFF): the per-style numbers below are baked into the shader text, so every facade style
    // compiles its own program. With this flag they are per-material uniforms (style-only branches become uniform ifs) and
    // every front shares ONE program; looks identical, but the full fold lost ~5 fps idle / ~3.5 fps firefight on phone Low
    // (ABBA 10-20, '(program)' native time up) and this branchy shader is the likely cause, so it stays off.
    // frontProgramFold alone keeps the free parts (side keys, lamp skip).
    const fold = flags.frontUniformFold;
    const paint = cell.style === 'vic' || cell.style === 'edw' ? .55 : flags.buildingPaint && (cell.style === 'apt' || cell.style === 'mix') ? .40 : 0;
    const glow = cell.style === 'tower' ? 1 : (cell.style === 'brk' || cell.style === 'mix') && flags.brickNightWindows ? .8 : 0;
    const reflect = flags.glassTowerReflect && (cell.style === 'tower' || cell.style === 'office');
    const glass = cell.style === 'tower' && !fixTower ? GLASS.tower ?? 0 : 0;
    material.customProgramCacheKey = fold
      ? () => `true-scale-front-v9-fold${flags.glassTowerReflect ? '-gr1' : ''}${flags.towerGlassMask ? '-tm1' : ''}${flags.frontFarFade ? '-ff2' : ''}${shopGlow ? '-sg1' : ''}`
      : () => `true-scale-front-v8-${cell.style}${flags.glassTowerReflect ? '-gr1' : ''}${fixTower ? '-tm1' : ''}${flags.frontFarFade ? '-ff2' : ''}${shopGlow ? '-sg1' : ''}`;
    const maskImage = cell.mask.image as { width: number; height: number };
    // GLSL for the style-dependent parts: inlined constants (flag off: the old shaders, same output) or the fold's uniforms.
    const towerMaskGlsl = `
          // towerGlassMask: the packed tower masks put the real panes in R and only dark reflections/trees in G, so
          // the dark-glass G mask above lit those silhouettes as white blotches. Glass = the clean panes (R, no
          // frames); the irregular G reflection/tree regions never glow (they lit as torn shapes at night).
          frontMask.g = smoothstep(.45, .75, textureGrad(uFrontMask, frontUv, dx, dy).r);`;
    const reflectGlsl = `
          // glassTowerReflect: make the glass window reflection VIEW-DEPENDENT (Teleoperator curtain-wall look) —
          // dark/steel head-on, mirror-BRIGHT at grazing angles — instead of the old flat sky glow, so the FiDi
          // towers read as reflective glass. World-space Fresnel (no env map); sky tint warms toward the sun at
          // golden hour from the sun light colour. Still masked to the crisp glass panes (frontMask.g).
          float grWarm = 0.0;
          #if NUM_DIR_LIGHTS > 0
          grWarm = clamp((directionalLights[0].color.r - directionalLights[0].color.b) * 0.8, 0.0, 0.6);
          #endif
          vec3 grSky = mix(vec3(0.40, 0.52, 0.70), vec3(0.78, 0.64, 0.44), grWarm);
          float grFres = pow(1.0 - clamp(abs(dot(normalize(vFrontWorldN), normalize(cameraPosition - vFrontWorld))), 0.0, 1.0), 2.5);
          // Strong mirror on the crisp glass panes PLUS a whole-wall grazing sheen so the whole curtain-wall tower
          // face (mullions/spandrels included) reflects the sky at grazing angles — the GTA/Teleoperator glass look.
          totalEmissiveRadiance += grSky * (1.0 - uFrontNight) * (frontMask.g * (0.34 + 1.75 * grFres) + 0.38 * grFres);`;
    const towerNight = 'smoothstep(.35, .9, uFrontNight) * step(cellSeed, .45) * .55';
    const g = fold ? {
      towerMask: flags.towerGlassMask ? `\n          if (uFrontTowerMask > .5) {${towerMaskGlsl}\n          }` : '',
      paint: 'uFrontPaint',
      night: flags.towerGlassMask ? `mix(uFrontNight, ${towerNight}, uFrontTowerMask)` : 'uFrontNight',
      glow: 'uFrontGlow',
      reflect: flags.glassTowerReflect
        ? `\n          if (uFrontReflect > .5) {${reflectGlsl}\n          } else {\n          totalEmissiveRadiance += vec3(.30,.36,.44) * frontMask.g * (1.0 - uFrontNight) * uFrontGlass;\n          }`
        : `\n          totalEmissiveRadiance += vec3(.30,.36,.44) * frontMask.g * (1.0 - uFrontNight) * uFrontGlass;`,
      uniforms: ' uniform float uFrontPaint; uniform float uFrontGlow; uniform float uFrontTowerMask; uniform float uFrontReflect; uniform float uFrontGlass;',
    } : {
      towerMask: fixTower ? towerMaskGlsl : '',
      paint: cell.style === 'vic' || cell.style === 'edw' ? '.55' : flags.buildingPaint && (cell.style === 'apt' || cell.style === 'mix') ? '.40' : '0.0',
      night: fixTower ? towerNight : 'uFrontNight',
      glow: cell.style === 'tower' ? '1.0' : (cell.style === 'brk' || cell.style === 'mix') && flags.brickNightWindows ? '0.8' : '0.0',
      reflect: reflect ? `\n${reflectGlsl}` : `
          totalEmissiveRadiance += vec3(.30,.36,.44) * frontMask.g * (1.0 - uFrontNight) * ${cell.style === 'tower' && !fixTower ? (GLASS.tower ?? 0).toFixed(2) : '0.00'};`,
      uniforms: '',
    };
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, { uFrontMask: { value: cell.mask }, uFrontNight: night, uFrontClock: windowClock, uFrontTexel: { value: new Vector2(1 / maskImage.width, 1 / maskImage.height) } });
      if (fold) Object.assign(shader.uniforms, { uFrontPaint: { value: paint }, uFrontGlow: { value: glow }, uFrontTowerMask: { value: fixTower ? 1 : 0 },
        uFrontReflect: { value: reflect ? 1 : 0 }, uFrontGlass: { value: glass } });
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nattribute vec4 frontRect; varying vec4 vFrontRect; varying vec3 vFrontWorld;${flags.glassTowerReflect ? ' varying vec3 vFrontWorldN;' : ''}${shopGlow ? ' attribute vec2 frontShop; varying vec2 vFrontShop;' : ''}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvFrontRect=frontRect; vFrontWorld=(modelMatrix*vec4(transformed,1.0)).xyz;${flags.glassTowerReflect ? ' vFrontWorldN=normalize((modelMatrix*vec4(normal,0.0)).xyz);' : ''}${shopGlow ? ' vFrontShop=frontShop;' : ''}`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform sampler2D uFrontMask; uniform float uFrontNight; uniform float uFrontClock; uniform vec2 uFrontTexel; varying vec4 vFrontRect; varying vec3 vFrontWorld;${g.uniforms}${flags.glassTowerReflect ? ' varying vec3 vFrontWorldN;' : ''}${shopGlow ? ' varying vec2 vFrontShop;' : ''}`)
        .replace('#include <map_fragment>', `${flags.frontFarFade ? `
          // frontFarFade: beyond ~230 m each per-floor quad only samples the middle of its storey row (the UV inset
          // clamp), so the facade art smears into periodic blobs. Dither the panel out (230-300 m) and let the base
          // facade's crisp procedural window grid carry the far view; interleaved-gradient-noise = no hard pop.
          float frontFar = 1.0 - smoothstep(230.0, 300.0, distance(vFrontWorld, cameraPosition));
          if (frontFar < fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))))) discard;` : ''}
          vec2 dx = dFdx(vMapUv), dy = dFdy(vMapUv);
          vec2 span = vFrontRect.zw - vFrontRect.xy;
          float limit = min(1.0, .2 * min(span.x,span.y) / max(max(length(dx),length(dy)),.00001));
          dx *= limit; dy *= limit;
          vec2 inset = min(span*.24, uFrontTexel*.5 + (abs(dx)+abs(dy))*.75);
          vec2 frontUv = clamp(vMapUv,vFrontRect.xy+inset,vFrontRect.zw-inset);
          vec4 sampledDiffuseColor = textureGrad(map, frontUv, dx, dy);
          vec2 frontMask = textureGrad(uFrontMask, frontUv, dx, dy).rg;
          diffuseColor *= sampledDiffuseColor;
          // The half-res window mask is soft and also catches dark brick: only crisp, genuinely dark
          // glass may glow or reflect, or night windows smear into blotches across the wall.
          vec3 frontC = sampledDiffuseColor.rgb;
          float frontSat = max(frontC.r, max(frontC.g, frontC.b)) - min(frontC.r, min(frontC.g, frontC.b));
          // Linear red brick is as dark as glass: also require the low saturation of grey/blue glazing.
          frontMask.g = smoothstep(.6, .85, frontMask.g) * (1.0 - smoothstep(.10, .22, dot(frontC, vec3(.299,.587,.114))))
            * (1.0 - smoothstep(.025, .06, frontSat));${g.towerMask}
        `).replace('#include <color_fragment>', `
          #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
          diffuseColor.rgb *= mix(vec3(1.0),vColor.rgb,frontMask.r * ${g.paint});
          #endif
        `).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * mix(.12,.02,uFrontNight);
          // Per-window occupancy (~3 x 3.6 m cells): about 60% lit, each window re-rolling at its own pace.
          vec3 cellId = floor(vec3(vFrontWorld.x / 3.0, vFrontWorld.y / 3.6, vFrontWorld.z / 3.0));
          float cellSeed = fract(sin(dot(cellId, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float epoch = floor((uFrontClock + cellSeed * 97.0) / (3.0 + floor(cellSeed * 7.0)));
          float lit = step(fract(sin(dot(cellId + epoch, vec3(39.346, 11.135, 83.155))) * 24634.6345), .7);
          vec3 warmth = mix(vec3(1.0,.65,.28), vec3(.85,.9,1.0), step(.8, cellSeed));
          // towerGlassMask: whole tower panes now count as glass, so a partial night (dusk, or weatherNight's
          // overcast-day bias) would mottle the curtain wall pane by pane; tower windows ramp in only at real night,
          // with ~30% of panes lit at a softer level so a whole curtain wall doesn't read as a blown-out checkerboard.
          // Towers glow fully. Brick/mixed fronts glow too since their masks mark only non-red dark glass
          // (gtasf-jtkf repack); other generated fronts still can't separate glass from wall reliably.
          totalEmissiveRadiance += warmth * frontMask.g * ${g.night} * .95 * lit * ${g.glow};
          // Glass is matte here (no env map), so dark curtain walls would read as black boxes: add a soft
          // daylight sky reflection on the window mask (strong for towers/offices), and never go pure black.
${g.reflect}
          diffuseColor.rgb = max(diffuseColor.rgb, vec3(.05));${shopGlow ? `
          // lowStorefrontGlow: a lit shop window per ground-floor street panel at night (Low panels cover the HD shop band).
          // vFrontShop.x = 1 + height in the storey (0 off-shop), .y = across the panel: one inset window, piers and
          // fascia left dark, the photo's own glazing modulating it so it isn't a flat card. ~80% of shops are open.
          if (vFrontShop.x > 0.5) {
            float shopY = vFrontShop.x - 1.0, shopU = vFrontShop.y;
            float shopPane = smoothstep(.06, .10, shopU) * (1.0 - smoothstep(.90, .94, shopU)) * smoothstep(.10, .13, shopY) * (1.0 - smoothstep(.70, .74, shopY));
            // Glazing, not a lit card: three lights per panel split by dark mullions, a transom bar, and interior ceiling
            // light falling off toward the floor; the photo's glazing darkness shades it further.
            float shopT = fract((shopU - .1) / .8 * 3.0);
            float shopMull = mix(.15, 1.0, smoothstep(.0, .03, min(shopT, 1.0 - shopT)));
            float shopTransom = mix(.15, 1.0, smoothstep(.012, .028, abs(shopY - .58)));
            float shopOpen = step(fract(sin(dot(floor(vFrontWorld.xz / 6.0), vec2(12.9898, 78.233))) * 43758.5453), .8);
            float shopInk = 1.0 - smoothstep(.08, .45, dot(frontC, vec3(.299, .587, .114)));
            float shopCeil = mix(.55, 1.0, smoothstep(.13, .70, shopY));
            totalEmissiveRadiance += vec3(1.0, .60, .26) * uFrontNight * shopOpen * shopPane * shopMull * shopTransom * shopCeil * (.10 + .30 * shopInk);
          }` : ''}
        `);
    };
    material.onBeforeRender = () => { windowClock.value = Math.floor(Date.now() / 45_000) % 100_000; };
    // frontProgramFold: the lamp map lights only upward faces (it is a no-op on a wall), and facades build after a chunk's
    // lamp pass on some loads and before it on others, so each program came in two variants. Facades skip it.
    if (flags.frontProgramFold) material.userData.gtasfNoLampMap = true;
    return material;
  }
  function build(root: Object3D) {
    const context = root.userData.gtasfShopfrontContext as ShopfrontContext | undefined;
    if (disposed || !context) return { release: () => {}, styles: new Set<FrontStyle>() };
    // Coarse (citywide) chunks pack solid collision boxes, so the per-wall exposure probe reads most walls
    // as blocked and the retained-frontage towers (the Mission slabs) get no elevation. In coarse chunks,
    // give any sizeable wall of a real building an elevation anyway so it gets a windowed front, not grey fill.
    const coarse = root.userData.gtasfLowDetail === true;
    const debug = FACADE_DEBUG ? { wallTris: 0, nonRect: 0, walls: 0, buildings: 0, noCell: 0, short: 0, budget: 0, mapped: 0 } : undefined;
    const buildings = readFacadeBuildings(root, context, debug), group = new Group(); group.name = 'Facade fronts';
    if (debug) debug.buildings = buildings.length;
    group.userData.gtasfBuildingDetail = true; group.userData.gtasfFrontFacade = true;
    const batches = new Map<string, Batch>(), bays = new Map<string, Batch>(), leases: ReturnType<typeof acquireSurface>[] = [];
    const materials: FrontMaterial[] = [], geometries: BufferGeometry[] = [];
    let released = false, bayCount = 0, frontQuads = 0;
    const quadBudget = options.low ? 8_000 : 24_000;
    const inverse = root.matrixWorld.clone().invert(), normalMatrix = new Matrix3().getNormalMatrix(inverse), point = new Vector3(), normal = new Vector3();
    // lowStorefrontGlow: 1 while emitting a Low ground-floor street storefront quad (the HD box shader's storefront band).
    let shopQuad = 0;
    function quad(batch: Batch, wall: FacadeWall, x0: number, x1: number, y0: number, y1: number,
      uv: [number, number, number, number], rgb: readonly number[], depth0 = lift, depth1 = depth0, cell?: FrontCell) {
      const tx = (wall.bx - wall.ax) / wall.width, tz = (wall.bz - wall.az) / wall.width;
      const dx = tx * (x1 - x0) + wall.nx * (depth1 - depth0), dz = tz * (x1 - x0) + wall.nz * (depth1 - depth0);
      normal.set(-dz, 0, dx).normalize().applyMatrix3(normalMatrix).normalize();
      for (const corner of [0, 1, 2, 0, 2, 3]) {
        const right = corner === 1 || corner === 2, top = corner >= 2, x = right ? x1 : x0, depth = right ? depth1 : depth0;
        point.set(wall.ax + tx * x + wall.nx * depth, top ? y1 : y0, wall.az + tz * x + wall.nz * depth).applyMatrix4(inverse);
        batch.positions.push(point.x, point.y, point.z); batch.normals.push(normal.x, normal.y, normal.z);
        const rect = cell?.rect ?? [0, 0, 1, 1];
        batch.uv.push(rect[0]! + (right ? uv[2] : uv[0]) * (rect[2]! - rect[0]!), rect[1]! + (top ? uv[3] : uv[1]) * (rect[3]! - rect[1]!));
        batch.rects.push(...rect); batch.colours.push(rgb[0]!, rgb[1]!, rgb[2]!); batch.shop.push(shopQuad ? 1 + (top ? 1 : 0) : 0, right ? 1 : 0);
      }
    }
    function cap(wall: FacadeWall, left: number, right: number, y: number, depth: number, inset: number, top: boolean, rgb: readonly number[]) {
      let batch = bays.get('caps');
      if (!batch) {
        const material = surface({ roughness: 1, vertexColors: true });
        materials.push(material); batch = blank(material); bays.set('caps', batch);
      }
      const corners = [[left, lift], [left + inset, depth], [right - inset, depth], [right, lift]];
      normal.set(0, top ? 1 : -1, 0).applyMatrix3(normalMatrix).normalize();
      for (const i of top ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
        const [x, d] = corners[i]!;
        point.set(wall.ax + (wall.bx - wall.ax) * x! / wall.width + wall.nx * d!, y,
          wall.az + (wall.bz - wall.az) * x! / wall.width + wall.nz * d!).applyMatrix4(inverse);
        batch.positions.push(point.x, point.y, point.z); batch.normals.push(normal.x, normal.y, normal.z);
        batch.uv.push(0, 0); batch.rects.push(0, 0, 1, 1); batch.colours.push(...rgb); batch.shop.push(0, 0);
      }
    }
    function surfaceBatch(kind: SideStyle, windowed = false) {
      const key = `side-${kind}-${windowed}`; let batch = batches.get(key);
      if (batch) return batch;
      const material = surface({ map: fallbackTile(windowed ? 'glass' : kind), roughness: 1, metalness: 0, envMapIntensity: 0,
        vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      // Small sky-bounce fill keeps textured walls legible on the SA lighting path, without
      // turning their night-time faces into luminous panels or depending on an environment map.
      // frontProgramFold: only siding (its map_fragment) and windowed differ in shader text; other kinds share one program.
      material.customProgramCacheKey = flags.frontProgramFold
        ? () => `metric-wall-bounce-v3-${windowed ? 'windowed' : kind === 'siding' ? 'siding' : 'plain'}`
        : () => `metric-wall-bounce-v2-${kind}-${windowed}`;
      material.onBeforeCompile = shader => {
        shader.uniforms.uWallNight = night;
        if (kind === 'siding' && !windowed) {
          // Keep the sourced board joints/grain, but paint raw brown timber in the building's
          // pastel palette. Multiplying the dark wood albedo alone makes SF clapboard look muddy.
          shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
            #ifdef USE_MAP
              vec4 timber = texture2D(map, vMapUv);
              float grain = dot(timber.rgb, vec3(.2126,.7152,.0722));
              diffuseColor.rgb *= clamp(.22 + 1.5 * sqrt(max(grain, 0.0)), .32, .88);
            #endif
          `);
        }
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWallNight;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * mix(.12,.02,uWallNight);');
        if (windowed) {
          // Glass side walls: one window per 3 x 3.6 m tile, switched on/off like the fronts.
          shader.uniforms.uWallClock = windowClock;
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWallWorld;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWallWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
          shader.fragmentShader = shader.fragmentShader.replace('uniform float uWallNight;', 'uniform float uWallNight; uniform float uWallClock; varying vec3 vWallWorld;')
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
              vec2 pane = fract(vMapUv);
              float glass = step(.08, pane.x) * step(pane.x, .92) * step(.17, pane.y) * step(pane.y, .92);
              vec3 cellId = vec3(floor(vMapUv), floor(vWallWorld.x / 50.0) + floor(vWallWorld.z / 50.0) * 31.0);
              float cellSeed = fract(sin(dot(cellId, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
              float epoch = floor((uWallClock + cellSeed * 97.0) / (3.0 + floor(cellSeed * 7.0)));
              float lit = step(fract(sin(dot(cellId + epoch, vec3(39.346, 11.135, 83.155))) * 24634.6345), .55);
              totalEmissiveRadiance += mix(vec3(1.0,.65,.28), vec3(.85,.9,1.0), step(.8, cellSeed)) * glass * lit * uWallNight * .6;`);
        }
      };
      if (windowed) material.onBeforeRender = () => { windowClock.value = Math.floor(Date.now() / 45_000) % 100_000; };
      if (flags.frontProgramFold) material.userData.gtasfNoLampMap = true; // walls: the lamp map lights only upward faces
      materials.push(material); batch = blank(material); batches.set(key, batch);
      const lease = windowed ? undefined : acquireSurface(kind, options.low); leases.push(lease);
      void lease?.ready.then(maps => {
        if (!maps || released) return;
        material.map = maps.albedo;
        if (material instanceof MeshStandardMaterial) { material.normalMap = maps.normal; material.normalScale.set(.4, .4); material.roughnessMap = maps.roughness; }
        material.needsUpdate = true;
      });
      return batch;
    }
    const mapped = new Set<string>(), styles = new Set<FrontStyle>();
    // frontCoplanarDedupe: overlapping source footprints (two buildings on one wall) each put a front panel at the same
    // lift; the coplanar pair z-fights as vertical streaks. Buildings run tallest first, so a later wall that lies in
    // an emitted front's plane and is mostly covered by it gets no second panel.
    const fronted: FacadeWall[] = [];
    const coveredByFront = (wall: FacadeWall) => flags.frontCoplanarDedupe && fronted.some(o => {
      if (o.nx * wall.nx + o.nz * wall.nz < .95 || Math.abs((wall.ax - o.ax) * o.nx + (wall.az - o.az) * o.nz) > .3) return false;
      const tx = (o.bx - o.ax) / o.width, tz = (o.bz - o.az) / o.width;
      const s0 = (wall.ax - o.ax) * tx + (wall.az - o.az) * tz, s1 = (wall.bx - o.ax) * tx + (wall.bz - o.az) * tz;
      const along = Math.min(Math.max(s0, s1), o.width) - Math.max(Math.min(s0, s1), 0);
      const up = Math.min(wall.top, o.top) - Math.max(wall.bottom, o.bottom);
      return along > wall.width * .8 && up > (wall.top - wall.bottom) * .8;
    });
    for (const building of buildings.sort((a, b) => b.height - a.height)) {
      const assignment = assignFacadeStyle({ ...building, colour: building.walls[0]?.colour });
      const choices = atlas.cells.get(assignment.style), cell = choices?.[assignment.seed % choices.length];
      const glazed = assignment.style === 'office' || assignment.style === 'tower';
      if (!cell && (building.frontage > 0 || (glazed && building.walls.some(w => w.exposed)))) styles.add(assignment.style);
      const pageKey = cell?.colour.uuid;
      let front = pageKey ? batches.get(pageKey) : undefined;
      if (cell && pageKey && !front) { const material = frontMaterial(cell); materials.push(material); front = blank(material); batches.set(pageKey, front); }
      // buildingPaint (gtasf-5mvt): residential mid-rises (apt/mix) get their own pastel paint too, a little more saturated
      // so neighbours read as different buildings (founder look gap item 2); Victorians keep the original tint.
      const residential = flags.buildingPaint && (assignment.style === 'apt' || assignment.style === 'mix');
      const tint = new Color().setHSL((assignment.seed % 360) / 360, (residential ? .22 : .10) + (assignment.seed % 13) / 100, residential ? .78 : .75);
      const rgb = [tint.r, tint.g, tint.b];
      for (const wall of building.walls) {
        // A sizeable exposed/coarse wall gets the windowed glass tile (not a flat matte slab); short jogs and
        // party walls stay tiled. gtasf-facade-exposed-clearance-l6sy fixes the Mission/Haight/Castro blank
        // slabs with two changes under exposedByClearance: (1) reach the low (phone) preset — the shipped build
        // gated bigExposed/coarseWall behind !options.low, so phones had no windowed coarse fronts at all;
        // (2) drop the minimum wall WIDTH from 5 m to the readFacadeBuildings 1.5 m floor — the coarse bake
        // splits SF's narrow lots into ~1.7 m-wide, 13-16 m-tall strips that fell under the 5 m gate and dropped
        // to a flat matte tile. The height gate (>=5 m) still keeps short jogs/sills/parapets matte. A windowed
        // tile is the same single quad as the matte tile (no extra geometry), and on low the fronts are still
        // culled beyond 150 m (lowDetailCull), so the added phone cost is bounded.
        const fix = flags.exposedByClearance, minW = fix ? 1.5 : 5;
        const bigExposed = (!options.low || fix) && wall.exposed && wall.width >= minW && wall.top - wall.bottom >= 5;
        const coarseWall = coarse && (!options.low || fix) && wall.width >= minW && wall.top - wall.bottom >= (fix ? 5 : 6);
        const elevation = wall.street || (glazed && wall.exposed) || bigExposed || coarseWall;
        const tile = (top = wall.top, base = false) => {
          const kind = !base && wall.street && !cell ? (assignment.style === 'office' || assignment.style === 'tower' ? 'concrete' : 'stucco') : assignment.side;
          // A tall exposed fallback wall gets the windowed glass tile too (not only glass styles), so a
          // cell-less tower reads as windowed rather than a flat concrete slab; party/short walls stay matte.
          const windowed = !base && (glazed || bigExposed || coarseWall) && elevation;
          const [scaleX, scaleY] = windowed ? [3, 3.6] : SURFACE_METRES[kind] as [number, number];
          // A plain matte concrete/stucco fallback must not take the full saturated per-building tint, or
          // set-back / coarse walls read as garish pink/lavender boxes. Pull it to near-grey concrete.
          const lum = .299 * rgb[0]! + .587 * rgb[1]! + .114 * rgb[2]!;
          const tileRgb = (kind === 'concrete' || kind === 'stucco') && !windowed ? rgb.map(c => lum + (c - lum) * .22) : rgb;
          // Behind the fronts: overlapping party walls must never tie with a front panel on depth.
          quad(surfaceBatch(kind, windowed), wall, 0, wall.width, wall.bottom, top, [0, wall.bottom / scaleY, wall.width / scaleX, top / scaleY], tileRgb, lift * .5, lift * .5);
        };
        if (!elevation || !cell || !front || !pageKey) { if (debug) debug.noCell++; tile(); continue; }
        if (coveredByFront(wall)) continue;
        // HD: commercial street fronts leave the 0-3.6 m ground floor to the box shader's storefront band.
        const storefront = !options.low && wall.street && STOREFRONT_STYLES.has(assignment.style) && wall.top - wall.ground > 6;
        const bottom = Math.max(wall.bottom, wall.ground - .1 + (storefront ? 3.7 : 0)), height = wall.top - bottom;
        if (height < 2) { if (debug) debug.short++; tile(); continue; }
        const floors = Math.max(1, Math.min(100, Math.round(height / (cell.heightM / cell.floors)))), floorH = height / floors;
        if (frontQuads + floors * Math.ceil(wall.width / cell.widthM) > quadBudget) { if (debug) debug.budget++; tile(); continue; }
        if (debug) debug.mapped++;
        // On hills the source extrusion extends below the street-facing floor baseline.
        // Its downhill portion can be visible: tile that skirt instead of leaving raw source colour
        // or repeating ground-floor doors/windows below the sampled street level.
        if (!storefront && bottom - wall.bottom > .01) tile(bottom, true);
        if (storefront && wall.ground - .1 - wall.bottom > .01) tile(wall.ground - .1, true);
        mapped.add(building.id); fronted.push(wall);
        frontQuads += floors * Math.ceil(wall.width / cell.widthM);
        const firstFloor = cell.firstUsableFloor ?? 0, lastFloor = cell.floors - 1;
        // Repeated middle floors must come from clean storeys: tower cells have their lobby, trees and reflected
        // neighbours in the bottom ~35%, office cells a double-height lobby (rows 0-1). Those rows stacked up a tall
        // building read as magnified blobs (FiDi) or chandelier lobbies on upper floors (Chinatown).
        const cleanFrom = cell.style === 'tower' ? Math.ceil(cell.floors * .35) : cell.style === 'office' ? 2 : firstFloor + 1;
        const middleFirst = Math.min(Math.max(firstFloor + 1, cleanFrom), lastFloor), middleCount = Math.max(1, lastFloor - middleFirst);
        for (let floor = 0; floor < floors; floor++) {
          // The ground/lobby row only belongs on a wall that actually starts at the street. An upper block standing on a
          // podium (Chinatown) used to get a magnified lobby on its first visible storey; it now starts mid-building.
          // wall.ground is clamped to the wall bottom, so sample the real terrain just outside the wall's midpoint.
          const terrain = sampleHeight(context.ground, (wall.ax + wall.bx) / 2 + wall.nx * .5, (wall.az + wall.bz) / 2 + wall.nz * .5);
          // storefrontUpperRows (critic N48): on an HD storefront wall the panel starts ABOVE the box shader's 0-3.6 m shop band,
          // so its first storey is the 2nd floor; giving it the photo's ground-floor row put doors and steps a storey up.
          const atStreet = (terrain === null || wall.bottom <= terrain + 1.5) && !(flags.storefrontUpperRows && storefront);
          const sourceFloor = floor === 0 && atStreet ? firstFloor : floor === floors - 1 ? lastFloor : middleFirst + Math.max(0, floor - (atStreet ? 1 : 0)) % middleCount;
          const v0 = sourceFloor / cell.floors, v1 = (sourceFloor + 1) / cell.floors;
          for (let x = 0; x < wall.width; x += cell.widthM) {
            const width = Math.min(cell.widthM, wall.width - x), y0 = bottom + floor * floorH, y1 = y0 + floorH;
            // lowStorefrontGlow: on Low the panel covers the street storefront floor that HD leaves to the box shader's lit
            // shop band, so mark that quad to glow at night (same styles/walls as the HD storefront rule above).
            shopQuad = flags.lowStorefrontGlow && options.low && floor === 0 && atStreet && wall.street
              && STOREFRONT_STYLES.has(assignment.style) && wall.top - wall.ground > 6 ? 1 : 0;
            quad(front, wall, x, x + width, y0, y1, [0, v0, width / cell.widthM, v1], rgb, lift, lift, cell);
            shopQuad = 0;
            // phoneFacadeBays (gtasf-16e2): the signature SF projecting bays are desktop-only by default (the `low`
            // skip below). On Low/phone, emit them too for Victorian/Edwardian fronts — by facade STYLE, citywide,
            // not by district — under a tighter per-chunk bay cap so the phone budget holds. Desktop path and the
            // flag-off path are byte-identical (the bays are only built when the flag is on).
            const lowBays = options.low && flags.phoneFacadeBays && (assignment.style === 'vic' || assignment.style === 'edw');
            if ((options.low && !lowBays) || bayCount >= (options.low ? 40 : 128)) continue;
            for (const bay of cell.bays) {
              const [left, low, right, high] = bay.rect, lo = Math.max(low, v0), hi = Math.min(high, v1);
              if (hi <= lo || right * cell.widthM > width) continue;
              let batch = bays.get(pageKey); if (!batch) { batch = blank(front.material); bays.set(pageKey, batch); }
              // phoneFacadeBays: on Low the source bay (0.45-0.6 m) reads too shallow at phone resolution and oblique
              // street angles, so project it further (to ~1 m) for a clear SF bay silhouette. Desktop keeps the authored depth.
              const depth = lowBays ? Math.min(1.05, bay.depth * 1.8) : bay.depth;
              const a = x + left * cell.widthM, b = x + right * cell.widthM, inset = Math.min((b - a) * .18, depth * .6);
              const by0 = y0 + (lo - v0) * cell.floors * floorH, by1 = y0 + (hi - v0) * cell.floors * floorH;
              quad(batch, wall, a, a + inset, by0, by1, [left, lo, left + inset / cell.widthM, hi], rgb, lift, depth, cell);
              quad(batch, wall, a + inset, b - inset, by0, by1, [left + inset / cell.widthM, lo, right - inset / cell.widthM, hi], rgb, depth, depth, cell);
              quad(batch, wall, b - inset, b, by0, by1, [right - inset / cell.widthM, lo, right, hi], rgb, depth, lift, cell);
              cap(wall, a, b, by1, depth, inset, true, rgb); cap(wall, a, b, by0, depth, inset, false, rgb);
              bayCount++;
            }
          }
        }
      }
    }
    function mesh(batch: Batch) {
      const geometry = new BufferGeometry(); geometries.push(geometry);
      geometry.setAttribute('position', new Float32BufferAttribute(batch.positions, 3)); geometry.setAttribute('normal', new Float32BufferAttribute(batch.normals, 3));
      geometry.setAttribute('frontRect', new Float32BufferAttribute(batch.rects, 4));
      geometry.setAttribute('uv', new Float32BufferAttribute(batch.uv, 2)); geometry.setAttribute('color', new Float32BufferAttribute(batch.colours, 3));
      if (shopGlow) geometry.setAttribute('frontShop', new Float32BufferAttribute(batch.shop, 2));
      geometry.computeBoundingSphere(); const result = new Mesh(geometry, batch.material); result.name = 'Facade fronts'; result.userData.gtasfBuildingDetail = true; result.userData.gtasfFrontFacade = true; return result;
    }
    for (const batch of batches.values()) if (batch.positions.length) group.add(mesh(batch));
    if (bays.size) {
      const detail = new Group(); for (const batch of bays.values()) detail.add(mesh(batch));
      const bounds = new Box3().setFromObject(detail), centre = bounds.getCenter(new Vector3());
      detail.position.copy(centre).negate();
      // phoneFacadeBays: the added bays are cheap merged quads (capped per chunk), so Low keeps a near-desktop fade
      // so a block or two of the street row reads with bays, not just the few nearest buildings.
      const lod = new LOD(); lod.position.copy(centre); lod.name = 'Facade bays'; lod.addLevel(detail, 0); lod.addLevel(new Object3D(), bounds.getSize(new Vector3()).length() / 2 + (options.low ? 70 : 150), .1); group.add(lod);
    }
    // HD silhouettes: parapets, rooftop units, water tanks and fire escapes (gtasf-qc8o).
    // Low gets the cheap variant (street parapets, 2 AC units, no rails/shadows) behind rooftopClutterLow.
    const clutter = flags.rooftopClutter && (!options.low || flags.rooftopClutterLow)
      ? buildRooftopClutter(buildings, b => assignFacadeStyle({ ...b, colour: b.walls[0]?.colour }), inverse, { low: options.low }) : undefined;
    if (clutter) group.add(clutter.group);
    if (clutter && FACADE_DEBUG) {
      let instances = 0, triangles = 0;
      clutter.group.traverse(o => { const m = o as InstancedMesh; if (m.isInstancedMesh) { instances += m.count; triangles += m.count * (m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position!.count / 3); } });
      console.info('[clutter]', options.low ? 'low' : 'hd', root.name || 'chunk', instances, triangles);
    }
    if (debug) console.info('[facades]', root.name || 'chunk', root.userData.gtasfLowDetail ? 'coarse' : 'detail', JSON.stringify(debug));
    root.userData.gtasfMappedFacadeIds = mapped; root.add(group);
    // chunkCompileHold (critic 12:1x): compileAsync only wins if the link beats the first draw, so keep the new facade group
    // hidden until its programs are linked (capped at 1.5 s). hold() collects the group while it is still visible.
    const held = options.hold?.(group);
    if (held) {
      group.visible = false;
      const show = () => { if (!released) group.visible = true; };
      void held.then(show, show); setTimeout(show, 1500);
    }
    const release = () => { if (released) return; released = true; root.remove(group); clutter?.dispose(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); leases.forEach(l => l?.release()); if (root.userData.gtasfMappedFacadeIds === mapped) delete root.userData.gtasfMappedFacadeIds; };
    return { release, styles };
  }
  function mount(root: Object3D) {
    let current = build(root), active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    // Keep watching missing styles after a failed request: another chunk may later retry
    // successfully, and all still-visible consumers should replace their fallback together.
    const unsubscribe = atlas.subscribe(style => {
      if (!active || disposed || !current.styles.has(style) || refreshTimer !== undefined) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        if (!active || disposed) return;
        const previous = current; current = build(root); previous.release();
        options.onRebuilt?.(root); // chunkCompileAsync: start linking the new style programs before their first draw
        // Remove overlapping old frontage details only after real replacement textures exist.
        (root.userData.gtasfRefreshBuildingDetail as (() => void) | undefined)?.();
      }, 32);
    });
    const release = () => {
      if (!active) return; active = false;
      unsubscribe();
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
      current.release(); mounts.delete(release);
    };
    mounts.add(release);
    for (const style of current.styles) void atlas.ensure(style);
    return release;
  }
  return { mount, dispose() { disposed = true; for (const release of mounts) release(); atlas.dispose(); fallbackTiles.forEach(texture => texture.dispose()); fallbackTiles.clear(); } };
}
