import { describe, expect, it } from 'vitest';
import { sampleTimeGrade, sanFranciscoHour } from './timeGrade';

describe('real SF atmosphere clock', () => {
  it('uses SF daylight/standard offsets rather than the host timezone', () => {
    expect(sanFranciscoHour(Date.parse('2026-10-03T01:15:00Z'))).toBe(18.25);
    expect(sanFranciscoHour(Date.parse('2026-12-03T02:15:00Z'))).toBe(18.25);
  });
  it('has distinct daytime, sunset and readable night palettes with a continuous midnight', () => {
    const sunset = sampleTimeGrade(Date.parse('2026-10-03T01:15:00Z'));
    const night = sampleTimeGrade(Date.parse('2026-10-03T05:00:00Z'));
    expect(sunset.tint.x).toBeGreaterThan(sunset.tint.z);
    expect(night.tint.z).toBeGreaterThan(night.tint.x);
    expect(night.ambientIntensity).toBeLessThan(1); // SA night: dark fill, lamps and windows carry the frame
    expect(night.fogFar).toBeLessThan(600);
    const before = sampleTimeGrade(Date.parse('2026-10-03T06:59:59Z'));
    const after = sampleTimeGrade(Date.parse('2026-10-03T07:00:00Z'));
    expect(Math.max(Math.abs(before.horizon.r-after.horizon.r), Math.abs(before.horizon.g-after.horizon.g), Math.abs(before.horizon.b-after.horizon.b))).toBeLessThan(.001);
  });
  it('reads as SA by time of day: a cool fog-grey morning and a strongly warm golden hour', () => {
    const morning = sampleTimeGrade(Date.parse('2026-10-03T14:00:00Z')); // 07:00 SF (PDT): Karl the Fog
    // Fog grades cool-to-neutral (never warm) and flattens direct sun, not a sunny warm morning.
    expect(morning.tint.z).toBeGreaterThan(morning.tint.x);
    expect(morning.sunIntensity).toBeLessThan(1);
    const golden = sampleTimeGrade(Date.parse('2026-10-03T01:15:00Z')); // 18:15 SF: golden hour
    // SA golden hour sends the whole scene orange, not a faint warm wash.
    expect(golden.tint.x - golden.tint.z).toBeGreaterThan(0.3);
    const midday = sampleTimeGrade(Date.parse('2026-10-03T18:00:00Z')); // 11:00 SF: SA midday
    // SA midday is a cyan-blue sky, neutral-to-cool ground — not the old warm tint.
    expect(midday.tint.z).toBeGreaterThan(midday.tint.x);
  });
  it('keeps the vivid daytime sky blue (no pale grey-green wash) with fog pushed back', () => {
    // PLAN-v2.1 §4 / pane 9: guards the founder "monochrome / grey-green" fix from regressing.
    // Colours are linear here (ColorManagement is on), so compare channels, not hex.
    const midday = sampleTimeGrade(Date.parse('2026-10-03T18:00:00Z')); // 11:00 SF
    const afternoon = sampleTimeGrade(Date.parse('2026-10-03T22:30:00Z')); // 15:30 SF
    // Blue dominates the daytime horizon — the old #c7d3cd/#cbd0bd wash was green-dominant/neutral.
    expect(midday.horizon.b).toBeGreaterThan(midday.horizon.g);
    expect(midday.horizon.b).toBeGreaterThan(midday.horizon.r);
    expect(afternoon.horizon.b).toBeGreaterThan(afternoon.horizon.g);
    // The daytime zenith is a strong cyan-blue (blue clearly above red).
    expect(midday.zenith.b).toBeGreaterThan(midday.zenith.r + 0.25);
    // Fog is pushed well back from the old fixed 65 m near / ~520 m far.
    expect(midday.fogNear).toBeGreaterThan(120);
    expect(midday.fogFar).toBeGreaterThan(700);
  });
});
