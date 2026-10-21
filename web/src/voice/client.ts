import { flags } from '@gtasf/shared/flags';
import type { C2SMessage, S2CMessage, VoicePeer } from '@gtasf/shared/protocol/types';
import { createVoiceMixer, type VoiceListener, type VoicePosition } from './mixer';
import { createPushToTalk } from './ptt';
import { createVoiceTransport } from './transport';
import './voice.css';
import { voiceGateOpen } from './gate';
import { track } from '../analytics';

export interface VoiceClientState { enabled: boolean; pending: boolean; transmitting: boolean; status: string }
type VoiceCommand = Extract<C2SMessage, { type: 'VOICE_PUBLISH' | 'VOICE_STOP' | 'VOICE_MUTE' }>;

/** Opt-in is session-only. Neither a stored preference nor incoming signalling opens the microphone. */
export function createProximityVoice(options: {
  send(message: VoiceCommand): boolean;
  selfId(): number;
  connected(): boolean;
  verified(): boolean;
  canTalk(): boolean;
  onSpeaking(id: number, speaking: boolean): void;
  onDuck(active: boolean): void;
  /** Unverified player tried to talk: open the inline 'Enter your email to talk' box (verified speakers only). */
  onNeedsVerification?(): void;
  /** Every hold/release of voice's push-to-talk (spoken bubbles record the same hold, gtasf-gc9q). */
  onHold?(held: boolean): void;
  /** Spoken bubbles own V while voice is off: don't toast 'Voice is off' over a caption that is recording. */
  captionsHandleV?(): boolean;
  /** Show a short, obvious toast for why holding V did not start talking (founder Oct 6). */
  onNotice?(text: string): void;
}) {
  if (!voiceGateOpen()) return null; // flags.proximityVoice + hidden launch gate (?voice=1 until flags.voicePublic)
  let disposed = false, enabled = false, pending = false, transmitting = false, held = false, remoteAudible = false;
  let generation = 0, pressGeneration = 0, status = 'Voice is off. Enable it in Game options to listen or talk.';
  let mixer: ReturnType<typeof createVoiceMixer> | undefined, transport: ReturnType<typeof createVoiceTransport> | undefined;
  let mic: MediaStream | undefined, microphonePending = false, publishRequested = false;
  let permissionTimer: ReturnType<typeof setTimeout> | undefined;
  let peers: readonly VoicePeer[] = [];
  // Keep only a short-lived identifier so a player can report speech after PTT is released. No audio.
  const recentSpeakers = new Map<number, { sessionId: string; at: number }>();
  const muted = new Set<number>(), listeners = new Set<(state: VoiceClientState) => void>();
  const state = (): VoiceClientState => ({ enabled, pending, transmitting, status });
  function emit(message?: string) {
    if (message !== undefined) status = message;
    ptt.setStatus(status);
    for (const listener of listeners) listener(state());
  }
  /** Status + toast: every reason a hold did not transmit must be visible without opening Game options. */
  function notice(message: string) { ptt.setPill(null); emit(message); options.onNotice?.(message); }
  function syncDuck() { options.onDuck(transmitting || remoteAudible); }
  function setTransmitting(value: boolean) {
    if (transmitting === value) return;
    transmitting = value; ptt.setTransmitting(value); if (value) ptt.setPill('🎙 Talking…', 'live'); options.onSpeaking(options.selfId(), value); syncDuck();
  }
  function stop() {
    ptt.setPill(null);
    held = false; pressGeneration++;
    if (permissionTimer !== undefined) clearTimeout(permissionTimer); permissionTimer = undefined;
    for (const track of mic?.getAudioTracks() ?? []) track.enabled = false;
    if (transmitting || publishRequested) options.send({ type: 'VOICE_STOP' });
    publishRequested = false;
    setTransmitting(false);
    if (enabled && !pending) emit('Listening · hold V or the mic button to talk.');
  }
  function disable(message = 'Voice is off.') {
    generation++; stop(); enabled = false; pending = false;
    ptt.setEnabled(false);
    for (const track of mic?.getTracks() ?? []) track.stop(); mic = undefined;
    transport?.destroy(); transport = undefined; mixer?.destroy(); mixer = undefined;
    remoteAudible = false; syncDuck(); emit(message);
  }
  async function start() {
    if (disposed || !enabled || pending || held || !options.canTalk()) return;
    if (!options.connected()) { notice('Reconnect to the city before talking.'); return; }
    if (!options.verified()) { ptt.setPill(null); emit('Enter your email to talk. You can still listen.'); options.onNeedsVerification?.(); return; }
    if (microphonePending) { notice('Finish the microphone permission prompt, then hold to talk again.'); return; }
    held = true;
    const current = generation, press = ++pressGeneration;
    try {
      if (!mic || mic.getAudioTracks().every(track => track.readyState === 'ended')) {
        microphonePending = true; emit('Allow microphone access to talk.');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
          .finally(() => { microphonePending = false; });
        for (const track of stream.getAudioTracks()) track.enabled = false;
        if (disposed || current !== generation || !held || press !== pressGeneration) { for (const track of stream.getTracks()) track.stop(); return; }
        mic = stream;
      }
      const track = mic.getAudioTracks()[0];
      if (!track) throw new Error('Microphone unavailable.');
      emit('Connecting microphone…');
      const published = await transport!.publish(track);
      if (disposed || current !== generation || !held || press !== pressGeneration || !options.canTalk()) return;
      if (!options.send({ type: 'VOICE_PUBLISH', ...published })) { stop(); notice('Voice could not connect. Hold to talk again after reconnecting.'); return; }
      publishRequested = true;
      // A server VOICE_STATE speaking acknowledgement enables the track, never this optimistic send.
      permissionTimer = setTimeout(() => {
        permissionTimer = undefined;
        if (disposed || current !== generation || press !== pressGeneration || !publishRequested) return;
        ptt.release(); stop();
        notice('Voice permission timed out. Release and hold to talk again.');
      }, 15_000);
      emit('Waiting for voice permission…');
    } catch (error) {
      if (disposed || current !== generation || press !== pressGeneration) return;
      stop(); notice(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow it in your browser to talk, or keep listening.'
        : error instanceof Error ? error.message : 'Voice is unavailable. Turn it off and on to retry.');
    }
  }
  const ptt = createPushToTalk({ canStart: () => enabled && !pending && options.canTalk(),
    onPress: () => { options.onHold?.(true); ptt.setPill('🎙 Connecting…'); void start(); }, onRelease: () => { options.onHold?.(false); stop(); },
    onBlocked: () => { if (!options.captionsHandleV?.()) options.onNotice?.('Voice is off. Turn it on in ☰ Game options, then hold V to talk.'); } });
  const visibility = () => { if (document.hidden && enabled) disable('Voice paused while this tab is hidden. Enable it again in Game options.'); };
  document.addEventListener('visibilitychange', visibility);
  return {
    get state() { return state(); },
    disconnect() { if (enabled) disable('Disconnected. Enable voice after reconnecting.'); peers = []; },
    subscribe(listener: (value: VoiceClientState) => void) { listeners.add(listener); listener(state()); return () => { listeners.delete(listener); }; },
    async setEnabled(value: boolean) {
      if (disposed) return;
      if (!value) { disable(); return; }
      if (enabled || pending) return;
      if (!options.connected()) { emit('Connect to the city before enabling voice.'); return; }
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined' || typeof AudioContext === 'undefined') {
        emit('This browser cannot use proximity voice. You can still type in chat.'); return;
      }
      const current = ++generation;
      enabled = true; pending = true; emit('Connecting voice…');
      track('voice_enabled'); // consent-gated inside track(); no audio or ids
      const nextMixer = createVoiceMixer({ onSpeaking: options.onSpeaking, onAudible(active) { remoteAudible = active; syncDuck(); } });
      mixer = nextMixer;
      const nextTransport = createVoiceTransport({
        onTrack(id, track) { if (!disposed && current === generation && enabled) nextMixer.attach(id, track); },
        onError(message) { if (!disposed && current === generation) disable(message); },
      });
      transport = nextTransport;
      try {
        // Unlock playback in this user gesture, before asynchronous signalling. No getUserMedia here.
        await Promise.all([nextMixer.unlock(), nextTransport.start()]);
        if (disposed || current !== generation) return;
        pending = false; ptt.setEnabled(true);
        nextMixer.setPeers(peers);
        for (const id of muted) nextMixer.setMuted(id, true);
        nextTransport.setPeers(peers.filter(peer => !muted.has(peer.playerId)));
        emit('Listening · hold V or the mic button to talk. Only verified founders can transmit.');
      } catch (error) {
        if (current === generation && !disposed) disable(error instanceof Error ? error.message : 'Voice could not connect. Try again.');
      }
    },
    receive(message: S2CMessage) {
      if (disposed) return;
      if (message.type === 'WELCOME') { if (enabled) disable('Reconnected. Enable voice again in Game options.'); muted.clear(); recentSpeakers.clear(); peers = []; return; }
      if (message.type === 'PLAYER_LEAVE') {
        peers = peers.filter(peer => peer.playerId !== message.id);
        mixer?.detach(message.id); muted.delete(message.id);
        transport?.setPeers(peers.filter(peer => !muted.has(peer.playerId))); return;
      }
      if (message.type === 'VOICE_PEERS') {
        peers = message.peers.filter(peer => peer.playerId !== options.selfId());
        if (enabled) {
          const now = Date.now();
          for (const [id, value] of recentSpeakers) if (now - value.at > 600_000) recentSpeakers.delete(id);
          for (const peer of peers) if (!muted.has(peer.playerId)) recentSpeakers.set(peer.playerId, { sessionId: peer.sessionId, at: now });
          while (recentSpeakers.size > 128) recentSpeakers.delete(recentSpeakers.keys().next().value!);
        }
        if (!pending) {
          mixer?.setPeers(peers);
          transport?.setPeers(peers.filter(peer => !muted.has(peer.playerId)));
        }
      }
      if (!enabled) return;
      if (message.type === 'VOICE_STATE' && message.playerId === options.selfId()) {
        if (message.state === 'speaking') {
          if (!held || !publishRequested || !mic?.getAudioTracks().some(track => track.readyState === 'live') || !options.canTalk()) { options.send({ type: 'VOICE_STOP' }); stop(); return; }
          if (permissionTimer !== undefined) clearTimeout(permissionTimer); permissionTimer = undefined;
          for (const track of mic?.getAudioTracks() ?? []) track.enabled = true;
          setTransmitting(true); emit('Talking · release V or the mic button to stop.');
        } else if (message.state === 'stopped') {
          if (transmitting) stop();
        } else {
          stop();
          for (const track of mic?.getTracks() ?? []) track.stop(); mic = undefined;
          if (message.state === 'refused-unverified') options.onNeedsVerification?.();
          const refusal = ({ 'refused-unverified': 'Enter your email to talk. You can still listen.',
            'refused-banned': 'Your voice access is temporarily restricted.', 'refused-rate': 'Voice is busy. Wait a moment before talking again.',
            'refused-off': 'Voice is not available on this server yet.' } as Record<string, string>)[message.state] ?? 'Voice is unavailable right now.';
          // Unverified opens the inline email box (its own feedback); every other refusal also toasts.
          if (message.state === 'refused-unverified') emit(refusal); else notice(refusal);
        }
      }
    },
    isMuted(id: number) { return muted.has(id); },
    reportSession(id: number) {
      const current = enabled ? peers.find(peer => peer.playerId === id) : undefined;
      if (current) return current.sessionId;
      const recent = recentSpeakers.get(id);
      return recent && Date.now() - recent.at <= 600_000 ? recent.sessionId : undefined;
    },
    setMuted(id: number, value: boolean) {
      if (disposed || id === options.selfId()) return;
      if (value) muted.add(id); else muted.delete(id);
      mixer?.setMuted(id, value); options.send({ type: 'VOICE_MUTE', target: id, muted: value });
      transport?.setPeers(peers.filter(peer => !muted.has(peer.playerId)));
    },
    update(listener: VoiceListener, positions: readonly VoicePosition[], now: number) {
      if (!enabled) return;
      if (!options.connected()) { disable('Disconnected. Enable voice after reconnecting.'); return; }
      if (held && (!options.canTalk() || !options.verified() || (transmitting && !mic?.getAudioTracks().some(track => track.readyState === 'live')))) { ptt.release(); stop(); }
      mixer?.update(listener, positions, now);
    },
    destroy() {
      if (disposed) return;
      disable(); disposed = true; ptt.destroy(); listeners.clear(); muted.clear(); recentSpeakers.clear(); document.removeEventListener('visibilitychange', visibility);
    },
  };
}
