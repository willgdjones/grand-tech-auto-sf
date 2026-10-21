/** Read-only standard-GLB size experiment; never writes candidate assets. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Accessor, Document, Primitive, TypedArray } from '@gltf-transform/core';
import { MeshoptEncoder } from 'meshoptimizer';
import { glbIo, newDocument, readGlb, writeGlb } from './src/glb.ts';

const variants = ['roundtrip', 'weld', 'reorder', 'weld-reorder'] as const;
type Variant = typeof variants[number];
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const samples = [
  ['Richmond', '-20_0'], ['Sunset', '-24_8'], ['Golden Gate Park', '-21_7'],
  ['Ocean Beach', '-36_5'], ['Twin Peaks', '-14_13'],
] as const;

function primitives(doc: Document): Primitive[] {
  assert.equal(doc.getRoot().listSkins().length, 0, 'skinned assets are outside this probe');
  assert.equal(doc.getRoot().listAnimations().length, 0, 'animated assets are outside this probe');
  const result = doc.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
  const seen = new Set<Accessor>();
  for (const p of result) {
    assert.equal(p.getMode(), 4, 'only independent triangles are supported');
    assert.equal(p.listTargets().length, 0, 'morph targets are outside this probe');
    assert.ok(p.getIndices(), 'expected indexed pipeline geometry');
    assert.equal(p.getIndices()!.getCount() % 3, 0);
    const count = p.getAttribute('POSITION')!.getCount();
    for (const a of p.listAttributes()) assert.equal(a.getCount(), count);
    for (const a of [...p.listAttributes(), p.getIndices()!]) {
      assert.ok(!seen.has(a), 'shared accessors require a separate cloning policy');
      seen.add(a);
    }
  }
  return result;
}

/** Raw bytes include signed zero and every attribute, not rounded/stringified numbers. */
function vertexKeys(p: Primitive): string[] {
  const attributes = p.listSemantics().sort().map(semantic => p.getAttribute(semantic)!);
  return Array.from({ length: attributes[0]!.getCount() }, (_, i) => attributes.map(a => {
    const array = a.getArray()!;
    const stride = a.getElementSize() * array.BYTES_PER_ELEMENT;
    return Buffer.from(array.buffer, array.byteOffset + i * stride, stride).toString('hex');
  }).join('/'));
}

function triangleDigest(p: Primitive): string {
  const vertices = vertexKeys(p), indices = p.getIndices()!.getArray()!;
  const triangles: string[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = vertices[indices[i]!]!, b = vertices[indices[i + 1]!]!, c = vertices[indices[i + 2]!]!;
    assert.ok(a !== undefined && b !== undefined && c !== undefined, 'valid vertex references');
    // Meshopt may rotate the first corner. Winding, duplicate faces and degenerates must survive.
    triangles.push([`${a}|${b}|${c}`, `${b}|${c}|${a}`, `${c}|${a}|${b}`].sort()[0]!);
  }
  return sha256(triangles.sort().join('\n'));
}

async function signature(doc: Document) {
  const ps = primitives(doc);
  const { json } = await (await glbIo()).writeJSON(doc);
  // Retain complete scenes, nodes, transforms, materials, textures, primitive boundaries,
  // names, extras, extensions and attribute formats. Only buffer layout/references can change.
  const { accessors = [], buffers: _buffers, bufferViews: _views, ...structure } = json;
  const canonical = {
    ...structure,
    meshes: json.meshes?.map(mesh => ({ ...mesh, primitives: mesh.primitives.map(p => {
      const { indices: _indices, attributes, ...rest } = p;
      return { ...rest, attributes: Object.fromEntries(Object.entries(attributes).sort().map(([key, id]) => {
        const a = accessors[id]!;
        return [key, { type: a.type, componentType: a.componentType, normalized: a.normalized ?? false }];
      })) };
    }) })),
  };
  return { structure: sha256(JSON.stringify(canonical)), triangles: ps.map(triangleDigest) };
}

function remapAttributes(p: Primitive, remap: Uint32Array, count: number): void {
  for (const attribute of p.listAttributes()) {
    const source = attribute.getArray()!, stride = attribute.getElementSize();
    const dest = source.slice(0, count * stride) as TypedArray;
    for (let old = 0; old < source.length / stride; old++) {
      const next = remap[old];
      if (next !== undefined && next < count) dest.set(source.subarray(old * stride, (old + 1) * stride), next * stride);
    }
    attribute.setArray(dest);
  }
}

function transform(doc: Document, variant: Variant): void {
  for (const p of primitives(doc)) {
    if (variant.includes('weld')) {
      const keys = vertexKeys(p), unique = new Map<string, number>(), remap = new Uint32Array(keys.length);
      keys.forEach((key, i) => {
        let target = unique.get(key);
        if (target === undefined) { target = unique.size; unique.set(key, target); }
        remap[i] = target;
      });
      remapAttributes(p, remap, unique.size);
      const indices = p.getIndices()!.getArray()!;
      p.getIndices()!.setArray(indices.map(index => remap[index]!) as TypedArray);
    }
    if (variant.includes('reorder')) {
      const accessor = p.getIndices()!, source = accessor.getArray()!;
      const indices = Uint32Array.from(source);
      const [remap, count] = MeshoptEncoder.reorderMesh(indices, true, true);
      remapAttributes(p, remap, count);
      const dest = source.slice() as TypedArray;
      dest.set(indices);
      accessor.setArray(dest);
    }
  }
}

