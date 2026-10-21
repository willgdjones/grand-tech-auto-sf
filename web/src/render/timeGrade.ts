import { Color, Vector3 } from 'three';
import { flags } from '@gtasf/shared/flags';

// neutralDaylight targets (Teleoperator): SF midday is neutral-to-slightly-cool with clean whites/greys, not the
// olive/yellow-green cast the SA midday `tint` + greenish daytime ambient/sun give. Pull the daytime grade toward
// these; golden hour + night keep their warm/cool character (the pull fades out as the sun drops).
const NEUTRAL_TINT = new Vector3(1, 1, 1);
const COOL_WHITE = new Color('#e9edf2'); // slightly-cool neutral ambient (kills the green dominance)
const CLEAN_SUN = new Color('#fff5e3');  // cleaner warm-white sun (less yellow)

const sfClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
export function sanFranciscoHour(now: number): number {
  const parts = sfClock.formatToParts(now), value = (name: string) => Number(parts.find(p => p.type === name)?.value ?? 0);
  return (value('hour') % 24) + value('minute') / 60 + value('second') / 3600;
}
/** Art-directed real local-clock palette, not a claim of live weather or solar ephemeris. */
// Vivid SF pass (PLAN-v2.1 §4 / pane 9): daytime horizons are clean sky-blue, not the old pale
// grey-green (#c7d3cd/#cbd0bd) that washed the city; midday/afternoon zeniths are a strong SA
// cyan-blue; fog is pushed back per time of day (`near`/`far`) so the city reads to the landmarks.
// Golden hour + dusk (founder evening review): a richer cinematic grade — warm amber SUN (`sun`,
// stronger `direct`) against a COOL blue-lavender ambient fill (`light`) so shadows read deep
// blue-purple instead of a flat amber wash; a reduced warm `tint`, pushed-back haze, and a magenta
// dusk afterglow; night keys (SA night, Oct 5 tour) are dark: low cool fill so sodium pools and lit windows carry the frame; window glow (`night`) ramps a touch earlier so dusk windows are lit. Karl still
// closes in at 07:00; the midday/afternoon keys are unchanged.
const keys = [
  { hour: 0, horizon: '#2d5578', zenith: '#061a33', cloud: '#2f5074', light: '#4a5c8c', ground: '#141a28', sun: '#8fa6d0', ambient: 0.55, direct: 0.2, near: 95, far: 540, tint: [0.95,1.01,1.08], elevation: 0.45 },
  { hour: 5.5, horizon: '#3a6186', zenith: '#0e2748', cloud: '#45617f', light: '#4e6090', ground: '#161c2a', sun: '#8fa6d0', ambient: 0.6, direct: 0.22, near: 90, far: 520, tint: [0.96,1.01,1.06], elevation: 0.15 },
  { hour: 7, horizon: '#bcc4cb', zenith: '#90a9b4', cloud: '#d4d9dc', light: '#d4e1e3', ground: '#8a8277', sun: '#f3e9d6', ambient: 1.5, direct: 0.85, near: 75, far: 500, tint: [0.99,1.00,1.03], elevation: 0.3 },
  { hour: 11, horizon: '#a9c8e0', zenith: '#2b93d8', cloud: '#eef0ee', light: '#dcefe9', ground: '#8a8880', sun: '#fff0bb', ambient: 1.45, direct: 1.25, near: 160, far: 820, tint: [0.99,1.01,1.04], elevation: 0.9 },
  { hour: 15.5, horizon: '#b7cdd6', zenith: '#4fa0cf', cloud: '#eceadd', light: '#e9eacb', ground: '#8f8370', sun: '#ffe0a0', ambient: 1.4, direct: 1.3, near: 150, far: 780, tint: [1.04,1.01,0.92], elevation: 0.65 },
  { hour: 18.25, horizon: '#e8b06f', zenith: '#bd8768', cloud: '#f4c488', light: '#8f9ecb', ground: '#7a5f52', sun: '#ffbf5a', ambient: 1.3, direct: 1.5, near: 170, far: 800, tint: [1.15,0.99,0.82], elevation: 0.13 },
  { hour: 19.25, horizon: '#915f82', zenith: '#1f3058', cloud: '#8a6f92', light: '#a99fd0', ground: '#6e6478', sun: '#ff9c5e', ambient: 1.65, direct: 0.8, near: 140, far: 660, tint: [1.03,0.99,1.02], elevation: 0.06 },
  { hour: 21, horizon: '#2d5578', zenith: '#061a33', cloud: '#2f5074', light: '#4a5c8c', ground: '#141a28', sun: '#8fa6d0', ambient: 0.55, direct: 0.2, near: 95, far: 540, tint: [0.95,1.01,1.08], elevation: 0.45 },
] as const;
/** liveNightKey (critic N6): the live clock between 02:00 and 05:30 slid toward the darkest pre-dawn key, so 03:00 was a
 * flat navy slab while the time=2 preset read well. Hold the 02:00 look until 04:30, then ease to the 05:30 key so dawn
 * still arrives on time. Returns the clock to sample the grade at (unchanged outside that window). */
