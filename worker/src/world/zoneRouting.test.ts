import { describe, expect, it } from 'vitest';
import { SINGLE_WORLD, resolveZoneName, worldBroadcastTargets, worldInstanceName } from './zoneRouting';
import { SF_ZONE_GRID, zoneCount } from '@gtasf/shared/world/zones';
import { LOCAL_SPAWN, LOMBARD_SPAWN } from './localSpawn';

const url = (query: string) => new URL(`https://gtasf.com/api/world${query}`);

describe('world instance routing', () => {
  it('stays on the single world when zoning is off, whatever the params', () => {
    expect(worldInstanceName(url('?zone=3,2'), false)).toBe(SINGLE_WORLD);
    expect(worldInstanceName(url(''), false)).toBe(SINGLE_WORLD);
  });

  it('honours an explicit in-grid ?zone', () => {
    expect(worldInstanceName(url('?zone=3,2'), true)).toBe('z:3:2');
    expect(resolveZoneName(url('?zone=0,0'))).toBe('z:0:0');
  });

  it('ignores an out-of-grid or malformed ?zone and falls back', () => {
    // 9,9 is outside the 5x4 grid → falls through to the default Ferry cell.
    expect(resolveZoneName(url('?zone=9,9'))).toBe(resolveZoneName(url('')));
    expect(resolveZoneName(url('?zone=foo'))).toBe(resolveZoneName(url('')));
  });

  it('derives the cell from ?spawn (centimetres → metres)', () => {
    const ferry = `${LOCAL_SPAWN.x},${LOCAL_SPAWN.y},${LOCAL_SPAWN.z},${LOCAL_SPAWN.yaw}`;
    const lombard = `${LOMBARD_SPAWN.x},${LOMBARD_SPAWN.y},${LOMBARD_SPAWN.z},${LOMBARD_SPAWN.yaw}`;
    const ferryZone = resolveZoneName(url(`?spawn=${ferry}`));
    const lombardZone = resolveZoneName(url(`?spawn=${lombard}`));
    expect(ferryZone).toMatch(/^z:\d+:\d+$/);
    expect(lombardZone).toMatch(/^z:\d+:\d+$/);
    // The founder route (Ferry → Lombard) spans two different zones, so handoff matters.
    expect(ferryZone).not.toBe(lombardZone);
  });

  it('defaults a param-less connection to the Ferry spawn cell', () => {
    const ferryFromSpawn = resolveZoneName(url(`?spawn=${LOCAL_SPAWN.x},${LOCAL_SPAWN.y},${LOCAL_SPAWN.z},${LOCAL_SPAWN.yaw}`));
    expect(resolveZoneName(url(''))).toBe(ferryFromSpawn);
  });

  it('targets only the single world for a city-wide broadcast when zoning is off', () => {
    expect(worldBroadcastTargets(false)).toEqual([SINGLE_WORLD]);
  });

  it('fans a city-wide broadcast out to every zone cell when zoning is on', () => {
    const targets = worldBroadcastTargets(true);
    expect(targets).toHaveLength(zoneCount(SF_ZONE_GRID));
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets).not.toContain(SINGLE_WORLD);
  });
});
