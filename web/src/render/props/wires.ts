import { Box3, Matrix4, Mesh, Vector2, type Group, type InterleavedBufferAttribute, type WebGLRenderer } from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export type WirePoint = readonly [number, number, number];
export type WireCollision = (x: number, y: number, z: number, radius: number, height: number) => boolean;

export function saggedWire(a: WirePoint, b: WirePoint, sag: number): WirePoint[] {
  return Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
  });
}

/** Cooperative clearance cursor. No cable is clear until the final return value is true. */
export function* wireClearanceSteps(points: readonly WirePoint[], collides: WireCollision): Generator<void, boolean> {
  let probes = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
    // Overlapping probes cover the whole segment with a small facade clearance.
    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      if (collides(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - .6,
        a[2] + (b[2] - a[2]) * t, .6, 1.2)) return false;
      // Keep the same overlapping samples, but let a real-frame caller pause
      // long curves without exposing an unchecked prefix of the cable.
      if (++probes === 8) { probes = 0; yield; }
    }
  }
  return true;
}

/** Reject the complete cable, including between curve vertices, before drawing any of it. */
export function wireClearsBuildings(points: readonly WirePoint[], collides: WireCollision): boolean {
  const checks = wireClearanceSteps(points, collides);
  let result = checks.next();
  while (!result.done) result = checks.next();
  return result.value;
}

/** Source footprints omit authored replacements. Reuse their local solids and current transforms. */
export function createLandmarkWireCollision(landmarks?: Group): WireCollision & { revision(): number } {
  const ids = new Set(['ferry-building', 'transamerica-pyramid', 'salesforce-tower', 'coit-tower', 'painted-ladies', 'pier-39']);
  const candidates = (landmarks?.children ?? []).filter(o => ids.has(o.userData.landmarkId)).map(object => {
    object.updateWorldMatrix(true, true);
    const inverse = new Matrix4().copy(object.matrixWorld).invert(), bounds = new Box3();
    object.traverse(child => {
      if (!(child instanceof Mesh)) return;
      child.geometry.computeBoundingBox();
      if (child.geometry.boundingBox) bounds.union(child.geometry.boundingBox.clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, child.matrixWorld)));
    });
    const footprints = object.userData.solidFootprints as { minX: number; maxX: number; minZ: number; maxZ: number }[] | undefined;
    const solids = footprints?.length ? footprints.map(p => ({ ...p, minY: bounds.min.y, maxY: bounds.max.y }))
      : [{ minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z, minY: bounds.min.y, maxY: bounds.max.y }];
    return { object, solids, x: NaN, y: NaN, z: NaN, yaw: NaN, active: false };
  });
  const collides: WireCollision = (x, y, z, radius, height) => {
    for (const { object, solids } of candidates) {
      if (!object.visible || object.parent !== landmarks) continue;
      const dx = x - object.position.x, dz = z - object.position.z, c = Math.cos(object.rotation.y), s = Math.sin(object.rotation.y);
      const lx = c * dx - s * dz, lz = s * dx + c * dz, ly = y - object.position.y;
      for (const p of solids) {
        if (ly + height < p.minY || ly > p.maxY) continue;
        const ex = lx - Math.max(p.minX, Math.min(p.maxX, lx)), ez = lz - Math.max(p.minZ, Math.min(p.maxZ, lz));
        if (ex * ex + ez * ez <= radius * radius) return true;
      }
    }
    return false;
  };
  let revision = 0;
  return Object.assign(collides, { revision() {
    for (const state of candidates) {
      const { object } = state, { x, y, z } = object.position, yaw = object.rotation.y;
      const active = object.visible && object.parent === landmarks;
      if (state.x !== x || state.y !== y || state.z !== z || state.yaw !== yaw || state.active !== active) {
        state.x = x; state.y = y; state.z = z; state.yaw = yaw; state.active = active; revision++;
      }
    }
    return revision;
  } });
}

/** One bounded instanced draw; screen-space thickness survives the low-resolution render target. */
export function createWireRibbons(capacity: number, low = false) {
  const positions = new Float32Array(capacity * 6);
  const geometry = new LineSegmentsGeometry().setPositions(positions); geometry.instanceCount = 0;
  const material = new LineMaterial({ color: '#303c38', linewidth: 1.5, worldUnits: false,
    transparent: true, depthTest: true, depthWrite: false, fog: true });
  material.uniforms.wireFade = { value: low ? [85, 200] : [140, 330] };
  material.vertexShader = material.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWireDistance;')
    .replace('// clip space', 'vWireDistance = length(mix(start.xyz, end.xyz, step(0.5, position.y)));\n// clip space')
    .replace('offset *= linewidth;', 'offset *= max(linewidth, min(4.0, 0.024 * resolution.y * projectionMatrix[1][1] / max(0.2, -mix(start.z, end.z, step(0.5, position.y)))));');
  material.fragmentShader = material.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWireDistance;\nuniform vec2 wireFade;')
    .replace('gl_FragColor = vec4( diffuseColor.rgb, alpha );', `
      float edge = 1.0 - smoothstep(1.0 - fwidth(vUv.x), 1.0, abs(vUv.x));
      alpha *= edge * (1.0 - smoothstep(wireFade.x, wireFade.y, vWireDistance));
      if (alpha < 0.002) discard;
      gl_FragColor = vec4(diffuseColor.rgb, alpha);`);
  const mesh = new LineSegments2(geometry, material); mesh.name = 'Sagging power and Muni wire ribbons';
  mesh.userData.gtasfStreetWire = true; mesh.frustumCulled = false;
  // LineMaterial sizes the ribbon in screen space: the shader derives `aspect`
  // from `resolution` and divides the offset by `resolution.y`. The uniform
  // defaults to (0,0), so without this the width math is 0/0 = NaN, every wire
  // vertex collapses and the cables (the most SA-specific street detail) never
  // draw — and the distance anti-aliasing floor is dead. three.js calls
  // onBeforeRender right before each draw, so the resolution tracks the current
  // (low-res) drawing buffer on every frame, including after a resize.
  material.resolution.set(1920, 1080); // harmless non-zero until the first draw
  const drawBuffer = new Vector2();
  mesh.onBeforeRender = (renderer: WebGLRenderer) => {
    renderer.getDrawingBufferSize(drawBuffer);
    if (drawBuffer.x > 0 && drawBuffer.y > 0 && !material.resolution.equals(drawBuffer)) material.resolution.copy(drawBuffer);
  };
  let count = 0;
  return {
    mesh, capacity,
    get count() { return count; },
    reset() { count = 0; },
    add(points: readonly WirePoint[]) {
      if (count + points.length - 1 > capacity) return false;
      for (let i = 1; i < points.length; i++) { positions.set(points[i - 1]!, count * 6); positions.set(points[i]!, count * 6 + 3); count++; }
      return true;
    },
    flush() { geometry.instanceCount = count; (geometry.getAttribute('instanceStart') as InterleavedBufferAttribute).data.needsUpdate = true; },
    destroy() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
