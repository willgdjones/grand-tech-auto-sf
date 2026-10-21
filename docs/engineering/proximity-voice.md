# Proximity voice chat (queue for the swarm)

## Context
The founder wants voice chat. Their notes from a call with a games founder (~/Downloads/Untitled) make the case:
- proximity voice is what makes players role-play;
- it creates the weird, viral streamer moments;
- it's "the human creativity that really shines through";
- the stated challenge is moderation.

Today GTASF has only speech-to-text: `web/src/chat/voice.ts`, a hold-to-talk button that transcribes speech into normal chat, behind `voiceChat: false`. There's no real-time audio between players: no WebRTC, no TURN, no Cloudflare Realtime.

Founder decisions:
- **Activation:** push-to-talk.
- **Who hears you:** nearby players, people in the same vehicle, and everyone at the same event.
- **Safety, all four on day one:**
  - per-player mute;
  - report player;
  - voice off by default, with mic permission requested only on opt-in;
  - only email-verified founders can transmit (anyone can listen).
- **Timing:** queue ASAP, behind a flag.

## Approach: Cloudflare Realtime SFU, signalled over the existing world socket
We're already all-in on Cloudflare (Workers, DOs, D1). Cloudflare Realtime (the Calls SFU plus managed TURN) avoids a peer-to-peer mesh, which breaks at roughly 5+ nearby speakers and behind NATs. Each speaker publishes one Opus track. Each listener subscribes only to the tracks it should hear.

1. **Who-can-hear logic (server-authoritative, in WorldDO).** Computed per tick from data WorldDO already has:
   - Positions within `CHAT_RADIUS_M` = 40 m (`shared/chat/constants.ts`), reusing the snapshot distance logic in `worker/src/world/snapshot.ts`.
   - Shared vehicle occupancy: driver and passengers of the same car, robotaxi or bus.
   - The same event room, via the `chatEventId` rooms that `WorldChat.broadcastLocal` (`worker/src/world/chat/world.ts`) already uses.

   WorldDO sends each listener `VOICE_PEERS {playerId, sessionTrack, gain}` deltas. Gain is 1 within 10 m and fades to 0 at 40 m; it's 1 in the same vehicle and about 0.8 in an event room.
2. **Signalling protocol.**
   - Client to server: `VOICE_PUBLISH`, `VOICE_STOP` and `VOICE_MUTE {target}`, using the next free opcodes after 0x1f in `shared/protocol/constants.ts`.
   - Server to client: `VOICE_PEERS` and `VOICE_STATE`.
   - Encoders and decoders go in `shared/protocol/c2s.ts` and `s2c.ts`.
   - Coordinate the protocol change with both consumers, per AGENTS.md.
3. **Worker Realtime proxy.** `worker/src/voice/realtime.ts` holds the Realtime app secret (it never reaches the client) and does three things:
   - creates sessions;
   - adds local tracks on PTT;
   - adds remote tracks per `VOICE_PEERS`.

   Server checks before allowing a publish:
   - the speaker's email is verified (`email_captures.verified_at`, from the emailCapture work, gtasf-1aon/2904);
   - the speaker isn't voice-banned;
   - the per-device rate limit passes (reuse the `takeBudget` pattern in `WorldChat`).
4. **Client.**
   - New `web/src/voice/` module replacing the STT button in `web/src/chat/voice.ts`. The STT version stays as a fallback for players who can't use a mic.
   - Opt-in toggle in Game options. `getUserMedia` is called only after opt-in and a user gesture.
   - Hold **V** (desktop) or a phone mic button to talk.
   - Each remote track goes through a Web Audio `GainNode` + `StereoPannerNode`, panned relative to the camera, following the pattern in `web/src/audio/vehicles.ts`.
   - Show a speaking indicator (mic icon) on the overhead nameplate.
   - Duck the radio while anyone audible speaks: add `setDuck()` to `applyGain` in `web/src/audio/radioStationPlayer.ts`.
5. **Safety.**
   - **Per-player mute:** nameplate menu → Mute. It's local and also sent as `VOICE_MUTE`, so the server stops subscribing you to that player's track.
   - **Report:** the same menu posts to the existing feedback route with `kind:'voice'`. Three reports from different devices within 1 h auto-revoke the speaker's voice for 24 h. Store this in a D1 `voice_bans` table (new migration). This is server logic, so it gets unit tests.
   - **Off by default; listening needs opt-in too.**
   - No recording or transcription of voice. This keeps the privacy and consent story simple, and the privacy notice gets one line saying so.
6. **Flags.** Add `proximityVoice` to `shared/flags.ts`: false in prod, true in dev. It's only enabled after:
   - a 2-tab and phone check on the preview;
   - the founder provisioning Cloudflare Realtime.

## Founder steps (blocking prod)
- Create a Cloudflare Realtime app in the GTASF account. The Realtime SFU is pay-per-use, with a free allowance of about 1,000 GB/month.
- Store the app ID as a variable and the token as the secret `REALTIME_APP_TOKEN`.
- emailCapture must be live first, because speaking requires a verified email. It's already in today's batch.

## Work breakdown (beads; day-sized, so it can run by DAY under the short-task rule in pieces)
1. Protocol + WorldDO who-can-hear sets, with unit tests (server logic).
2. Worker Realtime proxy, the verified/ban/rate checks, and the `voice_bans` migration, with tests.
3. Client voice module: PTT, Web Audio spatial mixing, the nameplate speaking icon, radio ducking.
4. Mute/report UI and the Game options opt-in.
5. Preview check: two headless tabs plus one phone. The founder flips the flag.

Owners:
- Pane 0.2 (Claude) takes 1, 2 and the safety pieces.
- codex2.6 (Codex) takes 3 and 4.
- Estimate: about 2 agent-days of work.

## Backlog context (founder asked)
- 10 beads ready now (4 founder-only, 6 agent).
- 71 open, 59 marked in progress. Most "in progress" are stale claims from retired panes, so they're effectively backlog.
- 7 long graphics items queued for tonight.
- Voice goes to the top of the day queue, right after today's batch deploy.

## Verification
- The test gate at deploy runs the new server tests (who-can-hear sets, publish permission, ban threshold).
- Preview test:
  - Two headless browser tabs with fake mic input (`--use-fake-device-for-media-stream`): tab B hears tab A at 10 m, can't hear it at 50 m, and hears it in the same car.
  - Mute stops the audio.
  - A non-verified speaker is refused.
- Then the founder tries it on a real phone and desktop before the flag goes into the prod allowlist.
