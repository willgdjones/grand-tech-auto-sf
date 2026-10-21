import { DataTexture, RGBAFormat, SRGBColorSpace, Texture, type MeshLambertMaterial, type MeshStandardMaterial } from 'three';
import { acquireSurface } from './surfaceMaterials';

/** Original 64px cast-iron drain and tactile concrete apron; shared by every streamed cell. */
export function roadSurfaceDetailTexture(kind: 'grate' | 'ramp'): DataTexture {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = (x * 17 + y * 13) % 7 - 3;
    let rgb: number[];
    if (kind === 'grate') {
      const rim = x < 6 || x > 57 || y < 6 || y > 57;
      const slot = !rim && x % 8 < 4;
      const bolt = [8, 55].some(cx => [8, 55].some(cy => Math.hypot(x - cx, y - cy) < 2));
      const v = bolt ? 154 : rim ? 115 : slot ? 31 : 132;
      rgb = [v + grain, v - 2 + grain, v - 7 + grain];
    } else {
      const pad = x >= 7 && x <= 56 && y >= 18 && y <= 57;
      const dot = pad && Math.hypot((x - 7) % 7 - 3, (y - 18) % 7 - 3) < 1.5;
      rgb = pad ? dot ? [213, 168, 77] : [185, 143, 63] : [208 + grain, 200 + grain, 181 + grain];
    }
    const offset = (y * size + x) * 4;
    data.set([...rgb, 255], offset);
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.name = `SF ${kind} detail`; texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true;
  return texture;
}

/** Warm concrete with hairline cracks. HD adds the metric CC0 finish; Low remains procedural. */
export function addSidewalkFinish(material: MeshLambertMaterial | MeshStandardMaterial, low: boolean): void {
  const lease = low ? undefined : acquireSurface('sidewalk', false);
  const uniforms = { uSlabReady: { value: 0 }, uSlabAlbedo: { value: null as Texture | null }, uSlabNormal: { value: null as Texture | null }, uSlabRough: { value: null as Texture | null } };
  let disposed = false;
  material.addEventListener('dispose', () => { disposed = true; lease?.release(); });
  void lease?.ready.then(maps => {
    if (!maps || disposed) return;
    uniforms.uSlabAlbedo.value = maps.albedo; uniforms.uSlabNormal.value = maps.normal; uniforms.uSlabRough.value = maps.roughness; uniforms.uSlabReady.value = 1;
  });
  const before = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${key}:graphics-v2-sidewalk-v2:${low}:${Boolean(lease)}`;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    if (lease) Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSidewalkMetres;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSidewalkMetres=(modelMatrix*vec4(transformed,1.0)).xz;');
    if (lease) shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSlabWorldNormal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSlabWorldNormal=inverseTransformDirection(transformedNormal,viewMatrix);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vSidewalkMetres;
${lease ? 'varying vec3 vSlabWorldNormal; uniform float uSlabReady; uniform sampler2D uSlabAlbedo; uniform sampler2D uSlabNormal; uniform sampler2D uSlabRough;' : ''}`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
float sidewalkNear=1.0-smoothstep(${low ? '18.0,55.0' : '25.0,80.0'},length(vSidewalkMetres-cameraPosition.xz));
float sidewalkGrain=clamp((dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722))-0.35)*0.20,-0.05,0.05);
${lease ? `if(uSlabReady>0.5) {
  float concreteLuma=dot(texture2D(uSlabAlbedo,vSidewalkMetres/1.8).rgb,vec3(0.2126,0.7152,0.0722));
  sidewalkGrain=clamp((concreteLuma-0.35)*0.16,-0.035,0.035);
}` : ''}
// Keep the sidewalk map's own paving (tiles + grout) and recolour it warm, instead of replacing it with a flat
// beige (preview review: SoMa sidewalks lost their tiles). The map's relative luminance carries the pattern.
float paveLuma=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));
float pavePattern=clamp(paveLuma/0.55,0.55,1.25);
diffuseColor.rgb=vec3(0.72,0.66,0.55)*mix(1.0,pavePattern,0.85)+sidewalkGrain*sidewalkNear;
#ifdef USE_MAP
float slab=floor(vMapUv.y), crackSeed=fract(sin(slab*12.9898)*43758.5453);
float crackPath=0.42+0.18*sin(vMapUv.x*5.0+slab)+0.06*sin(vMapUv.x*17.0);
float crackDistance=abs(fract(vMapUv.y)-crackPath);
float crack=(1.0-smoothstep(0.003,0.003+max(fwidth(vMapUv.y),0.002),crackDistance))*step(0.78,crackSeed);
diffuseColor.rgb*=1.0-0.14*crack*sidewalkNear;
// Paving slabs (preview review: SoMa sidewalks read flat beige): joints at each slab end and down the slab
// width, plus a slight per-slab tone, aligned with the street via the sidewalk UVs. Fades with distance.
vec2 paver=vec2(vMapUv.x*2.0,vMapUv.y), paverCell=floor(paver), paverAa=max(fwidth(paver),vec2(0.002));
vec2 joint=1.0-smoothstep(vec2(0.012),vec2(0.012)+paverAa*1.5,min(fract(paver),1.0-fract(paver)));
float paverTone=0.94+0.10*fract(sin(dot(paverCell,vec2(41.3,289.1)))*43758.5453);
diffuseColor.rgb*=mix(1.0,paverTone*(1.0-0.22*max(joint.x,joint.y)),sidewalkNear);
#endif`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
float warmBounce=clamp((directionalLights[0].color.r-directionalLights[0].color.b)*0.55,0.0,0.72);
vec3 bounce=reflectedLight.indirectDiffuse/max(diffuseColor.rgb,vec3(0.001));
float bounceLight=dot(bounce,vec3(0.2126,0.7152,0.0722));
reflectedLight.indirectDiffuse=mix(reflectedLight.indirectDiffuse,diffuseColor.rgb*bounceLight*vec3(1.04,1.0,0.94),warmBounce);
#endif`);
    if (lease) shader.fragmentShader = shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if(uSlabReady>0.5) roughnessFactor=mix(roughnessFactor,max(0.85,texture2D(uSlabRough,vSidewalkMetres/1.8).r),sidewalkNear);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if(uSlabReady>0.5) {
  vec3 n=normalize(vSlabWorldNormal);
  // Slab sides retain their existing normals; only the walkable top gets the grain.
  if(n.y>0.7) {
    vec3 t=normalize(vec3(1.0,0.0,0.0)-n*n.x), b=-normalize(cross(n,t));
    vec3 detail=texture2D(uSlabNormal,vSidewalkMetres/1.8).xyz*2.0-1.0; detail.xy*=0.35;
    vec3 mapped=normalize(mat3(viewMatrix)*(t*detail.x+b*detail.y+n*detail.z));
    normal=normalize(mix(normal,mapped,sidewalkNear));
  }
}`);
  };
}
