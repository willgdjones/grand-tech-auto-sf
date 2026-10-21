import { expect, it, vi } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, LinearFilter, Mesh, MeshBasicMaterial, NearestFilter, Texture, TextureLoader } from 'three';
import type { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { createStreetProps, smoothFoliageTexture, type StreetPropWorld } from './streetProps';

it('smoothFoliageTexture restores Linear magnification + anisotropy on a foliage card (gtasf-r0yf)', () => {
  const map = new Texture();
  map.magFilter = NearestFilter; // the shared prop loader forces this for the chunky SA atlas
  map.anisotropy = 1;
  const version = map.version;
  smoothFoliageTexture(map);
  expect(map.magFilter).toBe(LinearFilter); // smooth close-up, no pixelated leaves
  expect(map.anisotropy).toBe(4);
  expect(map.version).toBeGreaterThan(version); // needsUpdate bumped so the new sampling re-uploads
});

it('smoothFoliageTexture never lowers an already-higher anisotropy', () => {
  const map = new Texture();
  map.anisotropy = 16;
  smoothFoliageTexture(map);
  expect(map.anisotropy).toBe(16);
});

