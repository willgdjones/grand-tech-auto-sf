import { flags } from '@gtasf/shared/flags';
import { RADIO_STATIONS } from '@gtasf/shared/content/radio';
import { CELEB_RADIO_RUMOURS } from '@gtasf/shared/content/celebs';
import { createVehicleRadio } from './radioStationPlayer';
import './radio.css';
import { voiceDuck } from './voiceDuck';

const STORAGE = 'gtasf.radio.v1';
type Preference = { station: string; volume: number; muted: boolean };
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') { const element = document.createElement(tag); element.textContent = text; return element; }
function preference(): Preference {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) ?? '{}') as Partial<Preference>;
    return { station: RADIO_STATIONS.some(s => s.id === raw.station) ? raw.station! : RADIO_STATIONS[0].id,
      volume: typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.max(0, Math.min(1, raw.volume)) : .35, muted: raw.muted === true };
  } catch { return { station: RADIO_STATIONS[0].id, volume: .35, muted: false }; }
}

/** Mounted in Game options. Genre radio follows vehicles; legacy loops require a Play click. */
export function createRadio(options: { parent: HTMLElement; onChange?(): void }) {
  if (!flags.radio) return null;
  if (flags.radioStations) return createVehicleRadio(options);
  const saved = preference(); let station = RADIO_STATIONS.find(s => s.id === saved.station) ?? RADIO_STATIONS[0];
  // Parody angel rumours ride the ticker as ambient hints only while celebNpcs is on (dev-only
  // until the founder approves the roster); production keeps the station's own lines (gtasf-v2-angel-npcs-v4i6).
  const stationLines = (): readonly string[] => flags.celebNpcs ? [...station.djLines, ...CELEB_RADIO_RUMOURS] : station.djLines;
  let lines = stationLines();
  const controls = node('section'); controls.className = 'gt-radio-controls'; controls.setAttribute('aria-label', 'City radio');
  const heading = node('h3', 'City radio'), selectLabel = node('label', 'Station'), select = node('select'); select.setAttribute('aria-label', 'Radio station');
  for (const value of RADIO_STATIONS) { const option = node('option', value.name); option.value = value.id; select.append(option); }
  select.value = station.id; selectLabel.append(select);
  const buttons = node('div'); buttons.className = 'gt-radio-buttons';
  const play = node('button', 'Play radio'), mute = node('button'); play.type = mute.type = 'button'; buttons.append(play, mute);
  const volumeLabel = node('label', 'Volume'), volume = node('input'); volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.step = '1'; volume.value = String(Math.round(saved.volume * 100)); volume.setAttribute('aria-label', 'Radio volume'); volumeLabel.append(volume);
  const status = node('p', 'Choose a station, then press Play.'); status.className = 'gt-radio-status'; status.setAttribute('role', 'status');
  const ticker = node('p', station.tagline); ticker.className = 'gt-radio-dj';
  controls.append(heading, selectLabel, buttons, volumeLabel, ticker, status); options.parent.append(controls);
  const audio = new Audio(); audio.preload = 'none'; audio.loop = true; audio.volume = saved.volume; audio.muted = saved.muted;
  let disposed = false, wanted = false, started = false, revision = 0, line = 0, timer: ReturnType<typeof setInterval> | undefined;
  let playing = false, tickerText: string = station.tagline, level = saved.volume, ducked = false, voiceListening = false;
  const applyGain = () => { audio.volume = level * voiceDuck(ducked, voiceListening); };
  function persist() { try { localStorage.setItem(STORAGE, JSON.stringify({ station: station.id, volume: level, muted: audio.muted })); } catch { /* Storage can be blocked; controls still work. */ } }
  function update() {
    play.textContent = wanted ? 'Pause radio' : 'Play radio'; mute.textContent = audio.muted ? 'Unmute' : 'Mute'; mute.setAttribute('aria-pressed', String(audio.muted));
    ticker.textContent = `${station.host}: ${tickerText}`; options.onChange?.();
  }
  function stopTicker() { if (timer !== undefined) clearInterval(timer); timer = undefined; }
  function startTicker() { stopTicker(); timer = setInterval(() => { if (!playing || document.hidden) return; line = (line + 1) % lines.length; tickerText = lines[line]!; update(); }, 14_000); }
  async function resume() {
    if (disposed || !wanted || document.hidden) return;
    const attempt = ++revision;
    if (!audio.getAttribute('src')) { audio.src = `/audio/radio/${station.id}.mp3`; audio.load(); }
    status.textContent = 'Tuning in…'; update();
    try {
      await audio.play();
      if (disposed || attempt !== revision || !wanted || document.hidden) return;
      started = true; playing = true; status.textContent = 'Playing · original CC0 music'; tickerText = lines[line]!; startTicker(); update();
    } catch {
      if (disposed || attempt !== revision) return;
      wanted = false; playing = false; stopTicker(); status.textContent = 'Press Play to start this station.'; update();
    }
  }
  function pause() { revision++; audio.pause(); playing = false; stopTicker(); update(); }
  play.addEventListener('click', () => { wanted = !wanted; if (wanted) void resume(); else { pause(); status.textContent = 'Radio paused.'; } });
  mute.addEventListener('click', () => { audio.muted = !audio.muted; persist(); update(); });
  volume.addEventListener('input', () => { level = Number(volume.value) / 100; applyGain(); persist(); update(); });
  select.addEventListener('change', () => {
    const next = RADIO_STATIONS.find(s => s.id === select.value); if (!next || next === station) return;
    pause(); station = next; lines = stationLines(); line = 0; tickerText = station.tagline;
    // Do not even request an asset until the player has chosen playback.
    audio.removeAttribute('src'); audio.load(); persist(); status.textContent = wanted ? 'Tuning in…' : 'Press Play to hear this station.'; update(); if (wanted) void resume();
  });
  function visibility() {
    if (document.hidden) { if (!started) wanted = false; pause(); if (wanted) status.textContent = 'Paused while this tab is hidden.'; }
    else if (wanted && started) void resume();
  }
  audio.addEventListener('error', () => { if (disposed) return; wanted = false; pause(); status.textContent = 'This station could not load. Press Play to retry.'; audio.removeAttribute('src'); });
  document.addEventListener('visibilitychange', visibility); update();
  return {
    controls,
    // Legacy flag-off radio remains manually controlled, including on foot.
    setVehicle(_active: boolean) {}, unlock() {}, cycle(_direction: number) {},
    setDuck(active: boolean) { ducked = active; applyGain(); },
    /** Proximity voice listening is on: keep music under conversation even between talkers. */
    setVoiceListening(active: boolean) { voiceListening = active; applyGain(); },
    get state() { return { station: station.name, playing, muted: audio.muted, volume: level, ticker: tickerText }; },
    destroy() { if (disposed) return; disposed = true; wanted = false; pause(); document.removeEventListener('visibilitychange', visibility); audio.removeAttribute('src'); audio.load(); controls.remove(); },
  };
}
