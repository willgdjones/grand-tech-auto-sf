# Appearance sync — protocol proposal (character looks)

Author: BoldForest (pane 1, integrator) · bead gtasf-hrmk · for the worker/protocol pane to review + implement.

## Goal
Sync each player's **compact appearance id** so remotes render their status look (base sex, founder
archetype, stage-driven outfit/car, chosen variants) and show their archetype in the nameplate. The id
is the single unsigned int from `encodeAppearance()` in `shared/content/cosmetics.ts` (commit 9a22a05);
the worker treats it as an **opaque `u32`** — cosmetic only, it must never influence gameplay/funding.

## Not in the per-tick SNAPSHOT
`SNAPSHOT` entries are `SNAPSHOT_ENTRY_BYTES = 18` per player per tick; adding 4 bytes there is ~22 B ×
players × ticks — the bandwidth blow-up the founder warned against. Appearance changes **rarely** (a
wardrobe edit, or a funding-stage rise), so it belongs in a low-frequency per-player message, which is
also *cheaper* than the snapshot.

## Wire additions (back-compat: no existing message changes)
Two new opcodes; `PLAYER_JOIN`/`SNAPSHOT`/pose formats stay byte-identical.

- **C2S `SET_APPEARANCE` = `0x1b`** (next free after `ROAD_RESPAWN 0x1a`): body `u32 appearance`.
  The client sends it on connect (initial look) and whenever the local player changes their wardrobe
  or their funding stage rises (so `stageRound` in the id updates). Debounce client-side (≤ ~1/sec).
- **S2C `APPEARANCE` = `0x86`** (free; between `CHAT_BROADCAST 0x85` and `CORRECTION 0x89`): body
  `u32 id, u32 appearance`. The worker relays a player's latest appearance to the others, and on join
  replays each existing player's appearance to the newcomer (and the newcomer's to existing players),
  sent right **after** the existing `PLAYER_JOIN` so join ordering is unchanged.

Worker state: store `appearance: u32` per connected player (default `0` = `decodeAppearance(0)` → a
valid male/hacker/bootstrapping look, so a player who never sends one still renders). Validate on
receipt: reject/clamp anything `>= 2**26` (the id uses 26 bits); treat as opaque otherwise.

## Rollout / back-compat (milestone #1 is live)
`decodeS2C` returns `UNKNOWN_TYPE` for unknown opcodes, so an **old in-flight client** receiving the new
S2C `APPEARANCE` would error. Mitigation: the worker **only emits `APPEARANCE` when `flags.characterLooks`
is on**, and `characterLooks` stays out of the production allowlist until the coordinated feature deploy
(worker + web shipped together, so all live clients are new). The C2S `SET_APPEARANCE` is likewise only
sent by new clients. No subprotocol bump needed; `gtasf.v2` is preserved. (If we ever want it on before a
full redeploy, bump the subprotocol instead.)

## Client flow (pane 1 + pane 8/6)
1. Local appearance store holds the player's `Appearance` (sex/archetype/variants), persists it to
   localStorage, and derives `stageRound` from the funding round. On change → `encodeAppearance()` →
   send `SET_APPEARANCE`.
2. On receiving `APPEARANCE {id, appearance}` for a remote: store it, then `decodeAppearance()` +
   `resolveLook(appearance, round)` and hand the resolved look to the avatar renderer (pane 6). The
   nameplate (pane 3 / gtasf-5dlu) uses `nameplateTitle()` for the archetype flavour line.

## Rate limiting / safety
Rate-limit `SET_APPEARANCE` per player (e.g. the existing per-origin/DO limiter, a few per second). The
id is cosmetic and opaque; never derive funding, collision, or capability from it. No PII in the id.

## Checklist for the worker pane
- [ ] Add `C2S.SET_APPEARANCE = 0x1b`, `S2C.APPEARANCE = 0x86` to `shared/protocol/constants.ts`.
- [ ] Encode/decode in `c2s.ts` / `s2c.ts` (one `u32` in, two `u32` out); add to `S2CMessage`/`C2SMessage` types + `contract.test.ts`.
- [ ] WorldDO: store appearance per player; relay on change; replay on join (after `PLAYER_JOIN`); gate emits on `flags.characterLooks`; validate `< 2**26`; rate-limit.
- [ ] Client net layer (pane 1): send `SET_APPEARANCE`; surface remote `APPEARANCE` to `createRemotes`/avatars.

Ping BoldForest to wire the client net + main.ts side once the worker opcodes land.
