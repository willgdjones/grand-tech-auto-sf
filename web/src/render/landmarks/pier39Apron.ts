import { BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshLambertMaterial } from 'three';

type HeightAt = (x: number, z: number) => number | null;
export const PIER39_TRANSITION = { minX: -58, maxX: 58, minZ: 191, maxZ: 195 } as const;

/** Blend the existing pier apron into the sampled quay, retaining a fixed sea deck. */
export function createPier39Apron() {
  const { minX, maxX, minZ, maxZ } = PIER39_TRANSITION;
  const columns = maxX - minX, rows = maxZ - minZ, stride = columns + 1;
  const geometry = new BufferGeometry(), positions = new Float32Array(stride * (rows + 1) * 3);
  const colours = new Float32Array(positions.length), indices: number[] = [], colour = new Color('#b2ad9a');
  for (let z = 0; z <= rows; z++) for (let x = 0; x <= columns; x++) {
    const i = (z * stride + x) * 3; positions[i] = minX + x; positions[i + 2] = minZ + z; colour.toArray(colours, i);
    if (x < columns && z < rows) { const a = z * stride + x, b = a + 1, c = a + stride, d = c + 1; indices.push(a, c, b, b, c, d); }
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.name = 'Pier 39 quay transition'; mesh.visible = false;
  const attribute = geometry.getAttribute('position'); let ready = false;
  function resample(sample: HeightAt) {
    const edge = new Float32Array(stride);
    for (let x = 0; x <= columns; x++) {
      const ground = sample(minX + x, maxZ);
      if (ground === null || !Number.isFinite(ground)) { ready = false; mesh.visible = false; return; }
      edge[x] = ground;
    }
    let changed = !ready;
    for (let z = 0; z <= rows; z++) for (let x = 0; x <= columns; x++) {
      const i = z * stride + x, y = edge[x]! * z / rows;
      if (Math.abs(attribute.getY(i) - y) > 1e-5) { attribute.setY(i, y); changed = true; }
    }
    ready = true; mesh.visible = true;
    if (changed) { attribute.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingSphere(); }
  }
  function heightAt(x: number, z: number): number | null {
    if (!ready || x < minX || x > maxX || z < minZ || z > maxZ) return null;
    const u = x - minX, v = z - minZ, ix = Math.min(columns - 1, Math.floor(u)), iz = Math.min(rows - 1, Math.floor(v));
    const fx = u - ix, fz = v - iz, a = iz * stride + ix, b = a + 1, c = a + stride, d = c + 1;
    // Match the visible triangle diagonal, including a sloping waterfront edge.
    return fx + fz <= 1 ? attribute.getY(a) + (attribute.getY(b) - attribute.getY(a)) * fx + (attribute.getY(c) - attribute.getY(a)) * fz
      : attribute.getY(d) + (attribute.getY(b) - attribute.getY(d)) * (1 - fz) + (attribute.getY(c) - attribute.getY(d)) * (1 - fx);
  }
  return { mesh, resample, heightAt };
}
