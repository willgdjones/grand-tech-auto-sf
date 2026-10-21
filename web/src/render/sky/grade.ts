import { flags } from '@gtasf/shared/flags';
/**
 * Lightroom-style colour grade for the desktop HD atmosphere composer (gtasf-r9f6, flag atmosphereSky): one tunable
 * preset of exposure (stops), contrast, warmth and saturation, applied after tone mapping on display-referred colour.
 * Tune live with ?grade=exposure,contrast,warmth,saturation (e.g. ?grade=0.1,0.12,0.08,0.1); values are clamped.
 */
export interface GradePreset {
  /** Stops of exposure; 0 = unchanged. */
  exposure: number;
  /** -1..1 around mid-grey; 0 = unchanged. */
  contrast: number;
  /** -1..1: positive warms (more red, less blue); 0 = unchanged. */
  warmth: number;
  /** -1..1: 0 = unchanged, -1 = greyscale. */
  saturation: number;
}

/** SF "PLATEAU" look: a touch brighter and warmer than neutral ACES, with gentle contrast and colour. */
export const ATMOSPHERE_GRADE: Readonly<GradePreset> = { exposure: 0.1, contrast: 0.08, warmth: 0.06, saturation: 0.1 };

/** Optional alternate grade (flag filmicOvercast): a desaturated, soft, overcast grey-warm film look toward
 *  docs/sf-data/teleoperator-reference.png — lower (negative) contrast for the flat overcast light, a little
 *  warmth pulled back off the orange, and saturation well down. Default OFF; never changes the shipped PLATEAU
 *  look. For the founder to A/B against the vivid default from photos; the sky/sun are unchanged (grade only). */
export const FILMIC_OVERCAST_GRADE: Readonly<GradePreset> = { exposure: 0.05, contrast: -0.08, warmth: 0.02, saturation: -0.28 };

/** The active base preset: the vivid PLATEAU look by default, the filmic overcast look when its flag is on. */
export function baseGrade(): Readonly<GradePreset> { return flags.filmicOvercast ? FILMIC_OVERCAST_GRADE : ATMOSPHERE_GRADE; }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The preset, overridden by ?grade=e,c,w,s when present (tuning only; invalid parts keep the preset value). */
export function gradeFromQuery(search: string, base: Readonly<GradePreset> = baseGrade()): GradePreset {
  const raw = new URLSearchParams(search).get('grade');
  const parts = raw ? raw.split(',').map(Number) : [];
  const pick = (i: number, fallback: number, min: number, max: number) => Number.isFinite(parts[i]) ? clamp(parts[i]!, min, max) : fallback;
  return {
    exposure: pick(0, base.exposure, -2, 2),
    contrast: pick(1, base.contrast, -1, 1),
    warmth: pick(2, base.warmth, -1, 1),
    saturation: pick(3, base.saturation, -1, 1),
  };
}

/** GLSL body for a pmndrs postprocessing Effect (mainImage). Uniforms: uExposure, uContrast, uWarmth, uSaturation. */
export const GRADE_FRAGMENT = /* glsl */ `
uniform float uExposure;
uniform float uContrast;
uniform float uWarmth;
uniform float uSaturation;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * exp2(uExposure);
  c = (c - 0.5) * (1.0 + uContrast) + 0.5; // display-referred here (after tone mapping), so 0.5 is mid-grey
  c *= vec3(1.0 + uWarmth * 0.12, 1.0 + uWarmth * 0.02, 1.0 - uWarmth * 0.12);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, 1.0 + uSaturation);
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}`;

/** SF look on (flag atmosphereSky), unless a testing-harness A/B shot asks for ?look=0. */
export function sfLookEnabled(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  if (!('atmosphereSky' in flags) || !flags.atmosphereSky) return false;
  return !(flags.testingHarness && new URLSearchParams(search).get('look') === '0');
}