function counts(doc: Document) {
  const ps = primitives(doc);
  return {
    primitives: ps.length,
    vertices: ps.reduce((sum, p) => sum + p.getAttribute('POSITION')!.getCount(), 0),
    triangles: ps.reduce((sum, p) => sum + p.getIndices()!.getCount() / 3, 0),
    maxUploadBytes: Math.max(...ps.map(p => p.getAttribute('POSITION')!.getCount() * 12 + p.getIndices()!.getCount() * 2)),
  };
}

async function measure(input: Uint8Array) {
  const original = await readGlb(input), expected = await signature(original), before = counts(original);
  const measurements = [];
  for (const variant of variants) {
    const doc = await readGlb(input);
    transform(doc, variant);
    assert.deepEqual(await signature(doc), expected, `${variant}: exact pre-encode parity`);
    const encoded = await writeGlb(doc), decoded = await readGlb(encoded);
    assert.deepEqual(await signature(decoded), expected, `${variant}: exact decoded parity`);
    const after = counts(decoded);
    assert.ok(after.maxUploadBytes <= before.maxUploadBytes, 'preserve bounded upload partitions');
    measurements.push({ variant, rawBytes: encoded.byteLength, gzipBytes: gzipSync(encoded, { level: 9 }).length,
      sha256: sha256(encoded), ...after, parity: true });
  }
  return { input: { sha256: sha256(input), rawBytes: input.byteLength,
    gzipBytes: gzipSync(input, { level: 9 }).length, ...before }, signature: expected, measurements };
}

/** One adversarial smoke proves that normals/colours, winding and multiplicity are checked. */
async function selfCheck() {
  const doc = newDocument(), buffer = doc.createBuffer();
  const p = doc.createPrimitive();
  const attribute = (name: string, array: TypedArray) => p.setAttribute(name,
    doc.createAccessor().setType('VEC3').setNormalized(true).setArray(array).setBuffer(buffer));
  attribute('POSITION', new Int16Array([0,0,0, 9,0,0, 0,9,0, 0,0,0, 0,0,0, 0,0,0]));
  attribute('NORMAL', new Int8Array([0,0,127, 0,0,127, 0,0,127, 0,0,127, 0,127,0, 0,0,127]));
  attribute('COLOR_0', new Uint8Array([20,30,40, 20,30,40, 20,30,40, 20,30,40, 20,30,40, 40,30,20]));
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0,1,2, 3,1,2, 4,1,2, 5,1,2, 0,0,1])).setBuffer(buffer));
  p.setMaterial(doc.createMaterial('smoke').setRoughnessFactor(1));
  const mesh = doc.createMesh('smoke').addPrimitive(p);
  const scene = doc.createScene().addChild(doc.createNode().setMesh(mesh).setTranslation([1,2,3]).setScale([128,12,128]));
  doc.getRoot().setDefaultScene(scene);
  const baseline = triangleDigest(p), indices = p.getIndices()!.getArray()!;
  [indices[0], indices[1]] = [indices[1]!, indices[0]!];
  assert.notEqual(triangleDigest(p), baseline, 'reversed winding is detected');
  [indices[0], indices[1]] = [indices[1]!, indices[0]!];
  const results = await measure(await writeGlb(doc));
  assert.equal(results.measurements.find(v => v.variant === 'weld')!.vertices, 5);
  assert.ok(results.measurements.every(v => v.triangles === 5));
  return results;
}

const candidate = resolve(process.argv[2] ?? 'tools/map/out/district-tm7m');
const output = resolve(process.argv[3] ?? `artifacts/mesh-reuse/${new Date().toISOString().replaceAll(':', '-')}`);
assert.ok(!output.startsWith(`${candidate}/`) && output !== candidate, 'report must be outside candidate');
await MeshoptEncoder.ready;
const fixture = await selfCheck();
const report = {
  generatedAt: new Date().toISOString(), candidate: relative(process.cwd(), candidate),
  manifestSha256: sha256(await readFile(resolve(candidate, 'manifest.json'))),
  method: 'Raw-attribute exact weld and meshopt reorder; independent source primitive partitions; gzip level 9.',
  fixture, samples: [] as unknown[],
};
for (const [district, key] of samples) {
  const path = `chunks/${key}/lod1.glb`;
  const result = await measure(await readFile(resolve(candidate, path)));
  report.samples.push({ district, path, ...result });
  console.log(JSON.stringify({ district, input: result.input, measurements: result.measurements }));
}
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`PASS exact geometry, attributes, transforms and material parity: ${relative(process.cwd(), output)}/report.json`);
