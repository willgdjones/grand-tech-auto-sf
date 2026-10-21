import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { handleVoiceFeedback, handleVoiceRequest } from './realtime';
import { authoriseVoiceTracks, recordVoiceSession, setVoiceGrants, reportVoice, voicePublishGate, voiceTrackState, VOICE_BAN_MS, VOICE_PUBLISH_BURST, VOICE_PUBLISH_REFILL_MS } from './store';
import { hashToken } from '../funding/identity';
import { flags } from '@gtasf/shared/flags';

// A mutable copy of the real flags so one test can turn on pitching (15 s pitch clips); all values unchanged otherwise.
vi.mock('@gtasf/shared/flags', async importOriginal => ({ flags: { ...(await importOriginal<typeof import('@gtasf/shared/flags')>()).flags } }));

const MIGRATIONS = ['0011_referrals.sql', '0010_funding.sql', '0029_email_capture.sql', '0034_voice.sql', '0038_voice_captions.sql'];
function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) sqlite.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
  const prepare = (sql: string) => {
    const statement = sqlite.prepare(sql); let bindings: (string | number | null)[] = [];
    const wrapper = {
      bind(...values: (string | number | null)[]) { bindings = values; return wrapper; },
      async first() { return statement.get(...bindings) ?? null; },
      async all() { return { results: statement.all(...bindings), success: true }; },
      async run() { return { meta: statement.run(...bindings), success: true }; },
    };
    return wrapper;
  };
  const db = { prepare, async batch(list: { run(): Promise<unknown> }[]) { const out = []; for (const s of list) out.push(await s.run()); return out; } } as unknown as D1Database;
  return { sqlite, db };
}
const verify = (sqlite: DatabaseSync, device: string) =>
  sqlite.prepare('INSERT INTO email_captures(device_id,email,email_hash,verified_at,created_at) VALUES(?,?,?,?,?)').run(device, 'x', 'h-' + device, 1, 1);

describe('voice publish gate', () => {
  it('needs a verified email, refuses banned speakers, and rate-limits push-to-talk', async () => {
    const { sqlite, db } = freshDb();
    expect(await voicePublishGate(db, 'a', 0)).toBe('refused-unverified');
    verify(sqlite, 'a');
    for (let i = 0; i < VOICE_PUBLISH_BURST; i++) expect(await voicePublishGate(db, 'a', 0)).toBe('speaking');
    expect(await voicePublishGate(db, 'a', 0)).toBe('refused-rate');
    expect(await voicePublishGate(db, 'a', VOICE_PUBLISH_REFILL_MS)).toBe('speaking');
    sqlite.prepare('INSERT INTO voice_bans(device_id,until_at,reason,created_at) VALUES(?,?,?,?)').run('a', 10 ** 12, 'test', 0);
    expect(await voicePublishGate(db, 'a', 20 * VOICE_PUBLISH_REFILL_MS)).toBe('refused-banned');
  });

  it('spends the device budget atomically across concurrent requests', async () => {
    const { sqlite, db } = freshDb(); verify(sqlite, 'a');
    const results = await Promise.all(Array.from({ length: VOICE_PUBLISH_BURST + 4 }, () => voicePublishGate(db, 'a', 0)));
    expect(results.filter(state => state === 'speaking')).toHaveLength(VOICE_PUBLISH_BURST);
    expect(results.filter(state => state === 'refused-rate')).toHaveLength(4);
    expect(await voicePublishGate(db, 'a', VOICE_PUBLISH_REFILL_MS / 2)).toBe('refused-rate');
    expect(await voicePublishGate(db, 'a', VOICE_PUBLISH_REFILL_MS)).toBe('speaking');
  });
});

