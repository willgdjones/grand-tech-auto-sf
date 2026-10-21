import { describe, expect, it } from 'vitest';
import { sampleDrawnHeight, sampleHeight, type Heightfield } from './heightfield';

// One 2x2-sample cell, 10 m step, a saddle: (0,0)=10 m, (1,0)=0, (0,1)=0, (1,1)=10 m.
const saddle: Heightfield = { size: 2, step: 10, baseCm: 0, x: 0, z: 0, values: Uint16Array.from([1000, 0, 0, 1000]) };
describe('sampleDrawnHeight (serverTerrainLos)', () => {
  it('follows the drawn (x,z+s)-(x+s,z) triangles, not bilinear, on a saddle cell', () => {
    expect(sampleHeight(saddle, 5, 5)).toBeCloseTo(5);      // bilinear: 5 m at the centre
    expect(sampleDrawnHeight(saddle, 5, 5)).toBeCloseTo(0); // drawn: on the (10,0)-(0,10) diagonal, both 0 m
    expect(sampleDrawnHeight(saddle, 1, 1)).toBeCloseTo(8); // near the 10 m corner, first triangle
    expect(sampleDrawnHeight(saddle, 9, 9)).toBeCloseTo(8); // near the other 10 m corner, second triangle
  });
  it('agrees with bilinear at the samples and is null outside the chunk', () => {
    expect(sampleDrawnHeight(saddle, 0, 0)).toBeCloseTo(10);
    expect(sampleDrawnHeight(saddle, 10, 0)).toBeCloseTo(0);
    expect(sampleDrawnHeight(saddle, 11, 5)).toBeNull();
  });
});
