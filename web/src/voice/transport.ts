import type { VoicePeer } from '@gtasf/shared/protocol/types';
import { VOICE_GATE_HEADER } from './gate';

interface TrackInfo { mid?: string; sessionId?: string; trackName?: string; errorCode?: string }
interface Reply { sessionId?: string; sessionDescription?: RTCSessionDescriptionInit; tracks?: TrackInfo[]; errorCode?: string }
interface Session { id: string; pc: RTCPeerConnection; mids: Set<string> }
class VoiceRequestError extends Error { constructor(message: string, readonly code?: string) { super(message); } }
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const peerKey = (peer: VoicePeer) => `${peer.sessionId}/${peer.trackName}`;

/** Separate publisher/listener sessions avoid SDP glare. All mutations within a session are serial.
 * Negotiation follows https://developers.cloudflare.com/realtime/sfu/concepts/negotiation/ . */
export function createVoiceTransport(options: { onTrack(id: number, track: MediaStreamTrack): void; onError(message: string): void }) {
  let disposed = false, ready = false, iceServers: RTCIceServer[] = [], publisher: Session | undefined, receiver: Session | undefined;
  let sender: RTCRtpSender | undefined, publication: { sessionId: string; trackName: string } | undefined;
  let publishQueue: Promise<unknown> = Promise.resolve(), receiving = false;
  let revision = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined, subscriptionRetries = 0;
  const desired = new Map<number, VoicePeer>();
  const subscribed = new Map<number, { key: string; mid: string; track?: MediaStreamTrack }>();
  const requests = new Set<AbortController>();
  const sessions = new Set<Session>();

  async function request<T>(path: string, method = 'POST', body?: unknown): Promise<T> {
    if (disposed) throw new Error('Voice is off.');
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/voice/${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { [VOICE_GATE_HEADER]: '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = await response.json() as { error?: string; errorCode?: string };
      if (!response.ok || value.errorCode) {
        const message: Record<string, string> = { unconfigured: 'Voice is not available on this server yet.',
          unverified: 'Verify your email in Game options to talk. You can still listen.', banned: 'Your voice access is temporarily restricted.',
          rate: 'Voice is busy. Wait a moment before trying again.' };
        throw new VoiceRequestError(message[value.error ?? ''] ?? 'Voice could not connect. Turn it off and on to retry.', value.error);
      }
      return value as T;
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  function waitFor(pc: RTCPeerConnection, kind: 'ice' | 'connected') {
    return new Promise<void>((resolve, reject) => {
      const event = kind === 'ice' ? 'icegatheringstatechange' : 'connectionstatechange';
      // ICE gathering can stall for ages (blocked STUN/UDP, extra interfaces). The SFU learns our address from
      // connectivity checks, so after a 1 s cap (host candidates arrive in ms) send whatever candidates exist instead of failing (gtasf-ws4j).
      const timeout = kind === 'ice' ? setTimeout(() => finish(), 1_000)
        : setTimeout(() => finish(new Error('Voice connection timed out. Turn it off and on to retry.')), 12_000);
      function finish(error?: Error) { clearTimeout(timeout); pc.removeEventListener(event, check); pc.removeEventListener('connectionstatechange', check); error ? reject(error) : resolve(); }
      function check() {
        if (disposed || pc.connectionState === 'closed' || pc.connectionState === 'failed') finish(new Error('Voice connection closed.'));
        else if (kind === 'ice' ? pc.iceGatheringState === 'complete' : pc.connectionState === 'connected') finish();
      }
      pc.addEventListener(event, check); pc.addEventListener('connectionstatechange', check); check();
    });
  }
  async function session(): Promise<Session> {
    const result = await request<Reply>('sessions/new');
    if (disposed || !validId(result.sessionId)) throw new Error('Voice session unavailable.');
    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
    pc.addEventListener('connectionstatechange', () => {
      if (!disposed && pc.connectionState === 'failed') options.onError('Voice connection failed. Enable voice again to retry.');
    });
    const created: Session = { id: result.sessionId, pc, mids: new Set() };
    sessions.add(created); return created;
  }
  async function negotiate(target: Session, reply: Reply) {
    if (!reply.sessionDescription) return;
    await target.pc.setRemoteDescription(reply.sessionDescription);
    if (reply.sessionDescription.type === 'offer') {
      await target.pc.setLocalDescription(await target.pc.createAnswer());
      await waitFor(target.pc, 'ice');
      await request(`sessions/${target.id}/renegotiate`, 'PUT', { sessionDescription: target.pc.localDescription });
    }
  }
  async function publish(track: MediaStreamTrack) {
    if (disposed) throw new Error('Voice is off.');
    if (publication && sender) { await sender.replaceTrack(track); return publication; }
    publisher ??= await session();
    const transceiver = publisher.pc.addTransceiver(track, { direction: 'sendonly' }); sender = transceiver.sender;
    const opus = RTCRtpSender.getCapabilities?.('audio')?.codecs.filter(codec => codec.mimeType.toLowerCase() === 'audio/opus');
    if (opus?.length && transceiver.setCodecPreferences) transceiver.setCodecPreferences(opus);
    await publisher.pc.setLocalDescription(await publisher.pc.createOffer());
    await waitFor(publisher.pc, 'ice');
    const trackName = `mic_${crypto.randomUUID().replaceAll('-', '')}`;
    const reply = await request<Reply>(`sessions/${publisher.id}/tracks/new`, 'POST', {
      sessionDescription: publisher.pc.localDescription, tracks: [{ location: 'local', mid: transceiver.mid, trackName }] });
    if (reply.tracks?.some(info => info.errorCode)) throw new Error('Microphone could not connect. Turn voice off and on to retry.');
    if (transceiver.mid !== null) publisher.mids.add(transceiver.mid);
    await negotiate(publisher, reply); await waitFor(publisher.pc, 'connected');
    publication = { sessionId: publisher.id, trackName }; return publication;
  }
  function closeSession(target: Session) {
    if (!sessions.delete(target)) return;
    target.pc.close();
    if (target.mids.size) void fetch(`/api/voice/sessions/${target.id}/tracks/close`, { method: 'PUT', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json', [VOICE_GATE_HEADER]: '1' }, body: JSON.stringify({ force: true, tracks: [...target.mids].map(mid => ({ mid })) }) }).catch(() => {});
  }
  function retrySubscriptions() {
    if (disposed || retryTimer !== undefined) return;
    // An unchanged peer set will not trigger setPeers again. Never leave a failed subscription
    // silently stuck in "Listening" after the grant or SFU-track retry budget is exhausted.
    if (subscriptionRetries >= 3) throw new Error('Nearby voice could not connect. Enable voice again in Game options to retry.');
    const delay = 400 * 2 ** subscriptionRetries++;
    retryTimer = setTimeout(() => { retryTimer = undefined; if (!disposed) void reconcile(); }, delay);
  }
  async function reconcile() {
    if (receiving || disposed || !ready) return;
    receiving = true;
    try {
      let handled = -1;
      while (!disposed && handled !== revision) {
        handled = revision;
        if (!receiver && desired.size === 0) break;
        if (!receiver) {
          receiver = await session();
          receiver.pc.addEventListener('track', event => {
            for (const [id, sub] of subscribed) if (sub.mid === event.transceiver.mid) {
              sub.track = event.track;
              if (!disposed && desired.has(id) && peerKey(desired.get(id)!) === sub.key) options.onTrack(id, event.track);
              return;
            }
          });
        }
        const removed: { mid: string }[] = [];
        for (const [id, sub] of subscribed) if (!desired.has(id) || peerKey(desired.get(id)!) !== sub.key) {
          sub.track?.stop(); removed.push({ mid: sub.mid }); subscribed.delete(id); receiver.mids.delete(sub.mid);
        }
        if (removed.length) await negotiate(receiver, await request<Reply>(`sessions/${receiver.id}/tracks/close`, 'PUT', { tracks: removed, force: true }));
        const additions = [...desired.values()].filter(peer => !subscribed.has(peer.playerId));
        if (!additions.length) continue;
        let reply: Reply;
        try {
          reply = await request<Reply>(`sessions/${receiver.id}/tracks/new`, 'POST', {
            tracks: additions.map(peer => ({ location: 'remote', sessionId: peer.sessionId, trackName: peer.trackName })) });
        } catch (error) {
          // A speaker can leave hearing range while this request is in flight. Keep other audio alive.
          if (!(error instanceof VoiceRequestError) || error.code !== 'not-audible') throw error;
          if (handled !== revision) continue;
          retrySubscriptions();
          break;
        }
        let missing = false;
        for (const peer of additions) {
          const info = reply.tracks?.find(value => value.sessionId === peer.sessionId && value.trackName === peer.trackName);
          if (!info?.mid || info.errorCode) { missing = true; continue; }
          subscribed.set(peer.playerId, { key: peerKey(peer), mid: info.mid }); receiver.mids.add(info.mid);
        }
        await negotiate(receiver, reply);
        if (missing && handled === revision) { retrySubscriptions(); break; }
        if (!missing) subscriptionRetries = 0;
      }
    } catch (error) {
      if (!disposed) options.onError(error instanceof Error ? error.message : 'Voice could not connect. Try again.');
    } finally { receiving = false; }
  }
  return {
    async start() {
      const result = await request<{ iceServers: RTCIceServer[] }>('ice', 'GET');
      if (!Array.isArray(result.iceServers)) throw new Error('Voice connection settings are unavailable.');
      iceServers = result.iceServers; ready = true; void reconcile();
    },
    publish(track: MediaStreamTrack) {
      const next = publishQueue.then(() => publish(track)).catch(error => {
        if (publisher) closeSession(publisher);
        publisher = undefined; sender = undefined; publication = undefined;
        throw error;
      });
      publishQueue = next.catch(() => {}); return next;
    },
    setPeers(peers: readonly VoicePeer[]) {
      if (disposed) return;
      const changed = desired.size !== peers.length || peers.some(peer => !desired.has(peer.playerId) || peerKey(desired.get(peer.playerId)!) !== peerKey(peer));
      if (!changed) return;
      subscriptionRetries = 0;
      if (retryTimer !== undefined) clearTimeout(retryTimer); retryTimer = undefined;
      desired.clear(); for (const peer of peers) desired.set(peer.playerId, peer);
      revision++; void reconcile();
    },
    destroy() {
      if (disposed) return; disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer); retryTimer = undefined;
      for (const controller of requests) controller.abort(); requests.clear();
      for (const target of sessions) closeSession(target);
      for (const sub of subscribed.values()) sub.track?.stop(); subscribed.clear(); desired.clear();
    },
  };
}
