import { sanFranciscoHour } from './timeGrade';

/**
 * Debug / QA time-of-day override (PLAN-v2.1 §4 / pane 9).
 *
 * Live play drives the SA colour grade from the real San Francisco clock, so an evening session only
 * shows the dusk grade and the vivid daytime look is never visible. This lets testers, the founder
 * and players pin the grade to a time of day to compare looks or opt out of a dull real-time grade.
 *
 * Source order: the URL `?time=noon|golden|dusk|night` (or `?hour=HH`, decimals allowed) wins, then
 * the Game-options setting persisted via {@link setTimeOfDay} (localStorage). {@link clockOverride}
 * returns a `now()` for `createRenderFoundation`'s injected clock, or `undefined` for Live (real
 * clock / capture seconds). The foundation re-reads it each frame, so the Game-options toggle applies
 * live without a reload (the override makes the grade clock jump, which re-samples the grade at once).
 */
const STORAGE_KEY = 'gtasf.timeOfDay';

/** Named presets → SF local hour. `live` means no override. */
const PRESETS: Record<string, number | null> = {
  live: null,
  noon: 12, day: 12, midday: 12,
  golden: 18.25, 'golden-hour': 18.25, goldenhour: 18.25, sunset: 18.25,
  dusk: 19.25, evening: 19.25,
  night: 21, midnight: 0,
  morning: 8, dawn: 6,
};

/** The options shown on the Game-options "Time of day" toggle, in order (value + label). Other
 * presets like `dusk` stay reachable via the URL `?time=` even though they are not on the toggle. */
export const TIME_OF_DAY_PRESETS = [
  { value: 'live', label: 'Live' },
  { value: 'noon', label: 'Day' },
  { value: 'golden', label: 'Golden hour' },
  { value: 'night', label: 'Night' },
] as const;
export type TimeOfDayPreset = typeof TIME_OF_DAY_PRESETS[number]['value'];

/** Parse one value (preset name or a 0–24 hour) to an SF hour, or undefined for none/live/invalid. */
function parseTimeValue(raw: string | null | undefined): number | undefined {
  if (raw == null) return undefined;
  const key = raw.trim().toLowerCase();
  if (key === '' || key === 'live') return undefined;
  if (key in PRESETS) { const h = PRESETS[key]; return h == null ? undefined : h; }
  const clock = /^(\d{1,2}):(\d{2})$/.exec(key); // also accept HH:MM, e.g. ?time=21:00
  const n = clock ? Number(clock[1]) + Number(clock[2]) / 60 : Number(key);
  return Number.isFinite(n) && n >= 0 && n <= 24 ? n % 24 : undefined;
}

/** The current override hour: URL `?time=`/`?hour=` first, then the stored Game-options setting, else undefined (Live). */
export function timeOfDayHour(search: string = typeof location !== 'undefined' ? location.search : ''): number | undefined {
  let fromUrl: number | undefined;
  try {
    const p = new URLSearchParams(search);
    const raw = p.get('time') ?? p.get('hour');
    // Explicit Live is a choice, not a missing override: it must beat a saved preset.
    if (raw?.trim().toLowerCase() === 'live') return undefined;
    fromUrl = parseTimeValue(raw);
  } catch { fromUrl = undefined; }
  if (fromUrl !== undefined) return fromUrl;
  try { return parseTimeValue(localStorage.getItem(STORAGE_KEY)); } catch { return undefined; }
}

/** Match the effective clock to a menu preset; custom URL hours have no selected button. */
export function activeTimeOfDayPreset(): TimeOfDayPreset | undefined {
  const hour = timeOfDayHour();
  return TIME_OF_DAY_PRESETS.find(preset => (PRESETS[preset.value] ?? undefined) === hour)?.value;
}

/** The stored Game-options choice ('live' when unset), for driving the toggle's current state. */
export function storedTimeOfDay(): TimeOfDayPreset | string {
  try { const v = localStorage.getItem(STORAGE_KEY); return v && v.trim() ? v.trim().toLowerCase() : 'live'; } catch { return 'live'; }
}

/** Persist the Game-options time-of-day choice (a preset name, or 'live'/''/null to clear). */
export function setTimeOfDay(value: string | null): void {
  try {
    const key = value?.trim().toLowerCase();
    if (!key || key === 'live') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, key);
  } catch { /* storage unavailable */ }
}

/**
 * A `now()` pinned to the override SF hour for `createRenderFoundation`'s `options.now`, or undefined
 * when Live (so the caller falls back to the real clock / capture seconds). Minutes track the real
 * clock so animation keeps moving.
 */
export function clockOverride(search?: string): (() => number) | undefined {
  const target = timeOfDayHour(search);
  if (target === undefined) return undefined;
  return () => {
    const nowMs = Date.now();
    return nowMs + (target - sanFranciscoHour(nowMs)) * 3_600_000;
  };
}
