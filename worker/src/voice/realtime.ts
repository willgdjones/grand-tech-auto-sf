/**
 * Proximity voice Realtime proxy (flag proximityVoice, docs/engineering/proximity-voice.md, gtasf-bdzy).
 * Mirrors Cloudflare Realtime's own paths and bodies (agreed with the client lane, /tmp contract):
 *   POST /api/voice/sessions/new
 *   POST /api/voice/sessions/{id}/tracks/new      (publishing a local track is gated)
 *   PUT  /api/voice/sessions/{id}/renegotiate
 *   PUT  /api/voice/sessions/{id}/tracks/close
 *   GET  /api/voice/ice                           -> { iceServers }
 *   POST /api/voice/report { sessionId }          -> { ok, banned }   (also POST /api/feedback {kind:'voice'})
 * Every route needs the gtasf_device cookie; a session id must belong to the calling device. The Realtime
 * app token never reaches the client. Without REALTIME_APP_ID/TOKEN every route answers 503 'unconfigured'.
 * No audio, transcript or recording is stored.
 */
import { countCaption, countVoice, countVoiceDevice } from './metrics';
import { flags } from '@gtasf/shared/flags';
import { VOICE_ID } from '@gtasf/shared/protocol/constants';
import type { Env } from '../env';
import { fundingDevice, fundingSameOrigin } from '../funding/identity';
import { referralRateLimit } from '../referrals/store';
import { attachReportCaptions, billableSeconds, CAPTION_MAX_BYTES, CAPTION_MAX_SECONDS, PITCH_MAX_BYTES, PITCH_MAX_SECONDS, type CaptionLine, captionDeviceBudget, captionIpBudget, reserveCaptionSeconds } from './captions';
import { worldInstanceName } from '../world/zoneRouting';
import { authoriseVoiceTracks, recordVoiceSession, voiceBanned, voiceIceBudget, reportVoice, voiceGranted, voicePublishGate, voiceSessionDevice } from './store';
import { hashedIpKey } from '../referrals/ipLimiter';

