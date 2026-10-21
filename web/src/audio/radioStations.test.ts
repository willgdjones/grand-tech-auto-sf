import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flags } from '@gtasf/shared/flags';
import { GENRE_STATIONS, RADIO_ADS, createStationSchedule } from './radioStations';
import { createRadio } from './radio';

vi.mock('@gtasf/shared/flags', () => ({ flags: { radio: true, radioStations: true, celebNpcs: false } }));
class Element extends EventTarget {
  children: Element[] = []; attributes = new Map<string, string>(); hidden = false; textContent = ''; className = ''; value = '';
  isContentEditable = false;
  append(...children: Element[]) { this.children.push(...children); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  removeAttribute(key: string) { this.attributes.delete(key); }
  remove() {}
  closest() { return null; }
  find(className: string): Element | undefined { return this.className === className ? this : this.children.map(c => c.find(className)).find(Boolean); }
}
class Media extends Element {
  static instances: Media[] = [];
  preload = ''; loop = false; volume = 1; muted = false; paused = true;
  assignments: string[] = [];
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  constructor() { super(); Media.instances.push(this); }
  set src(value: string) { this.assignments.push(value); this.setAttribute('src', value); }
  get src() { return this.getAttribute('src') ?? ''; }
}
let doc: EventTarget & { body: Element; hidden: boolean; createElement(): Element };
let storage: Map<string, string>;
let radios: NonNullable<ReturnType<typeof createRadio>>[];
beforeEach(() => {
  vi.useFakeTimers(); Media.instances = []; radios = []; storage = new Map();
  doc = Object.assign(new EventTarget(), { body: new Element(), hidden: false, createElement: () => new Element() });
  vi.stubGlobal('document', doc); vi.stubGlobal('HTMLElement', Element); vi.stubGlobal('Audio', Media);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  Object.assign(flags, { radio: true, radioStations: true });
});
afterEach(() => { radios.forEach(r => r.destroy()); vi.useRealTimers(); vi.unstubAllGlobals(); });
function mount() { const radio = createRadio({ parent: doc.body as unknown as HTMLElement })!; radios.push(radio); return radio; }
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('six distinct stations rotate every song before repeats and play two songs per alternating DJ/ad break', () => {
  expect(new Set(GENRE_STATIONS.map(s => s.name)).size).toBe(6);
  expect(RADIO_ADS).toHaveLength(6);
  for (const station of GENRE_STATIONS) {
    expect(station.tracks).toHaveLength(4); expect(station.dj).toHaveLength(4);
    const schedule = createStationSchedule(station, () => .5);
    const program = Array.from({ length: 12 }, schedule);
    expect(program.map(c => c.kind)).toEqual([
      station.tracks[0]!.kind, station.tracks[0]!.kind, 'dj',
      station.tracks[0]!.kind, station.tracks[0]!.kind, 'ad',
      station.tracks[0]!.kind, station.tracks[0]!.kind, 'dj',
      station.tracks[0]!.kind, station.tracks[0]!.kind, 'ad',
    ]);
    expect(new Set([program[0], program[1], program[3], program[4]]).size).toBe(4);
    expect(program[4]).not.toBe(program[6]);
  }
});

test('no media request at boot; the first gesture starts city radio on foot; vehicles raise the level without restarting the track', async () => {
  const radio = mount(), audio = Media.instances[0]!;
  expect(audio.preload).toBe('none'); expect(audio.assignments).toEqual([]);
  radio.unlock(); await settle();
  expect(radio.state.playing).toBe(true); expect(audio.src).toMatch(/^\/audio\/radio\/radio-soma-track-/);
  const track = audio.src, foot = audio.volume;
  radio.setVehicle(true); await settle();
  expect(audio.src).toBe(track); expect(audio.volume).toBeGreaterThan(foot); expect(radio.state.playing).toBe(true);
  radio.setVehicle(false); expect(audio.paused).toBe(false); expect(radio.state.playing).toBe(true); expect(audio.volume).toBe(foot);
  audio.dispatchEvent(new Event('ended')); await settle(); expect(audio.src).not.toBe(track);
  audio.dispatchEvent(new Event('ended')); await settle(); expect(audio.src).toContain('-dj-');
});

test('station changes show a two-second title, persist selection, respect mute, and the phone button is always available', async () => {
  storage.set('gtasf.radio.v1', JSON.stringify({ station: 'sf-vc', volume: .2, muted: true }));
  const radio = mount(), audio = Media.instances[0]!;
  expect(radio.state.station).toBe('SF-VC'); expect(audio.muted).toBe(true); expect(radio.state.volume).toBe(.2);
  expect(audio.volume).toBe(.1); // ducked on foot
  radio.setVehicle(true); await settle(); expect(audio.volume).toBe(.2);
  const phone = doc.body.find('gt-radio-next')!, toast = doc.body.find('gt-radio-station-toast')!;
  expect(phone.hidden).toBe(false); phone.dispatchEvent(new Event('click')); await settle();
  expect(radio.state.station).toBe('LO-FI HAYES VALLEY'); expect(toast.textContent).toBe(radio.state.station);
  expect(JSON.parse(storage.get('gtasf.radio.v1')!).station).toBe('lofi-hayes-valley');
  expect(audio.muted).toBe(true);
  await vi.advanceTimersByTimeAsync(2000); expect(toast.hidden).toBe(true);
  radio.setVehicle(false); expect(phone.hidden).toBe(false);
});

test('autoplay rejection stays stopped until a real gesture, and hidden tabs pause then resume', async () => {
  const radio = mount(), audio = Media.instances[0]!;
  audio.play.mockRejectedValueOnce(new Error('gesture required'));
  radio.setVehicle(true); await settle(); expect(radio.state.playing).toBe(false);
  radio.unlock(); await settle(); expect(radio.state.playing).toBe(true);
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); expect(audio.paused).toBe(true);
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange')); await settle(); expect(radio.state.playing).toBe(true);
});

test('flag-off fallback keeps the original three loops and manual play behavior', async () => {
  Object.assign(flags, { radioStations: false });
  const radio = mount(), audio = Media.instances[0]!;
  radio.setVehicle(true); radio.unlock(); expect(audio.assignments).toEqual([]);
  expect(audio.loop).toBe(true);
  const buttons = doc.body.find('gt-radio-buttons')!;
  buttons.children[0]!.dispatchEvent(new Event('click')); await settle();
  expect(audio.src).toBe('/audio/radio/kvc-radio.mp3'); expect(radio.state.playing).toBe(true);
  radio.setVehicle(false); expect(radio.state.playing).toBe(true);
});
