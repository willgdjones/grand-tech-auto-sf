import type { VoicePeer } from '@gtasf/shared/protocol/types';
/** Founder Oct 6: voices were drowned by the radio. Post-compressor makeup gain (was .85). */
export const VOICE_MASTER_GAIN = 1.5;

export interface VoicePosition { id: number; x: number; y: number; z: number }
export interface VoiceListener { x: number; y: number; z: number; yaw: number }
interface RemoteAudio {
  track: MediaStreamTrack;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  speaking: boolean;
  spokeAt: number;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** SF camera convention: screen-right = (cos(yaw), 0, -sin(yaw)). */
function panAt(peer: VoicePosition | undefined, listener: VoiceListener): number {
  if (!peer) return 0; // Event-room / shared-vehicle peers can be outside snapshot range.
  const dx = peer.x - listener.x, dy = peer.y - listener.y, dz = peer.z - listener.z;
  return clamp((dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / Math.max(4, Math.hypot(dx, dy, dz)), -1, 1);
}

/** No AudioContext until unlock(), called only from the explicit voice opt-in gesture. */
export function createVoiceMixer(options: { onSpeaking(id: number, speaking: boolean): void; onAudible(active: boolean): void }) {
  let context: AudioContext | undefined, master: GainNode | undefined, disposed = false;
  let audible = false, lastUpdate = -Infinity;
  const peers = new Map<number, VoicePeer>(), remotes = new Map<number, RemoteAudio>(), muted = new Set<number>();

  function speaking(id: number, remote: RemoteAudio, value: boolean) {
    if (remote.speaking === value) return;
    remote.speaking = value; options.onSpeaking(id, value);
  }
  function syncAudible() {
    let next = false;
    for (const remote of remotes.values()) if (remote.speaking) { next = true; break; }
    if (next !== audible) { audible = next; options.onAudible(next); }
  }
  function detach(id: number) {
    const remote = remotes.get(id); if (!remote) return;
    speaking(id, remote, false);
    remote.source.disconnect(); remote.gain.disconnect(); remote.pan.disconnect(); remote.analyser.disconnect();
    remotes.delete(id); syncAudible();
  }
  function targetGain(id: number) {
    const peer = peers.get(id);
    return peer && !muted.has(id) && !document.hidden && Number.isFinite(peer.gain) ? clamp(peer.gain / 255, 0, 1) : 0;
  }
  function applyGain(id: number, remote: RemoteAudio) {
    if (!context) return;
    const gain = targetGain(id);
    remote.gain.gain.cancelScheduledValues(context.currentTime);
    // Privacy controls silence immediately; smooth only an allowed gain increase.
    if (gain === 0) { remote.gain.gain.setValueAtTime(0, context.currentTime); speaking(id, remote, false); }
    else remote.gain.gain.setTargetAtTime(gain, context.currentTime, .025);
  }
  return {
    async unlock() {
      if (disposed) return;
      if (!context) {
        // Voice must sit clearly above the radio and the city: compress (even out quiet/loud talkers), then ~1.5x.
        context = new AudioContext(); master = context.createGain(); master.gain.value = VOICE_MASTER_GAIN;
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -28; compressor.knee.value = 20; compressor.ratio.value = 4;
        compressor.attack.value = .005; compressor.release.value = .2;
        master.connect(compressor); compressor.connect(context.destination);
      }
      await context.resume();
    },
    setPeers(next: readonly VoicePeer[]) {
      for (const [id, old] of peers) {
        const replacement = next.find(peer => peer.playerId === id);
        if (!replacement || replacement.sessionId !== old.sessionId || replacement.trackName !== old.trackName) detach(id);
      }
      peers.clear(); for (const peer of next) peers.set(peer.playerId, peer);
      for (const [id, remote] of remotes) { if (!peers.has(id)) detach(id); else applyGain(id, remote); }
      syncAudible();
    },
    attach(id: number, track: MediaStreamTrack) {
      if (disposed || !context || !master || !peers.has(id)) return;
      if (remotes.get(id)?.track === track) return;
      detach(id);
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const gain = context.createGain(), pan = context.createStereoPanner(), analyser = context.createAnalyser();
      gain.gain.value = 0; analyser.fftSize = 256;
      source.connect(gain); gain.connect(pan); pan.connect(master); source.connect(analyser);
      const remote: RemoteAudio = { track, source, gain, pan, analyser, samples: new Float32Array(analyser.fftSize), speaking: false, spokeAt: -Infinity };
      remotes.set(id, remote); applyGain(id, remote);
    },
    detach,
    setMuted(id: number, value: boolean) {
      if (value) muted.add(id); else muted.delete(id);
      const remote = remotes.get(id); if (remote) applyGain(id, remote);
      syncAudible();
    },
    update(listener: VoiceListener, positions: readonly VoicePosition[], now: number) {
      if (disposed || !context || now - lastUpdate < 50) return;
      lastUpdate = now;
      for (const [id, remote] of remotes) {
        applyGain(id, remote);
        remote.pan.pan.setTargetAtTime(panAt(positions.find(peer => peer.id === id), listener), context.currentTime, .04);
        let power = 0;
        if (context.state === 'running' && targetGain(id) > .001 && remote.track.readyState === 'live' && !remote.track.muted) {
          remote.analyser.getFloatTimeDomainData(remote.samples);
          for (const sample of remote.samples) power += sample * sample;
          if (Math.sqrt(power / remote.samples.length) > .012) remote.spokeAt = now;
        }
        speaking(id, remote, targetGain(id) > .001 && context.state === 'running' && now - remote.spokeAt < 220);
      }
      syncAudible();
    },
    clear() { peers.clear(); for (const id of remotes.keys()) detach(id); },
    destroy() {
      if (disposed) return; disposed = true;
      peers.clear(); muted.clear(); for (const id of remotes.keys()) detach(id);
      master?.disconnect(); void context?.close().catch(() => {}); context = undefined; master = undefined;
    },
  };
}
