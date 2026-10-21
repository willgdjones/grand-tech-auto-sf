import { getPosition } from 'suncalc';
import { Vector3 } from 'three';
import type { TimeGrade } from '../timeGrade';
import { flags } from '@gtasf/shared/flags';

/** SunCalc 2.1: degrees clockwise from north → +X east, +Y up, +Z south. */
export function sfSun(now: number) {
  const { azimuth, altitude } = getPosition(new Date(now), 37.7842, -122.4078);
  const az = azimuth * Math.PI / 180, alt = altitude * Math.PI / 180, flat = Math.cos(alt);
  return { altitude, azimuth, direction: new Vector3(Math.sin(az) * flat, Math.sin(alt), -Math.cos(az) * flat) };
}
export function applySolarPosition(grade: TimeGrade, now: number): void {
  const sun = sfSun(now);
  // liveNightKey (critic N6, gtasf-vwvkl): past dusk the astronomical sun is far below the horizon, so the live clock had
  // NO key light at all (only flat ambient) and the 03:00 scene collapsed into one navy value, while the time presets keep
  // the grade's own cool night key (a moon-like directional). Blend to that night key as the sun drops from -2 deg to -8 deg.
  const nightKey = flags.liveNightKey ? Math.max(0, Math.min(1, (-2 - sun.altitude) / 6)) : 0;
  const keyDirection = nightKey > 0 ? grade.sunDirection.clone() : undefined, keyIntensity = grade.sunIntensity;
  grade.sunDirection.copy(sun.direction);
  const daylight = Math.max(0, Math.min(1, (sun.altitude + .8) / 8));
  grade.sunIntensity *= daylight;
  if (keyDirection) {
    grade.sunDirection.lerp(keyDirection, nightKey).normalize();
    grade.sunIntensity += keyIntensity * nightKey;
  }
  // The astronomical sun is below ground at night. Keep the accepted playable
  // blue ambient fill instead of shining the directional light from below it.
  grade.ambientIntensity = Math.max(grade.ambientIntensity, 2.25 * (1 - daylight) * grade.night);
}
