import { SRGBColorSpace, type Texture } from 'three';
import { createBillboard } from '../render/screens/screenMesh';
/** Reuses world material; preview has low gain and never enables bloom (BDTS feel checkpoint). */
export function createPreview(width: number, height: number, texture: Texture) {
  texture.colorSpace = SRGBColorSpace;
  const mesh = createBillboard(width, height, texture);
  return { mesh, dispose() { mesh.geometry.dispose(); mesh.material.dispose(); } };
}
