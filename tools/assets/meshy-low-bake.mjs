/**
 * Low LOD for a Meshy car with a fresh UV atlas and baked textures (gtasf-g7050).
 *
 * Meshy's UV atlas is fragmented (about 2.5 vertices per position), so simplifying with its seams intact stalls near
 * 10k triangles and ~300 KB, and simplifying across them (the old 'Permissive' pass) tears the texture: the phone
 * Low cars looked shattered. Here we simplify positions only, chart the result by dominant axis (box projection), pack
 * the charts, and bake the source base colour and metal-rough onto the new atlas from the closest source surface.
 *
 * Input: a normalised single-primitive document at full source resolution. Output: the same document with a ~`tris`
 * triangle primitive (POSITION, NORMAL, TEXCOORD_0) and PNG base colour / metal-rough at `bakeSize` (the caller's
 * textureCompress resizes and encodes them).
 */
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';

const CREASE = Math.cos(60 * Math.PI / 180);

/** Decode a glTF texture to RGBA8 for bilinear sampling. */
async function decode(texture) {
  if (!texture) return null;
  const { data, info } = await sharp(texture.getImage()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function sample(image, u, v, out) {
  const { data, width, height } = image;
  const x = u * width - .5, y = v * height - .5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const wrap = (i, n) => ((i % n) + n) % n;
  const xa = wrap(x0, width), xb = wrap(x0 + 1, width), ya = wrap(y0, height), yb = wrap(y0 + 1, height);
  for (let c = 0; c < 4; c++) {
    const top = data[(ya * width + xa) * 4 + c] * (1 - fx) + data[(ya * width + xb) * 4 + c] * fx;
    const bottom = data[(yb * width + xa) * 4 + c] * (1 - fx) + data[(yb * width + xb) * 4 + c] * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
}

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5); returns barycentrics in out. */
function closestBary(p, a, b, c, out) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return set(out, 1, 0, 0);
  const bpx = p[0] - b[0], bpy = p[1] - b[1], bpz = p[2] - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return set(out, 0, 1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return set(out, 1 - v, v, 0); }
  const cpx = p[0] - c[0], cpy = p[1] - c[1], cpz = p[2] - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return set(out, 0, 0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return set(out, 1 - w, 0, w); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return set(out, 0, 1 - w, w); }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  return set(out, 1 - v - w, v, w);
}
function set(out, a, b, c) { out[0] = a; out[1] = b; out[2] = c; return out; }

/** Uniform grid over the source triangles for closest-surface queries. */
function buildGrid(positions, indices, cell) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]);
  }
  const dims = min.map((m, k) => Math.max(1, Math.ceil((max[k] - m) / cell) + 1));
  const cells = new Map();
  const key = (x, y, z) => (x * dims[1] + y) * dims[2] + z;
  for (let t = 0; t < indices.length / 3; t++) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
      const v = positions[indices[t * 3 + j] * 3 + k];
      lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v);
    }
    const a = lo.map((v, k) => Math.floor((v - min[k]) / cell)), b = hi.map((v, k) => Math.floor((v - min[k]) / cell));
    for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) {
      const id = key(x, y, z);
      let list = cells.get(id);
      if (!list) cells.set(id, list = []);
      list.push(t);
    }
  }
  return { min, dims, cell, cells, key };
}

/**
 * Closest source triangle to p whose face normal agrees with n (falls back to any facing). Searches grid rings outward
 * and stops once the best hit is provably nearer than the next ring.
 */
