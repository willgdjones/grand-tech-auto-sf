import { describe, expect, it } from 'vitest';
import { applyVisibility, byZone, countRejoinGlitches, distributeBots, zoneQuery, walkToward, updateVisibility, clientLoadPassed } from './plan';
import { assertStagingHealth, assertStagingTarget } from './target';
import { SF_ZONE_GRID, cellBounds, splitPlayerId, zoneCount } from '@gtasf/shared/world/zones';
import type { S2CMessage } from '@gtasf/shared/protocol/types';

const grid = { minX: 0, minZ: 0, cols: 3, rows: 2, cell: 1000 }; // 6 cells

describe('zoned load bot distribution', () => {
  it('spreads bots evenly across every cell, round-robin', () => {
    const plans = distributeBots(12, grid, 0);
    const perZone = new Map<string, number>();
    for (const p of plans) perZone.set(p.zone, (perZone.get(p.zone) ?? 0) + 1);
    expect(perZone.size).toBe(zoneCount(grid)); // all 6 cells used
    expect([...perZone.values()].every(c => c === 2)).toBe(true); // 12/6 = 2 each
  });

  it('spawns each bot inside its own cell', () => {
    for (const p of distributeBots(6, grid, 0)) {
      const b = cellBounds(grid, p.cell.cx, p.cell.cy);
      expect(p.spawn.x / 100).toBeGreaterThanOrEqual(b.minX);
      expect(p.spawn.x / 100).toBeLessThanOrEqual(b.maxX);
      expect(p.spawn.z / 100).toBeGreaterThanOrEqual(b.minZ);
      expect(p.spawn.z / 100).toBeLessThanOrEqual(b.maxZ);
    }
  });

  it('makes a fraction of bots border-crossers, into a different cell', () => {
    const plans = distributeBots(10, grid, 5); // every 5th crosses
    const crossers = plans.filter(p => p.crossTo);
    expect(crossers.length).toBeGreaterThan(0);
    for (const p of crossers) {
      // The crossTo target lies in a neighbouring cell, not the home cell.
      const b = cellBounds(grid, p.cell.cx, p.cell.cy);
      const inHome = p.crossTo!.x / 100 >= b.minX && p.crossTo!.x / 100 <= b.maxX;
      expect(inHome).toBe(false);
    }
  });

  it('spreads across the real SF grid within its 16–24 zones', () => {
    const plans = distributeBots(40);
    const zones = new Set(plans.map(p => p.zone));
    expect(zones.size).toBe(zoneCount(SF_ZONE_GRID));
  });
});

describe('handoff glitch detection', () => {
  it('counts a present → brief-absent → present blink as one glitch', () => {
    expect(countRejoinGlitches([true, true, false, false, true], 10)).toBe(1);
  });
  it('ignores a long absence (a real leave, not a handoff blink)', () => {
    expect(countRejoinGlitches([true, false, false, false, false, false], 2)).toBe(0); // never reappears
    expect(countRejoinGlitches([true, ...Array(20).fill(false), true], 5)).toBe(0); // gap > maxGap
  });
  it('is zero for a clean, continuously-present handoff', () => {
    expect(countRejoinGlitches([true, true, true, true], 10)).toBe(0);
  });
  it('counts multiple blinks', () => {
    expect(countRejoinGlitches([true, false, true, false, true], 10)).toBe(2);
  });
});

describe('visibility tracking (applyVisibility) feeds the glitch metric', () => {
  const snap = (...ids: number[]): S2CMessage => ({ type: 'SNAPSHOT', tick: 1, serverT: 0, entries: ids.map(id => ({ id, x: 0, y: 0, z: 0, yaw: 0, flags: 0 })) });
  const leave = (id: number): S2CMessage => ({ type: 'PLAYER_LEAVE', id });
  it('reveals snapshot ids and prunes a left id (so a same-id leave→rejoin is detectable)', () => {
    const visible = new Set<number>();
    applyVisibility(visible, snap(7, 9));
    expect(visible.has(7)).toBe(true);
    applyVisibility(visible, leave(7));
    expect(visible.has(7)).toBe(false); // without leave-pruning the flicker would be invisible (id stays "seen")
    expect(visible.has(9)).toBe(true);  // other peers unaffected
    applyVisibility(visible, snap(7));
    expect(visible.has(7)).toBe(true);  // rejoined
  });
  it('a leave→rejoin stream scores as one handoff glitch; a clean (no-leave) handoff scores zero', () => {
    const flicker: S2CMessage[] = [snap(7), snap(7), leave(7), snap(7)];
    const v1 = new Set<number>();
    const p1 = flicker.map(f => { applyVisibility(v1, f); return v1.has(7); });
    expect(p1).toEqual([true, true, false, true]);
    expect(countRejoinGlitches(p1, 10)).toBe(1);
    // Seamless handoff suppresses PLAYER_LEAVE across the seam → the id never drops → no glitch.
    const clean: S2CMessage[] = [snap(7), snap(7), snap(7), snap(7)];
    const v2 = new Set<number>();
    const p2 = clean.map(f => { applyVisibility(v2, f); return v2.has(7); });
    expect(countRejoinGlitches(p2, 10)).toBe(0);
  });
});

