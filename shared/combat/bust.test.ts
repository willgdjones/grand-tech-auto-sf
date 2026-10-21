import { describe, expect, it } from 'vitest';
import { BUST_HOLD_MS, BUST_MAX_SPEED_MPS, BUST_MAX_STEP_MS, BUST_RADIUS_M, freshBust, stepBust, type BustInput } from './bust';

const TICK = 100;
/** Run ticks at a fixed position/velocity; returns the tick index of the bust, or -1. */
function run(ticks: number, at: (i: number) => Partial<BustInput>): number {
  let state = freshBust(0, 0, 0);
  for (let i = 1; i <= ticks; i++) {
    const r = stepBust(state, { level: 2, onFoot: true, nearestUnitM: 2, x: 0, z: 0, now: i * TICK, ...at(i) });
    state = r.state;
    if (r.busted) return i;
  }
  return -1;
}

describe('stepBust', () => {
  it('a wanted player standing next to a cruiser is busted after the hold time', () => {
    expect(run(60, () => ({}))).toBe(BUST_HOLD_MS / TICK);
  });

  it('nobody is busted without a wanted level', () => {
    expect(run(60, () => ({ level: 0 }))).toBe(-1);
  });

  it('in a vehicle, out of reach, or sprinting: never busted', () => {
    expect(run(60, () => ({ onFoot: false }))).toBe(-1);
    expect(run(60, () => ({ nearestUnitM: BUST_RADIUS_M + 0.1 }))).toBe(-1);
    expect(run(60, () => ({ nearestUnitM: Infinity }))).toBe(-1);
    const sprint = (BUST_MAX_SPEED_MPS + 2) * TICK / 1000; // metres per tick
    expect(run(60, i => ({ x: i * sprint }))).toBe(-1);
  });

  it('walking slowly next to the police still gets you cuffed', () => {
    const walk = (BUST_MAX_SPEED_MPS - 1) * TICK / 1000;
    expect(run(60, i => ({ x: i * walk }))).toBe(BUST_HOLD_MS / TICK);
  });

  it('breaking away resets the timer (no banked progress)', () => {
    const half = BUST_HOLD_MS / TICK / 2;
    // caught for just under the hold, escape for one tick, then caught again: the clock restarts.
    const busted = run(80, i => ({ nearestUnitM: i === half * 2 - 1 ? 20 : 2 }));
    expect(busted).toBe(half * 2 - 1 + BUST_HOLD_MS / TICK);
  });

  it('a WASTED player (dead, death debit in flight) is never also BUSTED — no double penalty', () => {
    // Caught for most of the hold, then killed: the next ticks must not complete the bust.
    const almost = BUST_HOLD_MS / TICK - 1;
    expect(run(60, i => ({ alive: i <= almost }))).toBe(-1);
  });

  it('the timer resets after a bust so it cannot double-fire', () => {
    let state = freshBust(0, 0, 0), busts = 0;
    for (let i = 1; i <= BUST_HOLD_MS / TICK + 5; i++) {
      const r = stepBust(state, { level: 3, onFoot: true, nearestUnitM: 1, x: 0, z: 0, now: i * TICK });
      state = r.state; if (r.busted) busts++;
    }
    expect(busts).toBe(1);
  });
});

describe('bust review: a server stall cannot complete a bust in one tick (D-L1)', () => {
  it('one 3 s step adds at most BUST_MAX_STEP_MS of hold', () => {
    const first = stepBust(freshBust(0, 0, 0), { level: 2, onFoot: true, nearestUnitM: 2, x: 0, z: 0, now: 100 });
    const stalled = stepBust(first.state, { level: 2, onFoot: true, nearestUnitM: 2, x: 0, z: 0, now: 3_100 });
    expect(stalled.busted).toBe(false);
    expect(stalled.state.holdMs).toBe(100 + BUST_MAX_STEP_MS);
  });
});

describe('QA #6.16: busts are fair', () => {
  it('a player who is shooting (resisting) is never cuffed; one who stops is, after the hold', () => {
    expect(run(80, () => ({ resisting: true }))).toBe(-1);
    expect(run(80, i => ({ resisting: i <= 10 }))).toBe(10 + BUST_HOLD_MS / TICK);
  });
  it('the hold is long enough to run (≥ 4 s)', () => {
    expect(BUST_HOLD_MS).toBeGreaterThanOrEqual(4_000);
  });
});

describe('QA #6.16 (gtasf-yqds6): ticks with no new MOVE do not cuff a runner', () => {
  it('a player running in 110 ms nudges, with server ticks that see no new pose in between, is never busted (one fast tick resets the hold)', () => {
    // 6 m/s: a 0.66 m nudge every 110 ms, but server ticks every 50 ms see the same pose twice in a row.
    let state = freshBust(0, 0, 0), x = 0, busted = false;
    for (let t = 50; t <= 20_000 && !busted; t += 50) {
      if (t % 110 < 50) x += 0.66;
      const r = stepBust(state, { level: 2, onFoot: true, nearestUnitM: 1, x, z: 0, now: t });
      state = r.state; busted = r.busted;
    }
    expect(busted).toBe(false);
  });
  it('a player who really stands still is still busted after the hold', () => {
    expect(run(80, () => ({}))).toBeGreaterThan(0);
  });
});

describe('review FB-L1: resisting needs a level where police shoot back', () => {
  it('a 1★ air-shot does not block the bust; at 2★+ a recent shot does', async () => {
    const { resistingArrest, BUST_RESIST_MS } = await import('./bust');
    const { POLICE_FIRE_MIN_LEVEL } = await import('./policeFire');
    expect(resistingArrest(1, 100)).toBe(false);
    expect(resistingArrest(POLICE_FIRE_MIN_LEVEL, 100)).toBe(true);
    expect(resistingArrest(POLICE_FIRE_MIN_LEVEL, BUST_RESIST_MS)).toBe(false);
  });
});
