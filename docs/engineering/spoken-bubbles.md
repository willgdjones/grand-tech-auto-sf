# Spoken chat bubbles: hold to talk → your words above your head (ElevenLabs STT)

## Context
Proximity voice is live behind `?voice=1` (#5.32). The founder wants talking to also show as a speech bubble above the speaker's head, like typed chat, and wants it to be **really easy to just talk with people around you**. They chose ElevenLabs for speech-to-text.

Founder decisions, from the grilling:
- **Activation:** push-to-talk only (hold **V** on desktop, or the mic button on phone).
- **Mic button:** visible to **every player by default**. No opt-in is needed to *speak as a bubble*; the first hold asks for mic permission. Hearing real voices stays an opt-in in Game options.
- **Who sees the bubble:** everyone within chat range (40 m) or in the same event room, even with voice or sound off.
- **Batch, not streaming.** Release → the server transcribes the clip → runs the **jev (TypeSafe) moderation check** → broadcasts the bubble, about 1–2 s after release.
- **Unverified players:** they can hold-to-talk for **bubble only** (text, no audio). Verified players' audio is also heard live through the existing SFU path.
- **Max hold:** **8 s**, then it auto-releases and sends.
- **Bubble style:** the normal chat bubble with a small **🎙 marker**.
- **Language:** auto-detect.
- **Retention:** no audio is ever stored. Transcripts are kept **only when attached to a report**: the reported player's last ~2 min of captions, deleted after 7 days.
- **Spend cap:** **$20/day** hard cap on transcription. Past the cap, voice audio keeps working, captions pause, and the server logs the overflow.

## What exists (reuse)
- `worker/src/voice/stt.ts`: ElevenLabs Scribe batch adapter (`createSttAdapter(env)`, `POST /v1/speech-to-text`, `xi-api-key`, 1 MB cap, fails closed). It has tests but isn't wired to any route. `ELEVENLABS_API_KEY` is declared in `worker/src/env.ts:23` but not provisioned.
- `web/src/voice/client.ts:69-76`: `getUserMedia` (echo cancellation, noise suppression) and the push-to-talk wiring (`ptt.ts`: V key and button, blur and hidden-tab release).
- Chat pipeline (`worker/src/world/chat/world.ts`):
  - `takeBudget` token bucket (3 credits, 1 per 2 s);
  - `locallyApproved` blocklist plus `moderateChat` (TypeSafe jev, 4 s, fails closed);
  - `CHAT_BROADCAST` + `broadcastLocal` (40 m radius / event room) + zone relay.
- Client bubbles: `web/src/chat/client.ts` `receive()`, 7 s bubbles, max 160 graphemes, replace-by-sender.
- Voice report flow: `kind:'voice'` feedback plus `voice_bans` (3 reports in 1 h → 24 h ban).

## Approach (server-authoritative: the transcript never comes from the client, so it can't be faked)
1. **Client capture (`web/src/voice/caption.ts`, new).**
   - On PTT press, `MediaRecorder` records from the same mic stream (reuse or obtain it in `client.ts`). Chrome produces webm/opus; Safari produces mp4/aac, and both are accepted by Scribe.
   - It stops on release or at 8 s.
   - On stop, it POSTs the blob to `/api/voice/caption` with the `X-GTASF-Voice` gate header while gated. Clips under ~0.4 s are skipped.
   - The speaker immediately sees their own "🎙 …" placeholder bubble, which is replaced by the server broadcast.
   - The mic button is decoupled from the voice opt-in. It shows for everyone when `voiceCaptions` is on; before that, only under `?voice=1`.
2. **Worker route `/api/voice/caption`.**
   - Checks: device cookie required, `voice_bans` respected, per-device budget (reuse the `takeBudget` pattern), per-IP cap (as for TURN), size ≤ 1 MB.
   - **Daily spend meter:** a D1 row per PT day accumulating clip seconds. Refuse with `captions-paused` past $20 (convert at the provider's per-hour rate, configured in one constant).
   - Forwards to the player's **WorldDO** (the same routing as the world socket), passing the device id plus the audio.
3. **WorldDO caption handler (`worker/src/world/chat/world.ts`, new `handleCaption`).**
   - Looks up the device's current player and pose. It must be connected, otherwise drop.
   - Calls `createSttAdapter(env)` with auto language. Keep the model id in one constant, checked against the current ElevenLabs batch model at build time.
   - Normalises and truncates to 160 graphemes, then runs `moderateChat` (blocklist + jev).
   - Broadcasts `CHAT_BROADCAST` with a new `spoken` bit, via `broadcastLocal` and relay, including event rooms.
   - Rejected transcripts are silently dropped (the speaker sees "Couldn't send that"), and **each rejection counts as a strike toward the existing 24 h voice ban**.
4. **Protocol.** Add a `spoken` flag to `CHAT_BROADCAST` in `shared/protocol` (s2c encoder and decoder, both consumers), coordinated per AGENTS.md. The client bubble and chat history render a 🎙 before the name.
5. **Reports.**
   - Keep a per-player in-memory ring of the last ~2 min of approved captions in WorldDO.
   - On a `kind:'voice'` or player report, attach that player's ring to the report row.
   - A cron deletes report transcripts older than 7 days (the existing 3-hourly cron).
   - Add one line to the privacy notice.
6. **Flags.**
   - `voiceCaptions` in `shared/flags.ts`: dev on, prod off. It is also gated by `?voice=1` until the founder tests.
   - `voicePublic` later opens both voice audio and captions to everyone, with the founder's yes.
   - Document `ELEVENLABS_API_KEY` as required.

## Founder steps
- Create an **ElevenLabs API key** with speech-to-text permission only, and set a monthly credit limit in the ElevenLabs dashboard as a second safety net. Copy it to the clipboard, and I'll store it as `ELEVENLABS_API_KEY` locally and in prod without printing it.

## Work breakdown (beads; Claude agents, about half a day)
1. Server: the caption route, budget, spend meter, `handleCaption`, STT + jev, the broadcast `spoken` bit, report ring + 7-day purge. **Unit tests**, since this is server, money and moderation logic: budget, cap, rejection strike, ring attach, purge. Pane 1.2 (it built voice).
2. Client: MediaRecorder capture, the 8 s auto-release, the always-visible mic button, the own-placeholder bubble, the 🎙 marker. Pane 1.0, which reviews 1; pane 1.2 reviews 2.

## Verification
- The test gate at deploy runs the new server tests.
- **Local, headless:** two Chromium tabs with `--use-fake-device-for-media-stream` and a WAV of "what's up guys" as the fake mic (`--use-file-for-fake-audio-capture`). Tab A holds V for 2 s; tab B within 40 m shows a 🎙 bubble with the transcript within ~3 s; tab C at 60 m shows nothing.
  - An unverified tab gets a bubble with no audio.
  - A blocklisted phrase is dropped and recorded as a strike.
  - The daily cap returns `captions-paused`.
- **Prod behind `?voice=1`:** the founder tests on phone and laptop. Then, with the founder's yes, `voiceCaptions` + `voicePublic` go public together.
