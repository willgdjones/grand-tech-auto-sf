import { describe, expect, it } from 'vitest';
import { clockOverride, timeOfDayHour, TIME_OF_DAY_PRESETS } from './timeOverride';
import { sanFranciscoHour } from './timeGrade';

describe('time-of-day override', () => {
  it('returns undefined for no / live / invalid override (so callers use the real clock)', () => {
    for (const s of ['', '?x=1', '?time=', '?time=live', '?hour=abc', '?hour=-1', '?hour=99', '?time=banana']) {
      expect(clockOverride(s)).toBeUndefined();
    }
    expect(timeOfDayHour('')).toBeUndefined();
    expect(timeOfDayHour('?time=live')).toBeUndefined();
  });

  it('maps the named presets to San Francisco hours', () => {
    expect(timeOfDayHour('?time=noon')).toBe(12);
    expect(timeOfDayHour('?time=golden')).toBe(18.25);
    expect(timeOfDayHour('?time=dusk')).toBe(19.25);
    expect(timeOfDayHour('?time=night')).toBe(21);
    expect(timeOfDayHour('?time=15.5')).toBe(15.5); // numbers still work
    expect(timeOfDayHour('?at=37.79,-122.39&time=golden')).toBe(18.25); // other params ignored
  });

  it('pins the SF clock to the chosen preset or hour', () => {
    for (const [s, h] of [['?time=noon', 12], ['?time=golden', 18.25], ['?time=dusk', 19.25], ['?time=night', 21], ['?hour=8', 8]] as const) {
      const clock = clockOverride(s);
      expect(clock).toBeTypeOf('function');
      expect(sanFranciscoHour(clock!())).toBeCloseTo(h % 24, 2);
    }
  });

  it('offers live + the three comparison presets to the Game-options toggle', () => {
    expect(TIME_OF_DAY_PRESETS.map(p => p.value)).toEqual(['live', 'noon', 'golden', 'night']);
    expect(TIME_OF_DAY_PRESETS.map(p => p.label)).toEqual(['Live', 'Day', 'Golden hour', 'Night']);
    // Every toggle value resolves (live -> undefined, the rest to an hour).
    for (const { value } of TIME_OF_DAY_PRESETS) {
      const h = timeOfDayHour(`?time=${value}`);
      if (value === 'live') expect(h).toBeUndefined(); else expect(typeof h).toBe('number');
    }
  });
});