function makeQuery(positions, indices, faceNormals, grid) {
  const stamp = new Int32Array(indices.length / 3).fill(-1), bary = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  let query = 0;
  const vertex = (i, out) => { out[0] = positions[i * 3]; out[1] = positions[i * 3 + 1]; out[2] = positions[i * 3 + 2]; return out; };
  return (p, n, maxRings = 5) => {
    for (const minDot of [.2, -2]) {
      query++;
      let best = -1, bestD = Infinity; const bestBary = [0, 0, 0];
      const centre = p.map((v, k) => Math.floor((v - grid.min[k]) / grid.cell));
      for (let ring = 0; ring <= maxRings; ring++) {
        for (let x = centre[0] - ring; x <= centre[0] + ring; x++) for (let y = centre[1] - ring; y <= centre[1] + ring; y++) for (let z = centre[2] - ring; z <= centre[2] + ring; z++) {
          if (Math.max(Math.abs(x - centre[0]), Math.abs(y - centre[1]), Math.abs(z - centre[2])) !== ring) continue;
          if (x < 0 || y < 0 || z < 0 || x >= grid.dims[0] || y >= grid.dims[1] || z >= grid.dims[2]) continue;
          const list = grid.cells.get(grid.key(x, y, z));
          if (!list) continue;
          for (const t of list) {
            if (stamp[t] === query) continue;
            stamp[t] = query;
            if (faceNormals[t * 3] * n[0] + faceNormals[t * 3 + 1] * n[1] + faceNormals[t * 3 + 2] * n[2] < minDot) continue;
            vertex(indices[t * 3], a); vertex(indices[t * 3 + 1], b); vertex(indices[t * 3 + 2], c);
            closestBary(p, a, b, c, bary);
            let d = 0;
            for (let k = 0; k < 3; k++) { const q = a[k] * bary[0] + b[k] * bary[1] + c[k] * bary[2] - p[k]; d += q * q; }
            if (d < bestD) { bestD = d; best = t; bestBary[0] = bary[0]; bestBary[1] = bary[1]; bestBary[2] = bary[2]; }
          }
        }
        // Anything outside the searched cube is at least `ring * cell` away.
        if (best >= 0 && Math.sqrt(bestD) <= ring * grid.cell) break;
      }
      if (best >= 0) return { triangle: best, bary: bestBary };
    }
    return null;
  };
}

function faceNormal(positions, i0, i1, i2) {
  const ax = positions[i1 * 3] - positions[i0 * 3], ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1], az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
  const bx = positions[i2 * 3] - positions[i0 * 3], by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1], bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
  const n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  const area2 = Math.hypot(n[0], n[1], n[2]);
  return { n: area2 > 0 ? n.map(v => v / area2) : [0, 1, 0], area: area2 / 2 };
}

/** Shelf-pack rectangles (sorted tallest first) into a size x size square; returns placements or null. */
function pack(rects, size) {
  const order = rects.map((r, i) => i).sort((a, b) => rects[b].h - rects[a].h);
  const placed = new Array(rects.length);
  let x = 0, y = 0, shelf = 0;
  for (const i of order) {
    const { w, h } = rects[i];
    if (w > size) return null;
    if (x + w > size) { y += shelf; x = 0; shelf = 0; }
    if (y + h > size) return null;
    placed[i] = { x, y };
    x += w; shelf = Math.max(shelf, h);
  }
  return placed;
}

/**
 * @param {import('@gltf-transform/core').Document} doc normalised, single primitive, source resolution
 * @param {{ tris: number, error: number, bakeSize: number, padding: number }} options padding in bake texels
 */
