import { describe, expect, it } from 'vitest';
import {
  TIME_TRIALS, timeTrialById, timeTrialDay, leaderboardKey,
  isPlausibleTime, isBetterTime, beatPar, validateSubmission,
  serverRunTimingOk, sanitizeTimeTrialGhost, atTimeTrialFinish, TIME_TRIAL_FINISH_LAG_M, TIME_TRIAL_GHOST_MAX_SAMPLES, type TimeTrialSpec,
} from './timeTrials';
import { fundingDay } from '../funding';

const NOON_PT = Date.parse('2026-10-08T19:00:00Z');

describe('time trial spec', () => {
  it('each route has ordered gates, a start letter, a par and a plausibility floor below par', () => {
    expect(TIME_TRIALS.length).toBe(5);
    for (const t of TIME_TRIALS) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
      expect(t.start.letter).toMatch(/^[A-Z]$/);
      expect(['drive', 'foot']).toContain(t.mode);
      expect(t.checkpoints.length).toBeGreaterThan(0);
      for (const cp of t.checkpoints) expect(cp.radiusM).toBeGreaterThan(0);
      expect(t.finish.radiusM).toBeGreaterThan(0);
      // the anti-cheese floor must sit below the "gold" par (par is reachable, the floor is not)
      expect(t.minMs).toBeGreaterThan(0);
      expect(t.minMs).toBeLessThan(t.parMs);
    }
  });

  it('covers the three founder routes with unique ids', () => {
    const ids = TIME_TRIALS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['lombard-switchbacks', 'embarcadero-sprint', 'twin-peaks-climb']));
  });

  it('the Embarcadero sprint is a foot route; Lombard and Twin Peaks are drives', () => {
    expect(timeTrialById('embarcadero-sprint')?.mode).toBe('foot');
    expect(timeTrialById('lombard-switchbacks')?.mode).toBe('drive');
    expect(timeTrialById('twin-peaks-climb')?.mode).toBe('drive');
  });

  it('timeTrialById returns undefined for an unknown route', () => {
    expect(timeTrialById('nope')).toBeUndefined();
  });
});

describe('leaderboard keys + daily reset', () => {
  it('the board key is scoped by route and SF day, and the day matches fundingDay', () => {
    const day = timeTrialDay(NOON_PT);
    expect(day).toBe(fundingDay(NOON_PT));
    expect(leaderboardKey('lombard-switchbacks', day)).toBe(`tt:lombard-switchbacks:${day}`);
  });

  it('different SF days produce different board keys (daily reset)', () => {
    const d1 = timeTrialDay(NOON_PT);
    const d2 = timeTrialDay(NOON_PT + 24 * 60 * 60 * 1000);
    expect(d1).not.toBe(d2);
    expect(leaderboardKey('x', d1)).not.toBe(leaderboardKey('x', d2));
  });
});

describe('server validation (anti-cheese + best time)', () => {
  const spec: TimeTrialSpec = TIME_TRIALS[0]!; // Lombard: minMs 12_000, parMs 40_000

  it('rejects a time under the plausibility floor (teleport/noclip)', () => {
    expect(isPlausibleTime(spec, spec.minMs - 1)).toBe(false);
    expect(isPlausibleTime(spec, 0)).toBe(false);
    expect(isPlausibleTime(spec, -5)).toBe(false);
    expect(isPlausibleTime(spec, Number.NaN)).toBe(false);
    expect(isPlausibleTime(spec, Infinity)).toBe(false);
  });

  it('accepts a time at or above the floor', () => {
    expect(isPlausibleTime(spec, spec.minMs)).toBe(true);
    expect(isPlausibleTime(spec, spec.parMs)).toBe(true);
    expect(isPlausibleTime(spec, spec.parMs + 50_000)).toBe(true); // a slow-but-legit run still counts
  });

  it('keeps the minimum time: a faster run beats the record, a slower one does not', () => {
    expect(isBetterTime(30_000, null)).toBe(true);       // first run always lands
    expect(isBetterTime(30_000, undefined)).toBe(true);
    expect(isBetterTime(25_000, 30_000)).toBe(true);     // faster
    expect(isBetterTime(30_000, 30_000)).toBe(false);    // equal is not better
    expect(isBetterTime(35_000, 30_000)).toBe(false);    // slower
  });

  it('beatPar is cosmetic: at/under par is gold, over par is not', () => {
    expect(beatPar(spec, spec.parMs)).toBe(true);
    expect(beatPar(spec, spec.parMs - 1)).toBe(true);
    expect(beatPar(spec, spec.parMs + 1)).toBe(false);
  });
});

