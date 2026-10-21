import { DataTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, RGBAFormat } from 'three';
import { flags } from '@gtasf/shared/flags';

function createTexture(): DataTexture {
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1);
    data[(y * size + x) * 4 + 3] = Math.round(100 * Math.max(0, 1 - radius * radius) ** 2);
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.minFilter = texture.magFilter = LinearFilter; texture.needsUpdate = true;
  return texture;
}
function createGeometry(width: number, length: number): PlaneGeometry {
  const geometry = new PlaneGeometry(width, length);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

let sharedTexture: { texture: DataTexture; refs: number } | undefined;
const sharedGeometry = new Map<string, { geometry: PlaneGeometry; refs: number }>();

/** Cheap soft contact shadow: one small alpha card, no lights or shadow-map passes. */
export function createBlobShadow(width: number, length: number) {
  // Keep materials local: avatars fade independently and tree instances use a
  // different opacity. Only the immutable texture and equal-sized planes share.
  const shared = flags.graphicsV2;
  const textureLease = shared ? (sharedTexture ??= { texture: createTexture(), refs: 0 }) : undefined;
  if (textureLease) textureLease.refs++;
  const key = `${width}:${length}`;
  let geometryLease = shared ? sharedGeometry.get(key) : undefined;
  if (shared && !geometryLease) {
    geometryLease = { geometry: createGeometry(width, length), refs: 0 };
    sharedGeometry.set(key, geometryLease);
  }
  if (geometryLease) geometryLease.refs++;
  const texture = textureLease?.texture ?? createTexture();
  const geometry = geometryLease?.geometry ?? createGeometry(width, length);
  const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false });
  const root = new Mesh(geometry, material);
  root.name = 'soft-contact-shadow'; root.position.y = .035; root.renderOrder = 1;
  let disposed = false;
  return { root, dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent(); material.dispose();
    if (!geometryLease) geometry.dispose();
    else if (--geometryLease.refs === 0) { geometry.dispose(); sharedGeometry.delete(key); }
    if (!textureLease) texture.dispose();
    else if (--textureLease.refs === 0) { texture.dispose(); sharedTexture = undefined; }
  } };
}
