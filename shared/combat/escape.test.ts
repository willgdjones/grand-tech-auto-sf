import { describe, expect, it } from 'vitest';
import { escapeRate, escapeTotalMs, evadeMs, freshEscape, HIDEOUTS, RESPRAY_SHOPS, resprayClears, searchMs, stepEscape, stepSightingHold, UNSIGHTED_HOLD_MS, withinAny, type EscapeInput, type EscapeState, type SightingHold } from './escape';
import { tickWanted, WANTED_THRESHOLDS, wantedLevel } from './wanted';
import { flags } from '../flags';
import { SFPD_CLASSIC, SFPD_FAIR, SFPD_TUNING } from './sfpdTuning';

// gtasf-66lvh: one smoke check per escape rule.
const base: EscapeInput = { level: 2, seen: false, dtMs: 100, lastCrimeMs: 0, inHideout: false, nearestUnitM: 50, vehicle: 0 };
/** Run ticks of `dtMs` until cleared or `maxMs` elapsed; returns the elapsed (unscaled) ms and the last step. */
function run(input: Partial<EscapeInput>, maxMs = 120_000, start: EscapeState = freshEscape()) {
  let state = start, t = 0;
  let last = stepEscape(state, { ...base, ...input, dtMs: 0 });
  while (t < maxMs) {
    last = stepEscape(state, { ...base, ...input });
    state = last.state; t += base.dtMs;
    if (last.cleared) break;
  }
  return { t, last };
}

describe('escape: break line of sight → searching → cleared', () => {
  it('shorter at low stars, longer at high stars', () => {
    for (let level = 1; level <= 5; level++) expect(run({ level }).t).toBe(escapeTotalMs(level));
    expect(escapeTotalMs(1)).toBeLessThan(escapeTotalMs(5));
    // escapeOwnsClear (critic 12:1x) scales the clock harder: ~12 / 18 / 30 s at 1-3 stars; otherwise the fair 9 ... 36 s.
    expect(escapeTotalMs(1)).toBe(flags.escapeOwnsClear ? 12_000 : 9_000);
    expect(escapeTotalMs(5)).toBe(flags.escapeOwnsClear ? 50_000 : 36_000);
    if (flags.escapeOwnsClear) expect([1, 2, 3].map(escapeTotalMs)).toEqual([12_000, 18_000, 30_000]);
  });
  it('phases: evading first, then searching after evadeMs', () => {
    let s = freshEscape();
    let step = stepEscape(s, { ...base, dtMs: evadeMs(2) - 100 }); s = step.state;
    expect(step.phase).toBe('evading');
    step = stepEscape(s, { ...base, dtMs: 200 });
    expect(step.phase).toBe('searching');
    expect(step.remainingMs).toBe(escapeTotalMs(2) - evadeMs(2) - 100);
    expect(searchMs(2)).toBeGreaterThan(0);
  });
  it('being seen resets the clock', () => {
    let s = stepEscape(freshEscape(), { ...base, dtMs: 8_000 }).state;
    const seen = stepEscape(s, { ...base, seen: true });
    expect(seen.phase).toBe('seen');
    s = seen.state;
    expect(stepEscape(s, base).progress).toBeLessThan(0.02);
  });
  it('a new crime resets the clock', () => {
    const s = stepEscape(freshEscape(), { ...base, dtMs: 8_000 }).state;
    expect(stepEscape(s, { ...base, lastCrimeMs: 5_000 }).state.hiddenMs).toBe(100);
  });
  it('no wanted level: nothing to escape', () => {
    expect(stepEscape(freshEscape(), { ...base, level: 0 }).cleared).toBe(false);
  });
});