const REALTIME = 'https://rtc.live.cloudflare.com/v1';
/** Per-IP TURN minting cap across all devices behind one address (NAT/office-safe at 30 per 10 min). */
export const VOICE_ICE_IP_MAX = 30, VOICE_ICE_IP_WINDOW_MS = 600_000;
const STUN: RTCIceServerLike[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
type RTCIceServerLike = { urls: string | string[]; username?: string; credential?: string };
type Track = { location?: string; trackName?: string; sessionId?: string; mid?: string };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const REFUSAL: Record<string, [number, string]> = { 'refused-unverified': [403, 'unverified'], 'refused-banned': [403, 'banned'], 'refused-rate': [429, 'rate'] };

export async function handleVoiceRequest(request: Request, env: Env, upstream: typeof fetch = fetch, now = Date.now()): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith('/api/voice/')) return null;
  if (!flags.proximityVoice) return json({ error: 'off' }, 404);
  // Hidden launch gate: until voicePublic, only clients that opened the page with ?voice=1 (they send this header).
  if (!flags.voicePublic && request.headers.get('X-GTASF-Voice') !== '1') return json({ error: 'off' }, 404);
  if (request.method !== 'GET' && !fundingSameOrigin(request)) return json({ error: 'origin' }, 403);
  const deviceId = await fundingDevice(request, env.DB);
  if (!deviceId) return json({ error: 'device' }, 401);

  if (pathname === '/api/voice/report' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { sessionId?: unknown } | null;
    if (typeof body?.sessionId !== 'string' || !VOICE_ID.test(body.sessionId)) return json({ error: 'session' }, 400);
    const { target, ...result } = await reportVoice(env.DB, deviceId, body.sessionId, now);
    if (result.ok && target) await attachSpeakerCaptions(env, request, target, deviceId, now);
    return json(result);
  }
  // Spoken bubbles need no Realtime session: speech goes to ElevenLabs STT via the player's WorldDO (gtasf-qjja).
  if (pathname === '/api/voice/caption' && request.method === 'POST') return handleCaption(request, env, deviceId, now);
  if (!env.REALTIME_APP_ID || !env.REALTIME_APP_TOKEN) return json({ error: 'unconfigured' }, 503);
  const auth = { Authorization: `Bearer ${env.REALTIME_APP_TOKEN}`, 'Content-Type': 'application/json' };

  if (pathname === '/api/voice/ice' && request.method === 'GET') {
    if (!env.REALTIME_TURN_KEY_ID || !env.REALTIME_TURN_KEY_TOKEN) return json({ iceServers: STUN });
    // Short-lived TURN (ttl 1 h) is minted only for a device that opts in (the client asks once per enable), rate-limited.
    // Devices are free to mint (new cookie = new device), so also cap per client IP (review of c264968e).
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip && !await referralRateLimit(env.DB, await hashedIpKey('voice-ice-ip:', 'gtasf-voice-ice', ip, now, env.IP_HASH_SECRET), VOICE_ICE_IP_MAX, VOICE_ICE_IP_WINDOW_MS, now)) return json({ error: 'rate' }, 429); // gtasf-cnjpc
    if (!await voiceIceBudget(env.DB, deviceId, now)) return json({ error: 'rate' }, 429);
    const turn = await upstream(`${REALTIME}/turn/keys/${env.REALTIME_TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.REALTIME_TURN_KEY_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 3600 }),
    }).catch(() => null);
    const value = turn?.ok ? await turn.json().catch(() => null) as { iceServers?: RTCIceServerLike[] } | null : null;
    return json({ iceServers: value?.iceServers?.length ? value.iceServers : STUN });
  }

  if (pathname === '/api/voice/sessions/new' && request.method === 'POST') {
    // Realtime rejects '{}' (400 decoding_error: it then requires sessionDescription); an empty body creates a bare
    // session (201). The client's publisher/listener sessions are created bare (gtasf-ws4j live check).
    const body = await request.text();
    const response = await upstream(`${REALTIME}/apps/${env.REALTIME_APP_ID}/sessions/new`, { method: 'POST', headers: auth, ...(body.trim() && body.trim() !== '{}' ? { body } : {}) });
    const value = await response.json().catch(() => null) as { sessionId?: unknown } | null;
    if (!response.ok || typeof value?.sessionId !== 'string' || !VOICE_ID.test(value.sessionId)) return json({ error: 'upstream' }, 502);
    await recordVoiceSession(env.DB, value.sessionId, deviceId, now);
    // Voice metrics: a created Realtime session = this device turned proximity voice on today.
    await countVoice(env.DB, 'voice_session', 'created', now); await countVoiceDevice(env.DB, 'voice_optin', deviceId, now);
    return json(value);
  }

  const match = /^\/api\/voice\/sessions\/([A-Za-z0-9_-]{1,64})\/(tracks\/new|renegotiate|tracks\/close)$/.exec(pathname);
  if (!match) return json({ error: 'route' }, 404);
  const [, sessionId, action] = match as unknown as [string, string, string];
  const method = action === 'tracks/new' ? 'POST' : 'PUT';
  if (request.method !== method) return json({ error: 'method' }, 405);
  if (await voiceSessionDevice(env.DB, sessionId) !== deviceId) return json({ error: 'session' }, 403);
  const raw = await request.text();
  if (raw.length > 64_000) return json({ error: 'size' }, 413);

  let published: string[] = [];
  if (action === 'tracks/new') {
    const body = (() => { try { return JSON.parse(raw) as { tracks?: Track[] }; } catch { return null; } })();
    if (!body || !Array.isArray(body.tracks) || !body.tracks.length || body.tracks.length > 32) return json({ error: 'tracks' }, 400);
    published = body.tracks.filter(track => track?.location === 'local').map(track => String(track.trackName ?? ''));
    if (published.some(name => !VOICE_ID.test(name))) return json({ error: 'trackName' }, 400);
    // Listening is server-authoritative too: only tracks WorldDO currently grants this device (in range,
    // same vehicle/room, not muted, speaker not banned) may be subscribed.
    for (const track of body.tracks.filter(track => track?.location === 'remote')) {
      if (typeof track.sessionId !== 'string' || typeof track.trackName !== 'string'
        || !await voiceGranted(env.DB, deviceId, track.sessionId, track.trackName)) return json({ error: 'not-audible' }, 403);
    }
    if (published.length) {
      const state = await voicePublishGate(env.DB, deviceId, now, 'setup');
      await countVoice(env.DB, 'voice_publish', state, now);
      if (state === 'speaking') await countVoiceDevice(env.DB, 'verified_speaker', deviceId, now); // the gate requires a verified email
      if (state !== 'speaking') { const [status, error] = REFUSAL[state] ?? [403, 'off']; return json({ error }, status); }
    }
  }
  const response = await upstream(`${REALTIME}/apps/${env.REALTIME_APP_ID}/sessions/${sessionId}/${action}`, { method, headers: auth, body: raw });
  const text = await response.text();
  if (response.ok && published.length) await authoriseVoiceTracks(env.DB, sessionId, deviceId, published, now);
  return new Response(text, { status: response.ok ? 200 : 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/**
 * POST /api/voice/caption (flag voiceCaptions): body = the push-to-talk clip (<=160 KB), Content-Type = recorder
 * type, X-GTASF-Clip-Ms = client length. Gates: voice ban, size, per-IP + per-device budgets, the provider key, and
 * the $20/day meter (reserved BEFORE transcription). The player's WorldDO transcribes, reconciles billing, moderates
 * and broadcasts. Replies { status: 'sent'|'empty'|'rejected' } or { error }.
 */
/** On a voice report, store the reported speaker's last ~2 min of approved captions with it (only time a transcript
 *  is kept; deleted after 7 days). Best effort: a report never fails because the ring could not be read. */
async function attachSpeakerCaptions(env: Env, request: Request, target: string, reporter: string, now: number): Promise<void> {
  if (!flags.voiceCaptions || !env.WORLD) return;
  try {
    const world = env.WORLD.get(env.WORLD.idFromName(worldInstanceName(new URL(request.url), flags.zonedWorld)));
    const response = await world.fetch(`https://world/internal/voice/caption-ring?device=${encodeURIComponent(target)}`);
    const value = await response.json().catch(() => null) as { lines?: CaptionLine[] } | null;
    if (Array.isArray(value?.lines)) await attachReportCaptions(env.DB, target, reporter, value.lines, now);
  } catch (error) { console.warn('Report caption attach failed', error instanceof Error ? error.message : 'unknown'); }
}

