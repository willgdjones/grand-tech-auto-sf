import { BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial, NearestFilter, NearestMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, TextureLoader } from 'three';
import type { Material, Texture } from 'three';
import { flags } from '@gtasf/shared/flags';
import { modelAssets } from '../../assets/manifest';
import type { VehicleAssetId } from '../../assets/manifest';

export interface VehicleTextures { paint: Texture; chrome: Texture; release(): void }
let cached: Promise<[Texture, Texture]> | undefined, users = 0;
/** Shared two-texture palette for the whole fleet, including every streamed instance. */
export async function loadVehicleTextures(): Promise<VehicleTextures | undefined> {
  if (!flags.vehiclePolish) return undefined;
  cached ??= Promise.all(['paint', 'chrome'].map(async name => {
    const texture = await new TextureLoader().loadAsync(`/art/vehicles/${name}.tile.png`);
    texture.colorSpace = SRGBColorSpace; texture.magFilter = NearestFilter;
    texture.minFilter = NearestMipmapLinearFilter; texture.wrapS = texture.wrapT = RepeatWrapping;
    return texture;
  })) as Promise<[Texture, Texture]>;
  const [paint, chrome] = await cached; users++;
  let released = false;
  return { paint, chrome, release() {
    if (released) return; released = true;
    if (--users === 0) { paint.dispose(); chrome.dispose(); cached = undefined; }
  } };
}

/** Retain the licensed kit silhouette/wheels; add broad PS2 paint and chunky period trim. */
export function polishVehicle(assetId: VehicleAssetId, scene: Group, textures?: VehicleTextures, low = false): () => void {
  if (!flags.vehiclePolish) return () => {};
  // legibleLowVehicles: on the Low ps2 path there is no IBL/ambient lift, so a body/glass face turned away from
  // the sun collapses to pure black — a near-black blob when a parked car sits right against the camera. A small
  // emissive floor keeps shadow-side faces as a dark-but-read vehicle shape. Low only; HD keeps enough ambient.
  const emissiveFloor = low && flags.legibleLowVehicles ? 0.085 : 0;
  const replaced = new Set<Material>();
  scene.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const body = object.name === 'body';
    if (body) {
      const geometry = object.geometry, positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!, dx = Math.max(.01, bounds.max.x - bounds.min.x), dy = Math.max(.01, bounds.max.y - bounds.min.y), dz = Math.max(.01, bounds.max.z - bounds.min.z);
      const uv = new Float32Array(positions.count * 2);
      for (let i = 0; i < positions.count; i++) {
        // Major-axis box projection prevents the original solid-colour palette UVs stretching.
        const nx = Math.abs(normals.getX(i)), ny = Math.abs(normals.getY(i)), nz = Math.abs(normals.getZ(i));
        uv[i * 2] = nx > nz ? (positions.getZ(i) - bounds.min.z) / dz : (positions.getX(i) - bounds.min.x) / dx;
        uv[i * 2 + 1] = ny > Math.max(nx, nz) ? (positions.getZ(i) - bounds.min.z) / dz : (positions.getY(i) - bounds.min.y) / dy;
      }
      geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    }
    const originals = Array.isArray(object.material) ? object.material : [object.material];
    const materials = originals.map(original => {
      replaced.add(original);
      const material = new MeshLambertMaterial({ vertexColors: !!object.geometry.getAttribute('color'), flatShading: true, map: body ? textures?.paint ?? null : null });
      const colour = (original as MeshLambertMaterial).color;
      if (colour) material.color.copy(colour);
      if (emissiveFloor) material.emissive.setScalar(emissiveFloor);
      return material;
    });
    object.material = Array.isArray(object.material) ? materials : materials[0]!;
    object.castShadow = false;
  });
  if (!['muni-bus', 'powell-cable-car', 'robotaxi'].includes(assetId)) {
    const { min, max } = modelAssets[assetId].bounds;
    const width = max[0] - min[0], length = max[2] - min[2];
    const chrome = new MeshLambertMaterial({ color: 0xc6ccd0, map: textures?.chrome ?? null });
    const rubber = new MeshLambertMaterial({ color: 0x202631 });
    const parts = new Group(); parts.name = 'period-chrome-trim';
    for (const end of [-1, 1]) {
      const bumper = new Mesh(new BoxGeometry(width * .94, .17, .22), chrome);
      bumper.name = end > 0 ? 'chrome-front-bumper' : 'chrome-rear-bumper';
      bumper.position.set(0, .43, end * (length / 2 - .055)); parts.add(bumper);
      const strip = new Mesh(new BoxGeometry(width * .9, .055, .235), rubber);
      strip.position.copy(bumper.position); strip.position.y += .025; parts.add(strip);
    }
    const grille = new Mesh(new BoxGeometry(width * .43, .19, .035), rubber);
    grille.name = 'square-radiator-grille'; grille.position.set(0, .68, length / 2 + .04); parts.add(grille);
    scene.add(parts);
  }
  return () => { replaced.forEach(material => material.dispose()); textures?.release(); };
}
