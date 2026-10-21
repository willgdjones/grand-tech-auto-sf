import { describe, expect, it } from 'vitest';
import {
  BILLBOARD_ROTATION_MS, assignBillboardSlots, startupForSlot, type BillboardStartup,
} from './billboardRotation';

const startups: BillboardStartup[] = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, startupName: `Startup ${i}` }));

describe('shared billboard slot rotation', () => {
  it('returns null when there are no startups', () => {
    expect(startupForSlot('slot-a', [], 0)).toBeNull();
    expect(assignBillboardSlots(['slot-a', 'slot-b'], [], 0).size).toBe(0);
  });

  it('is deterministic for the same slot/time/list (all clients agree)', () => {
    const a = startupForSlot('sf-bb-embarcadero-01', startups, 1_000_000);
    const b = startupForSlot('sf-bb-embarcadero-01', startups, 1_000_000);
    expect(a).toEqual(b);
  });

  it('advances exactly one startup per rotation period', () => {
    const now = 0;
    const first = startupForSlot('slot-x', startups, now)!;
    const firstIdx = startups.indexOf(first);
    const next = startupForSlot('slot-x', startups, now + BILLBOARD_ROTATION_MS)!;
    expect(startups.indexOf(next)).toBe((firstIdx + 1) % startups.length);
    // Within the same period it does not change.
    expect(startupForSlot('slot-x', startups, now + BILLBOARD_ROTATION_MS - 1)).toEqual(first);
  });

  it('cycles through every startup over N periods', () => {
    const seen = new Set<string>();
    for (let e = 0; e < startups.length; e++) seen.add(startupForSlot('slot-y', startups, e * BILLBOARD_ROTATION_MS)!.id);
    expect(seen.size).toBe(startups.length);
  });

  it('spreads different startups across neighbouring slots at one instant', () => {
    const slots = ['sf-bb-a', 'sf-bb-b', 'sf-bb-c', 'sf-bb-d'];
    const assigned = assignBillboardSlots(slots, startups, 500_000);
    expect(assigned.size).toBe(slots.length);
    // Not all the same startup (the hash spread makes neighbours differ with 5 startups / 4 slots).
    expect(new Set([...assigned.values()].map(s => s.id)).size).toBeGreaterThan(1);
  });

  it('handles a single startup (every slot shows it)', () => {
    const one = [startups[0]!];
    expect(startupForSlot('slot-a', one, 0)!.id).toBe('d0');
    expect(startupForSlot('slot-b', one, 7 * BILLBOARD_ROTATION_MS)!.id).toBe('d0');
  });

  it('a zero/negative period falls back to the default and never divides by zero', () => {
    expect(startupForSlot('slot-a', startups, 1000, 0)).toEqual(startupForSlot('slot-a', startups, 1000));
    expect(() => startupForSlot('slot-a', startups, -5, -1)).not.toThrow();
  });
});

describe('billboard tier routing (upgrade per stage)', () => {
  const tiered: BillboardStartup[] = [
    { id: 'idea', startupName: 'Idea', tierRank: 0 },
    { id: 'pre', startupName: 'Pre-seed', tierRank: 0 },
    { id: 'seed', startupName: 'Seed', tierRank: 1 },
    { id: 'a', startupName: 'Series A', tierRank: 2 },
  ];
  it('a Market-St surface (rank 1) only shows startups that reached Seed', () => {
    for (let e = 0; e < 16; e++) {
      const s = startupForSlot({ id: `mkt-${e}`, minRank: 1 }, tiered, e * BILLBOARD_ROTATION_MS)!;
      expect(s.tierRank ?? 0).toBeGreaterThanOrEqual(1);
    }
  });
  it('a Bay-Bridge surface (rank 2) only shows Series A+', () => {
    for (let e = 0; e < 16; e++) {
      const s = startupForSlot({ id: `bb-${e}`, minRank: 2 }, tiered, e * BILLBOARD_ROTATION_MS)!;
      expect(s.tierRank ?? 0).toBeGreaterThanOrEqual(2);
    }
  });
  it('rank 0 (or a bare slot id) shows any startup, same as before', () => {
    expect(startupForSlot({ id: 'local-1', minRank: 0 }, tiered, 0)).toEqual(startupForSlot('local-1', tiered, 0));
  });
  it('falls back to the full list so a prominent board is never blank before anyone has climbed', () => {
    const early: BillboardStartup[] = [{ id: 'x', startupName: 'X' }, { id: 'y', startupName: 'Y' }];
    const s = startupForSlot({ id: 'mkt-1', minRank: 2 }, early, 0); // no rank-2 startup exists → fallback
    expect(s).not.toBeNull();
    expect(['x', 'y']).toContain(s!.id);
  });
  it('a startup with no tierRank defaults to rank 0 (local only, never Market St)', () => {
    const mix: BillboardStartup[] = [{ id: 'none', startupName: 'No rank' }, { id: 'seed', startupName: 'Seed', tierRank: 1 }];
    for (let e = 0; e < 8; e++) {
      expect(startupForSlot({ id: `mkt-${e}`, minRank: 1 }, mix, e * BILLBOARD_ROTATION_MS)!.id).toBe('seed');
    }
  });
  it('assignBillboardSlots takes {id,minRank} slots and keys the map by id', () => {
    const assigned = assignBillboardSlots([{ id: 'mkt-1', minRank: 1 }, 'local-1'], tiered, 0);
    expect(assigned.has('mkt-1')).toBe(true);
    expect(assigned.has('local-1')).toBe(true);
    expect(assigned.get('mkt-1')!.tierRank ?? 0).toBeGreaterThanOrEqual(1);
  });
});