export async function bakeLow(doc, { tris, error, bakeSize, padding }) {
  const primitives = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
  if (primitives.length !== 1) throw new Error(`bakeLow expects one primitive, got ${primitives.length}`);
  const [primitive] = primitives, material = primitive.getMaterial();
  const srcPos = Float32Array.from(primitive.getAttribute('POSITION').getArray());
  const srcUv = primitive.getAttribute('TEXCOORD_0').getArray();
  const srcIdx = Uint32Array.from(primitive.getIndices()?.getArray() ?? srcPos.map((_, i) => i).slice(0, srcPos.length / 3));
  const baseColor = await decode(material.getBaseColorTexture()), metalRough = await decode(material.getMetallicRoughnessTexture());

  // 1. Simplify on positions only: weld UV-seam duplicates so the simplifier sees one connected surface.
  // Compact first: meshopt treats any other vertex at the same position (even unreferenced) as a seam and locks it.
  const remap = MeshoptSimplifier.generatePositionRemap(srcPos, 3);
  const welded = [...new Set(remap)], compact = new Map(welded.map((v, i) => [v, i]));
  const pos = new Float32Array(welded.length * 3);
  welded.forEach((v, i) => pos.set(srcPos.subarray(v * 3, v * 3 + 3), i * 3));
  const [simplified, achieved] = MeshoptSimplifier.simplify(srcIdx.map(i => compact.get(remap[i])), pos, 3, Math.floor(tris) * 3, error, []);
  // Unreferenced vertices after simplification are harmless (charting only visits face corners).
  const idx = simplified;
  const faces = idx.length / 3;

  // 2. Face normals; corner normals smoothed across edges under the crease angle.
  const fn = new Float32Array(faces * 3), area = new Float32Array(faces);
  for (let f = 0; f < faces; f++) { const { n, area: a } = faceNormal(pos, idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]); fn.set(n, f * 3); area[f] = a; }
  const vertexFaces = Array.from({ length: welded.length }, () => []);
  for (let f = 0; f < faces; f++) for (let j = 0; j < 3; j++) vertexFaces[idx[f * 3 + j]].push(f);
  const cornerNormal = new Float32Array(faces * 9);
  for (let f = 0; f < faces; f++) for (let j = 0; j < 3; j++) {
    const n = [0, 0, 0];
    for (const g of vertexFaces[idx[f * 3 + j]]) {
      if (fn[f * 3] * fn[g * 3] + fn[f * 3 + 1] * fn[g * 3 + 1] + fn[f * 3 + 2] * fn[g * 3 + 2] < CREASE) continue;
      for (let k = 0; k < 3; k++) n[k] += fn[g * 3 + k] * area[g];
    }
    const l = Math.hypot(...n) || 1;
    for (let k = 0; k < 3; k++) cornerNormal[f * 9 + j * 3 + k] = n[k] / l;
  }

  // 3. Charts: connected faces sharing a dominant axis (+-X, +-Y, +-Z), box-projected onto that axis's plane.
  const axis = new Uint8Array(faces);
  for (let f = 0; f < faces; f++) {
    const n = [fn[f * 3], fn[f * 3 + 1], fn[f * 3 + 2]], k = [0, 1, 2].reduce((m, i) => Math.abs(n[i]) > Math.abs(n[m]) ? i : m, 0);
    axis[f] = k * 2 + (n[k] < 0 ? 1 : 0);
  }
  const parent = Int32Array.from({ length: faces }, (_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const edges = new Map();
  for (let f = 0; f < faces; f++) for (let j = 0; j < 3; j++) {
    const a = idx[f * 3 + j], b = idx[f * 3 + (j + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
    const other = edges.get(key);
    if (other === undefined) edges.set(key, f);
    else if (axis[other] === axis[f]) parent[find(other)] = find(f);
  }
  const chartOf = new Int32Array(faces), charts = [], chartIds = new Map();
  for (let f = 0; f < faces; f++) {
    const root = find(f);
    if (!chartIds.has(root)) { chartIds.set(root, charts.length); charts.push({ faces: [], axis: axis[f] }); }
    chartOf[f] = chartIds.get(root);
    charts[chartOf[f]].faces.push(f);
  }
  const project = (k, p) => {
    const dim = k >> 1, flip = k & 1;
    // Right-handed view of each box face so the baked layout is not mirrored (only matters for debugging).
    if (dim === 0) return [flip ? p[2] : -p[2], -p[1]];
    if (dim === 1) return [p[0], flip ? -p[2] : p[2]];
    return [flip ? -p[0] : p[0], -p[1]];
  };
  for (const chart of charts) {
    chart.lo = [Infinity, Infinity]; chart.hi = [-Infinity, -Infinity];
    for (const f of chart.faces) for (let j = 0; j < 3; j++) {
      const v = idx[f * 3 + j], q = project(chart.axis, [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
      for (let k = 0; k < 2; k++) { chart.lo[k] = Math.min(chart.lo[k], q[k]); chart.hi[k] = Math.max(chart.hi[k], q[k]); }
    }
  }

  // 4. Pack at the largest uniform texel density that fits.
  const totalArea = charts.reduce((s, c) => s + (c.hi[0] - c.lo[0]) * (c.hi[1] - c.lo[1]), 0);
  let scale = bakeSize * Math.sqrt(.8 / totalArea), placed = null;
  for (; scale > 1; scale *= .97) {
    const rects = charts.map(c => ({ w: Math.ceil((c.hi[0] - c.lo[0]) * scale) + padding * 2 + 1, h: Math.ceil((c.hi[1] - c.lo[1]) * scale) + padding * 2 + 1 }));
    if ((placed = pack(rects, bakeSize))) break;
  }
  if (!placed) throw new Error('bakeLow: charts do not fit');

  // 5. Split vertices per (position, chart, corner normal) and assign atlas UVs.
  const outPos = [], outNormal = [], outUv = [], outIdx = new Uint32Array(idx.length), vertexIds = new Map();
  const texel = new Float32Array(faces * 6);
  for (let f = 0; f < faces; f++) for (let j = 0; j < 3; j++) {
    const v = idx[f * 3 + j], chart = charts[chartOf[f]], at = placed[chartOf[f]];
    const n = cornerNormal.subarray(f * 9 + j * 3, f * 9 + j * 3 + 3);
    const q = project(chart.axis, [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
    const tx = at.x + padding + (q[0] - chart.lo[0]) * scale + .5, ty = at.y + padding + (q[1] - chart.lo[1]) * scale + .5;
    texel[f * 6 + j * 2] = tx; texel[f * 6 + j * 2 + 1] = ty;
    const key = `${v},${chartOf[f]},${Math.round(n[0] * 100)},${Math.round(n[1] * 100)},${Math.round(n[2] * 100)}`;
    let id = vertexIds.get(key);
    if (id === undefined) {
      vertexIds.set(key, id = outPos.length / 3);
      outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); outNormal.push(n[0], n[1], n[2]); outUv.push(tx / bakeSize, ty / bakeSize);
    }
    outIdx[f * 3 + j] = id;
  }

  // 6. Bake: rasterise each face (with a one-texel apron for edge coverage) and sample the closest source surface.
  const srcFn = new Float32Array(srcIdx.length);
  for (let t = 0; t < srcIdx.length / 3; t++) srcFn.set(faceNormal(srcPos, srcIdx[t * 3], srcIdx[t * 3 + 1], srcIdx[t * 3 + 2]).n, t * 3);
  const query = makeQuery(srcPos, srcIdx, srcFn, buildGrid(srcPos, srcIdx, .05));
  const color = new Uint8ClampedArray(bakeSize * bakeSize * 4), mr = new Uint8ClampedArray(bakeSize * bakeSize * 4);
  const weight = new Float32Array(bakeSize * bakeSize).fill(Infinity); // edge distance (texels) of the texel's current owner; 0 = inside
  const rgba = [0, 0, 0, 0], p = [0, 0, 0], n = [0, 0, 0];
  let misses = 0;
  for (let f = 0; f < faces; f++) {
    const x = [texel[f * 6], texel[f * 6 + 2], texel[f * 6 + 4]], y = [texel[f * 6 + 1], texel[f * 6 + 3], texel[f * 6 + 5]];
    const den = (y[1] - y[2]) * (x[0] - x[2]) + (x[2] - x[1]) * (y[0] - y[2]);
    if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...x) - 1.5)), x1 = Math.min(bakeSize - 1, Math.ceil(Math.max(...x) + 1.5));
    const y0 = Math.max(0, Math.floor(Math.min(...y) - 1.5)), y1 = Math.min(bakeSize - 1, Math.ceil(Math.max(...y) + 1.5));
    const edgeLen = [0, 1, 2].map(i => Math.hypot(x[(i + 2) % 3] - x[(i + 1) % 3], y[(i + 2) % 3] - y[(i + 1) % 3]) || 1);
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const cx = px + .5, cy = py + .5;
      let b0 = ((y[1] - y[2]) * (cx - x[2]) + (x[2] - x[1]) * (cy - y[2])) / den;
      let b1 = ((y[2] - y[0]) * (cx - x[2]) + (x[0] - x[2]) * (cy - y[2])) / den;
      let b2 = 1 - b0 - b1;
      // Distance outside the triangle in texels (barycentric * 2*area / edge length = distance to that edge).
      const area2 = Math.abs(den);
      const outside = Math.max(0, -b0 * area2 / edgeLen[0], -b1 * area2 / edgeLen[1], -b2 * area2 / edgeLen[2]);
      if (outside > 1.5 || outside >= weight[py * bakeSize + px]) continue;
      if (outside > 0) { b0 = Math.max(0, b0); b1 = Math.max(0, b1); b2 = Math.max(0, b2); const s = b0 + b1 + b2; b0 /= s; b1 /= s; b2 /= s; }
      const v = [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]];
      for (let k = 0; k < 3; k++) {
        p[k] = pos[v[0] * 3 + k] * b0 + pos[v[1] * 3 + k] * b1 + pos[v[2] * 3 + k] * b2;
        n[k] = cornerNormal[f * 9 + k] * b0 + cornerNormal[f * 9 + 3 + k] * b1 + cornerNormal[f * 9 + 6 + k] * b2;
      }
      const hit = query(p, n);
      if (!hit) { misses++; continue; }
      const t = hit.triangle, [w0, w1, w2] = hit.bary, s = [srcIdx[t * 3], srcIdx[t * 3 + 1], srcIdx[t * 3 + 2]];
      const u = srcUv[s[0] * 2] * w0 + srcUv[s[1] * 2] * w1 + srcUv[s[2] * 2] * w2;
      const vv = srcUv[s[0] * 2 + 1] * w0 + srcUv[s[1] * 2 + 1] * w1 + srcUv[s[2] * 2 + 1] * w2;
      const o = (py * bakeSize + px) * 4;
      if (baseColor) { sample(baseColor, u, vv, rgba); color.set(rgba, o); } else color.set([255, 255, 255, 255], o);
      if (metalRough) { sample(metalRough, u, vv, rgba); mr.set(rgba, o); } else mr.set([255, 255, 255, 255], o);
      color[o + 3] = 255; mr[o + 3] = 255;
      weight[py * bakeSize + px] = outside;
    }
  }

  // 7. Dilate into the gutters (and then everything else) so mip levels never pull in black.
  for (let pass = 0, empty = Infinity; empty > 0 && pass < bakeSize; pass++) {
    const fill = [];
    for (let i = 0; i < bakeSize * bakeSize; i++) {
      if (color[i * 4 + 3]) continue;
      const x = i % bakeSize, y = (i / bakeSize) | 0, sum = [0, 0, 0, 0, 0, 0, 0];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= bakeSize || ny >= bakeSize) continue;
        const j = (ny * bakeSize + nx) * 4;
        if (!color[j + 3]) continue;
        for (let k = 0; k < 3; k++) { sum[k] += color[j + k]; sum[3 + k] += mr[j + k]; }
        sum[6]++;
      }
      if (sum[6]) fill.push([i, sum]);
    }
    empty = 0;
    for (const [i, sum] of fill) {
      for (let k = 0; k < 3; k++) { color[i * 4 + k] = sum[k] / sum[6]; mr[i * 4 + k] = sum[3 + k] / sum[6]; }
      color[i * 4 + 3] = mr[i * 4 + 3] = 255;
    }
    for (let i = 0; i < bakeSize * bakeSize; i++) if (!color[i * 4 + 3]) empty++;
    if (!fill.length) break;
  }

  // 8. Replace geometry and textures.
  const buffer = doc.getRoot().listBuffers()[0];
  const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  for (const semantic of primitive.listSemantics()) primitive.setAttribute(semantic, null);
  primitive.setAttribute('POSITION', accessor('VEC3', new Float32Array(outPos)))
    .setAttribute('NORMAL', accessor('VEC3', new Float32Array(outNormal)))
    .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(outUv)))
    .setIndices(accessor('SCALAR', outIdx));
  const png = data => sharp(Buffer.from(data.buffer), { raw: { width: bakeSize, height: bakeSize, channels: 4 } }).removeAlpha().png().toBuffer();
  if (material.getBaseColorTexture()) material.getBaseColorTexture().setImage(await png(color)).setMimeType('image/png');
  if (material.getMetallicRoughnessTexture()) material.getMetallicRoughnessTexture().setImage(await png(mr)).setMimeType('image/png');
  for (const info of [material.getBaseColorTextureInfo(), material.getMetallicRoughnessTextureInfo()]) info?.setTexCoord(0);
  return { triangles: faces, vertices: outPos.length / 3, charts: charts.length, error: achieved, texelsPerMetre: scale, misses };
}
