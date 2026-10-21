import { describe, expect, it } from 'vitest';
import { addTerrainMeshes, ChunkMeshes } from '../src/pipeline/meshes';
import { SpatialIndex } from '../src/pipeline/geometry';
import type { Polygon } from '../src/pipeline/types';

/**
 * Vivid SF pass (pane 9, founder "richer ground/grass contrast" + "bluer bay"). Terrain vertex
 * colours are linear, rounded to 0-255 in the mesh. Guards: parks go green, the bay goes deep blue,
 * and non-park land stays the golden-olive October ground (unchanged from before).
 */
const LAND = [97, 110, 71];   // [0.38,0.43,0.28]
const GRASS = [66, 107, 54];  // [0.26,0.42,0.21]
const WATER = [26, 59, 105];  // [0.10,0.23,0.41]
const hasColour = (colours: number[], [r, g, b]: number[]) => {
  for (let i = 0; i < colours.length; i += 3) if (colours[i] === r && colours[i + 1] === g && colours[i + 2] === b) return true;
  return false;
};
const fullChunkPark: Polygon = [[[0, 0], [0, 256], [256, 256], [256, 0]]];
const terrainColours = (parks: Polygon[], height: number) => {
  const meshes = new ChunkMeshes([0, 0, 256, 256]);
  addTerrainMeshes(meshes, { sample: () => height }, new SpatialIndex(), 64, 64, parks);
  return meshes.chunks.get('0_0')!.terrain.colours;
};

describe('terrain colour: parks green, bay blue, ground golden-olive', () => {
  it('keeps non-park land golden-olive, not green', () => {
    const land = terrainColours([], 5);
    expect(hasColour(land, LAND)).toBe(true);
    expect(hasColour(land, GRASS)).toBe(false);
  });

  it('colours park/grass landuse green for ground/grass contrast', () => {
    const park = terrainColours([fullChunkPark], 5);
    expect(hasColour(park, GRASS)).toBe(true);
    expect(hasColour(park, LAND)).toBe(false);
  });

  it('colours underwater triangles deep blue, never green even under a park', () => {
    const bay = terrainColours([fullChunkPark], -5);
    expect(hasColour(bay, WATER)).toBe(true);
    expect(hasColour(bay, GRASS)).toBe(false);
  });
});
