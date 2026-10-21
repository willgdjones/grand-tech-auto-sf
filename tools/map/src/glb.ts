import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMaterialsUnlit, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

// Deterministic GLB writing for the layout stages (first used by M2.4b; M2.2/M2.14b reuse it).
// A fixed `asset.generator` (no version or timestamp), KHR_mesh_quantization attributes and
// EXT_meshopt_compression (required, no fallback buffer), so equal inputs give byte-identical files.

export const GLB_GENERATOR = 'gtasf-map';

let io: Promise<NodeIO> | undefined;
/** One NodeIO with the codecs registered; the meshopt wasm initialises once per process. */
export function glbIo(): Promise<NodeIO> {
  io ??= Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]).then(() =>
    new NodeIO()
      .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsUnlit])
      .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder }),
  );
  return io;
}

/** A document with the fixed generator and the required compression extensions. */
export function newDocument(): Document {
  const doc = new Document();
  doc.getRoot().getAsset().generator = GLB_GENERATOR;
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    // Attributes are quantised by the stage itself; meshopt only entropy-codes them.
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  return doc;
}

export async function writeGlb(doc: Document): Promise<Uint8Array> {
  return (await glbIo()).writeBinary(doc);
}

export async function readGlb(bytes: Uint8Array): Promise<Document> {
  return (await glbIo()).readBinary(bytes);
}
