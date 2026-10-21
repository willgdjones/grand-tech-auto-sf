import type { FleetCar } from '../game/fleet';
import type { VehicleKind } from '@gtasf/shared/protocol/types';
import './vehicles.css';

const STORAGE = 'gtasf.vehicle-audio.v1';
export const ENGINE_VOICES = 4, SOUND_RANGE_M = 70;
type Point = { x: number; y: number; z: number };
export type SoundListener = Point & { yaw: number };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The camera boom yaw has screen-right=(cos(yaw),0,-sin(yaw)). */
export function vehicleSound(position: Point, listener: SoundListener, speed: number, kind: VehicleKind, occupied = false) {
  const dx = position.x - listener.x, dy = position.y - listener.y, dz = position.z - listener.z;
  const distance = Math.hypot(dx, dy, dz), moving = Math.min(40, Math.abs(Number.isFinite(speed) ? speed : 0));
  const electric = kind === 'tesla' || kind === 'robotaxi';
  const frequency = (electric ? 100 : kind === 'bus' ? 40 : 55) + moving * (electric ? 8 : 4);
  const attenuation = occupied ? 1 : Math.max(0, 1 - distance / SOUND_RANGE_M) ** 2 / (1 + distance / 12);
  return { distance, frequency, pan: occupied ? 0 : clamp((dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / Math.max(4, distance), -1, 1),
    gain: (occupied || moving > .15) && kind !== 'cable-car' ? attenuation * (electric ? .022 : .032) * (.55 + Math.min(1, moving / 12) * .45) : 0,
    attenuation };
}

type Engine = { id: number; oscillators: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode; frequency: number; targetGain: number; targetPan: number };
type Shot = { oscillators: OscillatorNode[]; gain: GainNode; pan: StereoPannerNode };
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') { const value = document.createElement(tag); value.textContent = text; return value; }
function savedPreference() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? '{}') as { volume?: unknown; muted?: unknown };
    return { volume: typeof saved.volume === 'number' && Number.isFinite(saved.volume) ? clamp(saved.volume, 0, 1) : .3, muted: saved.muted === true };
  } catch { return { volume: .3, muted: false }; }
}

