import { flags } from '@gtasf/shared/flags';
import { describe, expect, it } from 'vitest';
import { fallbackWeather } from '@gtasf/shared/weather';
import { sampleTimeGrade } from '../timeGrade';
import { sfSun, applySolarPosition } from './solar';
import { createWeatherGrade } from './grade';

describe('SF solar and weather atmosphere', () => {
  it('places sunrise east, noon south, sunset west and turns off direct light at night', () => {
    const morning = sfSun(Date.parse('2026-10-03T08:00:00-07:00'));
    const midday = sfSun(Date.parse('2026-10-03T13:00:00-07:00'));
    const evening = sfSun(Date.parse('2026-10-03T18:00:00-07:00'));
    expect(morning.direction.x).toBeGreaterThan(.5); expect(morning.altitude).toBeGreaterThan(0);
    expect(midday.direction.z).toBeGreaterThan(.5); expect(midday.altitude).toBeGreaterThan(40);
    expect(evening.direction.x).toBeLessThan(-.5);
    const time = Date.parse('2026-10-03T00:36:00-07:00'), night = sampleTimeGrade(time);
    const key = { direction: night.sunDirection.clone(), intensity: night.sunIntensity };
    applySolarPosition(night, time);
    expect(night.ambientIntensity).toBeGreaterThanOrEqual(2.25);
    // Never lit from below the horizon. liveNightKey (critic N6): deep night keeps the grade's own cool night key (as the
    // time presets do) instead of no key light at all; off = the old ambient-only night.
    if (flags.liveNightKey) { expect(night.sunDirection.angleTo(key.direction)).toBeLessThan(1e-6); expect(night.sunIntensity).toBeCloseTo(key.intensity, 6); expect(night.sunDirection.y).toBeGreaterThan(0); }
    else { expect(night.sunDirection.y).toBeLessThan(0); expect(night.sunIntensity).toBe(0); }
  });
  it('eases dense fog in and out while preserving near driving visibility and blue night', () => {
    const time = Date.parse('2026-10-03T00:36:00-07:00'), base = sampleTimeGrade(time), weather = { ...fallbackWeather(time), status: 'live' as const, cloudCover: 1, fog: 1 };
    const controller = createWeatherGrade();
    const first = controller.update(base, weather, 1 / 60);
    expect(Math.abs(first.fogFar - base.fogFar)).toBeLessThan(1);
    for (let i = 0; i < 120; i++) controller.update(base, weather, 1);
    const dense = controller.update(base, weather, 1);
    expect(dense.fogNear).toBeGreaterThanOrEqual(55); expect(dense.fogFar).toBeGreaterThanOrEqual(260);
    expect(dense.fogFar).toBeLessThan(base.fogFar); expect(dense.horizon.b).toBeGreaterThan(dense.horizon.r);
    expect(base.fogFar).toBe(sampleTimeGrade(time).fogFar);
    for (let i = 0; i < 180; i++) controller.update(base, undefined, 1);
    expect(controller.update(base, undefined, 1).fogFar).toBeCloseTo(base.fogFar, 2);
  });
});