describe('validateSubmission (server sanity)', () => {
  const spec: TimeTrialSpec = TIME_TRIALS[0]!; // Lombard: 1 checkpoint + finish => 2 splits, minMs 28_000 (~0.7× par)

  it('accepts a clean run (two monotonic splits, total == final split, above the floor)', () => {
    expect(validateSubmission(spec, { totalMs: 30_000, splits: [12_000, 30_000] })).toEqual({ ok: true });
  });

  it('rejects a total under the (raised ~0.7× par) anti-cheese floor', () => {
    expect(validateSubmission(spec, { totalMs: 5_000, splits: [2_000, 5_000] }))
      .toEqual({ ok: false, reason: 'implausible-time' });
    // 20s was legal under the old 12s floor; the raised 28s floor now rejects it (review fix 2).
    expect(validateSubmission(spec, { totalMs: 20_000, splits: [8_000, 20_000] }))
      .toEqual({ ok: false, reason: 'implausible-time' });
  });

  it('rejects the wrong number of splits (must be checkpoints + finish)', () => {
    expect(validateSubmission(spec, { totalMs: 30_000, splits: [30_000] }))
      .toEqual({ ok: false, reason: 'split-count' });
    expect(validateSubmission(spec, { totalMs: 30_000, splits: [5_000, 12_000, 30_000] }))
      .toEqual({ ok: false, reason: 'split-count' });
  });

  it('rejects out-of-order (non-monotonic) splits', () => {
    expect(validateSubmission(spec, { totalMs: 30_000, splits: [31_000, 30_000] }))
      .toEqual({ ok: false, reason: 'non-monotonic' });
  });

  it('rejects a negative or non-finite split', () => {
    expect(validateSubmission(spec, { totalMs: 30_000, splits: [-1, 30_000] }))
      .toEqual({ ok: false, reason: 'split-value' });
    expect(validateSubmission(spec, { totalMs: 30_000, splits: [Number.NaN, 30_000] }))
      .toEqual({ ok: false, reason: 'split-value' });
  });

  it('rejects a total that does not match the final split (beyond tolerance)', () => {
    expect(validateSubmission(spec, { totalMs: 35_000, splits: [12_000, 30_000] }))
      .toEqual({ ok: false, reason: 'total-mismatch' });
  });

  it('allows the finish split to be within 250ms of the reported total', () => {
    expect(validateSubmission(spec, { totalMs: 30_000, splits: [12_000, 29_800] })).toEqual({ ok: true });
  });
});

describe('serverRunTimingOk (review fix 2 — server-authoritative timing)', () => {
  const spec: TimeTrialSpec = TIME_TRIALS[0]!; // Lombard: minMs 28_000, slack 5_000

  it('rejects a run faster than the floor of REAL (server-measured) time — no teleport-to-finish', () => {
    expect(serverRunTimingOk(spec, 27_999, 30_000)).toEqual({ ok: false, reason: 'too-soon' });
    expect(serverRunTimingOk(spec, Number.NaN, 30_000)).toEqual({ ok: false, reason: 'too-soon' });
  });

  it('rejects a reported total meaningfully faster than the server observed — no lying the time down', () => {
    // server saw 40s; a claimed 34s is beyond the 5s latency slack.
    expect(serverRunTimingOk(spec, 40_000, 34_000)).toEqual({ ok: false, reason: 'time-mismatch' });
    expect(serverRunTimingOk(spec, 40_000, Number.NaN)).toEqual({ ok: false, reason: 'time-mismatch' });
  });

  it('accepts a legit run (over the floor, reported total within slack of the server elapsed)', () => {
    expect(serverRunTimingOk(spec, 40_000, 40_000)).toEqual({ ok: true }); // equal
    expect(serverRunTimingOk(spec, 40_000, 36_000)).toEqual({ ok: true }); // within the 5s slack
    expect(serverRunTimingOk(spec, 40_000, 41_000)).toEqual({ ok: true }); // client slightly slower than server (latency)
  });
});

describe('sanitizeTimeTrialGhost (review fix 3 — validated + bounded)', () => {
  const ok = [{ ms: 0, lat: 37.80, lon: -122.41 }, { ms: 500, lat: 37.81, lon: -122.42 }];

  it('returns a clean, route-tagged ghost for a valid sample set', () => {
    expect(sanitizeTimeTrialGhost({ totalMs: 30_000, samples: ok }, 'lombard-switchbacks'))
      .toEqual({ routeId: 'lombard-switchbacks', totalMs: 30_000, samples: ok });
  });

  it('falls back totalMs to the last sample ms when none (or a bad one) is supplied', () => {
    expect(sanitizeTimeTrialGhost({ samples: ok }, 'r')).toEqual({ routeId: 'r', totalMs: 500, samples: ok });
  });

  it('drops a non-object / empty / oversized sample set (null = store no ghost)', () => {
    expect(sanitizeTimeTrialGhost(null, 'r')).toBeNull();
    expect(sanitizeTimeTrialGhost({ samples: [] }, 'r')).toBeNull();
    const tooMany = Array.from({ length: TIME_TRIAL_GHOST_MAX_SAMPLES + 1 }, (_, i) => ({ ms: i, lat: 1, lon: 2 }));
    expect(sanitizeTimeTrialGhost({ samples: tooMany }, 'r')).toBeNull();
  });

  it('drops a non-finite coord/ms or a non-increasing sample time', () => {
    expect(sanitizeTimeTrialGhost({ samples: [{ ms: 0, lat: Number.NaN, lon: 2 }] }, 'r')).toBeNull();
    expect(sanitizeTimeTrialGhost({ samples: [{ ms: 0, lat: 1, lon: 2 }, { ms: 0, lat: 1, lon: 2 }] }, 'r')).toBeNull();
    expect(sanitizeTimeTrialGhost({ samples: [{ ms: 5, lat: 1, lon: 2 }, { ms: 4, lat: 1, lon: 2 }] }, 'r')).toBeNull();
  });
});

describe('atTimeTrialFinish (QA gtasf-024it: server pose lags the client at the finish line)', () => {
  const spec = TIME_TRIALS[0]!, finish = { x: 0, z: 0 };
  it('accepts a pose just outside the radius (one pose behind the client crossing it)', () => {
    expect(atTimeTrialFinish(spec, finish, spec.finish.radiusM + 1.5, 0)).toBe(true);
    expect(atTimeTrialFinish(spec, finish, 0, -(spec.finish.radiusM + TIME_TRIAL_FINISH_LAG_M))).toBe(true);
  });
  it('still rejects a pose that is not near the finish', () => {
    expect(atTimeTrialFinish(spec, finish, spec.finish.radiusM + TIME_TRIAL_FINISH_LAG_M + 0.5, 0)).toBe(false);
    expect(atTimeTrialFinish(spec, finish, 200, 200)).toBe(false);
  });
});
