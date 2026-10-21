import { CanvasTexture, Color, DataTexture, LinearFilter, Mesh, PlaneGeometry, RedFormat, ShaderMaterial, type Texture, UnsignedByteType, Vector4, type PerspectiveCamera, type Scene } from 'three';
import { flags } from '@gtasf/shared/flags';

/**
 * bayWaterRead: a distant open-water surface for the Bay. aerialFarClipWater removes the far water chunks (they
 * would otherwise render as flat tan slabs), which leaves the Bay as a geometry-less void that the warm fog/sky
 * fills — from the air the whole Bay reads as a flat orange nothing. This adds one large plane that follows the
 * camera just below sea level, so land and the streamed near-water (waterMirror) occlude it and it only shows
 * through the open-water gaps. It renders as cool, sky-tinted water fading to a cool haze at distance (never the
 * warm horizon), so the Bay reads as water and its contrast with the warm land draws the shoreline. HD + Low.
 */
export function createBayWater(scene: Scene) {
  if (!flags.bayWaterRead || !flags.graphicsV2) return undefined;
  const geometry = new PlaneGeometry(60000, 60000, 1, 1);
  geometry.rotateX(-Math.PI / 2); // flat, normal up
  const uniforms = {
    time: { value: 0 },
    uWater: { value: new Color().setRGB(0.09, 0.19, 0.31) },  // deep steel-blue bay
    uHaze: { value: new Color().setRGB(0.30, 0.42, 0.53) },   // cool blue-grey far haze
    uReflect: { value: new Color().setRGB(0.30, 0.42, 0.53) }, // cool sky reflection (not the warm horizon)
    uSheen: { value: new Color().setRGB(0.95, 0.86, 0.66) },  // warm sun glitter on the crests
    // shoreSeams: coastline land mask (1 = water); slivers in the ground mesh over land show a ground tone, not water.
    uLand: { value: null as Texture | null }, uLandBox: { value: new Vector4() }, uLandOn: { value: 0 },
    uLandColour: { value: new Color().setRGB(0.40, 0.35, 0.26) },
  };
  const shore = flags.shoreSeams;
  const material = new ShaderMaterial({
    name: 'GTASF bay water', uniforms, fog: false, toneMapped: false,
    vertexShader: `varying vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float time; uniform vec3 uWater, uHaze, uReflect, uSheen; varying vec3 vWorld;${shore ? `
      uniform sampler2D uLand; uniform vec4 uLandBox; uniform float uLandOn; uniform vec3 uLandColour;` : ''}
      void main() {
        float r = 0.5 * sin(vWorld.x * 0.015 + time * 0.6) + 0.5 * cos(vWorld.z * 0.012 - time * 0.5);
        float rf = 0.5 * sin(vWorld.x * 0.09 - time * 0.9) + 0.5 * cos(vWorld.z * 0.08 + time * 0.8);
        vec3 water = uWater * (1.0 + 0.06 * r);
        vec3 view = normalize(cameraPosition - vWorld);
        float fres = 0.12 + 0.42 * pow(1.0 - clamp(view.y, 0.0, 1.0), 4.0);
        // grazing water reflects the COOL sky, not the warm horizon, so the Bay reads blue-grey, not pale cream.
        vec3 c = mix(water, uReflect, fres);
        // wave sheen: bright glitter on the crests, strongest at grazing angles (sun on water).
        float sheen = pow(clamp(r * 0.5 + 0.5, 0.0, 1.0), 3.0) * (0.35 + 0.65 * clamp(rf, 0.0, 1.0)) * (0.3 + 0.7 * fres);
        c += uSheen * sheen * 0.22;${shore ? `
        // Near the camera only (far-ring lakes clipped by aerialFarClipWater, e.g. Lake Merced, stay water), and only
        // fetched there: the 2048^2 mask on every far pixel cost ~8 fps on phone Low.
        float landNear = 1.0 - smoothstep(250.0, 450.0, length(vWorld.xz - cameraPosition.xz));
        if (uLandOn > 0.5 && landNear > 0.0) {
          vec2 luv = (vWorld.xz - uLandBox.xy) * uLandBox.zw;
          float wet = any(lessThan(luv, vec2(0.0))) || any(greaterThan(luv, vec2(1.0))) ? 1.0 : texture2D(uLand, luv).r;
          c = mix(c, uLandColour, (1.0 - wet) * landNear);
        }` : ''}
        float haze = smoothstep(300.0, 9000.0, length(vWorld.xz - cameraPosition.xz));
        c = mix(c, uHaze, min(haze, 0.78));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'GTASF bay water';
  // shoreSeams: drawn after the other opaques (not first), so depth rejects the land-covered pixels before the mask fetch.
  mesh.frustumCulled = false; mesh.renderOrder = shore ? 1 : -1;
  scene.add(mesh);
  const cool = new Color().setRGB(0.28, 0.40, 0.52);
  const landBase = new Color().setRGB(0.40, 0.35, 0.26); // the warm grey of the paving/road mix the slivers cut through
  // The rings + uploader of the last mask, so a WebGL context restore can rebuild it (the uploaded canvas is freed to 1x1).
  let lastRings: readonly (readonly (readonly [number, number])[])[] | null = null, lastUpload: ((texture: Texture) => void) | undefined;
  const water = {
    /** shoreSeams: rasterise the map's coastline water rings (world [x,z], even-odd) into a 2048^2 R8 land mask. */
    /** `upload`: push the mask to the GPU now (renderer.initTexture), not lazily on the first water frame (reviewer 10-20). */
    setCoastline(rings: readonly (readonly (readonly [number, number])[])[], upload?: (texture: Texture) => void): void {
      if (!shore || !rings.length || uniforms.uLand.value) return;
      lastRings = rings; lastUpload = upload;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const ring of rings) for (const [x, z] of ring) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      const size = 2048, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      // coastlineCanvasUpload (gtasf-9oe0r): the readback below (16 MB getImageData + a 4M-texel copy) was ~600 ms of a cold 4x
      // phone's boot. Upload the canvas itself as a single-channel R8 texture instead (WebGL2 takes RED from a canvas source).
      // Blink only: in headless WebKit (Safari's engine) the canvas -> R8 upload measured slower than the readback (157 vs 97 ms,
      // reviewer's WebKit check 10-20), so Safari keeps the original path until a real-device read says otherwise.
      // Every iOS browser is WebKit (CriOS / EdgiOS included; reviewer 15:3x), and iPadOS reports as Macintosh with touch.
      const nav = typeof navigator !== 'undefined' ? navigator : undefined, ua = nav?.userAgent ?? '';
      const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1);
      const blink = !ios && /Chrome\/|Chromium\/|Edg\//.test(ua);
      const direct = flags.coastlineCanvasUpload && blink;
      const g = canvas.getContext('2d', direct ? undefined : { willReadFrequently: true });
      if (!g || !(maxX > minX) || !(maxZ > minZ)) return;
      const sx = size / (maxX - minX), sz = size / (maxZ - minZ);
      g.fillStyle = '#000'; g.fillRect(0, 0, size, size); g.fillStyle = '#fff'; g.beginPath();
      for (const ring of rings) ring.forEach(([x, z], i) => i ? g.lineTo((x - minX) * sx, (z - minZ) * sz) : g.moveTo((x - minX) * sx, (z - minZ) * sz));
      g.fill('evenodd');
      let texture: Texture;
      if (direct) {
        const canvasTexture = new CanvasTexture(canvas);
        canvasTexture.format = RedFormat; canvasTexture.internalFormat = 'R8'; canvasTexture.type = UnsignedByteType;
        canvasTexture.flipY = false; canvasTexture.generateMipmaps = false; // the DataTexture's orientation, no mips
        texture = canvasTexture;
      } else {
        const rgba = g.getImageData(0, 0, size, size).data, red = new Uint8Array(size * size);
        for (let i = 0; i < red.length; i++) red[i] = rgba[i * 4]!;
        texture = new DataTexture(red, size, size, RedFormat, UnsignedByteType);
      }
      texture.magFilter = texture.minFilter = LinearFilter; texture.needsUpdate = true;
      upload?.(texture);
      // The GPU copy is made: drop the 2048^2 canvas's 16 MB backing store (reviewer LOW). Only a context loss would re-upload it.
      if (direct && upload) canvas.width = canvas.height = 1;
      uniforms.uLand.value = texture; uniforms.uLandOn.value = 1;
      uniforms.uLandBox.value.set(minX, minZ, 1 / (maxX - minX), 1 / (maxZ - minZ));
    },
    update(camera: PerspectiveCamera, seconds = performance.now() / 1000, fog?: Color): void {
      uniforms.time.value = seconds;
      mesh.position.set(camera.position.x, -0.4, camera.position.z);
      if (fog && Number.isFinite(fog.r + fog.g + fog.b)) {
        // Far haze and the grazing reflection stay mostly cool, with only a touch of the time-of-day sky warmth;
        // the warm sun tone goes into the sheen, not the body of the water.
        uniforms.uHaze.value.copy(cool).lerp(fog, 0.22);
        uniforms.uReflect.value.copy(cool).lerp(fog, 0.18);
        uniforms.uSheen.value.copy(fog).multiplyScalar(1.15);
        // The plane is unlit: follow the daylight through the fog's brightness so slivers never glow at night.
        if (shore) uniforms.uLandColour.value.copy(landBase).multiplyScalar(Math.min(1, Math.max(0.3, (0.2126 * fog.r + 0.7152 * fog.g + 0.0722 * fog.b) / 0.55)));
      }
    },
    /** After a WebGL context restore (phone backgrounding): three would re-upload the freed 1x1 canvas, so build the mask
     *  again from the cached rings (reviewer 10-20). */
    restoreCoastline(): void {
      if (!lastRings) return;
      uniforms.uLand.value?.dispose(); uniforms.uLand.value = null; uniforms.uLandOn.value = 0;
      water.setCoastline(lastRings, lastUpload);
    },
    dispose(): void { scene.remove(mesh); geometry.dispose(); material.dispose(); uniforms.uLand.value?.dispose(); },
  };
  return water;
}
