import { describe, expect, it } from 'vitest';
import { createStuntTracker } from './stuntBonus';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const fly = (t: ReturnType<typeof createStuntTracker>, from: number, to: number, ms: number, start = 0) => {
  t.update({ x: from, z: 0, airborne: true, landed: false }, start);
  return t.update({ x: to, z: 0, airborne: false, landed: true }, start + ms);
};

describe('stuntBonus tracker', () => {
  it('a real jump (>= 1 s air, >= 12 m) scores; short hops and void falls in place do not', () => {
    const t = createStuntTracker(memory());
    expect(fly(t, 0, 30, 1500)).toEqual({ distanceM: 30, airMs: 1500, best: true, from: { x: 0, z: 0 } });
    expect(fly(t, 0, 30, 600, 5000)).toBeNull();     // a kerb hop
    expect(fly(t, 0, 2, 2500, 9000)).toBeNull();     // falling through a streaming void at spawn
  });
  it('keeps the device best across trackers and only flags a longer jump as NEW BEST', () => {
    const store = memory();
    expect(fly(createStuntTracker(store), 0, 40, 1800)?.best).toBe(true);
    const again = createStuntTracker(store);
    expect(again.best).toEqual({ distanceM: 40, airMs: 1800 });
    expect(fly(again, 0, 25, 1200)?.best).toBe(false);
    expect(fly(again, 0, 55, 2100, 4000)?.best).toBe(true);
  });
  it('a corrupt stored best is ignored', () => {
    const store = memory(); store.setItem('gtasf.stunt.best', '{nope');
    expect(createStuntTracker(store).best).toBeNull();
  });
});

describe('stuntBonus unique stunts', () => {
  it('each named street counts once per device, kept across trackers; a jump reports its take-off point', () => {
    const store = memory(), t = createStuntTracker(store);
    expect(t.markStreet('Filbert Street')).toBe(true);
    expect(t.markStreet('Filbert Street')).toBe(false);
    expect(t.markStreet('  ')).toBe(false);
    expect(createStuntTracker(store).streets).toBe(1);
    expect(fly(t, 3, 40, 1500)?.from).toEqual({ x: 3, z: 0 });
  });
});