describe('voice reports', () => {
  it('bans a speaker for 24 h after three different devices report them within an hour', async () => {
    const { sqlite, db } = freshDb(); verify(sqlite, 'target');
    await recordVoiceSession(db, 'sess-t', 'target', 0);
    expect(await reportVoice(db, 'target', 'sess-t', 0)).toEqual({ ok: false, banned: false });
    expect(await reportVoice(db, 'r1', 'sess-t', 0)).toEqual({ ok: true, banned: false, target: 'target' });
    expect(await reportVoice(db, 'r1', 'sess-t', 1000)).toEqual({ ok: true, banned: false, target: 'target' }); // same reporter counts once
    expect(await reportVoice(db, 'r2', 'sess-t', 2000)).toEqual({ ok: true, banned: false, target: 'target' });
    expect(await reportVoice(db, 'r3', 'sess-t', 3000)).toEqual({ ok: true, banned: true, target: 'target' });
    expect(await voiceTrackState(db, 'target', 'sess-t', 'mic', 4000)).not.toBe('speaking');
    await authoriseVoiceTracks(db, 'sess-t', 'target', ['mic'], 4000);
    expect(await voiceTrackState(db, 'target', 'sess-t', 'mic', 5000)).toBe('refused-banned');
    expect(await voiceTrackState(db, 'target', 'sess-t', 'mic', 3000 + VOICE_BAN_MS + 1)).toBe('speaking');
  });

  it('does not ban on reports spread beyond the hour', async () => {
    const { db } = freshDb();
    await recordVoiceSession(db, 'sess-t', 'target', 0);
    await reportVoice(db, 'r1', 'sess-t', 0); await reportVoice(db, 'r2', 'sess-t', 30 * 60_000);
    expect(await reportVoice(db, 'r3', 'sess-t', 61 * 60_000)).toEqual({ ok: true, banned: false, target: 'target' });
  });
});

describe('world publish authorisation', () => {
  it('accepts only a track authorised for this device', async () => {
    const { sqlite, db } = freshDb(); verify(sqlite, 'a');
    await authoriseVoiceTracks(db, 'sess-a', 'a', ['mic'], 0);
    expect(await voiceTrackState(db, 'a', 'sess-a', 'mic', 1)).toBe('speaking');
    expect(await voiceTrackState(db, 'b', 'sess-a', 'mic', 1)).toBe('refused-off');
    expect(await voiceTrackState(db, 'a', 'sess-a', 'other', 1)).toBe('refused-off');
    expect(await voiceTrackState(db, undefined, 'sess-a', 'mic', 1)).toBe('refused-unverified');
  });

  it('charges every hold across reused tracks, without charging setup or periodic checks to that budget', async () => {
    const { sqlite, db } = freshDb(); verify(sqlite, 'a');
    await authoriseVoiceTracks(db, 'sess-a', 'a', ['mic'], 0);
    await authoriseVoiceTracks(db, 'sess-b', 'a', ['mic'], 0);
    for (let i = 0; i < VOICE_PUBLISH_BURST; i++) expect(await voicePublishGate(db, 'a', 0, 'setup')).toBe('speaking');
    expect(await voicePublishGate(db, 'a', 0, 'setup')).toBe('refused-rate');
    for (let i = 0; i < VOICE_PUBLISH_BURST; i++) {
      const session = i % 2 ? 'sess-a' : 'sess-b';
      expect(await voiceTrackState(db, 'a', session, 'mic', 0, 'recheck')).toBe('speaking');
      expect(await voiceTrackState(db, 'a', session, 'mic', 0, 'publish')).toBe('speaking');
    }
    expect(await voiceTrackState(db, 'a', 'sess-a', 'mic', 0, 'publish')).toBe('refused-rate');
    expect(await voiceTrackState(db, 'a', 'sess-a', 'mic', 0, 'recheck')).toBe('speaking');
    expect(await voiceTrackState(db, 'a', 'sess-a', 'mic', VOICE_PUBLISH_REFILL_MS, 'publish')).toBe('speaking');
  });

  it('rejects a reused track after verification is revoked, including during a periodic check', async () => {
    const { sqlite, db } = freshDb(); verify(sqlite, 'a');
    await authoriseVoiceTracks(db, 'sess-a', 'a', ['mic'], 0);
    expect(await voiceTrackState(db, 'a', 'sess-a', 'mic', 0, 'publish')).toBe('speaking');
    sqlite.prepare('UPDATE email_captures SET verified_at=NULL WHERE device_id=?').run('a');
    expect(await voiceTrackState(db, 'a', 'sess-a', 'mic', 1, 'publish')).toBe('refused-unverified');
    expect(await voiceTrackState(db, 'a', 'sess-a', 'mic', 1, 'recheck')).toBe('refused-unverified');
  });
});