describe('per-zone grouping', () => {
  it('groups samples by each bot\'s home zone', () => {
    const plans = distributeBots(6, grid, 0);
    const grouped = byZone(plans, plans.map(p => p.index));
    expect(grouped.size).toBe(6);
    expect([...grouped.values()].every(v => v.length === 1)).toBe(true);
  });
});

// Sanity: the id scheme the load test asserts on is the one the server uses.
it('global id blocks are distinct per cell (load-test invariant)', () => {
  expect(splitPlayerId(1).cellIndex).toBe(0);
});

it('walks the real handoff margin below the server cap, with a stationary peer watching every crossing', () => {
  const plans = distributeBots(1000);
  for (const plan of plans.filter(p => p.crossTo)) {
    expect(zoneQuery(plan.zone)).toBe(`${plan.cell.cx},${plan.cell.cy}`);
    const watcher = plans[plan.watcherIndex!]!;
    expect(watcher.zone).toBe(plan.zone);
    expect(watcher.crossTo).toBeUndefined();
    let pose = plan.spawn;
    for (let tick = 0; tick < 200; tick++) {
      const next = walkToward(pose, plan.crossTo!, 100);
      expect(Math.hypot(next.x - pose.x, next.z - pose.z)).toBeLessThanOrEqual(51);
      pose = next;
    }
    expect(pose.x).toBe(plan.crossTo!.x);
  }
});

it('expires silently missing snapshots and fails a ramp without observed, clean handoffs', () => {
  const visible = new Map<number, number>();
  updateVisibility(visible, { type: 'SNAPSHOT', tick: 1, serverT: 0, entries: [{ id: 7, x: 0, y: 0, z: 0, yaw: 0, flags: 0 }] }, 0);
  updateVisibility(visible, { type: 'SNAPSHOT', tick: 2, serverT: 1600, entries: [] }, 1600);
  expect(visible.has(7)).toBe(false);
  const pass = { bots: 1000, welcomed: 1000, expectedCrossers: 200, completedHandoffs: 200, observedCrossers: 200,
    glitches: 0, missingSamples: 0, malformed: 0, errors: 0, rttSamples: 1000 };
  expect(clientLoadPassed(pass)).toBe(true);
  expect(clientLoadPassed({ ...pass, completedHandoffs: 0 })).toBe(false);
  expect(clientLoadPassed({ ...pass, expectedCrossers: 0 })).toBe(false);
  expect(clientLoadPassed({ ...pass, glitches: 1 })).toBe(false);
  expect(clientLoadPassed({ ...pass, missingSamples: 1 })).toBe(false);
});

it('refuses canonical production and staging aliases that actually serve production', () => {
  for (const origin of ['https://gtasf.com', 'wss://www.gtasf.com', 'wss://play.gtasf.com', 'https://gtasf.pages.dev'])
    expect(() => assertStagingTarget(origin)).toThrow(/PRODUCTION/);
  expect(assertStagingTarget('wss://staging.gtasf.com').secure).toBe(true);
  const flags = { multiplayer: true, zonedWorld: true, deepLinkSpawns: true, worldCapacity: false };
  expect(() => assertStagingHealth({ ok: true, environment: 'production', flags })).toThrow(/staging/);
  expect(() => assertStagingHealth({ ok: true, environment: 'staging', flags })).not.toThrow();
  expect(() => assertStagingHealth({ ok: true, environment: 'staging', flags: { ...flags, deepLinkSpawns: false } })).toThrow();
});
