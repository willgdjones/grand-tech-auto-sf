import { describe, expect, it } from 'vitest';
import { createMayhemController, type MayhemHit } from './mayhemController';
import { MAYHEM_FIRE_COOLDOWN_MS, WATER_SLOW_FACTOR, WATER_SLOW_MS } from '@gtasf/shared/content/mayhem';
import type { C2SMessage } from '@gtasf/shared/protocol/types';

const hit: MayhemHit = { at: [1, 2, 3], normal: [0, 1, 0], targetId: 'p7' };

describe('mayhem controller', () => {
  it('selects and cycles the toy', () => {
    const c = createMayhemController({ raycast: () => hit });
    expect(c.selected).toBe('paintball');
    c.cycle(1); expect(c.selected).toBe('confetti');
    c.select('water'); expect(c.selected).toBe('water');
    c.cycle(1); expect(c.selected).toBe('paintball'); // wraps
  });

  it('fires the selected toy into a hit, carrying colour + normal + target', () => {
    const c = createMayhemController({ raycast: () => hit, colour: () => 0x00ff00 });
    const e = c.fire(1000);
    expect(e).toEqual({ item: 'paintball', at: [1, 2, 3], colour: 0x00ff00, normal: [0, 1, 0], targetId: 'p7' });
  });

  it('rate-limits fires and returns null when the ray misses', () => {
    const c = createMayhemController({ raycast: () => hit });
    expect(c.fire(1000)).not.toBeNull();
    expect(c.fire(1000 + MAYHEM_FIRE_COOLDOWN_MS - 1)).toBeNull();       // too soon
    expect(c.fire(1000 + MAYHEM_FIRE_COOLDOWN_MS)).not.toBeNull();       // cooldown elapsed
    const miss = createMayhemController({ raycast: () => null });
    expect(miss.fire(5000)).toBeNull();                                  // nothing hit
  });

  it('briefly slows the player after a water hit, then restores full speed', () => {
    const c = createMayhemController({ raycast: () => hit });
    expect(c.speedScale(1000)).toBe(1);                                  // not slowed
    c.hitByWater(1000);
    expect(c.speedScale(1000)).toBe(WATER_SLOW_FACTOR);                  // slowed
    expect(c.speedScale(1000 + WATER_SLOW_MS - 1)).toBe(WATER_SLOW_FACTOR);
    expect(c.speedScale(1000 + WATER_SLOW_MS)).toBe(1);                  // recovered, no knockdown ever
  });

  it('sends one successful fire and applies relayed water only to nearby players', () => {
    const sent: Extract<C2SMessage, { type: 'MAYHEM_FIRE' }>[] = [];
    const sender = createMayhemController({ raycast: () => hit, send: message => sent.push(message) });
    const near = createMayhemController({ raycast: () => null });
    const far = createMayhemController({ raycast: () => null });
    sender.select('water');
    sender.fire(1000); sender.fire(1100);
    expect(sent).toHaveLength(1);
    const broadcast = { ...sent[0]!, senderId: 7 };
    expect(near.receive(broadcast, { x: 1, z: 3 }, 1200)).toMatchObject({ item: 'water', at: hit.at });
    expect(far.receive(broadcast, { x: 5, z: 3 }, 1200)).toMatchObject({ item: 'water' });
    expect(near.speedScale(1200)).toBe(WATER_SLOW_FACTOR);
    expect(far.speedScale(1200)).toBe(1);
    expect(near.speedScale(1200 + WATER_SLOW_MS)).toBe(1);
    sender.select('paintball'); sender.fire(3000);
    near.receive({ ...sent[1]!, senderId: 7 }, { x: 1, z: 3 }, 3100);
    expect(near.speedScale(3100)).toBe(1);
  });
});
