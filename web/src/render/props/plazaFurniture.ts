import { BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, Float32BufferAttribute,
  Group, InstancedMesh, Matrix4, MeshLambertMaterial, SRGBColorSpace } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flags } from '@gtasf/shared/flags';
import { graphicsPreset } from '../graphicsPreset';
import type { RoadHeightAt } from './layout';

type Kind = 'bench' | 'bin' | 'lamp';
type Point = readonly [number, number, number];
// Side terraces only: outside the pedestrian loops (x ±82, z 26–34),
// existing benches (x ±45/70/95, z38), bollards (z23), palms and pickup kerb.
const SITES = [-1, 1].flatMap(side => [20, 43].flatMap(z => [
  { kind: 'bench' as const, x: side * 105, z, yaw: -side * Math.PI / 2, radius: 1.35 },
  { kind: 'bin' as const, x: side * 109, z, yaw: 0, radius: .55 },
  { kind: 'lamp' as const, x: side * 113, z, yaw: 0, radius: .65 },
]));

function furnitureGeometry(kind: Kind): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (geometry: BufferGeometry, position: Point, tint: string) => {
    const g = geometry.toNonIndexed(); geometry.dispose(); g.translate(...position);
    const colour = new Color(tint), values = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < values.length; i += 3) colour.toArray(values, i);
    g.setAttribute('color', new Float32BufferAttribute(values, 3)); parts.push(g);
  };
  const box = (p: Point, size: Point, colour: string) => add(new BoxGeometry(...size), p, colour);
  const tube = (p: Point, bottom: number, top: number, height: number, colour: string) =>
    add(new CylinderGeometry(top, bottom, height, 8), p, colour);
  const iron = '#384c48', wood = '#b69a70';
  if (kind === 'bench') {
    for (const x of [-.85, .85]) {
      box([x, .26, 0], [.1, .52, .68], iron);
      box([x, .64, -.29], [.1, .98, .09], iron);
      box([x, .7, 0], [.1, .07, .68], iron);
      box([x, .58, .28], [.08, .28, .08], iron);
    }
    for (const z of [-.24, -.08, .08, .24]) box([0, .49, z], [2.2, .08, .12], wood);
    for (const y of [.73, .91, 1.09]) box([0, y, -.3], [2.2, .13, .07], wood);
    for (const x of [-.85, .85]) for (const y of [.73, 1.09]) box([x, y, -.255], [.035, .035, .025], '#c8b894');
  } else if (kind === 'bin') {
    tube([0, .46, 0], .32, .32, .85, '#243731');
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      box([Math.sin(a) * .32, .46, Math.cos(a) * .32], [.07, .78, .07], '#617469');
    }
    tube([0, .08, 0], .37, .37, .1, iron); tube([0, .87, 0], .38, .38, .1, iron);
    tube([0, .96, 0], .22, .22, .08, '#172621');
    box([0, .55, .365], [.2, .22, .015], '#c0b99e');
  } else {
    tube([0, .12, 0], .36, .28, .24, iron); tube([0, .52, 0], .23, .15, .8, iron);
    tube([0, 2.3, 0], .1, .065, 3.6, iron);
    tube([0, 3.94, 0], .3, .25, .13, iron);
    box([0, 4.24, 0], [.35, .5, .35], '#e8ca83');
    for (const x of [-.2, .2]) for (const z of [-.2, .2]) box([x, 4.24, z], [.04, .58, .04], iron);
    tube([0, 4.6, 0], .36, .05, .22, iron); tube([0, 4.78, 0], .06, .02, .17, iron);
  }
  const merged = mergeGeometries(parts)!; for (const part of parts) part.dispose(); return merged;
}

/** Preview-only SA furniture. Caller mounts root, updates after terrain refresh, then disposes. */
export function createPlazaFurniture(options: {
  landmarks: Group; low: boolean;
  heightAt(x: number, z: number): number | null;
  isLoaded(x: number, z: number): boolean;
  collides(x: number, y: number, z: number, radius: number): boolean;
  roadHeightAt: RoadHeightAt;
}) {
  if (!flags.graphicsV2 || options.low || graphicsPreset() !== 'hd') return null;
  const ferry = options.landmarks.children.find(child => child.userData.landmarkId === 'ferry-building');
  if (!ferry) return null;
  // Original tiny grain texture: no extra download, photo assets or high-resolution decode.
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const value = 208 + ((x * 17 + y * 7 + (y % 7) * 13) % 40);
    context.fillStyle = `rgb(${value},${value},${value})`; context.fillRect(x, y, 1, 1);
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  const material = new MeshLambertMaterial({ vertexColors: true, map: texture });
  const root = new Group(); root.name = 'HD Ferry terrace furniture';
  const batches = (['bench', 'bin', 'lamp'] as const).map(kind => {
    const mesh = new InstancedMesh(furnitureGeometry(kind), material, 4);
    mesh.name = `Plaza ${kind}`; mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh); return { kind, mesh };
  });
  const matrix = new Matrix4(); let disposed = false, lastUpdate = -Infinity;
  function update(player: { x: number; z: number }, now: number) {
    if (disposed) return;
    root.visible = ferry!.visible && ferry!.parent === options.landmarks
      && Math.hypot(player.x - ferry!.position.x, player.z - ferry!.position.z) < 220;
    if (!root.visible || now - lastUpdate < 1000) return;
    lastUpdate = now;
    const c = Math.cos(ferry!.rotation.y), s = Math.sin(ferry!.rotation.y);
    for (const { kind, mesh } of batches) {
      mesh.count = 0;
      for (const site of SITES) {
        if (site.kind !== kind) continue;
        const x = ferry!.position.x + c * site.x + s * site.z, z = ferry!.position.z - s * site.x + c * site.z;
        const y = options.heightAt(x, z);
        if (y === null || !Number.isFinite(y) || !options.isLoaded(x, z) || options.collides(x, y, z, site.radius)) continue;
        // Probe the whole footprint plus pedestrian clearance, not only its centre.
        const clearance = site.radius + .6;
        const probes = [[0, 0], [-clearance, 0], [clearance, 0], [0, -clearance], [0, clearance]];
        if (probes.some(([dx = 0, dz = 0]) => {
          const ground = options.heightAt(x + dx, z + dz);
          const road = options.roadHeightAt.contains?.(x + dx, z + dz, y)
            ?? options.roadHeightAt(x + dx, z + dz, y) !== null;
          return road || ground === null || !Number.isFinite(ground) || Math.abs(ground - y) > .12;
        })) continue;
        matrix.makeRotationY(ferry!.rotation.y + site.yaw); matrix.setPosition(x, y, z);
        mesh.setMatrixAt(mesh.count++, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    }
  }
  return { root, update, dispose() {
    if (disposed) return; disposed = true; root.removeFromParent();
    for (const { mesh } of batches) { mesh.geometry.dispose(); mesh.dispose(); }
    material.dispose(); texture.dispose();
  } };
}
