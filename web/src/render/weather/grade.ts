import { Color, Vector3 } from 'three';
import type { CityWeather } from '@gtasf/shared/weather';
import type { TimeGrade } from '../timeGrade';

/** Reuses the current fog/sky/lighting pass; transitions take seconds, never a hard weather jump. */
export function createWeatherGrade() {
  // Vivid SF pass (PLAN-v2.1 §4 / pane 9): a cooler, less dead overcast grey, and overcast pulls
  // the sky toward it far more gently than before — the founder's "tame the weather greying".
  const grey = new Color('#b9c6d0'), targetGrey = new Color();
  const grade: TimeGrade = { hour: 0, night: 0, horizon: new Color(), zenith: new Color(), cloud: new Color(),
    ambientColour: new Color(), groundColour: new Color(), sunColour: new Color(), ambientIntensity: 1,
    sunIntensity: 1, fogNear: 120, fogFar: 640, tint: new Vector3(), sunDirection: new Vector3() };
  const state = { cloudCover: .35, fog: 0, rain: 0, influence: 0 };
  return {
    state,
    update(base: TimeGrade, weather: CityWeather | undefined, dt: number) {
      const available = weather && weather.status !== 'fallback';
      const blend = 1 - Math.exp(-Math.max(0, Math.min(1, dt)) / 12);
      state.influence += ((available ? 1 : 0) - state.influence) * blend;
      state.cloudCover += ((available ? weather.cloudCover : .35) - state.cloudCover) * blend;
      state.fog += ((available ? weather.fog : 0) - state.fog) * blend;
      state.rain += ((available ? weather.rain : 0) - state.rain) * blend;
      const clouds = state.cloudCover * state.influence, fog = state.fog * state.influence;
      targetGrey.copy(base.horizon).lerp(grey, .34 * (1 - base.night));
      grade.hour = base.hour; grade.night = base.night;
      grade.horizon.copy(base.horizon).lerp(targetGrey, clouds * .28 + fog * .22);
      grade.zenith.copy(base.zenith).lerp(grade.horizon, clouds * .22 + fog * .3);
      grade.cloud.copy(base.cloud).lerp(grade.horizon, fog * .18);
      grade.ambientColour.copy(base.ambientColour); grade.groundColour.copy(base.groundColour);
      grade.sunColour.copy(base.sunColour); grade.tint.copy(base.tint); grade.sunDirection.copy(base.sunDirection);
      grade.ambientIntensity = base.ambientIntensity;
      grade.sunIntensity = base.sunIntensity * (1 - clouds * .42);
      // Karl begins beyond the (now pushed-back) driving corridor. Even dense observed fog keeps
      // the city readable to the landmarks and never conceals the next intersection.
      grade.fogNear = Math.max(90, base.fogNear - fog * 8);
      grade.fogFar = Math.max(340, base.fogFar * (1 - fog * .34 - clouds * .06));
      return grade;
    },
  };
}
