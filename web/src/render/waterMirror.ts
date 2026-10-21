/*! Planar-camera reflection adapted from jeantimex/tokyo src/world/mirror.js.
 * Copyright (c) 2026 Yong Su, MIT; full notice in TOKYO-LICENSE.txt and /licenses/tokyo-MIT.txt.
 * GTASF: semantic streamed water masks, bounded HD target, ripples and safe lifecycle. */
import {
  BufferGeometry, Color, Float32BufferAttribute, Frustum, LinearFilter, LinearSRGBColorSpace,
  Matrix4, Mesh, PerspectiveCamera, Plane, ShaderMaterial, Sphere, UnsignedByteType,
  Vector2, Vector3, Vector4, WebGLRenderTarget, UniformsLib, UniformsUtils,
  type Object3D, type Scene, type WebGLRenderer,
} from 'three';
import { flags } from '@gtasf/shared/flags';

type Sky = { update(camera: PerspectiveCamera, seconds?: number): void };
type Patch = { mesh: Mesh<BufferGeometry, ShaderMaterial>; sphere: Sphere; level: number; source: Object3D; active: boolean };

/** Flag-off: nothing. Low (hd false): rippled sky-tinted water, no reflection pass or render target use. */
export function createWaterMirror(renderer: WebGLRenderer, scene: Scene, options: { hd: boolean; sky?: Sky }) {
  if (!flags.graphicsV2) return undefined;
  const target = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, minFilter: LinearFilter,
    magFilter: LinearFilter, depthBuffer: true, stencilBuffer: false, generateMipmaps: false });
  target.texture.colorSpace = LinearSRGBColorSpace;
  target.texture.name = 'HD water reflection (512px maximum edge)';
  const mirror = new PerspectiveCamera(), patches = new Set<Patch>(), releases = new Set<() => void>();
  const projection = new Matrix4(), rotation = new Matrix4(), mirrorMatrix = new Matrix4();
  const frustum = new Frustum(), size = new Vector2(), up = new Vector3(0, 1, 0);
  const eye = new Vector3(), look = new Vector3(), focus = new Vector3(), point = new Vector3();
  const plane = new Plane(), clip = new Plane(), c = new Vector4(), q = new Vector4(), clear = new Color();
  const uniforms = Object.assign(UniformsUtils.clone(UniformsLib.fog), {
    reflection: { value: target.texture }, mirrorMatrix: { value: mirrorMatrix },
    mirrorOn: { value: 0 }, mirrorLevel: { value: 0 }, time: { value: 0 },
    waterColour: { value: new Color().setRGB(.10, .23, .41) }, skyColour: { value: new Color() },
  });
  const material = new ShaderMaterial({ name: 'HD rippled Bay and lake mirror', uniforms,
    fog: true, toneMapped: false,
    vertexShader: `varying vec3 vWorld; varying vec4 vMirror;
      uniform mat4 mirrorMatrix;
      #include <fog_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz;
        vMirror = mirrorMatrix * world;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D reflection; uniform float mirrorOn, mirrorLevel, time;
      uniform vec3 waterColour, skyColour; varying vec3 vWorld; varying vec4 vMirror;
      #include <fog_pars_fragment>
      void main() {
        vec2 ripple = vec2(sin(vWorld.x*.7 + vWorld.z*.23 + time*.9),
          cos(vWorld.z*.61 - vWorld.x*.19 + time*.7));
        vec3 colour = waterColour * (1.0 + .035*ripple.x);
        vec3 view = normalize(cameraPosition-vWorld);
        float fresnel = .25 + .5*pow(1.0-clamp(view.y,0.0,1.0),3.0);
        if (mirrorOn > .5 && abs(vWorld.y-mirrorLevel) < .6 && vMirror.w > .001) {
          vec2 uv = vMirror.xy / vMirror.w * .5 + .5;
          uv += ripple * .0025;
          float edge = smoothstep(0.0,.025,min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y)));
          vec3 reflected = texture2D(reflection,clamp(uv,vec2(.001),vec2(.999))).rgb;
          colour = mix(colour, mix(skyColour, reflected, edge), fresnel);
        } else colour = mix(colour, skyColour, ${flags.waterGrazeCap ? 'min(fresnel, .45)' : 'fresnel'}*(.6 + .4*ripple.y)); // waterGrazeCap: cap grazing sky-reflection so distant water keeps its sea tone
        gl_FragColor = vec4(colour,1.0);
        #include <colorspace_fragment>
${flags.bayWaterRead ? `
        // bayWaterRead: the warm golden-hour fog swallowed the Bay to a flat orange void from the air. Fog the
        // water toward a COOL sky-reflection grey-blue (not the warm horizon) and CAP it so some water tone always
        // survives, so the Bay reads as water and its contrast with the warm land draws the shoreline. A faint wave
        // sheen in the mid-haze band keeps a sea surface instead of a painted void.
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
          #else
            float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          vec3 coolWater = mix(fogColor, vec3(0.34,0.46,0.58), 0.72);
          float wfog = min(fogFactor, 0.80);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, coolWater, wfog);
          gl_FragColor.rgb += vec3(0.05,0.06,0.07) * (0.5 + 0.5*ripple.y) * (1.0 - wfog) * fogFactor;
        #endif
      ` : '        #include <fog_fragment>'}
      }`,
  });
  let disposed = false, lastFrame = -Infinity, lastLevel = NaN;
  function mount(root: Object3D): () => void {
    if (disposed) return () => {};
    const owned: Patch[] = [];
    root.updateWorldMatrix(true, true);
    root.traverse(object => {
      if (!(object instanceof Mesh) || !/^terrain(?:_|$)/.test(object.name)) return;
      const geometry = object.geometry, positions = geometry.getAttribute('position'), colours = geometry.getAttribute('color');
      if (!positions || !colours) return;
      const index = geometry.index, count = index?.count ?? positions.count, vertices: number[] = [], heights: number[] = [];
      // Exact linear UNORM8 water palette from tools/map/src/pipeline/{meshes,districts}.ts.
      // No blue-material heuristic: mapped sand, park, pavement and roads never become water.
      const wet = (i: number) => Math.round(colours.getX(i)*255) === 26
        && Math.round(colours.getY(i)*255) === 59 && Math.round(colours.getZ(i)*255) === 105;
      for (let i = 0; i + 2 < count; i += 3) {
        const a = index?.getX(i) ?? i, b = index?.getX(i+1) ?? i+1, d = index?.getX(i+2) ?? i+2;
        if (!wet(a) || !wet(b) || !wet(d)) continue;
        for (const v of [a,b,d]) {
          point.fromBufferAttribute(positions,v).applyMatrix4(object.matrixWorld);
          vertices.push(point.x,point.y,point.z); heights.push(point.y);
        }
      }
      if (!vertices.length) return;
      heights.sort((a,b) => a-b);
      // Sea-level Bay; inland levels use the existing DEM water surface rather than a citywide ocean plane.
      const median = heights[Math.floor(heights.length/2)]!;
      let level = median < 1 ? 0 : Math.round(median*2)/2;
      // One lake split across streamed chunks shares the first mounted level, so chunk edges never step.
      if (level > 0) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < vertices.length; i += 3) {
          minX = Math.min(minX, vertices[i]!); maxX = Math.max(maxX, vertices[i]!);
          minZ = Math.min(minZ, vertices[i+2]!); maxZ = Math.max(maxZ, vertices[i+2]!);
        }
        const centre = new Vector3((minX+maxX)/2, median, (minZ+maxZ)/2);
        const radius = Math.hypot(maxX-minX, maxZ-minZ)/2;
        for (const other of patches) {
          if (other.level > 0 && Math.abs(other.level-median) < 1.5
            && other.sphere.center.distanceTo(centre) <= other.sphere.radius+radius+2) { level = other.level; break; }
        }
      }
      // Overlay the decoded water surface itself (never a plane above it), so piers, the Embarcadero deck and
      // shore buildings can't be covered; only near-level parts take the reflection (shader band check).
      for (let i = 1; i < vertices.length; i += 3) vertices[i] = vertices[i]! + .04;
      const surface = new BufferGeometry(); surface.setAttribute('position',new Float32BufferAttribute(vertices,3));
      surface.computeBoundingSphere();
      const mesh = new Mesh(surface,material); mesh.name = 'HD mapped water mirror';
      mesh.userData.gtasfWaterMirror = true;
      const patch = { mesh, sphere: surface.boundingSphere!.clone(), level, source: object, active: true };
      scene.add(mesh); patches.add(patch); owned.push(patch);
    });
    let released = false;
    const release = () => {
      if (released) return; released = true;
      for (const patch of owned) { patches.delete(patch); scene.remove(patch.mesh); patch.mesh.geometry.dispose(); }
      releases.delete(release);
    };
    releases.add(release); return release;
  }
  function update(camera: PerspectiveCamera, seconds = performance.now()/1000): void {
    if (disposed) return;
    uniforms.time!.value = seconds;
    const fog = scene.fog?.color, horizon = fog && Number.isFinite(fog.r+fog.g+fog.b) ? fog : undefined; // never NaN into water
    const daylight = horizon ? Math.min(1, Math.max(horizon.r,horizon.g,horizon.b)*2.5) : 1;
    (uniforms.waterColour!.value as Color).setRGB(.10,.23,.41).multiplyScalar(.12+.88*daylight);
    if (horizon) (uniforms.skyColour!.value as Color).copy(horizon);
    if (!options.hd) { for (const patch of patches) {
      let ancestor: Object3D | null = patch.source;
      while (ancestor && ancestor !== scene && ancestor.visible) ancestor = ancestor.parent;
      patch.mesh.visible = ancestor === scene;
    } return; }
    camera.updateWorldMatrix(true,false);
    eye.setFromMatrixPosition(camera.matrixWorld);
    camera.getWorldDirection(focus).multiplyScalar(35).add(eye);
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    let chosen: Patch | undefined, distance = Infinity;
    for (const patch of patches) {
      let ancestor: Object3D | null = patch.source;
      while (ancestor && ancestor !== scene && ancestor.visible) ancestor = ancestor.parent;
      patch.active = ancestor === scene; patch.mesh.visible = patch.active;
      if (!patch.active || eye.y <= patch.level+.1 || !frustum.intersectsSphere(patch.sphere)) continue;
      const d = Math.max(0,focus.distanceTo(patch.sphere.center)-patch.sphere.radius);
      if (d < distance) { distance = d; chosen = patch; }
    }
    if (!chosen || distance > 700) { uniforms.mirrorOn!.value = 0; lastFrame = -Infinity; return; }
    // One 15Hz reflection for the visible basin. Main camera and ripples still render every frame.
    const now = performance.now();
    if (now-lastFrame < 1000/15 && chosen.level === lastLevel) return;
    const level = chosen.level;
    renderer.getDrawingBufferSize(size);
    const scale = Math.min(.5,512/Math.max(size.x,size.y));
    const width = Math.max(1,Math.floor(size.x*scale)), height = Math.max(1,Math.floor(size.y*scale));
    if (target.width !== width || target.height !== height) target.setSize(width,height);
    look.set(0,0,-1).applyMatrix4(rotation.extractRotation(camera.matrixWorld)).add(eye);
    mirror.position.set(eye.x,2*level-eye.y,eye.z);
    mirror.up.set(0,1,0).applyMatrix4(rotation).reflect(up);
    mirror.lookAt(look.x,2*level-look.y,look.z);
    mirror.near = camera.near; mirror.far = camera.far; mirror.layers.mask = camera.layers.mask;
    mirror.updateMatrixWorld(); mirror.projectionMatrix.copy(camera.projectionMatrix);
    plane.set(up,-level); clip.copy(plane); clip.constant += .3;
    clip.applyMatrix4(mirror.matrixWorldInverse);
    const p = mirror.projectionMatrix.elements;
    c.set(clip.normal.x,clip.normal.y,clip.normal.z,clip.constant);
    q.set((Math.sign(c.x)+p[8]!)/p[0]!, (Math.sign(c.y)+p[9]!)/p[5]!, -1, (1+p[10]!)/p[14]!);
    const denominator = c.dot(q);
    if (Math.abs(denominator) < 1e-6) { uniforms.mirrorOn!.value = 0; return; }
    c.multiplyScalar(2/denominator);
    p[2]=c.x; p[6]=c.y; p[10]=c.z+1; p[14]=c.w;
    mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
    mirrorMatrix.multiplyMatrices(mirror.projectionMatrix,mirror.matrixWorldInverse);
    const previous = renderer.getRenderTarget(), shadows = renderer.shadowMap.autoUpdate;
    const shadowUpdate = renderer.shadowMap.needsUpdate;
    const xr = renderer.xr.enabled, alpha = renderer.getClearAlpha(); renderer.getClearColor(clear);
    uniforms.mirrorOn!.value = 0;
    for (const patch of patches) patch.mesh.visible = false;
    try {
      renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
      options.sky?.update(mirror,seconds);
      renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene,mirror);
      uniforms.mirrorLevel!.value = level; uniforms.mirrorOn!.value = 1;
      lastFrame = now; lastLevel = level;
    } finally {
      renderer.setRenderTarget(previous); renderer.setClearColor(clear,alpha);
      renderer.shadowMap.autoUpdate = shadows; renderer.shadowMap.needsUpdate = shadowUpdate; renderer.xr.enabled = xr;
      options.sky?.update(camera,seconds);
      for (const patch of patches) patch.mesh.visible = patch.active;
    }
  }
  return { mount, update, dispose() {
    if (disposed) return; disposed = true;
    for (const release of releases) release();
    target.dispose(); material.dispose();
  } };
}
