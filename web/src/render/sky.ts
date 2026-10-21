import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3, type Camera } from 'three';
import type { TimeGrade } from './timeGrade';
import { flags } from '@gtasf/shared/flags';

/** CSS/hex colours enter Three in sRGB; Color converts them to linear exactly once. Vivid SF pass
 * (PLAN-v2.1 §4 / pane 9): the pre-grade and no-atmosphere default is a clean sky-blue matching the
 * midday keyframe, not the old pale grey-green that set a monochrome first frame and fog colour. */
export const SKY_COLOURS = Object.freeze({ horizon: '#a9c8e0', zenith: '#2b93d8' });

export function createSky(low = false) {
  const V2 = flags.graphicsV2;
  // skyCloudCover (Teleoperator look push): the reference sky is full of layered marine cloud; ours is a near-empty
  // saturated gradient. Boost the cumulus/wisp coverage + density so the sky reads as an atmospheric cloudscape
  // (warm sun-lit clouds, not grey overcast — the per-cloud shading below is unchanged). Byte-identical off.
  const bigClouds = V2 && flags.skyCloudCover;
  const material = new ShaderMaterial({
    name: 'GTASF sky',
    uniforms: {
      horizon: { value: new Color(SKY_COLOURS.horizon) },
      zenith: { value: new Color(SKY_COLOURS.zenith) },
      cloud: { value: new Color('#f1ecdf') },
      sun: { value: new Color('#fff0cb') },
      sunDirection: { value: new Vector3(-100,140,50).normalize() },
      time: { value: 0 },
      night: { value: 0 },
      cloudCover: { value: .35 }, weatherWeight: { value: 0 }, overlay: { value: 0 },
    },
    vertexShader: `varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${low ? 'gl_Position.z = gl_Position.w;' : ''}
      }`,
    fragmentShader: `uniform vec3 horizon; uniform vec3 zenith;
      uniform vec3 cloud; uniform vec3 sun; uniform vec3 sunDirection; uniform float time; uniform float night;
      uniform float cloudCover; uniform float weatherWeight; uniform float overlay;
      varying vec3 direction;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 cell = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
          mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), f.x), f.y);
      }
      float cloudField(vec2 p) {
        return noise(p) * 0.57 + noise(p * 2.07 + 4.2) * 0.28 + noise(p * 4.13 - 7.1) * 0.15;
      }
      void main() {
        vec3 ray = normalize(direction);
        float up = smoothstep(0.0, 0.75, ray.y);
        vec3 colour = mix(horizon, zenith, up);
        float sunAngle = dot(ray, sunDirection);
        float sunVisible = 1.0-cloudCover*weatherWeight*0.75;
        colour += sun * pow(max(0.0, sunAngle), 48.0) * mix(0.12, 0.025, night)*sunVisible;
        colour = mix(colour, sun, smoothstep(0.99955, 0.9998, sunAngle) * 0.9*sunVisible);
        ${V2 ? `// Graphics v2: a bright hazy horizon band and a wide sun glow that swells at golden hour/dusk.
        float lowSun = 1.0 - smoothstep(0.08, 0.55, sunDirection.y);
        colour = mix(colour, mix(horizon * 1.05, sun, 0.35 * lowSun), (1.0 - smoothstep(0.0, 0.12, ray.y)) * 0.18);
        float glow = pow(max(0.0, sunAngle), 6.0) * mix(0.10, 0.34, lowSun) + pow(max(0.0, sunAngle), 2.0) * (1.0 - up) * lowSun * 0.14;
        colour += sun * glow * (1.0 - night) * sunVisible;` : ''}
        // Two sparse marine cloud layers, projected onto the dome in world directions.
        vec2 uv = ray.xz / max(0.2, ray.y + 0.24);
        float cumulus = cloudField(uv * 3.1 + vec2(time * 0.002, 1.7));
        float wisps = cloudField(uv * vec2(1.8, 6.0) + vec2(8.0, -time * 0.001));
        float coverShift = (cloudCover-0.35)*0.28*weatherWeight;
        // skyCloudCover taper: the extra coverage/density fades out as the sun drops (hs -> 0 at golden hour/dusk),
        // so it fills the DAYTIME sky on blue and never over-brightens the warm golden-hour sky. Off: hs unused.
        ${bigClouds ? 'float hs = smoothstep(0.08, 0.45, sunDirection.y);' : ''}
        float v2Cover = ${V2 ? (bigClouds ? '(0.04 + 0.11*hs)' : '0.04') : '0.0'};
        float clouds = smoothstep(0.52-coverShift-v2Cover, 0.74-coverShift, cumulus) * ${bigClouds ? '(0.74 + 0.16*hs)' : '0.74'}
          + smoothstep(${bigClouds ? '(0.60 - 0.12*hs)' : '0.60'}-coverShift, 0.80-coverShift, wisps) * ${bigClouds ? '(0.25 + 0.17*hs)' : '0.25'};
        clouds *= smoothstep(0.025, 0.18, ray.y);
        vec3 cloudColour = mix(cloud * 0.84, cloud, smoothstep(0.5, 0.8, cumulus));
        ${V2 ? `// Sun-lit clouds: cooler, darker bases away from the sun; warm bright edges toward it, a silver lining
        // around the disc, and a strong warm wash on the sun side at golden hour.
        vec2 flatRay = normalize(ray.xz + vec2(1e-4)), flatSun = normalize(sunDirection.xz + vec2(1e-4));
        float sunSide = dot(flatRay, flatSun) * 0.5 + 0.5;
        float lowSunC = 1.0 - smoothstep(0.08, 0.55, sunDirection.y);
        vec3 shade = cloudColour * mix(vec3(0.88, 0.89, 0.94), vec3(1.0), smoothstep(0.55, 0.85, cumulus));
        cloudColour = mix(shade, cloudColour + sun * (0.08 + 0.32 * lowSunC), sunSide * sunSide * (1.0 - night));
        cloudColour += sun * pow(max(0.0, sunAngle), 14.0) * 0.55 * (1.0 - night);` : ''}
        colour = mix(colour, cloudColour, min(0.9, clouds) * mix(1.0, 0.22, night));
        ${V2 ? `// ---- Graphics v2 sky character ----
        float lowSunV = 1.0 - smoothstep(0.06, 0.5, sunDirection.y), dayV = 1.0 - night;
        vec2 flatR = normalize(ray.xz + vec2(1e-4)), flatS = normalize(sunDirection.xz + vec2(1e-4));
        float towardSun = dot(flatR, flatS) * 0.5 + 0.5;
        // High thin cirrus above the cumulus, streaked along one wind direction, caught by low sun.
        vec2 cuv = ray.xz / max(0.12, ray.y + 0.08);
        float cirrus = ${low ? '0.0;' : `smoothstep(0.55, 0.85, cloudField(cuv * vec2(0.9, 5.5) + vec2(time * 0.0006, 3.0)))
          * smoothstep(0.08, 0.35, ray.y) * (1.0 - smoothstep(0.75, 1.0, ray.y));`} // Low/phone: no cirrus (fill-rate)
        vec3 cirrusColour = mix(cloud, cloud * 0.6 + sun * 0.7, lowSunV * towardSun);
        colour = mix(colour, cirrusColour, cirrus * 0.35 * mix(1.0, 0.15, night));
        // Dusk: layered warm bands hugging the horizon, strongest toward the sun.
        float horizonBand = 1.0 - smoothstep(0.0, 0.28, ray.y);
        colour += sun * horizonBand * horizonBand * lowSunV * dayV * (0.18 + 0.32 * towardSun);
        // Volumetric-looking haze strata just above the horizon (bay/distance), broken up along the azimuth.
        float strata = ${low ? '0.0' : '(sin(ray.y * 140.0 + noise(flatR * 6.0) * 4.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.0, 0.07, ray.y))'};
        colour = mix(colour, horizon * 1.08 + sun * 0.06 * lowSunV, strata * 0.12 * dayV);
        // A defined sun disc with a soft limb (the v1 disc is a pin-prick).
        colour = mix(colour, sun * 1.25 + vec3(0.15), smoothstep(0.9988, 0.99935, sunAngle) * sunVisible * dayV);
        // Night: warm light pollution from the city along the horizon.
        colour += vec3(0.85, 0.48, 0.24) * ${flags.nightWarmth ? '0.3' : '0.16'} * night * (1.0 - smoothstep(0.0, ${flags.nightWarmth ? '0.24' : '0.16'}, ray.y));` : ''}
        // Low daytime fragments need no star projection/noise/derivatives: their contribution is zero.
        // night is uniform across the draw, so derivatives remain in uniform control flow at night.
        ${V2 && low ? 'if (night > 0.0) {' : ''}
        // Fixed world-direction stars: stable while moving, antialiased at phone resolution.
        vec2 starsUv = vec2(atan(ray.z,ray.x)/6.2831853+0.5, asin(clamp(ray.y,-1.0,1.0))/3.1415927+0.5)*vec2(360.0,180.0);
        vec2 cell = floor(starsUv);
        vec2 star = vec2(hash(cell+11.7),hash(cell+47.3))*0.6+0.2;
        float radius = mix(0.025,0.075,hash(cell+84.1));
        float edge = max(length(fwidth(starsUv))*0.45,0.015);
        float sparkle = (1.0-smoothstep(radius,radius+edge,length(fract(starsUv)-star)))
          * step(0.983,hash(cell))*smoothstep(0.06,0.22,ray.y);
        colour += vec3(0.62,0.74,0.92)*sparkle*night*(1.0-min(0.95,clouds*2.0)*weatherWeight);
        ${V2 && low ? '}' : ''}
        // Alpha is a sky mask inside the offscreen colour target; final composite is opaque.
        // Overlay mode (HD atmosphere sky underneath): only clouds, cirrus and stars cover it.
        float overlayAlpha = ${V2 ? (low ? 'clamp(clouds * 0.95, 0.0, 1.0)' /* Low scopes `sparkle` inside its star block; overlay is HD-only */ : 'clamp(clouds * 0.95 + cirrus * 0.35 + sparkle * night * 2.0, 0.0, 1.0)') : '0.0'};
        gl_FragColor = overlay > 0.5 ? vec4(colour, overlayAlpha) : vec4(colour, 0.0);
        #include <colorspace_fragment>
      }`,
    side: BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new Mesh(new SphereGeometry(1, 24, 12), material);
  mesh.name = 'Sky';
  mesh.frustumCulled = false;
  // Low shades the background after opaque depth is available. Keep it at the clip far plane
  // so even geometry beyond the dome rejects sky fragments; clouds/stars and HD stay unchanged.
  mesh.renderOrder = low ? 1000 : -1000;
  const position = new Vector3();
  return {
    mesh,
    horizon: material.uniforms.horizon!.value as Color,
    zenith: material.uniforms.zenith!.value as Color,
    applyGrade(grade: TimeGrade, nightEnabled = true): void {
      (material.uniforms.horizon!.value as Color).copy(grade.horizon);
      (material.uniforms.zenith!.value as Color).copy(grade.zenith);
      (material.uniforms.cloud!.value as Color).copy(grade.cloud);
      (material.uniforms.sun!.value as Color).copy(grade.sunColour);
      (material.uniforms.sunDirection!.value as Vector3).copy(grade.sunDirection);
      material.uniforms.night!.value = nightEnabled ? grade.night : 0;
    },
    /** HD atmosphere sky underneath: draw only clouds/stars, blended, after opaque geometry. */
    setOverlay(on: boolean): void {
      if ((material.uniforms.overlay!.value === 1) === on) return; // no-op: avoid recompiling every grade tick
      material.uniforms.overlay!.value = on ? 1 : 0; material.transparent = on; mesh.renderOrder = on ? 900 : (low ? 1000 : -1000);
      material.needsUpdate = true;
    },
    applyWeather(cloudCover: number, influence: number): void {
      material.uniforms.cloudCover!.value = Math.max(0, Math.min(1, cloudCover));
      material.uniforms.weatherWeight!.value = Math.max(0, Math.min(1, influence));
    },
    update(camera: Camera & { far: number }, seconds = performance.now() / 1000): void {
      // Follow the camera, including parent transforms; never expose a dome edge while driving.
      camera.getWorldPosition(position);
      mesh.position.copy(position);
      mesh.scale.setScalar(camera.far * 0.9);
      material.uniforms.time!.value = seconds;
    },
    dispose(): void { mesh.geometry.dispose(); material.dispose(); },
  };
}
