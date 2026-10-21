import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { createMayhemEffects } from './mayhem';
import type { MayhemFireEvent } from '@gtasf/shared/content/mayhem';

const paintball = (colour?: number, normal?: [number, number, number]): MayhemFireEvent => ({ item: 'paintball', at: [1, 2, 3], colour, normal });

describe('createMayhemEffects', () => {
  it('splats a decal on paintball and recycles it after its fade life', () => {
    const fx = createMayhemEffects(new Group(), { low: true });
    fx.fire(paintball(0x123456, [0, 1, 0]));
    expect(fx.stats.decals).toBe(1);
    fx.update(0.1); expect(fx.stats.decals).toBe(1);   // still within SPLAT_FADE_MS
    for (let i = 0; i < 2000; i++) fx.update(0.1);      // age past the ~180 s fade life
    expect(fx.stats.decals).toBe(0);                    // recycled
    fx.dispose();
  });

  it('caps live decals at the phone budget, recycling the oldest', () => {
    const fx = createMayhemEffects(new Group(), { low: true }); // low cap = 28
    for (let i = 0; i < 40; i++) fx.fire(paintball(0xff0000));
    expect(fx.stats.decals).toBeLessThanOrEqual(28);
    expect(fx.stats.decals).toBeGreaterThan(0);
    fx.dispose();
  });

  it('fires confetti + water bursts that recycle after their life', () => {
    const fx = createMayhemEffects(new Group(), { low: false });
    fx.fire({ item: 'confetti', at: [0, 5, 0] });
    fx.fire({ item: 'water', at: [2, 0, 2] });
    expect(fx.stats.bursts).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 40; i++) fx.update(0.1); // 4 s > confetti 2.6 s and water 0.8 s
    expect(fx.stats.bursts).toBe(0);
    fx.dispose();
  });

  it('is a no-op on empty update and ignores nothing-fired state without throwing', () => {
    const fx = createMayhemEffects(new Group());
    fx.update(0.016);
    expect(fx.stats.decals).toBe(0);
    expect(fx.stats.bursts).toBe(0);
    fx.dispose();
  });
});
