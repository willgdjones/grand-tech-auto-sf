/**
 * GTHF terrain chunk decoding + bilinear sampling, shared so the WORKER can test shot line of sight against the same
 * ground the client draws (serverTerrainLos). Byte-for-byte the format web/src/render/chunks/terrain.ts decodes
 * (that copy predates this module; lane A may switch it to import from here).
 */
export interface Heightfield { size: number; step: number; baseCm: number; x: number; z: number; values: Uint16Array }

export function decodeHeightfield(buffer: ArrayBuffer): Heightfield {
  const view = new DataView(buffer);
  if (view.byteLength < 32 || view.getUint32(0, false) !== 0x47544846 || view.getUint16(4, true) !== 1) throw new Error('Invalid GTHF map data');
  const size = view.getUint16(6, true), step = view.getFloat32(8, true);
  if (size < 2 || view.byteLength !== 32 + size * size * 2 || !Number.isFinite(step) || step <= 0 || Math.abs(view.getFloat32(24, true) - .01) > 1e-8) throw new Error('Invalid GTHF dimensions');
  const values = new Uint16Array(size * size);
  for (let i = 0; i < values.length; i++) values[i] = view.getUint16(32 + i * 2, true);
  return { size, step, baseCm: view.getInt32(12, true), x: view.getInt32(16, true), z: view.getInt32(20, true), values };
}

/** Ground height (m) at world (x, z) inside this chunk, or null outside it. */
export function sampleHeight(field: Heightfield, x: number, z: number): number | null {
  const span = (field.size - 1) * field.step;
  const u = (x - field.x * span) / field.step, v = (z - field.z * span) / field.step;
  if (u < 0 || v < 0 || u > field.size - 1 || v > field.size - 1) return null;
  const ix = Math.min(field.size - 2, Math.floor(u)), iz = Math.min(field.size - 2, Math.floor(v));
  const a = u - ix, b = v - iz, i = iz * field.size + ix;
  const top = field.values[i]! * (1 - a) + field.values[i + 1]! * a;
  const bottom = field.values[i + field.size]! * (1 - a) + field.values[i + field.size + 1]! * a;
  return (field.baseCm + top * (1 - b) + bottom * b) / 100;
}

/** The ground as the client DRAWS it: each grid cell split on its (x, z+s)-(x+s, z) diagonal (tools/map meshes.ts
 *  uncutGround), not bilinear — on a saddle cell bilinear sits up to |a+d-b-c|/4 above the drawn triangle, so a line
 *  skimming a crest that looks clear on screen would be blocked (reviewer 2108e126). Null outside this chunk. */
export function sampleDrawnHeight(field: Heightfield, x: number, z: number): number | null {
  const span = (field.size - 1) * field.step;
  const u = (x - field.x * span) / field.step, v = (z - field.z * span) / field.step;
  if (u < 0 || v < 0 || u > field.size - 1 || v > field.size - 1) return null;
  const ix = Math.min(field.size - 2, Math.floor(u)), iz = Math.min(field.size - 2, Math.floor(v));
  const fu = u - ix, fv = v - iz, i = iz * field.size + ix, n = field.size;
  const a = field.values[i]!, b = field.values[i + 1]!, c = field.values[i + n]!, d = field.values[i + n + 1]!;
  const h = fu + fv <= 1 ? a + fu * (b - a) + fv * (c - a) : d + (1 - fu) * (c - d) + (1 - fv) * (b - d);
  return (field.baseCm + h) / 100;
}
