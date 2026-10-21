# GTASF world wire contract (D01)

`gtasf.v2`, little-endian, exactly one binary record per WebSocket message. HELLO also carries version 2; v1 is rejected. The bootstrap and all new message kinds share signed i32 centimetres for x/y/z, u32 identifiers, and yaw in 256 steps of a turn. World bounds are ±20,000 m on each axis. Convert map global metres to wire centimetres once at the boundary: +x east, +y up, +z south. IDs are opaque; zero is reserved for an absent driver or proximity-chat event scope. Player IDs begin at 1 and are never reused, including after expiry/restart. There is no lobby or 250-player admission/storage limit.

Strings are fatal UTF-8 with explicit byte-length prefixes, never null-terminated. Nicknames have at most 48 bytes, chat text 320 bytes. Resume tokens are 64 lowercase hexadecimal characters (256 random bits); they are private bearer credentials, never included in PLAYER_JOIN, snapshots, logs or chat. C2S is bounded to 2,048 bytes and S2C to 65,536 bytes. Decoders reject truncated/trailing bytes, unknown opcodes, enum/boolean values, nonfinite times and out-of-range poses. All collection counts are bounded against frame size before allocation.

| Client message | Fields after opcode |
| --- | --- |
| HELLO | version u8, nickname str8, resumeToken str8 (empty for new session) |
| MOVE | seq u16, pose (x/y/z i32, yaw/flags u8) |
| PING | nonce u32, clientT f64 |
| CHAT | clientMsgId u32, eventId u32 (0 proximity), text str16 |
| VEHICLE_ENTER / VEHICLE_EXIT | vehicleId u32 |
| VEHICLE_MOVE | vehicleId u32, seq u16, pose |
| ROBOTAXI_HAIL | requestId u32, destination x/y/z i32 |
| ROBOTAXI_CANCEL | requestId u32 |
| EVENT_JOIN / EVENT_LEAVE | eventId u32 |

| Server message | Fields after opcode |
| --- | --- |
| WELCOME | id u32, serverT f64, name str8, pose, resumeToken str8, lastMoveSeq u16, resumed u8 |
| PLAYER_JOIN | id u32, name str8, pose |
| PLAYER_LEAVE | id u32 |
| SNAPSHOT | tick u32, serverT f64, count u16, entries (id u32 + pose; 18 bytes each) |
| CORRECTION | pose |
| PONG | nonce u32, clientT/serverT f64 |
| VEHICLE_SNAPSHOT | tick u32, serverT f64, count u16, entries (id + pose + kind u8 + driverId u32 + signed speedCmps i16; 25 bytes each) |
| VEHICLE_STATE | vehicleId/playerId u32, mode u8 |
| ROBOTAXI_STATE | requestId/vehicleId u32, state u8, pose, destination x/y/z i32, etaSeconds u16 |
| EVENT_STATE | eventId/playerId u32, present u8 |
| CHAT_BROADCAST | messageId/senderId/eventId u32, serverT f64, name str8, text str16 |

Enum ordinals and opcodes are fixed by `constants.ts`. Gameplay records are contracts; their owners must verify proximity, occupancy, request IDs, event membership, and moderation before changing state. Client `connectWorld.send()` checks driving/robotaxi/chat/event feature switches. D01 never broadcasts chat or treats a robotaxi request as steering; owning D02/D03/D05/D06 beads install those handlers. Disabled integrations remain off.

## Nicknames and recovery

New HELLO names are NFKC-normalized, whitespace-collapsed, trimmed and checked for empty/control/bidi/oversized labels. Emoji and non-Latin labels are supported; duplicate labels are allowed because IDs identify players. A resume token restores the stored canonical name, ID, pose and accepted movement sequence. Supplying a different HELLO name never renames the resumed player. A successful server-verified funding profile save can update the stored name without reconnecting; connections bound to that saved device use its canonical nickname. Existing PLAYER_JOIN records announce that name update to other peers.

SQLite commits each accepted pose and sequence. Sessions retain a token for 120 seconds after disconnect; connected peers idle out after 30 seconds. An alarm removes expired records even with no players. `ctx.acceptWebSocket()` attachments bind each socket to its session ID and generation. Constructor recovery checks that binding against persisted state. A takeover increments the generation before WELCOME, closes the old socket with 4006, and ignores its late callbacks. Offline time grants no movement credit. The client resumes from lastMoveSeq + 1, including u16 wrap.

Tokens remain stable for the session so a lost WELCOME cannot strand an already issued credential. They are kept in browser sessionStorage when available, with in-memory fallback; they are never sent in URLs. A forged/expired token closes with 4003 and the client clears it before one fresh-session attempt. A superseded tab stops reconnecting. All socket callbacks are fenced to their transport; disposal cancels handshakes, pings and retries. WELCOME is followed by a local CORRECTION callback to restore existing renderers after their welcome reset.

Snapshots remain 10 Hz with distance cadence of 10/5/2 Hz (<40 m, 40–120 m, >120 m). Oversized populations use multiple bounded frames with the same tick; entries are incremental and absence is not a removal. PLAYER_JOIN announces current membership and PLAYER_LEAVE removes it. World tick counters wrap u32. City-wide spatial-index optimization and measured bandwidth/load remain D09 work; these tests do not establish a load budget.

## Targeted checks

Use Node from `.nvmrc`, one worker, no watch mode:

- `nice -n 10 npx vitest run shared/protocol/bootstrap.test.ts shared/protocol/contract.test.ts worker/src/world/bootstrap.test.ts web/src/net/bootstrap.test.ts web/src/net/ws.test.ts --maxWorkers=1`
- `nice -n 10 npx vitest run --config worker/src/world/vitest.config.ts --maxWorkers=1`

The second command runs real SQLite/WebSocket/hibernation lifecycle tests inside workerd. Its `world.do.ts` suffix deliberately keeps it out of the ordinary Node test glob.
