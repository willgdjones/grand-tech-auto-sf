// Server-authoritative proximity voice (docs/engineering/proximity-voice.md, flag proximityVoice).
// Audio flows through Cloudflare Realtime; this decides, per listener, which published tracks they hear
// and how loud. Pure and allocation-light so WorldDO can run it every few ticks.
import { CHAT_RADIUS_M } from '@gtasf/shared/chat/constants';
import { VOICE_PEERS_MAX } from '@gtasf/shared/protocol/constants';
import type { VoicePeer } from '@gtasf/shared/protocol/types';

/** Full volume inside this radius, then a linear fade to silence at CHAT_RADIUS_M (40 m). */
export const VOICE_FULL_M = 10;
export const VOICE_FADE_M = CHAT_RADIUS_M;
/** Event rooms carry everyone in the room at slightly below full volume. */
export const VOICE_EVENT_GAIN = 0.8;

export interface VoiceTrack { sessionId: string; trackName: string }
export interface VoicePlayer {
  id: number;
  /** World position in centimetres (wire pose units). */
  x: number; y: number; z: number;
  /** Occupied vehicle id (driver or passenger); 0 when on foot. */
  vehicleId: number;
  /** Current event room (chatEventId); 0 when not inside one. */
  eventId: number;
  /** The authorised track this player is publishing, if they are speaking. */
  track?: VoiceTrack;
}

/** Gain 0..1 that `listener` hears `speaker` at; 0 means not audible. */
export function voiceGain(listener: VoicePlayer, speaker: VoicePlayer): number {
  let gain = 0;
  if (listener.vehicleId && listener.vehicleId === speaker.vehicleId) gain = 1;
  if (listener.eventId && listener.eventId === speaker.eventId) gain = Math.max(gain, VOICE_EVENT_GAIN);
  const metres = Math.hypot(listener.x - speaker.x, listener.y - speaker.y, listener.z - speaker.z) / 100;
  if (metres <= VOICE_FULL_M) gain = 1;
  else if (metres < VOICE_FADE_M) gain = Math.max(gain, (VOICE_FADE_M - metres) / (VOICE_FADE_M - VOICE_FULL_M));
  return gain;
}

/**
 * Every listener's audible peers: loudest first, at most VOICE_PEERS_MAX, never themselves, never a
 * speaker they muted, never a silent (gain byte 0) track.
 */
export function voicePeers(players: readonly VoicePlayer[], mutes: ReadonlyMap<number, ReadonlySet<number>>): Map<number, VoicePeer[]> {
  const speakers = players.filter(player => player.track);
  const result = new Map<number, VoicePeer[]>();
  for (const listener of players) {
    const muted = mutes.get(listener.id), peers: VoicePeer[] = [];
    for (const speaker of speakers) {
      if (speaker.id === listener.id || muted?.has(speaker.id)) continue;
      const gain = Math.round(voiceGain(listener, speaker) * 255);
      if (gain > 0) peers.push({ playerId: speaker.id, sessionId: speaker.track!.sessionId, trackName: speaker.track!.trackName, gain });
    }
    peers.sort((a, b) => b.gain - a.gain || a.playerId - b.playerId);
    result.set(listener.id, peers.slice(0, VOICE_PEERS_MAX));
  }
  return result;
}

/** Same set and the same gains to within a small step, so a slow walk does not resend every tick. */
export function samePeers(a: readonly VoicePeer[] | undefined, b: readonly VoicePeer[], gainStep = 8): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((peer, i) => peer.playerId === b[i]!.playerId && peer.sessionId === b[i]!.sessionId
    && peer.trackName === b[i]!.trackName && Math.abs(peer.gain - b[i]!.gain) < gainStep);
}

/** Per-world voice state: who is publishing, who muted whom, and what each listener was last sent. */
export class WorldVoice {
  private readonly tracks = new Map<number, VoiceTrack>();
  private readonly mutes = new Map<number, Set<number>>();
  private readonly sent = new Map<number, VoicePeer[]>();
  publish(playerId: number, track: VoiceTrack): void { this.tracks.set(playerId, track); }
  stop(playerId: number): boolean { return this.tracks.delete(playerId); }
  speaking(playerId: number): boolean { return this.tracks.has(playerId); }
  /** Current publishers, for the periodic ban re-check. */
  active(): Array<[number, VoiceTrack]> { return [...this.tracks]; }
  mute(listenerId: number, target: number, muted: boolean): void {
    if (listenerId === target) return;
    const set = this.mutes.get(listenerId) ?? new Set<number>();
    if (muted) set.add(target); else set.delete(target);
    if (set.size) this.mutes.set(listenerId, set); else this.mutes.delete(listenerId);
  }
  /** A player left the world: forget their track, their mutes, and what they were sent. */
  remove(playerId: number): void { this.tracks.delete(playerId); this.mutes.delete(playerId); this.sent.delete(playerId); }
  /**
   * Recompute hearing for the current world and return only the listeners whose peer set changed.
   * Positions/vehicles/rooms come from WorldDO; the track comes from this state.
   */
  update(players: readonly Omit<VoicePlayer, 'track'>[]): Array<[number, VoicePeer[]]> {
    const all = players.map(player => ({ ...player, track: this.tracks.get(player.id) }));
    const changed: Array<[number, VoicePeer[]]> = [];
    for (const [listener, peers] of voicePeers(all, this.mutes)) {
      if (samePeers(this.sent.get(listener), peers)) continue;
      // Nothing to say to a listener who has never heard anyone and still hears no one.
      if (!peers.length && !this.sent.get(listener)?.length) { this.sent.set(listener, peers); continue; }
      this.sent.set(listener, peers); changed.push([listener, peers]);
    }
    return changed;
  }
}
