/** Read-only compact mesh experiment. Run through tools/heavy.sh. No map output. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { decodeCompactMesh, type DecodedMapMesh } from '../../shared/mapMesh';

const root = resolve(process.argv[2] ?? 'tools/map/out/compact-zzpr');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const files = [...new Set<string>(manifest.chunks.flatMap((c: any) => c.lods.map((a: any) => a.path)))];
const selected = files.filter((_, i) => i % Math.max(1, Math.floor(files.length / 32)) === 0);
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
function encode(group: DecodedMapMesh, indices: Uint32Array, colors: Uint8Array) {
  // Reuse the exact quantized source positions; eliminate only unreferenced vertices.
  const remap = new Map<number, number>(), xyz: number[] = [], order = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const source = indices[i]!; let target = remap.get(source);
    if (target === undefined) { target = remap.size; remap.set(source, target); xyz.push(...group.positions.subarray(source * 4, source * 4 + 4)); }
    order[i] = target;
  }
  const positions = new Int16Array(xyz);
  const streams = [MeshoptEncoder.encodeVertexBuffer(new Uint8Array(positions.buffer), remap.size, 8),
    MeshoptEncoder.encodeIndexBuffer(new Uint8Array(order.buffer), order.length, 4),
    MeshoptEncoder.encodeVertexBuffer(colors, colors.length / 4, 4)];
  return { raw: streams.reduce((n, s) => n + s.length, 0), gzip: gzipSync(Buffer.concat(streams), { level: 9 }).length,
    triangles: order.length / 3, vertices: remap.size };
}
type EncodedSize = ReturnType<typeof encode>;
type Variant = EncodedSize & { policy: 'all-borders' | 'chunk-borders'; toleranceM: number; approximateErrorM: number };
const results: { path: string; name: string; colors: number; source: EncodedSize; variants: Variant[] }[] = [];
for (const path of selected) {
  const groups = await decodeCompactMesh(await readFile(resolve(root, path)), MeshoptDecoder);
  for (const group of groups) {
    const positions = new Float32Array(group.group.vertices * 3), batches = new Map<number, number[]>();
    const locks = new Uint8Array(group.group.vertices), noAttributes = new Float32Array(group.group.vertices);
    for (let i = 0; i < group.group.vertices; i++) for (let axis = 0; axis < 3; axis++)
      positions[i * 3 + axis] = group.positions[i * 4 + axis]! / 32767 * group.group.scale[axis]!;
    for (let i = 0; i < group.group.vertices; i++) {
      const x = positions[i * 3]! + group.group.translation[0], z = positions[i * 3 + 2]! + group.group.translation[2];
      if (Math.min(Math.abs(x), Math.abs(x - 256), Math.abs(z), Math.abs(z - 256)) < .05) locks[i] = 1;
    }
    for (let t = 0; t < group.group.triangles; t++) {
      const at = t * 4, key = group.colors[at]! | group.colors[at + 1]! << 8 | group.colors[at + 2]! << 16;
      const batch = batches.get(key) ?? []; if (!batches.has(key)) batches.set(key, batch);
      batch.push(...group.indices.subarray(t * 3, t * 3 + 3));
    }
    const variants: Variant[] = [];
    for (const policy of ['all-borders', 'chunk-borders'] as const) for (const tolerance of [0, 0.02, 0.1, 0.25]) {
      const indices: number[] = [], colors: number[] = []; let error = 0;
      for (const [color, batch] of batches) {
        const [simple, measured] = policy === 'all-borders'
          ? MeshoptSimplifier.simplify(new Uint32Array(batch), positions, 3, 3, tolerance, ['LockBorder', 'ErrorAbsolute', 'Sparse'])
          : MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(batch), positions, 3, noAttributes, 1, [0], locks,
            3, tolerance, ['ErrorAbsolute', 'Sparse']);
        error = Math.max(error, measured); for (const i of simple) indices.push(i);
        for (let i = 0; i < simple.length; i += 3) colors.push(color & 255, color >> 8 & 255, color >> 16 & 255, 0);
      }
      variants.push({ policy, toleranceM: tolerance, approximateErrorM: error, ...encode(group, new Uint32Array(indices), new Uint8Array(colors)) });
    }
    results.push({ path, name: group.group.name, colors: batches.size, source: encode(group, group.indices, group.colors), variants });
  }
}
const summary = [...new Set(results.map(r => r.name))].map(name => {
  const groups = results.filter(r => r.name === name);
  return { name, sourceGzip: groups.reduce((n, r) => n + r.source.gzip, 0), sourceTriangles: groups.reduce((n, r) => n + r.source.triangles, 0),
    variants: groups[0]!.variants.map((variant, i) => ({ policy: variant.policy, toleranceM: variant.toleranceM,
      gzip: groups.reduce((n, r) => n + r.variants[i]!.gzip, 0), triangles: groups.reduce((n, r) => n + r.variants[i]!.triangles, 0) })) };
});
const collisionSamples = [];
for (const chunk of manifest.chunks.filter((_: unknown, i: number) => i % Math.max(1, Math.floor(manifest.chunks.length / 32)) === 0)) {
  const source = await readFile(resolve(root, chunk.collision.path)), json = JSON.parse(source.toString());
  const metadata = [], bytes: number[] = [];
  function integer(value: number) {
    if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) throw new Error('Collision integer range');
    let word = ((value << 1) ^ (value >> 31)) >>> 0;
    while (word > 127) { bytes.push((word & 127) | 128); word >>>= 7; } bytes.push(word);
  }
  for (const b of json.buildings) {
    metadata.push([b.id, b.heightSource, b.rings.map((r: number[][]) => r.length)]);
    integer(Math.round(b.minY * 1000)); integer(Math.round(b.maxY * 1000));
    for (const ring of b.rings) {
      let x = 0, z = 0;
      for (const p of ring) { const nx = Math.round(p[0] * 1000), nz = Math.round(p[1] * 1000); integer(nx - x); integer(nz - z); x = nx; z = nz; }
    }
  }
  const packed = Buffer.concat([Buffer.from(JSON.stringify([json.origin, metadata])), new Uint8Array(bytes)]);
  collisionSamples.push({ path: chunk.collision.path, sourceGzip: chunk.collision.gzipBytes, packedGzip: gzipSync(packed, { level: 9 }).length });
}
await writeFile('docs/perf/map-zzpr/simplify-probe.json', JSON.stringify({ root, sampledFiles: selected.length, totalFiles: files.length,
  note: 'Sample only, not acceptance. Constant-color subsets; either all topological borders or chunk boundary vertices locked. No prune or position updates. Approximate simplifier error needs independent validation before use.', summary, results, collisionSamples }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
console.log('collision', collisionSamples.reduce((n, s) => n + s.sourceGzip, 0), collisionSamples.reduce((n, s) => n + s.packedGzip, 0));