async function handleCaption(request: Request, env: Env, deviceId: string, now: number): Promise<Response> {
  if (!flags.voiceCaptions) return json({ error: 'off' }, 404);
  if (await voiceBanned(env.DB, deviceId, now)) { await countCaption(env.DB, 'refused-banned', deviceId, now); return json({ error: 'banned' }, 403); }
  // A pitch clip (client sends X-GTASF-Pitch near an angel/VC) may run longer; it is billed on the same daily meter,
  // and the DO still only judges it if the speaker is actually next to an investor.
  const pitch = flags.pitching && request.headers.get('X-GTASF-Pitch') === '1';
  const maxBytes = pitch ? PITCH_MAX_BYTES : CAPTION_MAX_BYTES, maxSeconds = pitch ? PITCH_MAX_SECONDS : CAPTION_MAX_SECONDS;
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > maxBytes) return json({ error: 'too-large' }, 413);
  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return json({ error: 'empty' }, 400);
  if (audio.byteLength > maxBytes) return json({ error: 'too-large' }, 413);
  const ip = request.headers.get('CF-Connecting-IP');
  // STT is Workers AI Whisper (AI binding); the ElevenLabs key is only a dormant fallback (founder, Oct 6). Checked
  // before the budgets so a misconfigured server doesn't spend players' rate-limit credits.
  if (!env.AI && !env.ELEVENLABS_API_KEY?.trim()) return json({ error: 'unconfigured' }, 503);
  if ((ip && !await captionIpBudget(env.DB, ip, now, env.IP_HASH_SECRET)) || !await captionDeviceBudget(env.DB, deviceId, now)) {
    await countCaption(env.DB, 'refused-budget', deviceId, now); return json({ error: 'rate' }, 429);
  }
  const reserved = billableSeconds(Number(request.headers.get('X-GTASF-Clip-Ms')) / 1000, audio.byteLength, maxSeconds);
  if (!await reserveCaptionSeconds(env.DB, reserved, now)) { await countCaption(env.DB, 'refused-budget', deviceId, now); return json({ error: 'captions-paused' }, 503); }
  const world = env.WORLD.get(env.WORLD.idFromName(worldInstanceName(new URL(request.url), flags.zonedWorld)));
  return world.fetch('https://world/internal/voice/caption', { method: 'POST', body: audio, headers: {
    'Content-Type': request.headers.get('Content-Type') || 'audio/webm', 'X-GTASF-Device': deviceId, 'X-GTASF-Reserved': String(reserved),
    // Which of this device's tabs is speaking (two tabs share one device id); the DO only honours it for that device.
    'X-GTASF-Player': /^\d{1,10}$/.test(request.headers.get('X-GTASF-Player') ?? '') ? request.headers.get('X-GTASF-Player')! : '' } });
}

/**
 * The proximity-voice doc routes nameplate reports through the existing feedback endpoint:
 * POST /api/feedback { kind: 'voice', sessionId, text? } -> { ok: true, kind: 'voice', banned } (or an error).
 * Answers explicitly with kind 'voice' so a generic feedback handler can never appear to accept a safety
 * report. Free text is not stored (no voice content is kept). Returns null for any other feedback.
 */
export async function handleVoiceFeedback(request: Request, env: Env, now = Date.now()): Promise<Response | null> {
  if (!flags.proximityVoice || request.method !== 'POST' || new URL(request.url).pathname !== '/api/feedback') return null;
  if (!flags.voicePublic && request.headers.get('X-GTASF-Voice') !== '1') return null; // hidden launch gate
  const body = await request.clone().json().catch(() => null) as { kind?: unknown; sessionId?: unknown } | null;
  if (body?.kind !== 'voice') return null;
  if (!fundingSameOrigin(request)) return json({ ok: false, kind: 'voice', error: 'origin' }, 403);
  const deviceId = await fundingDevice(request, env.DB);
  if (!deviceId) return json({ ok: false, kind: 'voice', error: 'device' }, 401);
  if (typeof body.sessionId !== 'string' || !VOICE_ID.test(body.sessionId)) return json({ ok: false, kind: 'voice', error: 'session' }, 400);
  const result = await reportVoice(env.DB, deviceId, body.sessionId, now);
  if (result.ok && result.target) await attachSpeakerCaptions(env, request, result.target, deviceId, now);
  return result.ok ? json({ ok: true, kind: 'voice', banned: result.banned }) : json({ ok: false, kind: 'voice', error: 'target' }, 400);
}