describe('voice proxy routes', () => {
  async function setup(configured = true, extra: Record<string, string> = {}) {
    const { sqlite, db } = freshDb(), token = 'a'.repeat(64);
    sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,created_at,updated_at) VALUES(?,?,?,?)').run('dev', await hashToken(token), 0, 0);
    const env = { DB: db, ...(configured ? { REALTIME_APP_ID: 'app', REALTIME_APP_TOKEN: 'secret' } : {}), ...extra } as unknown as Env;
    const upstream = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/sessions/new')
      ? Response.json({ sessionId: 'sess1' }) : String(url).includes('/turn/keys/')
      ? Response.json({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }] })
      : Response.json({ sessionDescription: { type: 'answer', sdp: 'v=0' }, tracks: [] }));
    const call = (path: string, method = 'POST', body?: unknown) => handleVoiceRequest(new Request(`https://gtasf.com${path}`, {
      method, headers: { cookie: `gtasf_device=${token}`, origin: 'https://gtasf.com', 'X-GTASF-Voice': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, upstream as unknown as typeof fetch, 1000);
    return { sqlite, db, upstream, call };
  }
  const publish = { sessionDescription: { type: 'offer', sdp: 'v=0' }, tracks: [{ location: 'local', mid: '0', trackName: 'mic' }] };

  it('answers 503 unconfigured without Realtime credentials and 401 without a device', async () => {
    const { call } = await setup(false);
    expect((await call('/api/voice/sessions/new'))!.status).toBe(503);
    expect((await handleVoiceRequest(new Request('https://gtasf.com/api/voice/sessions/new', { method: 'POST', headers: { 'X-GTASF-Voice': '1' } }), {} as Env))!.status).toBe(401);
  });

  it('records session ownership, gates publishing on a verified email, and authorises the published track', async () => {
    const { sqlite, db, upstream, call } = await setup();
    expect(await (await call('/api/voice/sessions/new'))!.json()).toEqual({ sessionId: 'sess1' });
    // Live Realtime answers 400 to a '{}' body (it then requires sessionDescription): a bare session sends none.
    expect((upstream.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBeUndefined();
    const refused = await call('/api/voice/sessions/sess1/tracks/new', 'POST', publish);
    expect(refused!.status).toBe(403); expect(await refused!.json()).toEqual({ error: 'unverified' });
    expect(upstream).toHaveBeenCalledTimes(1); // the SFU never saw the refused publish
    verify(sqlite, 'dev');
    expect((await call('/api/voice/sessions/sess1/tracks/new', 'POST', publish))!.status).toBe(200);
    expect(await voiceTrackState(db, 'dev', 'sess1', 'mic', 2000)).toBe('speaking');
  });

  it('lets a listener subscribe only to tracks WorldDO currently grants their device', async () => {
    const { db, call } = await setup();
    await call('/api/voice/sessions/new');
    const subscribe = () => call('/api/voice/sessions/sess1/tracks/new', 'POST', { tracks: [{ location: 'remote', sessionId: 'other', trackName: 'mic' }] });
    const refused = await subscribe();
    expect(refused!.status).toBe(403); expect(await refused!.json()).toEqual({ error: 'not-audible' });
    await setVoiceGrants(db, 'dev', [{ sessionId: 'other', trackName: 'mic' }], 1);
    expect((await subscribe())!.status).toBe(200);
    // Walking out of range / muting replaces the grant set; the old ids stop working.
    await setVoiceGrants(db, 'dev', [], 2);
    expect((await subscribe())!.status).toBe(403);
  });

  it('accepts nameplate reports through /api/feedback kind voice with an explicit voice answer', async () => {
    const { db } = await setup();
    await recordVoiceSession(db, 'speaker-sess', 'speaker', 0);
    const token = 'a'.repeat(64), env = { DB: db } as unknown as Env;
    const post = (body: unknown) => handleVoiceFeedback(new Request('https://gtasf.com/api/feedback', {
      method: 'POST', headers: { cookie: `gtasf_device=${token}`, origin: 'https://gtasf.com', 'X-GTASF-Voice': '1' }, body: JSON.stringify(body) }), env, 1000);
    expect(await post({ kind: 'bug', text: 'hi' })).toBeNull();
    const ok = await post({ kind: 'voice', sessionId: 'speaker-sess', text: 'shouting' });
    expect(await ok!.json()).toEqual({ ok: true, kind: 'voice', banned: false });
    expect((await post({ kind: 'voice', sessionId: 'nobody' }))!.status).toBe(400);
  });

  it("refuses another device's session and falls back to STUN without a TURN key", async () => {
    const { db, call } = await setup();
    await recordVoiceSession(db, 'theirs', 'someone-else', 0);
    expect((await call('/api/voice/sessions/theirs/renegotiate', 'PUT', {}))!.status).toBe(403);
    expect(await (await call('/api/voice/ice', 'GET'))!.json()).toEqual({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] });
  });

  it('mints 1 h TURN ICE servers per device with a TURN key, rate-limited (burst 6)', async () => {
    const { upstream, call } = await setup(true, { REALTIME_TURN_KEY_ID: 'turnkey', REALTIME_TURN_KEY_TOKEN: 'turnsecret' });
    for (let i = 0; i < 6; i++) {
      const value = await (await call('/api/voice/ice', 'GET'))!.json() as { iceServers: { urls: string[] }[] };
      expect(value.iceServers[0]!.urls[0]).toMatch(/^turn:/);
    }
    expect((await call('/api/voice/ice', 'GET'))!.status).toBe(429);
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/turnkey/credentials/generate-ice-servers');
    expect(JSON.parse(String(init.body))).toEqual({ ttl: 3600 });
    expect(upstream).toHaveBeenCalledTimes(6); // the 7th request never reached Cloudflare
  });

  it('caps TURN minting per client IP across rotating device cookies (30 per 10 min)', async () => {
    const { db, sqlite } = await setup();
    const env = { DB: db, REALTIME_APP_ID: 'app', REALTIME_APP_TOKEN: 'secret', REALTIME_TURN_KEY_ID: 'k', REALTIME_TURN_KEY_TOKEN: 't' } as unknown as Env;
    const upstream = vi.fn(async () => Response.json({ iceServers: [{ urls: ['turn:x'] }] }));
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const token = String(i).padStart(64, 'b');
      sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,created_at,updated_at) VALUES(?,?,?,?)').run(`farm-${i}`, await hashToken(token), 0, 0);
      const response = await handleVoiceRequest(new Request('https://gtasf.com/api/voice/ice', { headers: {
        cookie: `gtasf_device=${token}`, 'X-GTASF-Voice': '1', 'CF-Connecting-IP': '203.0.113.7' } }), env, upstream as unknown as typeof fetch, 1000);
      statuses.push(response!.status);
    }
    expect(statuses.slice(0, 30).every(status => status === 200)).toBe(true);
    expect(statuses[30]).toBe(429); expect(upstream).toHaveBeenCalledTimes(30);
  });

  it('hidden launch gate: voice routes and reports answer as off without the ?voice=1 header (voicePublic off)', async () => {
    const { db } = await setup();
    const token = 'a'.repeat(64), env = { DB: db, REALTIME_APP_ID: 'app', REALTIME_APP_TOKEN: 'secret' } as unknown as Env;
    const bare = await handleVoiceRequest(new Request('https://gtasf.com/api/voice/ice', { headers: { cookie: `gtasf_device=${token}` } }), env);
    expect(bare!.status).toBe(404); expect(await bare!.json()).toEqual({ error: 'off' });
    expect(await handleVoiceFeedback(new Request('https://gtasf.com/api/feedback', { method: 'POST',
      headers: { cookie: `gtasf_device=${token}`, origin: 'https://gtasf.com' }, body: JSON.stringify({ kind: 'voice', sessionId: 'x' }) }), env, 0)).toBeNull();
  });

  it('caption route: gates size, key and the daily cap, then forwards the clip with its reservation to WorldDO', async () => {
    const { db, sqlite } = await setup();
    const token = 'a'.repeat(64), forwarded: { url: string; headers: Headers; bytes: number }[] = [];
    const world = { fetch: async (url: string, init: RequestInit) => { forwarded.push({ url, headers: new Headers(init.headers), bytes: (init.body as ArrayBuffer).byteLength }); return Response.json({ status: 'sent' }); } };
    const env = (extra: Record<string, unknown> = {}) => ({ DB: db, WORLD: { idFromName: () => 'id', get: () => world }, ...extra }) as unknown as Env;
    const post = (bytes: number, e: Env, ms = 2000) => handleVoiceRequest(new Request('https://gtasf.com/api/voice/caption', { method: 'POST',
      headers: { cookie: `gtasf_device=${token}`, origin: 'https://gtasf.com', 'X-GTASF-Voice': '1', 'Content-Type': 'audio/webm', 'X-GTASF-Clip-Ms': String(ms), 'X-GTASF-Player': '7' },
      body: new Uint8Array(bytes) }), e, fetch, Date.parse('2026-10-06T19:00:00Z'));
    expect((await post(4000, env()))!.status).toBe(503);                                      // no ELEVENLABS_API_KEY
    expect((await post(160_001, env({ ELEVENLABS_API_KEY: 'k' })))!.status).toBe(413);         // over 160 KB
    const ok = await post(4000, env({ ELEVENLABS_API_KEY: 'k' }));
    expect(await ok!.json()).toEqual({ status: 'sent' });
    expect(forwarded[0]!.url).toBe('https://world/internal/voice/caption');
    expect(forwarded[0]!.headers.get('X-GTASF-Device')).toBe('dev'); expect(forwarded[0]!.headers.get('X-GTASF-Reserved')).toBe('2');
    expect(forwarded[0]!.headers.get('X-GTASF-Player')).toBe('7'); // which of this device's tabs spoke
    expect(forwarded[0]!.bytes).toBe(4000);
    sqlite.prepare("UPDATE voice_caption_spend SET seconds=1e9").run();                        // the day is spent
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const paused = await post(4000, env({ ELEVENLABS_API_KEY: 'k' }));
    expect(paused!.status).toBe(503); expect(await paused!.json()).toEqual({ error: 'captions-paused' }); warn.mockRestore();
    expect(forwarded).toHaveLength(1);                                                         // never reached STT
    sqlite.prepare('INSERT INTO voice_bans(device_id,until_at,reason,created_at) VALUES(?,?,?,?)').run('dev', Date.parse('2026-10-07T00:00:00Z'), 'x', 0);
    expect((await post(4000, env({ ELEVENLABS_API_KEY: 'k' })))!.status).toBe(403);           // banned speakers can't caption
  });

  it('pitch clips: with pitching on, X-GTASF-Pitch allows up to 300 KB / 15 s on the same meter; ignored when off', async () => {
    const { db } = await setup();
    const token = 'a'.repeat(64), forwarded: Headers[] = [];
    const world = { fetch: async (_url: string, init: RequestInit) => { forwarded.push(new Headers(init.headers)); return Response.json({ status: 'sent' }); } };
    const env = { DB: db, WORLD: { idFromName: () => 'id', get: () => world }, ELEVENLABS_API_KEY: 'k' } as unknown as Env;
    const post = (bytes: number, ms: number, pitch: boolean) => handleVoiceRequest(new Request('https://gtasf.com/api/voice/caption', { method: 'POST',
      headers: { cookie: `gtasf_device=${token}`, origin: 'https://gtasf.com', 'X-GTASF-Voice': '1', 'Content-Type': 'audio/webm', 'X-GTASF-Clip-Ms': String(ms), ...(pitch ? { 'X-GTASF-Pitch': '1' } : {}) },
      body: new Uint8Array(bytes) }), env, fetch, Date.parse('2026-10-06T19:00:00Z'));
    const mutable = flags as { pitching: boolean }, was = mutable.pitching;
    try {
      mutable.pitching = false;
      expect((await post(200_000, 14_000, true))!.status).toBe(413);                          // header ignored while off
      mutable.pitching = true;
      expect((await post(200_000, 14_000, false))!.status).toBe(413);                         // plain captions keep 160 KB
      expect((await post(200_000, 14_000, true))!.status).toBe(200);
      expect(forwarded.at(-1)!.get('X-GTASF-Reserved')).toBe('15');                           // 200 KB at the 32 kbps floor = 50 s -> cap
      expect((await post(40_000, 14_000, true))!.status).toBe(200);
      expect(forwarded.at(-1)!.get('X-GTASF-Reserved')).toBe('14');                           // billed for the longer clip
      expect((await post(4000, 60_000, true))!.status).toBe(200);
      expect(forwarded.at(-1)!.get('X-GTASF-Reserved')).toBe('15');                           // capped at 15 s
      expect((await post(300_001, 15_000, true))!.status).toBe(413);
    } finally { mutable.pitching = was; }
  });
});
