import { expect, it } from 'vitest';
import { pierGapFill } from '../src/pipeline/pierGaps';
import { FilledTerrain } from '../src/pipeline/sunkenPlazas';

// Land (2.5 m) for z < 0, the Bay (-3 m) beyond; a pier shed stands over the water from z = 3 to 40, leaving a 3 m
// strip of open water between it and the seawall.
const dem = { sample: (_x: number, z: number) => (z < 0 ? 2.5 : -3) };
const shed = [[[-20, 3], [20, 3], [20, 40], [-20, 40], [-20, 3]]] as [number, number][][];

it('fills the water strip between an over-water footprint and the seawall to the land grade', () => {
  const fill = pierGapFill(shed, dem)!;
  expect(fill).not.toBeNull();
  const ground = new FilledTerrain(dem, [fill]);
  expect(ground.sample(0, 1.5)).toBeGreaterThan(2);         // the strip reads as ground, not a blue crack
  expect(ground.sample(0, -5)).toBe(2.5);                    // dry land keeps the raw DEM exactly
  expect(ground.sample(0, 70)).toBe(-3);                     // open water further out is untouched
  expect(ground.sample(30, 1.5)).toBeLessThan(0);            // beside the shed (> 8 m from it) stays water
  expect(fill.max).toBeLessThanOrEqual(5.5 + 1e-6);          // never above the land grade
});

it('leaves dry shore buildings and buildings far from land alone', () => {
  const dry = [[[-20, -40], [20, -40], [20, -10], [-20, -10], [-20, -40]]] as [number, number][][];
  expect(pierGapFill(dry, dem)).toBeNull();
  const island = [[[-20, 200], [20, 200], [20, 240], [-20, 240], [-20, 200]]] as [number, number][][];
  expect(pierGapFill(island, dem)).toBeNull();
});
