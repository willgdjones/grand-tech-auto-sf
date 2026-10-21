import { DataTexture, Material, Mesh, NearestFilter, RedFormat, UnsignedByteType, Vector4, type Box3, type Object3D } from 'three';

const SIZE = 64, CELL = 16, SPAN = SIZE * CELL;
/** Coarse coverage mask of currently visible, sufficiently refined tile content bounds.
 * Only complete cells are replaced. This is a render-only discard: no visibility flags,
 * geometry, heightfields, collision meshes or landmark walkable surfaces are modified. */
export function createGoogleCoverage() {
  const data = new Uint8Array(SIZE * SIZE);
  const texture = new DataTexture(data, SIZE, SIZE, RedFormat, UnsignedByteType);
  texture.minFilter = texture.magFilter = NearestFilter; texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const extent = new Vector4(0, 0, SPAN, SPAN);
  const enabled = { value: 0 };
  const uniforms = { uGoogleCoverage: { value: texture }, uGoogleExtent: { value: extent }, uGoogleCovered: enabled };
  const restores = new Map<Material, () => void>();
  function mount(root: Object3D) {
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      for (const material of [object.material].flat() as Material[]) {
        if (restores.has(material) || !('isMeshLambertMaterial' in material || 'isMeshStandardMaterial' in material
          || 'isMeshBasicMaterial' in material || 'isMeshPhongMaterial' in material)) continue;
        const compile = material.onBeforeCompile, key = material.customProgramCacheKey;
        // Three's default key reads the CURRENT hook. After wrapping, that would
        // collapse distinct authored shaders onto this common coverage function.
        // Custom keys remain live so their material-specific variants still work.
        const authoredKey = key === Material.prototype.customProgramCacheKey ? compile.toString() : undefined;
        material.onBeforeCompile = (shader, renderer) => {
          compile.call(material, shader, renderer);
          Object.assign(shader.uniforms, uniforms);
          shader.vertexShader = `varying vec2 vGoogleWorld;\n${shader.vertexShader}`.replace('#include <project_vertex>', `
            #include <project_vertex>
            vec4 googleWorld = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              googleWorld = instanceMatrix * googleWorld;
            #endif
            vGoogleWorld = (modelMatrix * googleWorld).xz;
          `);
          shader.fragmentShader = `uniform sampler2D uGoogleCoverage; uniform vec4 uGoogleExtent;
            uniform float uGoogleCovered; varying vec2 vGoogleWorld;\n${shader.fragmentShader}`
            .replace('#include <clipping_planes_fragment>', `
              #include <clipping_planes_fragment>
              if (uGoogleCovered > 0.5) {
                vec2 googleUv = (vGoogleWorld - uGoogleExtent.xy) / uGoogleExtent.zw;
                if (all(greaterThanEqual(googleUv, vec2(0.0))) && all(lessThan(googleUv, vec2(1.0)))
                  && texture2D(uGoogleCoverage, googleUv).r > 0.5) discard;
              }
            `);
        };
        material.customProgramCacheKey = () => `${authoredKey ?? key.call(material)}:google-coverage-v2`;
        material.needsUpdate = true;
        const dispose = () => { restores.delete(material); material.removeEventListener('dispose', dispose); };
        material.addEventListener('dispose', dispose);
        restores.set(material, () => {
          material.removeEventListener('dispose', dispose);
          material.onBeforeCompile = compile; material.customProgramCacheKey = key; material.needsUpdate = true;
        });
      }
    });
  }
  function update(boxes: readonly Box3[], focus: { x: number; z: number }) {
    extent.x = Math.floor(focus.x / CELL) * CELL - SPAN / 2;
    extent.y = Math.floor(focus.z / CELL) * CELL - SPAN / 2;
    data.fill(0);
    // Merge X intervals for each complete row strip, so adjacent tile bounds don't
    // punch artificial seams into our map. Partial cells stay on the authored fallback.
    for (let row = 0; row < SIZE; row++) {
      const z0 = extent.y + row * CELL, z1 = z0 + CELL;
      const intervals = boxes.filter(box => box.min.z <= z0 && box.max.z >= z1)
        .map(box => [box.min.x, box.max.x] as const).sort((a, b) => a[0] - b[0]);
      let end = -Infinity, start = Infinity;
      const fill = () => {
        const left = Math.max(0, Math.ceil((start - extent.x) / CELL));
        const right = Math.min(SIZE, Math.floor((end - extent.x) / CELL));
        if (right > left) data.fill(255, row * SIZE + left, row * SIZE + right);
      };
      for (const [left, right] of intervals) {
        if (left > end + .01) { fill(); start = left; end = right; }
        else end = Math.max(end, right);
      }
      fill();
    }
    enabled.value = boxes.length ? 1 : 0; texture.needsUpdate = true;
  }
  return { mount, update, clear() { enabled.value = 0; }, dispose() {
    enabled.value = 0; for (const restore of restores.values()) restore(); restores.clear(); texture.dispose();
  } };
}
