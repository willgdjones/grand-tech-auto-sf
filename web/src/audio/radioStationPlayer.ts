import { GENRE_STATIONS, createStationSchedule, type RadioClip } from './radioStations';
import { voiceDuck } from './voiceDuck';

const STORAGE = 'gtasf.radio.v1';
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') {
  const element = document.createElement(tag); element.textContent = text; return element;
}
function preference() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
    return { station: String(value?.station ?? ''), muted: value?.muted === true,
      volume: typeof value?.volume === 'number' && Number.isFinite(value.volume) ? Math.max(0, Math.min(1, value.volume)) : .35 };
  } catch { return { station: '', muted: false, volume: .35 }; }
}
/** A tiny local silent WAV unlocks the same media element during an entry gesture; no network. */
function silence() {
  const bytes = new Uint8Array(844), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((c, i) => { bytes[at + i] = c.charCodeAt(0); });
  text(0, 'RIFF'); view.setUint32(4, 836, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  text(36, 'data'); view.setUint32(40, 800, true); bytes.fill(128, 44);
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
}

/** gtasf-vhn6n (critique R3): top-centre cards the station name must never print over — the founder quest card,
 *  valuation chip, mission slab, drive quest, race card and the ARRIVED-style toasts. */
const TOP_CENTRE_HUD = '.gt-founder-quest, .gt-founder-valuation, .gt-mission-slab, .gt-drive-quest, .gt-race-card, .gt-toast';
/** Drop the toast just below whichever of those is showing under it (capped at 45% of the viewport). */
function clearTopCentreHud(toast: HTMLElement) {
  if (!toast.style || typeof toast.getBoundingClientRect !== 'function' || typeof document.querySelectorAll !== 'function') return;
  toast.style.top = '';
  const own = toast.getBoundingClientRect(), cap = innerHeight * .45;
  const boxes = [...document.querySelectorAll<HTMLElement>(TOP_CENTRE_HUD)].map(el => el.getBoundingClientRect())
    .filter(r => r.width && r.height && r.right > own.left && r.left < own.right && r.top < cap);
  // Stacked cards (quest card → valuation chip → ARRIVED toast): settle in any document order.
  let top = own.top;
  for (let moved = true; moved;) {
    moved = false;
    for (const r of boxes) if (r.bottom + 10 > top && r.top < top + own.height) { top = r.bottom + 10; moved = true; }
    if (top >= cap) { top = cap; break; }
  }
  if (top > own.top) toast.style.top = `${top}px`;
}

/** Vehicle-only programming. This module creates no remote request until a station actually plays. */
export function createVehicleRadio(options: { parent: HTMLElement; onChange?(): void }) {
  const saved = preference();
  let stationIndex = Math.max(0, GENRE_STATIONS.findIndex(s => s.id === saved.station));
  let station = GENRE_STATIONS[stationIndex]!;
  const schedules = new Map<string, ReturnType<typeof createStationSchedule>>();
  const controls = node('section'); controls.className = 'gt-radio-controls'; controls.setAttribute('aria-label', 'City radio');
  const selectLabel = node('label', 'Station'), select = node('select'); select.setAttribute('aria-label', 'Radio station');
  for (const s of GENRE_STATIONS) { const option = node('option', `${s.name} · ${s.genre}`); option.value = s.id; select.append(option); }
  select.value = station.id; selectLabel.append(select);
  const buttons = node('div'); buttons.className = 'gt-radio-buttons';
  const play = node('button', 'Radio on'), mute = node('button'); play.type = mute.type = 'button'; buttons.append(play, mute);
  const volumeLabel = node('label', 'Volume'), volume = node('input'); volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.step = '1'; volume.value = String(Math.round(saved.volume * 100)); volume.setAttribute('aria-label', 'Radio volume'); volumeLabel.append(volume);
  const ticker = node('p', station.tagline); ticker.className = 'gt-radio-dj';
  const status = node('p', 'City radio plays everywhere (quieter on foot). [ / ] changes station.'); status.className = 'gt-radio-status'; status.setAttribute('role', 'status');
  controls.append(node('h3', 'City radio'), selectLabel, buttons, volumeLabel, ticker, status); options.parent.append(controls);
  const toast = node('div'); toast.className = 'gt-radio-station-toast'; toast.hidden = true; toast.setAttribute('role', 'status');
  const phone = node('button', '♫ Station ›'); phone.type = 'button'; phone.className = 'gt-radio-next'; phone.hidden = true; phone.setAttribute('aria-label', 'Next radio station');
  document.body.append(toast, phone);
  // Background music everywhere (founder, Oct 4): full level in vehicles, ducked on foot.
  const FOOT_GAIN = 0.5;
  let level = saved.volume, ducked = false, voiceListening = false;
  const audio = new Audio(); audio.preload = 'none'; audio.volume = level * FOOT_GAIN; audio.muted = saved.muted;
  let vehicle = false, enabled = true, disposed = false, playing = false, unlocked = false, unlocking = false, revision = 0;
  let clip: RadioClip | undefined, tickerText = station.tagline;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const canPlay = () => enabled && !document.hidden && !disposed;
  const applyGain = () => { audio.volume = Math.max(0, Math.min(1, level * (vehicle ? 1 : FOOT_GAIN) * voiceDuck(ducked, voiceListening))); };
  function persist() { try { localStorage.setItem(STORAGE, JSON.stringify({ station: station.id, volume: level, muted: audio.muted })); } catch { /* private browsing */ } }
  function update() {
    play.textContent = enabled ? 'Radio on' : 'Radio off'; play.setAttribute('aria-pressed', String(enabled));
    mute.textContent = audio.muted ? 'Unmute' : 'Mute'; mute.setAttribute('aria-pressed', String(audio.muted));
    ticker.textContent = `${station.host}: ${tickerText}`;
    phone.hidden = false; options.onChange?.();
  }
  function announce() {
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toast.textContent = station.name; toast.hidden = false;
    clearTopCentreHud(toast);
    toastTimer = setTimeout(() => { toast.hidden = true; toastTimer = undefined; }, 2000);
  }
  function pause() { revision++; audio.pause(); playing = false; update(); }
  function nextClip() {
    let schedule = schedules.get(station.id);
    if (!schedule) { schedule = createStationSchedule(station); schedules.set(station.id, schedule); }
    clip = schedule(); tickerText = clip.text ?? clip.title;
    audio.src = `/audio/radio/${clip.file}`;
    audio.load();
  }
  async function resume() {
    if (!canPlay()) return;
    if (!clip) nextClip();
    const attempt = ++revision;
    status.textContent = 'Tuning in…'; update();
    try {
      await audio.play();
      if (attempt !== revision || !canPlay()) return;
      unlocked = true; playing = true; status.textContent = `${station.genre} · ${clip!.title}`; update();
    } catch {
      if (attempt !== revision || disposed) return;
      playing = false; status.textContent = 'Press E, change station, or tap Radio on to listen.'; update();
    }
  }
  function unlock() {
    if (disposed || unlocked || unlocking) return;
    if (canPlay()) { void resume(); return; }
    if (clip) return;
    unlocking = true;
    audio.src = silence();
    const attempt = ++revision;
    void audio.play().then(() => {
      unlocked = true;
      if (attempt === revision && !canPlay()) audio.pause();
    }).catch(() => { /* A rejected gesture can be retried; never pretend audio is playing. */ })
      .finally(() => { unlocking = false; });
  }
  function setVehicle(active: boolean) {
    if (disposed || vehicle === active) return;
    vehicle = active; applyGain();
    if (active) announce();
    if (canPlay() && !playing) void resume();
    update();
  }
  function choose(index: number) {
    if (disposed) return;
    const next = (index + GENRE_STATIONS.length) % GENRE_STATIONS.length;
    if (next === stationIndex) return;
    pause(); stationIndex = next; station = GENRE_STATIONS[next]!; select.value = station.id;
    clip = undefined; tickerText = station.tagline;
    audio.removeAttribute('src'); audio.load(); persist(); update();
    announce();
    if (canPlay()) void resume();
  }
  function cycle(direction: number) { choose(stationIndex + direction); }
  function onKey(event: KeyboardEvent) {
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select'))) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
      event.preventDefault(); cycle(event.code === 'BracketLeft' ? -1 : 1);
    } else if (event.isTrusted) unlock();
  }
  const onPointer = (event: PointerEvent) => { if (event.isTrusted) unlock(); };
  function visibility() { if (document.hidden) pause(); else if (canPlay()) void resume(); }
  function ended() { if (!clip || !canPlay()) return; nextClip(); void resume(); }
  function failed() { if (disposed || !clip) return; pause(); clip = undefined; audio.removeAttribute('src'); status.textContent = 'Signal lost. Change station or tap Radio on to retry.'; }
  play.addEventListener('click', () => {
    // A blocked or failed first play should retry with this gesture, not turn the preference off.
    if (canPlay() && !playing) { void resume(); return; }
    enabled = !enabled; if (canPlay()) void resume(); else pause(); update();
  });
  mute.addEventListener('click', () => { audio.muted = !audio.muted; persist(); update(); });
  volume.addEventListener('input', () => { level = Number(volume.value) / 100; applyGain(); persist(); update(); });
  select.addEventListener('change', () => choose(GENRE_STATIONS.findIndex(s => s.id === select.value)));
  phone.addEventListener('click', () => cycle(1));
  audio.addEventListener('ended', ended); audio.addEventListener('error', failed);
  document.addEventListener('keydown', onKey); document.addEventListener('pointerdown', onPointer);
  document.addEventListener('visibilitychange', visibility); update();
  return {
    controls, setVehicle, unlock, cycle,
    setDuck(active: boolean) { ducked = active; applyGain(); },
    /** Proximity voice listening is on: keep music under conversation even between talkers. */
    setVoiceListening(active: boolean) { voiceListening = active; applyGain(); },
    get state() { return { station: station.name, playing, muted: audio.muted, volume: level, ticker: tickerText }; },
    destroy() {
      if (disposed) return; disposed = true; pause();
      if (toastTimer !== undefined) clearTimeout(toastTimer);
      document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('visibilitychange', visibility);
      audio.removeEventListener('ended', ended); audio.removeEventListener('error', failed);
      audio.removeAttribute('src'); audio.load(); controls.remove(); toast.remove(); phone.remove();
    },
  };
}
