// Adapted from jeantimex/tokyo src/world/lamplight.js, MIT, Copyright (c) 2026 Yong Su.
// License: /licenses/tokyo-MIT.txt. GTASF: bounded instancing, local material hooks, phone tiers.
import { Color, CustomBlending, HalfFloatType, InstancedMesh, LinearFilter, Material, Matrix4, MaxEquation,
  Mesh, OneFactor, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, UnsignedByteType,
  Vector3, Vector4, WebGLRenderTarget, type Object3D, type WebGLRenderer } from 'three';
import { flags } from '@gtasf/shared/flags';
import { wetSignal } from './weather/wetness';

export type LampFootprint = { x: number; y: number; z: number };
/** Street-prop lamp posts near the player, refilled by streetProps on each spatial refresh. */
export const propLampFootprints: LampFootprint[] = [];
/** shopfrontGlow: lit-shopfront spill points (commercial frontages), refilled by streetProps; yaw faces the shop. */
export const propShopfrontFootprints: (LampFootprint & { yaw: number })[] = [];
/** A small night-only projection, sampled by lit surfaces; no PointLight per street lamp. */
export function createLampLightMap(renderer: WebGLRenderer, low: boolean) {
  if (!flags.graphicsV2) return undefined;
  const size = low ? 256 : 512, half = low ? 128 : 192, capacity = low ? 192 : 384;
  const target = new WebGLRenderTarget(size, size, { depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter,
    type: renderer.extensions.has('EXT_color_buffer_float') ? HalfFloatType : UnsignedByteType });
  target.texture.name = 'GTASF night lamp projection';
  const uniforms = { uLampMap: { value: target.texture }, uLampNight: { value: 0 },
    uLampRect: { value: new Vector4(0, 0, half, 0) }, uLampBase: { value: 0 },
    // wetLampStreaks: the shared rain-wet signal (written by foundation via urbanSurfaces' uWet), read in the lit hook.
    ...(flags.wetLampStreaks ? { uLampWet: wetSignal } : {}) };
  const geometry = new PlaneGeometry(1, 1); geometry.rotateX(-Math.PI / 2);
  const material = new ShaderMaterial({ depthTest: false, depthWrite: false, transparent: true,
    blending: CustomBlending, blendEquation: MaxEquation, blendSrc: OneFactor, blendDst: OneFactor,
    toneMapped: false, uniforms: { uLampBase: uniforms.uLampBase },
    vertexShader: `varying vec2 vUv; varying vec3 vLight; varying float vHeight;
      void main(){vUv=uv;vLight=instanceColor;vec4 p=instanceMatrix*vec4(position,1.0);
        vHeight=p.y;gl_Position=projectionMatrix*modelViewMatrix*p;}`,
    fragmentShader: `varying vec2 vUv;varying vec3 vLight;varying float vHeight;uniform float uLampBase;
      void main(){vec2 p=vUv*2.0-1.0;float falloff=pow(max(0.0,1.0-dot(p,p)),2.0);
        float h=(vHeight-uLampBase)/256.0;if(falloff<.004||h<=0.0||h>=1.0)discard;
        gl_FragColor=vec4(vLight*falloff,h);}`,
  });
  const quads = new InstancedMesh(geometry, material, capacity); quads.frustumCulled = false; quads.count = 0;
  quads.setColorAt(0, new Color(1, 1, 1));
  const scene = new Scene(); scene.add(quads);
  const camera = new OrthographicCamera(-half, half, half, -half, 1, 600);
  camera.up.set(0, 0, -1);
  // shopfrontGlow: shop-window spill, dimmer than a lamp pool; mostly warm interiors, some cool white/teal signage.
  const shopTones = [new Color(.62, .38, .16), new Color(.52, .44, .32), new Color(.36, .44, .48), new Color(.6, .32, .2)];
  const matrix = new Matrix4(), scale = new Vector3(), clear = new Color(), warm = new Color(1.0, .52, .16), white = !low && flags.softHeadlightPools ? new Color(.5, .53, .58) : new Color(.7, .74, .8);
  const patched = new WeakSet<Material>();
  let nextUpdate = -Infinity, disposed = false;
  // Night pool accumulation into the lit surface. The pool scales with the surface albedo (diffuseColor), so a
  // light-albedo plaza under a lamp/headlight was boosted far past a road and clipped to a flat white blob — and
  // a clipped pool's hard 1.0 iso-contour traced across the coarse night ground as the jagged white "sawtooth"
  // at the Ferry spawn on phone (gtasf founder review). On Low, cap the pool's effective albedo near asphalt
  // (~.15, the tier the gain 3.5 is tuned for) while keeping its hue: dark roads are unchanged (mag below the
  // cap), light pavers no longer over-brighten, and with MaxEquation blending the pool now stays below 1.0, so
  // the edge reads as a smooth radial gradient with no clip boundary. HD keeps the original line (byte-identical).
  const accumulate = low
    ? 'vec3 lampAlbedo=material.diffuseColor;float lampMag=max(lampAlbedo.r,max(lampAlbedo.g,lampAlbedo.b));'
      + 'lampAlbedo*=min(lampMag,0.22)/max(lampMag,1e-4);'
      + 'reflectedLight.directDiffuse+=lamp.rgb*edge.x*edge.y*level*up*uLampNight*lampAlbedo*3.5;'
    // softHeadlightPools (lane D): on HD the pool plateau saturated after the night exposure lift and the asphalt detail
    // traced its clip line as a jagged white blob; a soft knee keeps the pool's centre bright but never flat.
    : flags.softHeadlightPools
      ? 'vec3 lampAdd=lamp.rgb*edge.x*edge.y*level*up*uLampNight*material.diffuseColor*3.5;reflectedLight.directDiffuse+=lampAdd/(1.0+lampAdd*2.5);'
      : 'reflectedLight.directDiffuse+=lamp.rgb*edge.x*edge.y*level*up*uLampNight*material.diffuseColor*3.5;';
  // wetLampStreaks (lane A #5, wet night): a wet road is a rough mirror, so a lamp/headlight reads as a long streak
  // stretched toward the viewer. For a light at height H above this surface, its mirror image lands where the eye ray
  // meets the ground, i.e. the light's ground point sits along the camera->surface direction at  at.xz + away*(H/camH).
  // Sample the existing night projection at a few H (bulb ~7.4 m, headlights lower) => a continuous streak, tightened
  // to the pool core (rgb*max), Fresnel-weighted (grazing views only, nothing straight down), soft-kneed so Low's
  // untonemapped output never clips, added as emission (a reflection does not scale with albedo). Upward surfaces only.
  const wetTaps = low ? [3.0, 5.5, 8.0] : [2.5, 4.5, 6.5, 8.5];
  const wetStreak = !flags.wetLampStreaks ? '' : `
              if(uLampWet>.001&&up>.5){
                vec3 wetEye=cameraPosition-at;float wetH=max(wetEye.y,.6);vec2 wetAway=-wetEye.xz;
                vec3 wetRefl=vec3(0.0);
                ${wetTaps.map(h => `{vec2 q=at.xz+wetAway*(${h.toFixed(1)}/wetH);
                  vec2 qv=vec2(q.x-uLampRect.x,uLampRect.y-q.y)/(2.0*uLampRect.z)+.5;
                  vec2 qe=smoothstep(vec2(0.0),vec2(.04),qv)*(1.0-smoothstep(vec2(.96),vec2(1.0),qv));
                  vec4 s=texture2D(uLampMap,clamp(qv,0.0,1.0));
                  float ql=1.0-smoothstep(2.0,4.0,abs(at.y-(s.a*256.0+uLampBase)));
                  wetRefl+=s.rgb*max(s.r,max(s.g,s.b))*qe.x*qe.y*ql;}`).join('\n                ')}
                float wetNdv=wetH/sqrt(wetH*wetH+dot(wetAway,wetAway));float wetFres=pow(1.0-wetNdv,2.0);
                vec3 wetAdd=wetRefl*(${(3.0 / wetTaps.length).toFixed(3)}*uLampWet*uLampNight*wetFres);
                totalEmissiveRadiance+=wetAdd/(1.0+wetAdd*${low ? '1.4' : '0.8'});
              }`;
  function mount(root: Object3D) {
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      for (const material of [object.material].flat() as Material[]) {
        if (patched.has(material) || material.userData.gtasfUnlit || material.userData.gtasfNoLampMap || !('isMeshLambertMaterial' in material || 'isMeshStandardMaterial' in material)) continue;
        patched.add(material);
        const prepare = material.onBeforeCompile, key = material.customProgramCacheKey();
        material.customProgramCacheKey = () => `${key}:gtasf-lamp-map-v2${flags.wetLampStreaks ? '-wet' : ''}`;
        material.onBeforeCompile = (shader, renderer) => {
          prepare.call(material, shader, renderer); Object.assign(shader.uniforms, uniforms);
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
            uniform sampler2D uLampMap;uniform float uLampNight;uniform vec4 uLampRect;uniform float uLampBase;${flags.wetLampStreaks ? 'uniform float uLampWet;' : ''}`)
            .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
            if(uLampNight>.001){
              mat3 toWorld=transpose(mat3(viewMatrix));vec3 at=cameraPosition+toWorld*geometryPosition;
              vec2 uv=vec2(at.x-uLampRect.x,uLampRect.y-at.z)/(2.0*uLampRect.z)+.5;
              vec2 edge=smoothstep(vec2(0.0),vec2(.04),uv)*(1.0-smoothstep(vec2(.96),vec2(1.0),uv));
              vec4 lamp=texture2D(uLampMap,clamp(uv,0.0,1.0));
              float level=1.0-smoothstep(2.0,4.0,abs(at.y-(lamp.a*256.0+uLampBase)));
              float up=smoothstep(.2,.7,(toWorld*geometryNormal).y);
              ${accumulate}${wetStreak}
            }`);
        };
        material.needsUpdate = true;
      }
    });
  }
  function add(x: number, y: number, z: number, width: number, length: number, yaw: number, colour: Color) {
    if (quads.count >= capacity || Math.abs(x-uniforms.uLampRect.value.x)>half+length || Math.abs(z-uniforms.uLampRect.value.y)>half+length) return;
    matrix.makeRotationY(yaw); matrix.scale(scale.set(width, 1, length)); matrix.setPosition(x, y, z);
    quads.setMatrixAt(quads.count, matrix); quads.setColorAt(quads.count++, colour);
  }
  return { mount, update(world: Scene, focus: Vector3, lamps: Iterable<LampFootprint>, night: number, now: number) {
    if (disposed) return;
    uniforms.uLampNight.value = Math.max(0, Math.min(1, night));
    if (night <= .001) { nextUpdate = -Infinity; return; }
    if (now < nextUpdate && Math.hypot(focus.x-uniforms.uLampRect.value.x, focus.z-uniforms.uLampRect.value.y)<half*.5) return;
    nextUpdate = now + (low ? 100 : 50);
    const texel = 2*half/size, cx = Math.round(focus.x/texel)*texel, cz = Math.round(focus.z/texel)*texel;
    uniforms.uLampRect.value.set(cx, cz, half, 0); uniforms.uLampBase.value = focus.y-128;
    quads.count = 0;
    // Vehicles are direct scene children. Reserve headlight capacity before static lamp pools.
    let vehicles = 0;
    for (const car of world.children) {
      const light = car.userData.gtasfHeadlight as { active: boolean; front: number } | undefined;
      if (!light?.active || !car.visible || vehicles >= (low ? 24 : 48)) continue;
      if (Math.hypot(car.position.x-cx,car.position.z-cz)>half) continue;
      const yaw=car.rotation.y,s=Math.sin(yaw),c=Math.cos(yaw),reach=light.front+6;
      add(car.position.x+s*reach,car.position.y,car.position.z+c*reach,6,16,yaw,white);vehicles++;
    }
    // Police helicopter searchlight pool (policeAir.ts, flags.policeAirArt): a round pool where its beam lands.
    if (flags.policeAirArt) for (const car of world.children) {
      const spot = car.userData.gtasfSpotlight as { x: number; y: number; z: number; r: number } | undefined;
      if (!spot || !car.visible || Math.hypot(spot.x-cx,spot.z-cz)>half) continue;
      add(spot.x,spot.y,spot.z,spot.r*2.2,spot.r*2.2,0,white);
    }
    for (const lamp of lamps) add(lamp.x,lamp.y,lamp.z,18,18,0,warm);
    for (const lamp of propLampFootprints) add(lamp.x,lamp.y,lamp.z,14,14,0,warm);
    // shopfrontGlow: a dimmer oblong pool along each lit frontage (8 m along the street, 4 m deep), warm or cool by shop.
    if (flags.shopfrontGlow) propShopfrontFootprints.forEach((s, i) => add(s.x, s.y, s.z, 8, 4, s.yaw, shopTones[i % shopTones.length]!));
    quads.instanceMatrix.needsUpdate = true; if(quads.instanceColor) quads.instanceColor.needsUpdate = true;
    camera.position.set(cx,focus.y+300,cz);camera.lookAt(cx,focus.y,cz);camera.updateMatrixWorld();
    // lampHeightClear (lane D): alpha stores each pool's ground height and lit surfaces keep only pools within ~2-4 m of
    // their own height. Clearing alpha to 0 meant bilinear filtering blended a pool's height with "128 m below the camera"
    // near every pool, so that height test cut a hard texel-grid edge through the light: the jagged white headlight blob.
    // Clear instead to ~6 m below the camera (street level for on-foot/driving views); empty texels carry no light anyway.
    const clearHeight = flags.lampHeightClear ? (128 - 6) / 256 : 0;
    const previous=renderer.getRenderTarget(),alpha=renderer.getClearAlpha(),auto=renderer.autoClear;
    renderer.getClearColor(clear);
    try { renderer.setRenderTarget(target);renderer.setClearColor(0,clearHeight);renderer.autoClear=true;renderer.clear();renderer.render(scene,camera); }
    finally { renderer.setRenderTarget(previous);renderer.setClearColor(clear,alpha);renderer.autoClear=auto; }
  }, dispose(){if(disposed)return;disposed=true;uniforms.uLampNight.value=0;quads.dispose();geometry.dispose();material.dispose();target.dispose();} };
}