describe('escape helpers', () => {
  it('hideout: the clock runs ×2', () => {
    expect(run({ level: 3, inHideout: true }).t).toBe(escapeTotalMs(3) / SFPD_TUNING.hideoutRate);
  });
  it('outrun: beyond outrunM from every unit the clock runs ×1.5', () => {
    expect(escapeRate(false, SFPD_TUNING.outrunM - 1)).toBe(1);
    expect(escapeRate(false, SFPD_TUNING.outrunM + 1)).toBe(SFPD_TUNING.outrunRate);
    expect(run({ level: 3, nearestUnitM: 1_000 }, 120_000, { ...freshEscape(), sighted: true }).t).toBeLessThan(escapeTotalMs(3));
  });
  it('car swap while unseen skips straight to searching (once)', () => {
    const seenIn = stepEscape(freshEscape(), { ...base, seen: true, vehicle: 7 }).state; // seen in car 7
    const swap = stepEscape(seenIn, { ...base, vehicle: 9 });
    expect(swap.phase).toBe('searching');
    expect(stepEscape(seenIn, { ...base, vehicle: 7 }).phase).toBe('evading'); // same car: no skip
  });
  it('respray: an unseen, wanted driver in a shop is cleared, once per cooldown', () => {
    const ok = { level: 3, driving: true, seen: false, inShop: true, now: 100_000, lastResprayMs: -Infinity };
    expect(resprayClears(ok)).toBe(true);
    expect(resprayClears({ ...ok, seen: true })).toBe(false);
    expect(resprayClears({ ...ok, driving: false })).toBe(false);
    expect(resprayClears({ ...ok, inShop: false })).toBe(false);
    expect(resprayClears({ ...ok, level: 0 })).toBe(false);
    expect(resprayClears({ ...ok, lastResprayMs: ok.now - SFPD_TUNING.resprayCooldownMs + 1 })).toBe(false);
  });
  it('places exist and the radius test works', () => {
    expect(HIDEOUTS.length).toBeGreaterThanOrEqual(3);
    expect(RESPRAY_SHOPS.length).toBeGreaterThanOrEqual(1);
    expect(withinAny([{ x: 0, z: 0 }], 10, 0, 12)).toBe(true);
    expect(withinAny([{ x: 0, z: 0 }], 13, 0, 12)).toBe(false);
  });
});

