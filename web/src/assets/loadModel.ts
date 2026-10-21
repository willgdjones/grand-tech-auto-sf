import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { modelAssets } from './manifest';
import type { ModelAssetId } from './manifest';

/** Cold load only. Callers own feature flags, instance cloning and resource lifetime. */
export function loadModel(id: ModelAssetId): Promise<GLTF> {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(modelAssets[id].url);
}
