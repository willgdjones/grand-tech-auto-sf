import {
  BoxGeometry, Color, DoubleSide, DynamicDrawUsage, FrontSide, Group, InstancedMesh,
  Matrix4, MeshLambertMaterial, Object3D, PlaneGeometry, Vector3,
  type BufferGeometry, type Texture,
} from 'three';
import { flags } from '@gtasf/shared/flags';
import { graphicsPreset } from '../graphicsPreset';
import type { Detail } from './primitives';
import { createLombardFlowerTextures, gardenRandom } from './lombardFlowerTextures';

type Point = readonly [number, number];
type HeightAt = (x: number, z: number) => number | null;
interface Anchor { x: number; z: number; y: number }
interface Instance { anchor: Anchor; matrix: Matrix4; colour: Color }
interface GardenOptions { path: readonly Point[]; detail: Detail; heightAt?: HeightAt }

export function gardenRoadDistance(path: readonly Point[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!, dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return best;
}

/** Five instanced draws, no animation or per-frame allocations; the existing landmarks switch owns entry. */
export function createLombardGarden({ path, detail, heightAt }: GardenOptions): Group {
  const root = new Group(); root.name = 'Lombard flower beds'; root.userData.landmark = true;
  const low = detail === 'far' || graphicsPreset() === 'low';
  const first = path[0]!, last = path.at(-1)!;
  const length = Math.hypot(last[0] - first[0], last[1] - first[1]);
  const dx = (last[0] - first[0]) / length, dz = (last[1] - first[1]) / length;
  const textures = createLombardFlowerTextures(), random = gardenRandom(402111597);
  const anchors: Anchor[] = [], beds: Anchor[] = [];
  const soil: Instance[] = [], hedge: Instance[] = [], kerb: Instance[] = [];
  const leaves: Instance[] = [], blooms: Instance[] = [];
  const transform = new Object3D(), scratch = new Matrix4();
  function anchor(x: number, z: number): Anchor {
    const sampled = heightAt?.(x, z);
    const a = { x, z, y: typeof sampled === 'number' && Number.isFinite(sampled) ? sampled : -(x * dx + z * dz) * .23 };
    anchors.push(a); return a;
  }
  function add(target: Instance[], a: Anchor, offset: readonly [number, number, number], size: readonly [number, number, number], yaw: number, tilt: number, colour: string) {
    transform.position.set(a.x + offset[0], a.y + offset[1], a.z + offset[2]);
    transform.rotation.set(tilt, yaw, 0, 'YXZ'); transform.scale.set(...size); transform.updateMatrix();
    target.push({ anchor: a, matrix: transform.matrix.clone(), colour: new Color(colour) });
  }
  // Preserve the original sourced garden footprint and >4.15 m bed-centre road clearance.
  for (let u = -65; u <= 65; u += 2.1) for (let v = -8; v <= 8; v += 2.1) {
    const x = dx * u - dz * v, z = dz * u + dx * v;
    if (gardenRoadDistance(path, x, z) < 4.15) continue;
    const a = anchor(x, z); beds.push(a);
    add(soil, a, [0, -.09, 0], [2.08, .18, 2.08], Math.atan2(-dz, dx), 0, '#ffffff');
  }
  // Continuous clipped-hedge border follows both sides of the source road, never its ribbon.
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!, sx = b[0] - a[0], sz = b[1] - a[1], len = Math.hypot(sx, sz);
    if (len < .01) continue;
    const steps = Math.ceil(len / .85), nx = -sz / len, nz = sx / len;
    for (let n = 0; n < steps; n++) for (const side of [-1, 1]) {
      const t = (n + .5) / steps, x = a[0] + sx * t + nx * side * 3.55, z = a[1] + sz * t + nz * side * 3.55;
      if (Math.abs(x * dx + z * dz) > 66 || Math.abs(-x * dz + z * dx) > 9.1 || gardenRoadDistance(path, x, z) < 3.5) continue;
      const contact = anchor(x, z), yaw = Math.atan2(sx, sz);
      add(hedge, contact, [0, .3, 0], [.42, .58, len / steps + .12], yaw, 0, n % 3 ? '#d7e6b4' : '#e2edc6');
      add(kerb, contact, [0, .015, 0], [.55, .13, len / steps + .13], yaw, 0, '#b5ad92');
    }
  }
  // lombardFlowerColour (gap #1): a vivid hydrangea palette (deep blue, magenta, violet, hot pink, white) so the
  // beds carry dense colour like the real Lombard, vs the default pale pastels. The cream petal card tints toward it.
  const vivid = flags.lombardFlowerColour;
  const colours = vivid
    ? ['#2f5fd0', '#e0479a', '#8a44c4', '#d8356f', '#f4f1ec', '#5b86e0', '#b32e86', '#a46fd8']
    : ['#ddb4cc', '#c799bd', '#d6c6e4', '#f0e4d2', '#c3cce1', '#bf829f'];
  // Baseline cards for every bed are first in the instance buffers, so distance LOD changes count only.
  function plant(extra: boolean) {
    beds.forEach((a, index) => {
      const turn = index * 2.399963;
      if (!extra) {
        for (let j = 0; j < 3; j++) add(leaves, a, [0, .52, 0], [2.02, 1.1, 1], turn + j * Math.PI / 3, j === 2 ? -Math.PI / 2 : -.12, '#ffffff');
      } else {
        add(leaves, a, [.05, .63, -.05], [1.8, 1.05, 1], turn + .4, -.5, '#dce7ba');
      }
      for (let j = 0; j < (extra ? (vivid ? 3 : 2) : (vivid ? 4 : 3)); j++) {
        const angle = turn + j * 2.399963 + (extra ? 1.1 : 0), r = .25 + random() * .39;
        const x = Math.sin(angle) * r, z = Math.cos(angle) * r;
        const y = .77 + random() * .3, size = (vivid ? .48 : .42) + random() * (vivid ? .2 : .18);
        const tint = colours[(index + (j === 2 ? 1 : 0)) % colours.length]!;
        for (let face = 0; face < 3; face++) {
          add(blooms, a, [x, y, z], [size, size * .86, 1], angle + face * Math.PI / 2, face === 2 ? -Math.PI / 2 : -.2, tint);
        }
      }
    });
  }
  plant(false);
  const leafFarCount = leaves.length, bloomFarCount = blooms.length;
  if (!low) plant(true);

  function card(): PlaneGeometry {
    const geometry = new PlaneGeometry(1, 1, 2, 1), p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setZ(i, .1 * (1 - 4 * p.getX(i) ** 2));
    geometry.computeVertexNormals(); return geometry;
  }
  const batches: { mesh: InstancedMesh; instances: Instance[] }[] = [];
  function batch(name: string, geometry: BufferGeometry, instances: Instance[], map?: Texture, alpha = false, farCount = instances.length) {
    const material = new MeshLambertMaterial({ map: map ?? null, side: alpha ? DoubleSide : FrontSide, alphaTest: alpha ? .35 : 0 });
    material.name = name;
    const mesh = new InstancedMesh(geometry, material, instances.length); mesh.name = name;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    instances.forEach((entry, i) => { mesh.setMatrixAt(i, entry.matrix); mesh.setColorAt(i, entry.colour); });
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    // The landmark disposer releases geometry/materials. Also release owned instance buffers and maps.
    geometry.addEventListener('dispose', () => mesh.dispose());
    material.addEventListener('dispose', () => map?.dispose());
    if (farCount < instances.length) {
      const centre = new Vector3(), eye = new Vector3();
      mesh.onBeforeRender = (_renderer, _scene, camera) => {
        root.getWorldPosition(centre); camera.getWorldPosition(eye);
        mesh.count = eye.distanceToSquared(centre) > 100 ** 2 ? farCount : instances.length;
      };
    }
    mesh.userData.farCount = farCount; mesh.userData.fullCount = instances.length;
    root.add(mesh); batches.push({ mesh, instances });
  }
  batch('Lombard textured soil', new BoxGeometry(1, 1, 1), soil, textures.soil);
  batch('Lombard pale garden kerb', new BoxGeometry(1, 1, 1), kerb);
  batch('Lombard clipped hedge', new BoxGeometry(1, 1, 1), hedge, textures.hedge);
  batch('Lombard hydrangea foliage', card(), leaves, textures.foliage, true, leafFarCount);
  batch('Lombard hydrangea florets', card(), blooms, textures.flowers, true, bloomFarCount);
  root.userData.bedClusters = beds.length;
  root.userData.gardenDetail = low ? 'low' : 'hd';
  root.userData.roadSource = 'https://www.openstreetmap.org/way/402111597';
  root.userData.resampleTerrain = (sample: HeightAt) => {
    const deltas = new Map<Anchor, number>();
    for (const a of anchors) {
      const y = sample(a.x, a.z);
      if (y === null || !Number.isFinite(y) || Math.abs(y - a.y) < .005) continue;
      deltas.set(a, y - a.y); a.y = y;
    }
    if (!deltas.size) return;
    for (const { mesh, instances } of batches) {
      let changed = false;
      instances.forEach((entry, i) => {
        const delta = deltas.get(entry.anchor); if (delta === undefined) return;
        entry.matrix.elements[13]! += delta; scratch.copy(entry.matrix); mesh.setMatrixAt(i, scratch); changed = true;
      });
      if (changed) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere(); }
    }
  };
  return root;
}
