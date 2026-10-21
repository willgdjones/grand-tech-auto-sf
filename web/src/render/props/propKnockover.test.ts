import { describe, expect, it } from 'vitest';
import { createKnockover, DEFAULT_KNOCKOVER, type Knockover, type KnockoverConfig } from './propKnockover';

const cfg: KnockoverConfig = { bumpRadiusM: 2, toppleSeconds: 0.4, holdSeconds: 2, resetSeconds: 0.5 };

/** Advance in sub-clamp (<=0.1 s) steps so each tick applies in full, totalling `seconds`. */
function advance(k: Knockover, seconds: number, step = 0.05): void {
  let remaining = seconds;
  while (remaining > 1e-9) { const d = Math.min(step, remaining); k.tick(d); remaining -= d; }
}

describe('prop knockover', () => {
  it('ignores a car outside the bump radius and topples one inside it', () => {
    const k = createKnockover(cfg);
    expect(k.bump(1, 10, 0, 0, 0)).toBe(false); // ~10 m away -> no topple
    expect(k.lean(1)).toBeNull();
    expect(k.activeCount).toBe(0);
    expect(k.bump(2, 1, 0, 0, 0)).toBe(true); // 1 m away, inside radius 2 -> newly toppled
    expect(k.lean(2)?.amount).toBe(0); // just started, still upright
    expect(k.activeCount).toBe(1);
  });

  it('falls toward the side away from the car', () => {
    const west = createKnockover(cfg);
    west.bump(1, 3.5, 0, 5, 0); // prop just west of the car (1.5 m) -> falls further west (-x)
    expect(Math.sin(west.lean(1)!.fallYaw)).toBeLessThan(0);
    const north = createKnockover(cfg);
    north.bump(1, 0, 1.5, 0, 0); // prop just north of the car (1.5 m) -> falls +z
    expect(Math.cos(north.lean(1)!.fallYaw)).toBeGreaterThan(0.9);
  });

  it('runs topple -> held -> resetting -> upright and forgets the prop', () => {
    const k = createKnockover(cfg);
    k.bump(1, 0, 0, 0, 0);
    expect(k.lean(1)!.amount).toBe(0);
    advance(k, cfg.toppleSeconds);
    expect(k.lean(1)!.amount).toBeCloseTo(1, 3); // flat
    advance(k, cfg.holdSeconds - 0.2);
    expect(k.lean(1)!.amount).toBe(1); // still held flat
    advance(k, 0.2 + cfg.resetSeconds + 0.05); // finish hold + full rise
    expect(k.lean(1)).toBeNull(); // upright, forgotten
    expect(k.activeCount).toBe(0);
  });

  it('rises monotonically back up once resetting', () => {
    const k = createKnockover(cfg);
    k.bump(1, 0, 0, 0, 0);
    advance(k, cfg.toppleSeconds + cfg.holdSeconds); // down and held through the dwell
    const before = k.lean(1)!.amount;
    advance(k, cfg.resetSeconds / 2);
    const mid = k.lean(1)!.amount;
    expect(mid).toBeLessThan(before); // rising (amount shrinking toward upright)
    expect(mid).toBeGreaterThan(0);
  });

  it('does not restart a prop that is already down', () => {
    const k = createKnockover(cfg);
    k.bump(1, 0, 0, 0, 0);
    advance(k, cfg.toppleSeconds + 0.1); // held, amount 1
    expect(k.bump(1, 0, 0, 0, 0)).toBe(false); // second hit while down — no restart, no new topple
    expect(k.lean(1)!.amount).toBe(1);
    expect(k.activeCount).toBe(1);
  });

  it('clamps long frames so a stall cannot skip the fall, and forget() clears state', () => {
    const k = createKnockover(cfg);
    k.bump(1, 0, 0, 0, 0);
    k.tick(10); // one giant frame is clamped to 0.1 s — still mid-topple, not gone
    expect(k.lean(1)).not.toBeNull();
    expect(k.lean(1)!.amount).toBeLessThan(1);
    k.forget(1);
    expect(k.lean(1)).toBeNull();
    expect(k.activeCount).toBe(0);
  });

  it('ships a frozen default config roughly matching the car bump radius', () => {
    expect(Object.isFrozen(DEFAULT_KNOCKOVER)).toBe(true);
    expect(DEFAULT_KNOCKOVER.bumpRadiusM).toBeGreaterThan(1);
    expect(DEFAULT_KNOCKOVER.toppleSeconds).toBeGreaterThan(0);
  });
});
