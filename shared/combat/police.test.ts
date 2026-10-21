import { describe, expect, it } from 'vitest';
import {
  anySight, desiredUnits, distanceTo, escapedLoS, hasHelicopter, hasSwat,
  passedRoadblock, roadblockAnchor, roadblockCount, roadblockLine, ROADBLOCK_AHEAD_M,
  ROADBLOCK_LEVEL, POLICE_CHASE_SPEED, POLICE_SIGHT_M, seek, spawnPoint,
} from './police';

describe('desiredUnits', () => {
  it('scales with wanted level and clamps', () => {
    expect(desiredUnits(0)).toBe(0);
    // gtasf-66lvh: fewer units per star ([0,1,2,3,4,5] → [0,1,1,2,3,3]).
    expect(desiredUnits(1)).toBe(1);
    expect(desiredUnits(2)).toBe(1);
    expect(desiredUnits(3)).toBe(2);
    expect(desiredUnits(5)).toBe(3);
    expect(desiredUnits(9)).toBe(3);
  });
});

describe('seek', () => {
  it('moves toward the target by speed·dt', () => {
    const p = seek(0, 0, 100, 0, 10, 1); // 10 m in 1 s toward +x
    expect(p.x).toBeCloseTo(10, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });
  it('never overshoots the target', () => {
    const p = seek(0, 0, 3, 4, POLICE_CHASE_SPEED, 1); // target is 5 m away, cap would be 13 m
    expect(p.x).toBeCloseTo(3, 6);
    expect(p.z).toBeCloseTo(4, 6);
  });
  it('is a no-op at the target and with non-finite/zero dt', () => {
    expect(seek(5, 5, 5, 5, 10, 1)).toEqual({ x: 5, z: 5 });
    expect(seek(0, 0, 100, 0, 10, 0)).toEqual({ x: 0, z: 0 });
  });
});

describe('sight / escape', () => {
  const units = [{ x: 0, z: 0 }, { x: 200, z: 0 }];
  it('anySight is true when a unit is within range', () => {
    expect(anySight(units, 10, 0)).toBe(true);     // 10 m from unit 0
    expect(anySight(units, 1000, 0)).toBe(false);  // far from both
  });
  it('escapedLoS is the inverse of anySight', () => {
    expect(escapedLoS(units, 10, 0)).toBe(false);
    expect(escapedLoS(units, 1000, 0)).toBe(true);
    expect(escapedLoS([], 0, 0)).toBe(true);        // no cops → escaped
  });
  it('respects the sight range at the boundary', () => {
    expect(anySight([{ x: 0, z: 0 }], POLICE_SIGHT_M, 0)).toBe(true);
    expect(anySight([{ x: 0, z: 0 }], POLICE_SIGHT_M + 1, 0)).toBe(false);
  });
});

describe('spawnPoint / escalation', () => {
  it('places a spawn on the ring at the given angle/distance', () => {
    const p = spawnPoint(100, 100, 0, 80);
    expect(distanceTo(p.x, p.z, 100, 100)).toBeCloseTo(80, 6);
  });
  it('helicopter at 4+, SWAT at 5', () => {
    expect(hasHelicopter(3)).toBe(false);
    expect(hasHelicopter(4)).toBe(true);
    expect(hasSwat(4)).toBe(false);
    expect(hasSwat(5)).toBe(true);
  });
});

describe('roadblocks', () => {
  it('fields no cars below level 3, then scales and clamps', () => {
    expect(roadblockCount(0)).toBe(0);
    expect(roadblockCount(2)).toBe(0);
    expect(roadblockCount(ROADBLOCK_LEVEL)).toBe(2);
    expect(roadblockCount(4)).toBe(2); // gtasf-66lvh: 3 → 2
    expect(roadblockCount(5)).toBe(2);
    expect(roadblockCount(99)).toBe(2);
  });
  it('anchors the block ahead of the player along their heading', () => {
    const a = roadblockAnchor(0, 0, 0, ROADBLOCK_AHEAD_M); // heading +x
    expect(a.x).toBeCloseTo(ROADBLOCK_AHEAD_M, 6);
    expect(a.z).toBeCloseTo(0, 6);
    const b = roadblockAnchor(0, 0, Math.PI / 2, 50); // heading +z
    expect(b.x).toBeCloseTo(0, 6);
    expect(b.z).toBeCloseTo(50, 6);
  });
  it('lines the cars up perpendicular to the heading, centred on the anchor', () => {
    const line = roadblockLine(10, 0, 0, 3, 7); // heading +x → spread along z
    expect(line).toHaveLength(3);
    expect(line.map(p => p.x)).toEqual([10, 10, 10]);     // all at the anchor's x
    expect(line[0]!.z).toBeCloseTo(-7, 6);
    expect(line[1]!.z).toBeCloseTo(0, 6);
    expect(line[2]!.z).toBeCloseTo(7, 6);
  });
  it('detects when the player has driven past the block', () => {
    // anchor 70 m ahead (+x); player still behind it, then past it.
    expect(passedRoadblock(0, 0, 70, 0, 0)).toBe(false);
    expect(passedRoadblock(80, 0, 70, 0, 0)).toBe(true);
  });
});
