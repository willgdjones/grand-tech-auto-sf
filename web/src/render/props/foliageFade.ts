import type { MeshLambertMaterial, MeshStandardMaterial } from 'three';

/** Clear nearby leaf cards without transparent sorting or per-frame instance work. Works on the
 *  PS2 Lambert cards and on the realistic path's converted MeshStandardMaterial (same shader chunks). */
export function addFoliageCameraFade(material: MeshLambertMaterial | MeshStandardMaterial): void {
  if (material.userData.gtasfFoliageCameraFade) return;
  material.userData.gtasfFoliageCameraFade = true;
  const prepare = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${key}:foliage-camera-v1`;
  material.onBeforeCompile = (shader, renderer) => {
    prepare.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFoliageView;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFoliageView = mvPosition.xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFoliageView;
        float foliageBayer2(vec2 p) { return 2.0*p.x + 3.0*p.y - 4.0*p.x*p.y; }
      `)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        // Ordered coverage keeps the authored alpha silhouette and ordinary
        // opaque depth writes. At five metres the original material is intact.
        float foliageCoverage = smoothstep(2.0, 5.0, length(vFoliageView));
        vec2 foliagePixel = mod(floor(gl_FragCoord.xy), 4.0);
        float foliageThreshold = (4.0*foliageBayer2(mod(foliagePixel, 2.0))
          + foliageBayer2(floor(foliagePixel/2.0)) + 0.5) / 16.0;
        if (foliageCoverage < foliageThreshold) discard;
      `);
  };
  material.needsUpdate = true;
}

/** foliageCanopyHide (critic R1): when the CAMERA is inside a tree instance's canopy footprint (horizontal distance to the trunk
 *  under the card's scaled radius, height within the card's span), collapse that whole instance to its pivot in the vertex
 *  shader. No per-pixel discard (keeps early-Z, so it runs on Low too) and no dither speckle; the chase camera never sits inside
 *  a leaf card. `bounds` is the card geometry's local bounding box. */
export function addFoliageCanopyHide(material: MeshLambertMaterial | MeshStandardMaterial, bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }): void {
  if (material.userData.gtasfFoliageCanopyHide) return;
  // foundation.mountGeometry rebuilds world materials and re-applies this from userData (like gtasfFoliageCameraFade).
  material.userData.gtasfFoliageCanopyHide = { min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z }, max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z } };
  const radius = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x), Math.abs(bounds.min.z), Math.abs(bounds.max.z));
  const prepare = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${key}:foliage-canopy-hide-v1`;
  material.onBeforeCompile = (shader, renderer) => {
    prepare.call(material, shader, renderer);
    shader.uniforms.uCanopyR = { value: radius * 1.05 };
    shader.uniforms.uCanopyY = { value: [bounds.min.y, bounds.max.y] };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uCanopyR;\nuniform vec2 uCanopyY;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          mat4 canopyWorld = modelMatrix * instanceMatrix;
          vec3 canopyPivot = canopyWorld[3].xyz;
          float canopyScale = length(canopyWorld[0].xyz);
          vec2 canopyD = cameraPosition.xz - canopyPivot.xz;
          float canopyH = cameraPosition.y - canopyPivot.y, canopyR = uCanopyR * canopyScale;
          if (dot(canopyD, canopyD) < canopyR * canopyR && canopyH > uCanopyY.x * canopyScale - .5 && canopyH < uCanopyY.y * canopyScale + .5) transformed = vec3(0.0);
        #endif
      `);
  };
  material.needsUpdate = true;
}
