import { analyticsContext, confirmAnalyticsPlay } from '../analytics';
import { flags } from '@gtasf/shared/flags';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { CloseCode, PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import { validResumeToken } from '@gtasf/shared/protocol/fields';
import { normalizeNickname } from '@gtasf/shared/protocol/nickname';
import { validPose } from '@gtasf/shared/protocol/pose';
import { SF_ZONE_GRID, inGrid, type Cell } from '@gtasf/shared/world/zones';
import type { C2SMessage, Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import { createSyncedClock } from './clock';
import { ADMISSION_PROTOCOL_PREFIX } from '@gtasf/shared/admission';
import { admissionConsumed, invalidateAdmission, waitForAdmission } from '../admission/client';

type Command = Exclude<C2SMessage, { type: 'HELLO' | 'MOVE' | 'PING' }>;
const TOKEN_KEY = 'gtasf.world.v2.resume';
function storedToken(): string | undefined {
  try { const value = sessionStorage.getItem(TOKEN_KEY); return value && validResumeToken(value) ? value : undefined; }
  catch { return undefined; }
}
function rememberToken(token: string | undefined): void {
  try { if (token) sessionStorage.setItem(TOKEN_KEY, token); else sessionStorage.removeItem(TOKEN_KEY); }
  catch { /* Private browsing/storage denial still supports reconnect within this connection. */ }
}
function commandEnabled(message: Command): boolean {
  switch (message.type) {
    case 'CHAT': return flags.chat && (message.eventId === 0 || flags.eventChat);
    case 'VEHICLE_ENTER': return flags.driving || flags.cableCars;
    case 'VEHICLE_MOVE': return flags.driving;
    case 'VEHICLE_EXIT': return flags.driving || flags.robotaxi || flags.cableCars;
    case 'ROBOTAXI_QUOTE': case 'ROBOTAXI_READY': return flags.robotaxi && flags.quickRobotaxi;
    case 'ROBOTAXI_HAIL': case 'ROBOTAXI_CANCEL': return flags.robotaxi;
    case 'ROAD_RESPAWN': return flags.roadRespawn;
    case 'EVENT_JOIN': case 'EVENT_LEAVE': return flags.eventVisits || (flags.chat && flags.eventChat);
    case 'ACTIVITY': return flags.worldCapacity;
    case 'ANALYTICS': return flags.posthogAnalytics || flags.xAdsPixel;
    case 'SET_APPEARANCE': return flags.characterLooks || flags.personalRides;
    case 'MAYHEM_FIRE': return flags.playfulMayhem;
    case 'COMBAT_FIRE': return flags.combat && flags.weapons && flags.serverHits;
    case 'COMBAT_READY': return flags.combat && flags.serverHits; // PvP opt-in signal; only matters with server hits
    case 'VEHICLE_CRASH': return flags.combat && flags.vehicleDamage; // own-car crash report
    case 'PED_PUNCH': return flags.combat && flags.pedMelee; // a ped who fought back hit me (self-damage)
    case 'KERB_CAR_TAKE': return flags.driving && flags.kerbCarTheft; // steal a kerb-parked car
    case 'OPENING_CAR': return flags.driving && flags.openingDrive; // the new player's opening car
    case 'COMBAT_CRIME': return flags.combat && flags.wanted && flags.streetCrimeWanted; // ped-kill confession
    case 'VOICE_PUBLISH': case 'VOICE_STOP': case 'VOICE_MUTE': return flags.proximityVoice;
  }
}

/** Each callback is fenced to its transport. A duplicated tab gets its own anonymous session. */
/** gtasf-j7wvv: what this client sent in the last 2 s, by type — a 'server: message budget exceeded' (4004) close or a
 *  sustained flood then names the sender in the console (the server allows a 60-frame burst, 30/s refill). */
const sentLog: { t: number; type: string }[] = [];
let floodWarnAt = -Infinity;
function sentHistogram(): string {
  const counts = new Map<string, number>();
  for (const entry of sentLog) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([type, n]) => `${type} ${n}`).join(', ');
}
function sendFrame(target: WebSocket, message: Parameters<typeof encodeC2S>[0]): void {
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  sentLog.push({ t, type: message.type });
  while (sentLog.length && t - sentLog[0]!.t > 2000) sentLog.shift();
  if (sentLog.length > 50 && t - floodWarnAt > 10_000) { floodWarnAt = t; console.warn(`[net] sent ${sentLog.length} frames in 2 s: ${sentHistogram()}`); }
  target.send(encodeC2S(message));
}

export function connectWorld(options: { name: string; spawn?: Pose; zone?: Cell; resumeToken?: string; handoffRejected?(): void; message(m: S2CMessage): void; status(text: string): void;
  /** gtasf-j7wvv netBeacon: a live session's socket closed unexpectedly (close code, ms it had been up) / any WELCOME. */
  dropped?(code: number, upMs: number): void; welcomed?(): void }) {
  const clock = createSyncedClock(), name = normalizeNickname(options.name);
  let socket: WebSocket | undefined, disposed = false, ready = false, readyAt = 0, attempts = 0, seq = 0, nonce = 0;
  // A PROTOCOL close (4004) used to strand the player until a manual reload. QA saw it mid-session on #6.17 right
  // after a respawn, so retry a few times (with the normal backoff) before giving up, and say why. [gtasf-qa]
  let protocolRetries = 0;
  const PROTOCOL_RETRIES = 3;
  const protocolClose = (current: WebSocket, reason: string, detail = '') => {
    console.warn(`[net] world socket protocol close: ${reason}${detail ? ` (${detail})` : ''}`);
    current.close(CloseCode.PROTOCOL, reason);
  };
  let token = flags.zonedWorld && options.resumeToken && validResumeToken(options.resumeToken) ? options.resumeToken : storedToken();
  let initialSpawn = flags.deepLinkSpawns && options.spawn && validPose(options.spawn) ? options.spawn : undefined;
  let lastPose: Pose | undefined = initialSpawn;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let handshake: ReturnType<typeof setTimeout> | undefined;
  // Server state pushed during the join (a restored WANTED level, pickup state) can land just BEFORE the WELCOME.
  // Hold it and replay it after the WELCOME reset instead of closing the socket: closing locked wanted players out
  // in a reconnect loop (the server re-stashed their heat on every close). [gtasf-awnin]
  let early: S2CMessage[] = [];
  const EARLY_MAX = 16;
  let lastActivity = -Infinity, connectionGeneration = 0;
  let handingOff = false;
  const pings = new Map<number, { sent: number; clientT: number }>();
  function connect(requireInput = false) {
    if (disposed || !flags.multiplayer) return;
    if (!name) { options.status('Choose a valid nickname'); return; }
    const attempt = ++connectionGeneration;
    if (flags.worldCapacity) {
      options.status(requireInput ? 'Inactive — rejoin when ready' : 'Joining the city');
      void waitForAdmission({ requireInput }).then(grant => { if (!disposed && attempt === connectionGeneration) open(grant); });
    } else open();
  }
  function open(grant?: string) {
    if (!name) return;
    const url = new URL('/api/world', location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if (initialSpawn) url.searchParams.set('spawn', [initialSpawn.x, initialSpawn.y, initialSpawn.z, initialSpawn.yaw].join(','));
    if (flags.zonedWorld && options.zone && inGrid(SF_ZONE_GRID, options.zone.cx, options.zone.cy))
      url.searchParams.set('zone', `${options.zone.cx},${options.zone.cy}`);
    // This build understands CHAT_SPOKEN (spoken bubbles); the server sends it only to clients that say so (gtasf-6ef9).
    url.searchParams.set('caps', 'spoken');
    const current = new WebSocket(url, grant ? [PROTOCOL_SUBPROTOCOL, `${ADMISSION_PROTOCOL_PREFIX}${grant}`] : PROTOCOL_SUBPROTOCOL);
    socket = current; current.binaryType = 'arraybuffer';
    const active = () => !disposed && socket === current;
    options.status('Connecting');
    handshake = setTimeout(() => { if (active() && !ready) current.close(4000, 'Handshake timeout'); }, 10_000);
    current.onopen = () => {
      if (!active()) return;
      const analytics = analyticsContext();
      sendFrame(current, ({ type: 'HELLO', name, ...(token ? { resumeToken: token } : {}), ...(analytics ? { analytics } : {}) }));
    };
    current.onmessage = event => {
      if (!active()) return;
      if (!(event.data instanceof ArrayBuffer)) { protocolClose(current, 'Binary required', typeof event.data === 'string' ? event.data.slice(0, 80) : typeof event.data); return; }
      const decoded = decodeS2C(new Uint8Array(event.data));
      // A message type this build doesn't know (a newer server, e.g. CHAT_SPOKEN) is skipped, not fatal, so future
      // opcodes can't disconnect players on an older tab. Malformed frames still close. [gtasf-6ef9]
      if (!decoded.ok && decoded.err === 'UNKNOWN_TYPE') return;
      if (!decoded.ok) { const bytes = new Uint8Array(event.data); protocolClose(current, 'Invalid server frame', `${decoded.err} op=0x${(bytes[0] ?? 0).toString(16)} len=${bytes.length}`); return; }
      const m = decoded.msg;
      if (m.type === 'ZONE_HANDOFF' && flags.zonedWorld) handingOff = true;
      if (m.type === 'WELCOME') {
        if (ready) { protocolClose(current, 'Repeated welcome'); return; }
        clearTimeout(handshake);
        admissionConsumed(); lastActivity = -Infinity;
        token = m.resumeToken; rememberToken(token); seq = m.lastMoveSeq;
        initialSpawn = undefined;
        ready = true; readyAt = performance.now(); attempts = 0; protocolRetries = 0; clock.welcome(m.serverT); options.status('Connected');
        options.welcomed?.();
        confirmAnalyticsPlay();
        sendAnalytics();
      } else if (!ready) {
        if (early.length >= EARLY_MAX) { protocolClose(current, 'Welcome required', `${early.length} early frames`); return; }
        early.push(m); return;
      }
      if (m.type === 'WELCOME' || m.type === 'CORRECTION' || (m.type === 'ROBOTAXI_STATE' && m.state === 'riding')) lastPose = { ...m.pose };
      if (m.type === 'PONG') {
        const ping = pings.get(m.nonce); pings.delete(m.nonce);
        if (!ping) clock.rejectPong('nonce');
        else if (ping.clientT !== m.clientT) clock.rejectPong('echo');
        else clock.pong(m.serverT, ping.sent, clock.monotonicMs());
      }
      options.message(m);
      // Existing renderers already consume corrections. Restore feet after their WELCOME reset.
      if (m.type === 'WELCOME') {
        options.message({ type: 'CORRECTION', pose: m.pose });
        const held = early; early = [];
        for (const message of held) options.message(message);
      }
    };
    current.onclose = event => {
      if (!active()) return;
      // gtasf-j7wvv: the server's own closes carry 'server: <cause>' (e.g. message budget, bad frame); log any
      // non-normal close so a soak/QA console says WHICH side closed and why.
      if (event.code !== 1000 && event.code !== CloseCode.SUPERSEDED) console.warn(`[net] world socket closed ${event.code}${event.reason ? `: ${event.reason}` : ''}${event.code === CloseCode.PROTOCOL ? ` · sent in the last 2 s: ${sentHistogram() || 'nothing'}` : ''}`);
      const wasLive = ready && performance.now() - readyAt >= 5000; // up a while: not a crash-on-join loop
      // netBeacon: count unexpected closes of a session that was in (not deliberate ones: normal, superseded, idle, handoff).
      if (ready && !handingOff && event.code !== 1000 && event.code !== CloseCode.SUPERSEDED && event.code !== CloseCode.INPUT_IDLE) options.dropped?.(event.code, performance.now() - readyAt);
      ready = false; socket = undefined; clearTimeout(handshake); clock.reset(); pings.clear(); early = [];
      invalidateAdmission();
      // Destination claim closes the source before WELCOME. Preserve its token until the wrapper
      // either promotes the destination or explicitly resumes this source after a rejected claim.
      if (handingOff) return;
      if (event.code === CloseCode.BAD_RESUME && options.handoffRejected) { options.handoffRejected(); return; }
      if (event.code === CloseCode.SUPERSEDED) {
        // Duplicate Tab may copy sessionStorage. Never fight to reclaim that token: join beside it.
        token = undefined; rememberToken(undefined);
        initialSpawn = flags.deepLinkSpawns && lastPose ? { ...lastPose, flags: 0 } : undefined;
      }
      if (event.code === CloseCode.PROTOCOL && protocolRetries < PROTOCOL_RETRIES) {
        protocolRetries++; options.status('Reconnecting'); clearTimeout(retry);
        retry = setTimeout(() => connect(), Math.min(10_000, 500 * 2 ** Math.min(attempts++, 5)) + Math.random() * 250);
        return;
      }
      if (event.code === CloseCode.BAD_HELLO || event.code === CloseCode.PROTOCOL || event.code === 1002) {
        options.status('Connection rejected; reload to reconnect'); return;
      }
      if (event.code === CloseCode.BAD_RESUME) { token = undefined; rememberToken(undefined); }
      if (event.code === CloseCode.INPUT_IDLE) { connect(true); return; }
      options.status('Reconnecting');
      clearTimeout(retry);
      // gtasf-j7wvv: the edge ends live sockets with a bare TLS close_notify (no WS close frame → 1006); the first
      // retry after a socket that was up >= 5 s goes out at once (jittered); the backoff applies from the second.
      const delay = wasLive ? 100 : Math.min(10_000, 500 * 2 ** Math.min(attempts, 5));
      attempts++;
      retry = setTimeout(() => connect(), delay + Math.random() * 250);
    };
    current.onerror = () => { if (active()) current.close(4000, 'Transport error'); };
  }
  const pingTimer = setInterval(() => {
    if (!ready || socket?.readyState !== WebSocket.OPEN) return;
    const clientT = clock.localMonotonicEpochMs(); nonce = (nonce + 1) >>> 0;
    if (pings.size >= 8) pings.delete(pings.keys().next().value!);
    pings.set(nonce, { sent: clock.monotonicMs(), clientT });
    sendFrame(socket, ({ type: 'PING', nonce, clientT }));
  }, 2000);
  function activity() {
    const now = performance.now();
    if (!flags.worldCapacity || !ready || socket?.readyState !== WebSocket.OPEN || now - lastActivity < 5000) return;
    lastActivity = now; sendFrame(socket, ({ type: 'ACTIVITY' }));
  }
  function sendAnalytics(event?: Event) {
    if ((!flags.posthogAnalytics && !flags.xAdsPixel) || !ready || socket?.readyState !== WebSocket.OPEN) return;
    const analytics = analyticsContext();
    if (!analytics && event?.type !== 'gtasf:analytics-revoked') return;
    sendFrame(socket, ({ type: 'ANALYTICS', ...(analytics ? { analytics } : {}) }));
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('gtasf:analytics-ready', sendAnalytics);
    window.addEventListener('gtasf:analytics-revoked', sendAnalytics);
  }
  const inputActivity = (event: Event) => { if (event.isTrusted) activity(); };
  const activityEvents = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const;
  if (typeof window !== 'undefined') for (const event of activityEvents) window.addEventListener(event, inputActivity, { passive: true });
  connect();
  return {
    clock, activity,
    reconnect() {
      handingOff = false;
      if (!disposed && !ready && !socket) { clearTimeout(retry); connect(); }
    },
    move(pose: Pose) {
      if (ready && socket?.readyState === WebSocket.OPEN) {
        sendFrame(socket, ({ type: 'MOVE', seq: seq = (seq + 1) & 65535, ...pose })); lastPose = { ...pose };
      }
    },
    send(message: Command): boolean {
      if (!ready || socket?.readyState !== WebSocket.OPEN || !commandEnabled(message)) return false;
      sendFrame(socket, (message));
      if (message.type === 'VEHICLE_MOVE') lastPose = { x: message.x, y: message.y, z: message.z, yaw: message.yaw, flags: message.flags };
      return true;
    },
    dispose() {
      disposed = true; ready = false; clearInterval(pingTimer); clearTimeout(retry); clearTimeout(handshake);
      connectionGeneration++;
      if (typeof window !== 'undefined') {
        window.removeEventListener('gtasf:analytics-ready', sendAnalytics);
        window.removeEventListener('gtasf:analytics-revoked', sendAnalytics);
      }
      if (typeof window !== 'undefined') for (const event of activityEvents) window.removeEventListener(event, inputActivity);
      socket?.close(1000); socket = undefined; clock.dispose();
    },
  };
}
