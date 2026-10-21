import { describe, expect, it } from 'vitest';
import type { MapCollision } from '../mapCollision';
import { dirTo, lineOfSight, rayVsWorld } from './rayVsWorld';

// One 10×10 m building from x∈[95,105], z∈[-5,5], 20 m tall, at origin [0,0,0] (rings = world coords).
const BUILDING: MapCollision = {
  version: 1,
  origin: [0, 0, 0],
  buildings: [{
    id: 'b1', minY: 0, maxY: 20, heightSource: 'test',
    rings: [[[95, 5], [95, -5], [105, -5], [105, 5]]],
  }],
};

describe('rayVsWorld — buildings', () => {
  it('hits the near wall of a building in the ray path', () => {
    const r = rayVsWorld({ origin: [0, 1, 0], dir: [1, 0, 0], maxDist: 200 }, BUILDING);
    expect(r.hit).toBe(true);
    expect(r.kind).toBe('building');
    expect(r.buildingId).toBe('b1');
    expect(r.distance).toBeCloseTo(95, 3);
    expect(r.point[0]).toBeCloseTo(95, 3);
  });

  it('misses when the ray passes to the side of the footprint', () => {
    const r = rayVsWorld({ origin: [0, 1, 20], dir: [1, 0, 0], maxDist: 200 }, BUILDING);
    expect(r.hit).toBe(false);
    expect(r.kind).toBe('none');
  });

  it('misses when the ray flies over the building (above maxY)', () => {
    const r = rayVsWorld({ origin: [0, 30, 0], dir: [1, 0, 0], maxDist: 200 }, BUILDING);
    expect(r.hit).toBe(false);
  });

  it('respects maxDist (building beyond range is not hit)', () => {
    const r = rayVsWorld({ origin: [0, 1, 0], dir: [1, 0, 0], maxDist: 50 }, BUILDING);
    expect(r.hit).toBe(false);
  });

  it('applies the collision origin offset', () => {
    const shifted: MapCollision = { ...BUILDING, origin: [1000, 0, 0] }; // building now at x∈[1095,1105]
    const miss = rayVsWorld({ origin: [0, 1, 0], dir: [1, 0, 0], maxDist: 200 }, shifted);
    expect(miss.hit).toBe(false);
    const hit = rayVsWorld({ origin: [1000, 1, 0], dir: [1, 0, 0], maxDist: 200 }, shifted);
    expect(hit.hit).toBe(true);
    expect(hit.distance).toBeCloseTo(95, 3);
  });
});

describe('rayVsWorld — terrain', () => {
  it('hits flat ground when the ray descends into it', () => {
    const r = rayVsWorld({ origin: [0, 5, 0], dir: dirTo([0, 5, 0], [100, -5, 0]).dir, maxDist: 300 }, null, { heightAt: () => 0 });
    expect(r.hit).toBe(true);
    expect(r.kind).toBe('terrain');
    expect(r.distance).toBeGreaterThan(40);
    expect(r.point[1]).toBeLessThanOrEqual(0.5);
  });

  it('returns the nearer of building vs terrain', () => {
    // Ray grazes down toward ground; the building wall at x=95 is nearer than the ground crossing.
    const r = rayVsWorld({ origin: [0, 10, 0], dir: dirTo([0, 10, 0], [300, 0, 0]).dir, maxDist: 400 }, BUILDING, { heightAt: () => 0 });
    expect(r.hit).toBe(true);
    expect(r.kind).toBe('building'); // wall is crossed before the ray reaches the ground far away
  });

  it('no terrain sampler → ignores ground', () => {
    const r = rayVsWorld({ origin: [0, 5, 0], dir: [1, -0.5, 0], maxDist: 300 }, null);
    expect(r.hit).toBe(false);
  });
});

describe('lineOfSight', () => {
  it('is blocked by a building between the two points', () => {
    expect(lineOfSight([0, 1, 0], [200, 1, 0], BUILDING)).toBe(false);
  });

  it('is clear when nothing is between', () => {
    expect(lineOfSight([0, 1, 20], [200, 1, 20], BUILDING)).toBe(true);
  });

  it('is clear to a point just in front of a wall', () => {
    expect(lineOfSight([0, 1, 0], [94, 1, 0], BUILDING)).toBe(true);
  });

  it('is trivially clear for coincident points', () => {
    expect(lineOfSight([5, 1, 5], [5, 1, 5], BUILDING)).toBe(true);
  });
});

describe('dirTo', () => {
  it('returns a unit direction and the distance', () => {
    const { dir, distance } = dirTo([0, 0, 0], [0, 0, 10]);
    expect(distance).toBeCloseTo(10, 6);
    expect(dir).toEqual([0, 0, 1]);
  });
});

describe('gtasf-j7wvv: building bounds prefilter is exact', () => {
  // The pre-prefilter scan, kept as the reference: every edge of every building.
  const reference = (origin: [number, number, number], to: [number, number, number], c: MapCollision): boolean => {
    const { dir, distance } = dirTo(origin, to);
    if (distance < 1e-6) return true;
    const maxDist = distance - Math.min(0.25, distance / 2);
    for (const b of c.buildings) for (const ring of b.rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, e = ring[(i + 1) % ring.length]!;
      const ax = a[0] + c.origin[0], az = a[1] + c.origin[2], ex = e[0] + c.origin[0] - ax, ez = e[1] + c.origin[2] - az;
      const denom = dir[0] * ez - dir[2] * ex;
      if (Math.abs(denom) < 1e-6) continue;
      const wx = ax - origin[0], wz = az - origin[2], s = (wx * ez - wz * ex) / denom, t = (wx * dir[2] - wz * dir[0]) / denom;
      if (s < 0 || s > maxDist || t < 0 || t > 1) continue;
      const y = origin[1] + s * dir[1];
      if (y >= b.minY - 1e-6 && y <= b.maxY + 1e-6) return false;
    }
    return true;
  };
  it('lineOfSight matches the brute-force scan on random rays through a random block of buildings', () => {
    let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const city: MapCollision = { version: 1, origin: [300, 0, -200], buildings: Array.from({ length: 120 }, (_, i) => {
      const x = rnd() * 400, z = rnd() * 400, w = 4 + rnd() * 30, d = 4 + rnd() * 30, lo = rnd() < 0.2 ? 6 : 0;
      return { id: `b${i}`, minY: lo, maxY: lo + 3 + rnd() * 60, heightSource: 'test', rings: [[[x, z], [x + w, z], [x + w, z + d], [x, z + d]]] as [number, number][][] };
    }) };
    let blocked = 0;
    for (let i = 0; i < 3000; i++) {
      const from: [number, number, number] = [300 + rnd() * 400, rnd() * 40, -200 + rnd() * 400];
      const to: [number, number, number] = [300 + rnd() * 400, rnd() * 40, -200 + rnd() * 400];
      const want = reference(from, to, city);
      if (!want) blocked++;
      expect(lineOfSight(from, to, city)).toBe(want);
    }
    expect(blocked).toBeGreaterThan(300); // the sample exercises real blocks, not just clear rays
  });
});