/** Original oscillator synthesis, started only by a Game options button. Caller passes flags.vehicleAudio. */
export function createVehicleAudio(options: { enabled: boolean; parent: HTMLElement }) {
  if (!options.enabled) return null;
  const saved = savedPreference();
  let volume = saved.volume, muted = saved.muted, wanted = false, disposed = false, revision = 0;
  let context: AudioContext | undefined, master: GainNode | undefined, compressor: DynamicsCompressorNode | undefined, analyser: AnalyserNode | undefined;
  const engines: Engine[] = [], shots = new Set<Shot>(), previousMoving = new Map<number, boolean>();
  let cars: ReadonlyMap<number, FleetCar> = new Map(), listener: SoundListener = { x: 0, y: 0, z: 0, yaw: 0 };
  let occupiedId = 0, occupiedSpeed = 0, lastUpdate = -Infinity, lastHorn = -Infinity, hornCount = 0, bellCount = 0;
  const controls = element('section'); controls.className = 'gt-vehicle-audio'; controls.setAttribute('aria-label', 'Vehicle sounds');
  const heading = element('h3', 'Vehicle sounds'), buttons = element('div'); buttons.className = 'gt-vehicle-audio-buttons';
  const play = element('button', 'Enable vehicle sounds'), mute = element('button'); play.type = mute.type = 'button'; buttons.append(play, mute);
  const label = element('label', 'Effects volume'), slider = element('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1'; slider.value = String(Math.round(volume * 100)); slider.setAttribute('aria-label', 'Vehicle effects volume'); label.append(slider);
  const status = element('p', 'Engines and passing cars · F or Horn in a vehicle.'); status.setAttribute('role', 'status');
  controls.append(heading, buttons, label, status); options.parent.append(controls);

  function persist() { try { localStorage.setItem(STORAGE, JSON.stringify({ volume, muted })); } catch { /* Session controls still work. */ } }
  function refresh() { play.textContent = wanted ? 'Pause vehicle sounds' : 'Enable vehicle sounds'; mute.textContent = muted ? 'Unmute effects' : 'Mute effects'; mute.setAttribute('aria-pressed', String(muted)); }
  function clearShots() {
    for (const shot of shots) { for (const oscillator of shot.oscillators) { oscillator.onended = null; oscillator.stop(); oscillator.disconnect(); } shot.gain.disconnect(); shot.pan.disconnect(); }
    shots.clear();
  }
  function clearVoices() {
    clearShots(); previousMoving.clear();
    if (!context) return;
    for (const engine of engines) { engine.id = 0; engine.targetGain = 0; engine.gain.gain.cancelScheduledValues(context.currentTime); engine.gain.gain.setValueAtTime(0, context.currentTime); }
  }
  function prepare() {
    if (context) return;
    context = new AudioContext();
    master = context.createGain(); master.gain.value = muted ? 0 : volume;
    compressor = context.createDynamicsCompressor(); compressor.threshold.value = -12; compressor.knee.value = 12; compressor.ratio.value = 6;
    analyser = context.createAnalyser(); analyser.fftSize = 256;
    master.connect(compressor); compressor.connect(analyser); analyser.connect(context.destination);
    for (let i = 0; i < ENGINE_VOICES; i++) {
      const gain = context.createGain(), pan = context.createStereoPanner(), filter = context.createBiquadFilter();
      gain.gain.value = 0; filter.type = 'lowpass'; filter.frequency.value = 700; filter.Q.value = .3;
      filter.connect(gain); gain.connect(pan); pan.connect(master);
      const oscillators = [context.createOscillator(), context.createOscillator()];
      oscillators[0]!.type = 'triangle'; oscillators[1]!.type = 'sine';
      oscillators.forEach((oscillator, harmonic) => { oscillator.frequency.value = 55 * (harmonic + 1); oscillator.connect(filter); oscillator.start(); });
      engines.push({ id: 0, oscillators, filter, gain, pan, frequency: 55, targetGain: 0, targetPan: 0 });
    }
  }
  async function syncPlayback() {
    const current = ++revision;
    if (!wanted || muted || volume === 0 || document.hidden) {
      if (context?.state === 'running') {
        master!.gain.setTargetAtTime(0, context.currentTime, .008);
        await new Promise(done => setTimeout(done, 40));
        if (disposed || current !== revision) return;
        await context.suspend().catch(() => undefined);
      }
      clearVoices();
      if (!disposed && current === revision) { status.textContent = document.hidden && wanted ? 'Paused while this tab is hidden.' : muted ? 'Vehicle sounds muted.' : 'Vehicle sounds paused.'; refresh(); }
      return;
    }
    try {
      prepare(); await context!.resume();
      if (disposed || current !== revision) return;
      master!.gain.setTargetAtTime(volume, context!.currentTime, .025);
      lastUpdate = -Infinity; status.textContent = 'Vehicle sounds on · F or Horn in a vehicle.'; refresh();
    } catch {
      if (disposed || current !== revision) return;
      wanted = false; status.textContent = 'Press Enable to retry vehicle sounds.'; refresh();
    }
  }
  function oneShot(car: FleetCar, bell: boolean): boolean {
    if (!context || context.state !== 'running' || !wanted || muted || document.hidden || shots.size >= 2 || !car.model.root.visible) return false;
    const sound = vehicleSound(car.model.root.position, listener, car.data.speedCmps / 100, car.data.kind, car.data.id === occupiedId);
    if (sound.attenuation <= 0) return false;
    const now = context.currentTime, gain = context.createGain(), pan = context.createStereoPanner();
    pan.pan.value = sound.pan; gain.gain.value = 0; gain.connect(pan); pan.connect(master!);
    const frequencies = bell ? [880, 1320] : [330, 415];
    const oscillators = frequencies.map(frequency => {
      const oscillator = context!.createOscillator(); oscillator.type = bell ? 'sine' : 'triangle'; oscillator.frequency.value = frequency; oscillator.connect(gain); return oscillator;
    });
    const shot = { oscillators, gain, pan }; shots.add(shot);
    const peak = (bell ? .1 : .075) * sound.attenuation, end = bell ? .85 : .42;
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(peak, now + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, now + end); gain.gain.linearRampToValueAtTime(0, now + end + .03);
    oscillators[0]!.onended = () => { for (const oscillator of oscillators) oscillator.disconnect(); gain.disconnect(); pan.disconnect(); shots.delete(shot); };
    for (const oscillator of oscillators) { oscillator.start(now); oscillator.stop(now + end + .04); }
    if (bell) bellCount++; else hornCount++;
    return true;
  }
  play.addEventListener('click', () => { wanted = !wanted; refresh(); void syncPlayback(); });
  mute.addEventListener('click', () => { muted = !muted; persist(); refresh(); if (master && context) master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, .025); void syncPlayback(); });
  slider.addEventListener('input', () => { volume = Number(slider.value) / 100; persist(); if (master && context) master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, .025); void syncPlayback(); });
  const visibility = () => { void syncPlayback(); };
  document.addEventListener('visibilitychange', visibility); refresh();
  return {
    controls,
    update(fleet: ReadonlyMap<number, FleetCar>, nextListener: SoundListener, vehicleId: number, vehicleSpeed: number): void {
      cars = fleet; listener = nextListener; occupiedId = vehicleId; occupiedSpeed = vehicleSpeed;
      if (!context || context.state !== 'running' || !wanted || muted || document.hidden || context.currentTime - lastUpdate < .08) return;
      lastUpdate = context.currentTime;
      const candidates: { id: number; sound: ReturnType<typeof vehicleSound> }[] = [];
      for (const [id, car] of cars) {
        if (!car.model.root.visible) { previousMoving.delete(id); continue; }
        const speed = id === occupiedId ? occupiedSpeed : car.data.speedCmps / 100;
        const sound = vehicleSound(car.model.root.position, listener, speed, car.data.kind, id === occupiedId);
        if (sound.distance > SOUND_RANGE_M && id !== occupiedId) { previousMoving.delete(id); continue; }
        if (car.data.kind === 'cable-car') {
          if (previousMoving.get(id) === true && Math.abs(speed) < .1) oneShot(car, true);
          previousMoving.set(id, Math.abs(speed) > .1);
        } else if (sound.gain > 0) candidates.push({ id, sound });
      }
      for (const id of previousMoving.keys()) if (!cars.has(id)) previousMoving.delete(id);
      candidates.sort((a, b) => b.sound.gain - a.sound.gain);
      const selected = candidates.slice(0, ENGINE_VOICES), selectedIds = new Set(selected.map(value => value.id));
      for (const engine of engines) if (!selectedIds.has(engine.id)) { engine.id = 0; engine.targetGain = 0; engine.gain.gain.setTargetAtTime(0, context.currentTime, .08); }
      for (const candidate of selected) {
        const engine = engines.find(value => value.id === candidate.id) ?? engines.find(value => value.id === 0)!;
        engine.id = candidate.id; engine.frequency = candidate.sound.frequency; engine.targetGain = candidate.sound.gain; engine.targetPan = candidate.sound.pan;
        engine.oscillators.forEach((oscillator, harmonic) => oscillator.frequency.setTargetAtTime(engine.frequency * (harmonic + 1), context!.currentTime, .12));
        engine.gain.gain.setTargetAtTime(engine.targetGain, context.currentTime, .08); engine.pan.pan.setTargetAtTime(engine.targetPan, context.currentTime, .08);
      }
    },
    horn(vehicleId: number): boolean {
      if (!context || context.currentTime - lastHorn < .65 || !vehicleId) return false;
      const car = cars.get(vehicleId); if (!car || !oneShot(car, car.data.kind === 'cable-car')) return false;
      lastHorn = context.currentTime; return true;
    },
    /** Read-only observation for local audio evidence; no playback or pose overrides. */
    get state() {
      const samples = new Float32Array(256); analyser?.getFloatTimeDomainData(samples);
      return { wanted, muted, volume, context: context?.state ?? 'not-started', hornCount, bellCount, shots: shots.size,
        peak: Math.max(...samples.map(Math.abs)), voices: engines.filter(engine => engine.id).map(engine => ({ id: engine.id, frequency: engine.frequency, gain: engine.targetGain, pan: engine.targetPan })) };
    },
    destroy() {
      if (disposed) return;
      disposed = true; wanted = false; revision++; document.removeEventListener('visibilitychange', visibility); clearVoices();
      for (const engine of engines) { for (const oscillator of engine.oscillators) { oscillator.stop(); oscillator.disconnect(); } engine.filter.disconnect(); engine.gain.disconnect(); engine.pan.disconnect(); }
      engines.length = 0; master?.disconnect(); compressor?.disconnect(); analyser?.disconnect(); void context?.close().catch(() => undefined); controls.remove();
    },
  };
}
