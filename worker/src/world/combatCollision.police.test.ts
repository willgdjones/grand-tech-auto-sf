import { describe, expect, it } from 'vitest';
import type { MapCollision } from '@gtasf/shared/mapCollision';
import { policeLineClear, shotLosKnown } from './combatCollision';

// One 10×10 m building at x∈[95,105], z∈[-5,5], 20 m tall.
const BUILDING: MapCollision = { version: 1, origin: [0, 0, 0], buildings: [{ id: 'b1', minY: 0, maxY: 20, heightSource: 'test', rings: [[[95, 5], [95, -5], [105, -5], [105, 5]]] }] };
const OPEN: MapCollision = { version: 1, origin: [0, 0, 0], buildings: [] };

describe('policeLineClear (SFPD fire + off-road steps fail closed)', () => {
  it('missing collision (chunk not loaded / no data) is BLOCKED — never shoot or step through an unknown wall', () => {
    expect(policeLineClear(undefined, [0, 1.4, 0], [10, 1.4, 0])).toBe(false);
  });
  it('a loaded open area is clear', () => {
    expect(policeLineClear(OPEN, [0, 1.4, 0], [200, 1.4, 0])).toBe(true);
  });
  it('a building between the cruiser and the player blocks the shot', () => {
    expect(policeLineClear(BUILDING, [0, 1.4, 0], [200, 1.4, 0])).toBe(false);
    expect(policeLineClear(BUILDING, [0, 1.4, 0], [80, 1.4, 0])).toBe(true); // stops short of the wall
  });
});

describe('shotLosKnown (player shots)', () => {
  it('collision data exists but the shooter chunk is not loaded yet: harms no one', () => {
    expect(shotLosKnown(undefined, 'loaded')).toBe(false);
  });
  it('manifest still loading / retrying (unknown): harms no one — never fail open at DO start', () => {
    expect(shotLosKnown(undefined, 'unknown')).toBe(false);
  });
  it('loaded collision (open or built-up) can be judged', () => {
    expect(shotLosKnown(OPEN, 'loaded')).toBe(true);
    expect(shotLosKnown(BUILDING, 'loaded')).toBe(true);
  });
  it('a world KNOWN to have no collision data (local/dev) keeps shots working', () => {
    expect(shotLosKnown(undefined, 'none')).toBe(true);
  });
});