export function liveNightFloorTime(now: number): number {
  const hour = sanFranciscoHour(now);
  if (hour < 2 || hour >= 5.5) return now;
  const held = hour < 4.5 ? 2 : 2 + (hour - 4.5) / 1 * 3.5;
  return now - (hour - held) * 3_600_000;
}

export function sampleTimeGrade(now = Date.now()) {
  const hour = sanFranciscoHour(now);
  let index = keys.length - 1;
  for (let i = 0; i < keys.length - 1; i++) if (hour >= keys[i]!.hour && hour < keys[i+1]!.hour) { index = i; break; }
  const a = keys[index]!, b = keys[(index+1) % keys.length]!;
  const end = b.hour > a.hour ? b.hour : b.hour + 24;
  const t = Math.max(0,Math.min(1,(hour-a.hour)/(end-a.hour)));
  const smooth = t*t*(3-2*t), mix = (x:number,y:number) => x+(y-x)*smooth;
  const colour = (x:string,y:string) => new Color(x).lerp(new Color(y),smooth);
  const fade = (v: number) => { const c = Math.max(0, Math.min(1, v)); return c*c*(3-2*c); };
  const night = hour < 12 ? 1-fade((hour-5.5)/1.5) : fade((hour-17.5)/2.75);
  const grade = {
    hour, night, horizon: colour(a.horizon,b.horizon), zenith: colour(a.zenith,b.zenith), cloud: colour(a.cloud,b.cloud),
    ambientColour: colour(a.light,b.light), groundColour: colour(a.ground,b.ground), sunColour: colour(a.sun,b.sun),
    ambientIntensity: mix(a.ambient,b.ambient), sunIntensity: mix(a.direct,b.direct), fogNear: mix(a.near,b.near), fogFar: mix(a.far,b.far),
    tint: new Vector3(mix(a.tint[0],b.tint[0]),mix(a.tint[1],b.tint[1]),mix(a.tint[2],b.tint[2])),
    sunDirection: new Vector3(Math.sin((hour-12)/12*Math.PI),mix(a.elevation,b.elevation),-0.4).normalize(),
  };
  if (flags.neutralDaylight) {
    // Strongest at high sun (noon/afternoon), fades to 0 by golden hour so the warm sunset grade is untouched.
    const d = Math.max(0, Math.min(1, (grade.sunDirection.y - 0.35) / 0.4)), daylight = d*d*(3-2*d);
    grade.tint.lerp(NEUTRAL_TINT, 0.85 * daylight);           // remove the SA midday cyan/green frame multiply
    grade.ambientColour.lerp(COOL_WHITE, 0.55 * daylight);    // neutral-cool fill instead of greenish
    grade.sunColour.lerp(CLEAN_SUN, 0.4 * daylight);          // cleaner, less-yellow key light
  }
  return grade;
}
export type TimeGrade = ReturnType<typeof sampleTimeGrade>;