describe('review 1.2 fixes', () => {
  it('no free escape before any unit is dispatched: the clock holds', () => {
    expect(run({ level: 1, unitsActive: false, nearestUnitM: Infinity }, 60_000).last.cleared).toBe(false);
  });
  it('outrunning only counts after they have sighted you', () => {
    expect(run({ level: 1, nearestUnitM: 1_000 }).t).toBe(escapeTotalMs(1)); // never sighted: no x1.5
    expect(escapeRate(false, 1_000, false)).toBe(1);
  });
  it('sfpdFairness off keeps the classic SFPD numbers; on picks the fair ones', () => {
    expect(SFPD_TUNING).toBe(flags.sfpdFairness ? SFPD_FAIR : SFPD_CLASSIC);
    expect(SFPD_CLASSIC).toMatchObject({ sightM: 70, chaseSpeedMps: 16, shotDamage: 9, fireIntervalMs: 1_500, ramMinLevel: 2, ramDamage: 180,
      dispatchDelayMs: 0, wantedCooldownMs: 15_000, wantedDecayPerSec: 4, swatVans: 2, roadblockNeedsSight: false });
    expect(SFPD_CLASSIC.pursuitCarsByStar).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('escapeWaitsForSighting (critic N38): no clock runs before the police have found the player', () => {
  const tick = (prev: SightingHold | undefined, o: { seen?: boolean; nearestUnitM?: number; dtMs?: number }) =>
    stepSightingHold(prev, { seen: o.seen ?? false, nearestUnitM: o.nearestUnitM ?? 70, dtMs: o.dtMs ?? 100, sightM: 55 });
  it('holds while no unit has seen or reached the player, then releases at the cap', () => {
    let s: SightingHold | undefined, holding = true, t = 0;
    while (holding && t < 60_000) { ({ state: s, holding } = tick(s, {})); t += 100; }
    expect(t).toBe(UNSIGHTED_HOLD_MS); // nearest unit 70 m, never closer: released by the cap, not before
  });
  it('a sighting ends the hold at once, and it stays ended (hiding afterwards is a real escape)', () => {
    let r = tick(undefined, {}); expect(r.holding).toBe(true);
    r = tick(r.state, { seen: true }); expect(r.holding).toBe(false);
    r = tick(r.state, { seen: false }); expect(r.holding).toBe(false);
  });
  it('a unit reaching sight range without seeing the player ends it (they arrived, you hid)', () => {
    let r = tick(undefined, { nearestUnitM: 120 }); expect(r.holding).toBe(true);
    r = tick(r.state, { nearestUnitM: 40 }); expect(r.holding).toBe(false);
    r = tick(r.state, { nearestUnitM: 300 }); expect(r.holding).toBe(false);
  });
  it('no unit dispatched at all still releases at the cap (nobody stays wanted forever)', () => {
    let s: SightingHold | undefined, holding = true, t = 0;
    while (holding && t < 60_000) { ({ state: s, holding } = tick(s, { nearestUnitM: Infinity })); t += 100; }
    expect(t).toBe(UNSIGHTED_HOLD_MS);
  });
  it('the N38 case: 1 star, a cruiser 70 m out that never sees you, no decay and no escape until the hold ends', () => {
    // WorldDO order per tick: hold -> tickWanted(escaped && !holding) -> stepEscape(unitsActive && !holding).
    let wanted = { heat: 0, lastCrimeMs: 0 }, hold: SightingHold | undefined, esc = freshEscape(0), t = 0, clearedAt = -1;
    wanted = { heat: WANTED_THRESHOLDS[0]! + 5, lastCrimeMs: 0 }; // one star
    expect(wantedLevel(wanted.heat)).toBe(1);
    const level0 = wantedLevel(wanted.heat);
    while (t < 120_000 && clearedAt < 0) {
      const h = tick(hold, { nearestUnitM: 70 }); hold = h.state;
      wanted = tickWanted(wanted, 0.1, !h.holding, t);
      const step = stepEscape(esc, { level: wantedLevel(wanted.heat), seen: false, dtMs: 100, lastCrimeMs: 0, inHideout: false, nearestUnitM: 70, vehicle: 0, unitsActive: !h.holding });
      esc = step.state; t += 100;
      if (t < UNSIGHTED_HOLD_MS) expect(wantedLevel(wanted.heat)).toBe(level0); // held: stars stay up
      if (step.cleared || wanted.heat <= 0) clearedAt = t;
    }
    expect(clearedAt).toBeGreaterThan(UNSIGHTED_HOLD_MS);
  });
});

describe('escapeOwnsClear: with wantedEscape the escape clock alone clears the stars', () => {
  // WorldDO per tick: tickWanted(escaped && !holding && legacyDecay) then stepEscape. Seen once (contact), then hidden in a garage.
  function hideAt3Stars(legacyDecay: boolean) {
    let wanted = { heat: WANTED_THRESHOLDS[2]! + 6, lastCrimeMs: 0 }, esc = freshEscape(0), t = 0;
    esc = stepEscape(esc, { level: wantedLevel(wanted.heat), seen: true, dtMs: 100, lastCrimeMs: 0, inHideout: false, nearestUnitM: 20, vehicle: 0 }).state;
    let starsDroppedAt = -1, clearedAt = -1;
    while (t < 120_000 && clearedAt < 0) {
      wanted = tickWanted(wanted, 0.1, legacyDecay, t + 20_000); // well past the crime cooldown, as in the playtest
      const level = wantedLevel(wanted.heat);
      if (starsDroppedAt < 0 && level < 3) starsDroppedAt = t;
      const step = stepEscape(esc, { level, seen: false, dtMs: 100, lastCrimeMs: 0, inHideout: true, nearestUnitM: 30, vehicle: 0 });
      esc = step.state; t += 100;
      if (step.cleared || wanted.heat <= 0) clearedAt = t;
    }
    return { starsDroppedAt, clearedAt };
  }
  it('legacy decay on (the old behaviour): stars fall well before the escape clock would clear them', () => {
    const r = hideAt3Stars(true);
    expect(r.clearedAt).toBeLessThan(escapeTotalMs(3) / SFPD_TUNING.hideoutRate); // the playtest's '3 stars gone mid SEARCHING'
  });
  it('escapeOwnsClear: stars hold at 3 until the escape clock fills (20 s unseen, x2 in a garage = 10 s)', () => {
    const r = hideAt3Stars(false);
    expect(r.starsDroppedAt).toBe(-1); // never dropped a star on the way
    expect(r.clearedAt).toBeGreaterThanOrEqual(escapeTotalMs(3) / SFPD_TUNING.hideoutRate - 100);
    expect(r.clearedAt).toBeLessThanOrEqual(escapeTotalMs(3) / SFPD_TUNING.hideoutRate + 200);
  });
});

describe('noUnitGraceMs (escapeOwnsClear, review 1.2 HIGH): no unit ever comes -> the clock still runs after the grace', () => {
  it('holds through the grace, then clears after the normal escape time', () => {
    const r = run({ level: 2, unitsActive: false, nearestUnitM: Infinity, noUnitGraceMs: 30_000 }, 120_000);
    expect(r.last.cleared).toBe(true);
    expect(r.t).toBeGreaterThanOrEqual(30_000);
    expect(r.t).toBeLessThanOrEqual(30_000 + escapeTotalMs(2) + 200);
  });
  it('default (no grace given) keeps the old hold: no free escape before any unit', () => {
    expect(run({ level: 2, unitsActive: false, nearestUnitM: Infinity }, 120_000).last.cleared).toBe(false);
  });
  it('a unit turning up resets the no-unit count', () => {
    let st = freshEscape(), step;
    for (let i = 0; i < 250; i++) st = stepEscape(st, { ...base, unitsActive: false, nearestUnitM: Infinity, noUnitGraceMs: 30_000 }).state; // 25 s
    step = stepEscape(st, { ...base, unitsActive: true, nearestUnitM: 80 }); st = step.state;
    expect(st.noUnitMs ?? 0).toBe(0);
    step = stepEscape(st, { ...base, unitsActive: false, nearestUnitM: Infinity, noUnitGraceMs: 30_000 });
    expect(step.rate).toBe(0); // back to holding: the grace starts over
  });
});
