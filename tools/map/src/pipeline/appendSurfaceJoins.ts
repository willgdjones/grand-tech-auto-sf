import assert from 'node:assert/strict';
import type { GLTF } from '@gltf-transform/core';
import { MeshoptEncoder } from 'meshoptimizer';
import { readGlb } from '../glb';
import { createSurfaceJoins } from './surfaceJoins';
import type { JoinSurface } from './surfaceJoins';
import type { XYZ } from './types';

const JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
const align = (n: number) => Math.ceil(n / 4) * 4;

/** Append only: compressed source bytes, accessors, materials and transforms
 * retain their original values. The added opaque faces use the roads material.
 * No contact/collision data is read or written here.
 */
export async function appendSurfaceJoinsToGlb(input: Uint8Array): Promise<{
  bytes: Uint8Array; joinedPairs: number; rejectedWidePairs: number; trianglesAdded: number;
}> {
  const header = new DataView(input.buffer, input.byteOffset, input.byteLength);
  assert.equal(header.getUint32(0, true), 0x46546c67); assert.equal(header.getUint32(4, true), 2);
  assert.equal(header.getUint32(8, true), input.byteLength);
  assert.equal(header.getUint32(16, true), JSON_CHUNK);
  const jsonLength = header.getUint32(12, true), binOffset = 20 + jsonLength;
  assert.equal(header.getUint32(binOffset + 4, true), BIN_CHUNK);
  const oldBinary = input.subarray(binOffset + 8);
  assert.equal(header.getUint32(binOffset, true), oldBinary.byteLength);
  const json = JSON.parse(new TextDecoder().decode(input.subarray(20, binOffset))) as GLTF.IGLTF;
  assert(json.nodes && json.meshes && json.scenes && json.buffers && json.accessors && json.bufferViews);
  assert(json.extensionsRequired?.includes('KHR_mesh_quantization'));
  const doc = await readGlb(input);
  const terrain: JoinSurface = { positions: [], indices: [], colours: [] };
  const roads: JoinSurface = { positions: [], indices: [], colours: [] };
  const roadIndex = json.nodes.findIndex(node => node.mesh !== undefined && json.meshes![node.mesh]!.name === 'roads');
  if (roadIndex < 0) return { bytes: input, trianglesAdded: 0, joinedPairs: 0, rejectedWidePairs: 0 };
  const roadNode = json.nodes[roadIndex]!, translation = roadNode.translation!, scale = roadNode.scale!;
  assert(translation?.length === 3 && scale?.length === 3 && scale.every(n => n > 0));
  assert(!roadNode.matrix && !roadNode.rotation && !roadNode.children);
  const scene = json.scenes[json.scene ?? 0]!;
  assert(scene.nodes?.includes(roadIndex), 'Expected a direct chunk scene child');
  const material = json.meshes[roadNode.mesh!]!.primitives[0]!.material;
  assert(material !== undefined);
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(), name = mesh?.getName();
    if (!mesh || (name !== 'terrain' && name !== 'roads')) continue;
    assert.deepEqual(node.getTranslation(), translation); assert.deepEqual(node.getScale(), scale);
    assert.deepEqual(node.getRotation(), [0, 0, 0, 1]);
    const surface = name === 'terrain' ? terrain : roads;
    const positions = surface.positions as number[], indices = surface.indices as number[], colours = surface.colours as number[];
    for (const primitive of mesh.listPrimitives()) {
      assert.equal(primitive.getMode(), 4);
      const position = primitive.getAttribute('POSITION'), colour = primitive.getAttribute('COLOR_0'), index = primitive.getIndices();
      assert(position && colour && index); const offset = positions.length / 3, value: number[] = [];
      for (let v = 0; v < position.getCount(); v++) {
        position.getElement(v, value);
        positions.push(...value.map((n, axis) => n * scale[axis]! + translation[axis]!));
        colour.getElement(v, value); colours.push(...value.map(n => Math.round(n * 255)));
      }
      for (let i = 0; i < index.getCount(); i++) indices.push(offset + index.getScalar(i));
    }
  }
  const joined = createSurfaceJoins(terrain, roads);
  if (!joined.triangles.length) return { bytes: input, trianglesAdded: 0, joinedPairs: joined.joinedPairs, rejectedWidePairs: joined.rejectedWidePairs };
  const sourceCounts = { nodes: json.nodes.length, meshes: json.meshes.length, accessors: json.accessors.length, views: json.bufferViews.length };
  const source = JSON.stringify({ nodes: json.nodes, meshes: json.meshes, accessors: json.accessors, views: json.bufferViews, materials: json.materials });
  const fallback = json.buffers.findIndex(buffer => (buffer.extensions?.EXT_meshopt_compression as { fallback?: boolean } | undefined)?.fallback);
  assert(fallback >= 0, 'Expected the existing meshopt fallback buffer');
  await MeshoptEncoder.ready;
  const parts: Uint8Array[] = [oldBinary]; let binaryLength = oldBinary.byteLength;
  const append = (bytes: Uint8Array, target: number, byteStride?: number) => {
    const stride = byteStride ?? 2, mode = target === 34962 ? 'ATTRIBUTES' : 'INDICES';
    // INDICES retains the exact sequence; TRIANGLES may rotate triangle corners.
    const compressed = MeshoptEncoder.encodeGltfBuffer(bytes, bytes.length / stride, stride, mode);
    const padding = align(binaryLength) - binaryLength;
    if (padding) { parts.push(new Uint8Array(padding)); binaryLength += padding; }
    const id = json.bufferViews!.length;
    const decodedOffset = align(json.buffers![fallback]!.byteLength);
    json.bufferViews!.push({ buffer: fallback, byteOffset: decodedOffset, byteLength: bytes.length, target,
      ...(byteStride ? { byteStride } : {}), extensions: { EXT_meshopt_compression: {
        buffer: 0, byteOffset: binaryLength, byteLength: compressed.length, mode, byteStride: stride, count: bytes.length / stride,
      } } });
    json.buffers![fallback]!.byteLength = decodedOffset + bytes.length;
    parts.push(compressed); binaryLength += compressed.length; return id;
  };
  // 3,000 vertices occupy 54 KB including strides/indices. Avoid tiny batches:
  // each primitive is a draw call, even though upload must stay below 64 KB.
  for (let start = 0; start < joined.triangles.length; start += 1000) {
    const triangles = joined.triangles.slice(start, start + 1000), count = triangles.length * 3;
    // glTF vertex strides must be multiples of four, including byte attributes.
    const positionBytes = new Uint8Array(count * 8), normalBytes = new Uint8Array(count * 4), colourBytes = new Uint8Array(count * 4);
    const positionView = new DataView(positionBytes.buffer), normalView = new DataView(normalBytes.buffer);
    const indexBytes = new Uint8Array(count * 2), indexView = new DataView(indexBytes.buffer);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const [t, triangle] of triangles.entries()) {
      const [a, b, c] = triangle.points, u = b.map((n, i) => n - a[i]!) as XYZ, v = c.map((n, i) => n - a[i]!) as XYZ;
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]].map((n, i) => n * scale[i]!);
      const length = Math.hypot(...normal); assert(length > 0);
      for (const [corner, point] of triangle.points.entries()) {
        const vertex = t * 3 + corner; indexView.setUint16(vertex * 2, vertex, true);
        for (let axis = 0; axis < 3; axis++) {
          const q = Math.round((point[axis]! - translation[axis]!) / scale[axis]! * 32767);
          assert(q >= -32767 && q <= 32767, 'Join must fit the unchanged chunk transform');
          positionView.setInt16(vertex * 8 + axis * 2, q, true);
          min[axis] = Math.min(min[axis]!, q); max[axis] = Math.max(max[axis]!, q);
          normalView.setInt8(vertex * 4 + axis, Math.round(normal[axis]! / length * 127));
          colourBytes[vertex * 4 + axis] = Math.round(triangle.colour[axis]! * 255);
        }
      }
    }
    const accessor = (bytes: Uint8Array, componentType: GLTF.AccessorComponentType, type: 'VEC3' | 'SCALAR', stride?: number) => {
      const id = json.accessors!.length, vertex = type === 'VEC3';
      json.accessors!.push({ bufferView: append(bytes, vertex ? 34962 : 34963, stride), byteOffset: 0, componentType, type, count, normalized: vertex }); return id;
    };
    const position = accessor(positionBytes, 5122, 'VEC3', 8); Object.assign(json.accessors[position]!, { min, max });
    const normal = accessor(normalBytes, 5120, 'VEC3', 4), colour = accessor(colourBytes, 5121, 'VEC3', 4), indices = accessor(indexBytes, 5123, 'SCALAR');
    const mesh = json.meshes.length; json.meshes.push({ name: 'roads', primitives: [{ mode: 4, material, attributes: { POSITION: position, NORMAL: normal, COLOR_0: colour }, indices }] });
    scene.nodes!.push(json.nodes.length); json.nodes.push({ name: 'roads_surface_join', translation: [...translation], scale: [...scale], mesh });
  }
  assert.equal(JSON.stringify({ nodes: json.nodes.slice(0, sourceCounts.nodes), meshes: json.meshes.slice(0, sourceCounts.meshes),
    accessors: json.accessors.slice(0, sourceCounts.accessors), views: json.bufferViews.slice(0, sourceCounts.views), materials: json.materials }), source);
  json.buffers[0]!.byteLength = binaryLength;
  const encoded = new TextEncoder().encode(JSON.stringify(json)), paddedJSON = align(encoded.length), paddedBIN = align(binaryLength);
  const bytes = new Uint8Array(28 + paddedJSON + paddedBIN), out = new DataView(bytes.buffer);
  out.setUint32(0, 0x46546c67, true); out.setUint32(4, 2, true); out.setUint32(8, bytes.length, true);
  out.setUint32(12, paddedJSON, true); out.setUint32(16, JSON_CHUNK, true); bytes.fill(32, 20, 20 + paddedJSON); bytes.set(encoded, 20);
  out.setUint32(20 + paddedJSON, paddedBIN, true); out.setUint32(24 + paddedJSON, BIN_CHUNK, true);
  let cursor = 28 + paddedJSON; for (const part of parts) { bytes.set(part, cursor); cursor += part.length; }
  assert(Buffer.from(bytes.buffer, 28 + paddedJSON, oldBinary.length)
    .equals(Buffer.from(oldBinary.buffer, oldBinary.byteOffset, oldBinary.length)), 'Original compressed BIN bytes preserved');
  return { bytes, trianglesAdded: joined.triangles.length, joinedPairs: joined.joinedPairs, rejectedWidePairs: joined.rejectedWidePairs };
}
