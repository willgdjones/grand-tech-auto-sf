# Zoned world: one SF for 5,000 concurrent players

Status: **in progress** (epic `gtasf-k1aa`, lane 10; Codex takeover: CobaltFalcon).

### Current implementation and remaining acceptance (2026-10-04)

The 20-cell grid, read-only neighbours, player ID namespaces, on-foot handoff and global outbid
fan-out are present. The Codex takeover added stable vehicle IDs, durable prepare/claim ownership,
occupied-car and riding-taxi transfers, and merged observer vehicle snapshots. Targeted checks
cover these changes; native browser and staging acceptance remains outstanding. The main transport
switch belongs to the integrator. `zonedWorld` stays off for Sunday's single-world playtest.

Required work before enablement: authenticated observer capacity, nearest-60 full-rate plus reduced
updates for others, overloaded cell subdivision, zone-aware funding/admission routing, reconnect
routing, and the staging 1,000→5,000 ramp. Earlier phase notes below describe their original slices;
they do not establish feature completeness or a load/deployment gate.

### Overload subdivision and routing contract

Use one spatial subdivision level, preserving the original 20 districts and adding four child
WorldDOs only when a district is overloaded. These are adjacent pieces of the same world, never
parallel rooms. A split is monotonic for this launch: no merge while sessions or cars may still carry
child ownership. Up to 80 active leaf zones and 100 lifetime ID namespaces fit the existing u32
player and vehicle protocol. Trigger a split after sustained population above 350 or a sustained
slow tick; use a 500-player leaf admission limit as the last fallback after subdivision. A single
extreme crowd can still reach that limit; the staging hotspot scenario must measure this honestly.

- Address a parent with its existing `(cx,cy)`. Encode a child as
  `(grid.cols + 2*parent.cx + eastBit, 2*parent.cy + southBit)`, where positive z is south.
  Child namespace indices are `20 + parentIndex*4 + southBit*2 + eastBit`; never reuse a parent
  namespace for a child. Existing `ZONE_HANDOFF` u16 coordinates can carry these addresses.
- Persist a 20-bit split mask in the existing `WorldDO('sf')` used only as a topology coordinator
  when zoning is enabled. Cache reads; no player tick traffic goes through it. A split RPC performs
  a durable bitwise union so concurrent districts cannot overwrite each other.
- Send a new `ZONE_LAYOUT {splitMask,cx,cy}` frame after WELCOME and on layout changes. The worker,
  browser and staging driver use the same address/bounds/observer helpers. The client learns the
  actual authoritative leaf, remembers it with its resume token, and observes every leaf touching
  the 150 m border band. A split drains existing sessions using the existing prepare/claim transfer,
  including cars and taxi route cursors, before retiring parent authority.
- New joins route to the leaf under their spawn. Resume and transfer sockets target their exact
  prior owner until it hands them off. Prepared destination state does not admit a second writer.
  Global broadcasts and cross-border chat cover both draining parents and children.
- Observer upgrades carry the current home session in a WebSocket subprotocol header. The target
  verifies it with that home and checks geographic adjacency before counting capacity by player ID.
  Shared Wi-Fi and the staging runner must not share an IP-based player quota.
- Funding HTTP requests carry a non-secret zone routing hint; the selected owner still verifies the
  normal device cookie and authoritative player pose. D1 remains the money/count boundary.
  Admission tickets target the requested zone; existing-player handoffs carry ownership proof and
  do not rejoin the queue. Disconnected/new players use the normal queue if the destination is full.

The lane's current check budget is touched-workspace typechecks plus one unit file per change,
through `tools/heavy.sh`. Pane 6 owns browser verification; pane 5 coordinates the staging ramp and
Cloudflare CPU telemetry. No synthetic or unit result substitutes for those acceptance records.

Ships: **Monday 2026-10-05 08:00 PT**, behind flag `zonedWorld` (default **off**).
The **Sunday 2026-10-04 playtest stays on the single `WorldDO('sf')`** — this design must not
change that path when the flag is off.

## 1. Goal and constraints

- One shared San Francisco that holds **~5,000 concurrent players** without a single Durable Object
  melting, and with **no visible seams** as players move across the city.
- Keep every v1/v2 feature working: on-foot + driving, robotaxis, NPC traffic, cable cars, proximity
  chat, funding/leaderboard, outbid crown, VC fund drops, events.
- **Global things stay globally consistent**: the event calendar, funding totals / leaderboard
  (D1), the outbid crown, VC-drop "first 50" claim counts, and event chat rooms must behave exactly
  as if there were one world.
- **Behind `zonedWorld`.** Off → today's single `WorldDO('sf')`, byte-for-byte. On → the zoned path.
- Non-goals for Monday: perfect cell boundaries matched to real neighbourhood polygons (uniform grid
  is fine); true elastic DO auto-scaling beyond the documented split trigger.

## 2. What exists today (single world)

Grounded in the current code so the zoned path reuses, not rewrites, it:

- **Routing** — `worker/src/index.ts:29`: `/api/world` → `env.WORLD.get(env.WORLD.idFromName('sf'))`.
  One DO instance named `sf` holds every player.
- **`WorldDO`** (`worker/src/world/WorldDO.ts`, ~434 lines) owns, for its whole peer set:
  `peers: Map<id, Peer>`, durable generation-fenced sessions (`sessions.ts`), parked-car ownership and
  driving (`vehicles.ts`), server robotaxis (`localRobotaxi.ts`), NPC traffic (`traffic/`), cable cars,
  proximity chat (`chat/world.ts`), funding (`funding/world.ts`), VC drops (`funding/drops.ts`),
  referral presence, analytics, and the outbid revision.
- **Tick** — `WorldTick` runs `step()` at 10 Hz while peers exist. `step()` advances taxis/traffic/
  cable cars, then `broadcastSnapshots(peers, …)` + a per-peer `vehicleSnapshot`.
- **Interest** — `snapshot.ts`: `interestTier(a,b)` by horizontal distance (<40 m every tick, ≤120 m
  every 2nd, else every 5th). `snapshotEntries` is **O(N²)**: each peer scans all peers. Fine for ~150;
  at 5,000 in one DO it is ~25 M distance checks × 10 Hz. **This is the core reason to zone.**
  Vehicle snapshots already filter per-viewer (cars ≤500 m, NPC ≤400 m).
- **Admission** — HTTP FIFO via `LobbyDO`, `WorldReservations`, and `flags.worldCapacity`
  (`WORLD_CAPACITY` 1–500). A single-use grant in the `gtasf.admit.<grant>` subprotocol is required to
  connect (`WorldDO.fetch` + `webSocketMessage` HELLO path). This is the **queue we keep as fallback**.
- **Wrangler** — `worker/wrangler.toml`: SQLite DOs `WorldDO` (WORLD), `LedgerDO` (LEDGER),
  `LobbyDO` (LOBBY).
- **Protocol** — binary `shared/protocol/*`. Poses are signed 32-bit centimetres + a yaw byte.
  World metres: **+x east, +y up, −z north** (SF_FRAME). Ferry spawn `[1196.869, 3.328, −1224.309]`.
- **Load harness** — `tools/world-load.mjs`: Miniflare + real workerd `WorldDO`/`LobbyDO`, 100 real
  protocol clients, records `stepMs`, peers, traffic, trips, bytes. **Never targets production.**

## 3. Target architecture (overview)

```
                    ┌─────────────────────────────────────────────┐
  client ──/api/world?zone=cx,cy──▶  ZoneDO(cx,cy)  [home, writable]│  authoritative for players in
     │   (position-derived home cell)   ├─ sim: sessions, vehicles, │  cell (cx,cy): pose, cars,
     │                                  │  taxis, NPC traffic, chat  │  taxis, NPC traffic
     ├──/api/world?zone=cx±1,cy±1&observe (0–3 neighbours) ──▶ ZoneDO(neighbour) [read-only]
     │                                                            delivers border-region peers/cars/chat
     │                                                            within interest radius of the shared edge
     ▼ merges all sockets into one world view (no seam)
  Global services (one instance each, city-wide):
    • D1: events, funding_credits/earnings, leaderboard, waitlist  (already global)
    • GlobalHubDO: outbid revision fan-out, VC-drop "first 50" atomic claim, active-zone registry
    • event chat rooms (per-event, not proximity) via the hub / D1
    • LobbyDO: global capacity queue — last-resort only
```

A `ZoneDO` **is a `WorldDO` parameterised by a cell** (bounds + neighbour ids + a handle to the global
hub). ~90% of `WorldDO`'s logic is already "simulate this set of peers"; zoning adds cell bounds,
neighbour observer subscriptions, border handoff, and routing of the few global concerns to the hub.

## 4. Zone partition

- A **fixed uniform grid** over the SF world-metre bounding box (from the map manifest / `SF_FRAME`;
  the playable extent is ~11 km × ~12 km). Choose a cell size that yields **16–24 cells** — e.g. a
  **5 × 4 grid of ~2.4 km cells = 20 zones** (final numbers pinned from the real bbox in the map
  manifest when we wire it).
- Cell for a position: `cx = floor((x − originX) / CELL)`, `cy = floor((z − originZ) / CELL)`, clamped
  to the grid. Zone DO id: `env.ZONE.idFromName('z:' + cx + ':' + cy)` — deterministic and stable.
- Grid over neighbourhood polygons for v1: trivial O(1) cell math, trivial 8-neighbourhood, deterministic
  handoff. Zones carry a display label (nearest neighbourhood) for ops/telemetry only; gameplay never
  depends on the label.
- The dense NE quadrant (FiDi/North Beach/Lombard, where events and players cluster) can later use a
  finer cell size than the low-detail outer city (non-uniform grid); v1 ships uniform.

## 5. Routing and the client connection model

**The client drives zone selection from its own (server-clamped) position** — no global lookup on the
hot path:

1. The client computes its home cell from its current/last/spawn position and connects
   `GET /api/world?zone=cx,cy` (admission grant still required when `worldCapacity` is on).
   `index.ts` routes to `ZONE.idFromName('z:cx:cy')`. The zone **validates** the claimed cell contains
   the admitted pose (reject/correct otherwise) so a client cannot pick an arbitrary zone.
2. When the client is within **`BORDER_SUBSCRIBE` (≈150 m, > the 120 m tier-2 edge)** of a shared edge
   or corner, it opens **read-only observer** connections to the 1–3 relevant neighbour zones
   (`?zone=…&observe=1`). Observers may only receive; any C2S control frame on an observer socket is
   rejected. Most players subscribe to **0–1** neighbours; a corner is the worst case at 3.
3. The client **merges** all sockets into one world: dedupe players/vehicles by id, apply the nearest
   authoritative pose, render one seamless scene. Because the observer is open *before* the player
   reaches the edge, there is never a gap.

Rationale: this is exactly the brief's "connect to your zone + subscribe to neighbours." It keeps each
zone's work **bounded and independent** (no server-side fan-in hub that would re-create the single-DO
bottleneck). Cost is ≤ a few extra sockets per client, only near borders.

## 6. Interest management and hotspot defence

Per-player, inside the home zone, replace the O(N²) scan with a bounded nearest-K:

- Maintain a **coarse spatial hash** of in-zone players (bucket by ~40 m). For each player, gather
  candidates from nearby buckets, keep the **nearest ~60 at full rate (tier 0)**, the next band at
  reduced rate (tiers 1/2 cadence from `interestTier`), and **omit the rest**. This bounds each
  player's snapshot to ~60 entries **regardless of local density**, so a crowd cannot inflate any one
  player's packet. Per-zone cost becomes ~O(N·k) with small k, not O(N²).
- Cross-zone peers (within interest radius of a shared edge) arrive via the neighbour observer
  subscriptions, already distance-cadenced, so border crowds are naturally capped the same way.
- **Status (shipped):** the bounded nearest-K selection is `shared/world/interest.ts nearestPeers`
  (O(N·k) bounded top-k, no spatial index). The zoned path passes `cap = NEAREST_FULL` (60) in
  `broadcastSnapshots`; the **single world now also caps behind the off-by-default `boundedInterest`
  flag** (`gtasf-k1aa`), so a launch-day crowd's snapshots shrink to the nearest 60 without changing
  normal <60-nearby play — flip after a pane-6 crowd/two-tab feel check (`gtasf-bounded-interest-verify-l404`).
  The **coarse spatial hash is intentionally not built yet**: `nearestPeers`' O(N·k) scan is fine at a
  uniform ~250/zone, and the hash is only warranted if the §13 hotspot run shows one zone must hold
  thousands before a split — so it stays gated on that (still-pending) load test, not added speculatively.
- **Zone split (overload escape hatch).** A zone trips a split when a budget is exceeded
  (e.g. residents > `ZONE_SPLIT_PLAYERS` ≈ 350, or sustained `stepMs` p95 > budget). Phase 2 mechanism:
  the cell subdivides into a 2×2 quadtree — the parent spins up four child zone ids
  (`z:cx:cy/q{0..3}`), reassigns residents to the child containing their position (same handoff path as
  §7), and the grid math prefers the finer level where it exists. The split is transparent to clients
  (they re-derive their cell at the finer level). **Phase 1 first-line defence** that likely suffices
  for a *uniform* 5,000 (≈250/zone) is the nearest-60 cap plus per-zone graceful degradation (widen
  tier cadences / shrink interest radius under load); true DO splitting is built only if a single-event
  hotspot proves the cap insufficient under load test (§13).

## 7. Seamless handoff on border crossing

Because the client already observes the destination zone before crossing, handoff is a **promotion**,
not a reconnect:

1. Home zone sees the player's clamped pose leave its cell. It RPCs the destination zone
   `receiveHandoff(sessionBlob)` with the minimal authoritative state: id, generation, resume token,
   nickname, `fundingDeviceId`, pose + movement debt, occupied vehicle (if any) and active taxi trip.
2. Destination zone installs the session (it already knows the client as a border observer by resume
   token) and replies ready.
3. Home zone sends the client `ZONE_HANDOFF{to: cx,cy}` and demotes the player to a border observer (or
   drops it once out of its interest radius); destination becomes the **writable** socket. The client
   now sends `MOVE`/`VEHICLE_MOVE` to the destination and (a) promotes that observer socket, (b) opens
   observers for the destination's new neighbours, (c) drops observers no longer adjacent.
4. Residents of each side see the player via normal snapshot/observer flows, so no `PLAYER_LEAVE`
   flicker across the seam (suppress leave for ids still visible to a side as a border observer).

**Vehicles/taxi.** A player's *occupied* car or *active* taxi trip hands off **with** the player
(include it in `sessionBlob`; destination resumes the drive/route on its own tick). **NPC traffic is
zone-local and ephemeral** (spawned near players): it despawns at the boundary and the destination
spawns its own — no NPC handoff needed, consistent with today's "spawn near players" model.

**Resume / reconnect across zones.** Durable session storage is per-zone. A reconnecting client
self-routes by last position to a cell; to survive the player having moved zones while away (or a zone
eviction), a best-effort **`SessionDirectory`** (D1 table `device → current zone`, written on handoff)
lets the hub redirect a cold reconnect to the right zone. If the directory is stale, the client admits
fresh via resume token in the cell it landed in (worst case: identity restored, position from the
client's last pose). This is the main correctness item to test (§13).

## 8. Global systems stay global

> **Ownership boundary.** The funding / VC-drop / angel ("Become an angel") / cap-table **claim and
> checkout logic is owned by pane 2 (angel + cap table) and pane 7 (VC drops + Stripe checkout)** — the
> zoned world does **not** implement it. Zoning owns only the **transport that keeps those globally
> consistent**: D1 writes are already city-wide, and anything in-DO (the outbid crown, a drop's
> first-50 counter) is made global by the fan-out / global-authority pattern below. When panes 2/7's
> claim logic is ready, WildSpring wires the zone transport (as done for the outbid crown, §5a), not
> the feature.

| System | Today | Zoned |
|---|---|---|
| **Events calendar** | D1 + `/api/events` (already outside WorldDO) | unchanged |
| **Funding / leaderboard** | `WorldFunding` in WorldDO detects local drive-throughs, writes credits to D1 | detection runs **per zone** (local poses), credit still written to **D1** with the once-ever `UNIQUE(device,season,source,source_ref)` constraint (ties to `gtasf-v2-captable-model-55qd`); leaderboard reads D1 → identical global totals |
| **Outbid crown** | `/internal/outbid/changed` POSTs a revision to the one DO which broadcasts | the **GlobalHubDO** holds the revision and **fans out** `OUTBID_CHANGED` to every active zone (zone registry, §below); each zone broadcasts to its peers |
| **VC-drop "first 50"** | `WorldDrops` counts claims in the one DO | **Already zoned-correct — no transport needed (verified).** The claim is **not** in-DO: `recordDropStore.recordDropClaim` does a single **atomic D1 conditional insert** — `INSERT … SELECT … WHERE (SELECT COUNT(*) FROM fund_drop_claims WHERE season=? AND drop_id=?) < capacity ON CONFLICT(device,season,drop) DO NOTHING`. Because D1 serialises writes and re-evaluates the count inside that one statement, the 51st concurrent attempt from **any** zone inserts nothing. So every zone's `WorldDrops` calling the same statement against the same global table yields exactly ≤ capacity city-wide, with no hub and no new code. (The in-DO `counts`/`claimed` maps are caches re-read from D1.) The §13 pass-bar invariant "VC-drop claims ≤ 50 city-wide" holds under zoning as-is. |
| **Proximity chat (40 m)** | `WorldChat` over the one peer set | per-zone for residents; **cross-border proximity is relayed** (shipped, `gtasf-1xd4`): the origin zone moderates/rate-limits/sequences the `CHAT` as normal, then `WorldDO.fanoutChat` POSTs the finished `CHAT_BROADCAST` + sender pose to the sender's **`borderObservers` cells** (`/internal/chat/relay`), and each re-applies the 40 m visibility to its own peers via `WorldChat.relayIncoming`. `CHAT_RADIUS_M` (40) and the event room radius (8) both sit inside `BORDER_SUBSCRIBE_M` (150), so those neighbour cells are the only ones that can hold a cross-border listener. Observer sockets stay read-only (MOVE/PING) and do **not** carry chat. Jev moderation runs once, in the origin zone |
| **Event chat rooms** | per-event room over the one peer set | event members cluster within the 8 m room anchor; a border-straddling anchor is covered by the **same `fanoutChat` relay** (`relayIncoming` re-checks `currentMember(eventId)` in the sibling cell). A truly city-wide per-event channel (members anywhere) would additionally route through a **hub-backed / D1 fan-out** — not needed while rooms are anchor-local |

**GlobalHubDO — not needed (verified; the hub was dropped).** The globals were planned to route
through a hub, but each is handled without one: the **outbid revision** fans out from `LedgerDO`'s
alarm to **every cell** (`worldBroadcastTargets(zoned)` → `allZoneIds`, P5a `pjvz`) — idempotent
(revision > current) and retried, so no active-zone registry is needed (empty cells are cheap
no-ops); the **VC-drop "first 50"** and **funding credits** are atomic/unique in **D1** (global by
construction, §8 rows above); **proximity chat** and **mayhem** relay over the border-observer band;
**event rooms** are anchor-local, covered by the same relay. A hub would only return if a future
*city-wide per-event channel* (members anywhere) is wanted. So the globals phase adds **no new DO and
no migration** (§11).

## 9. Capacity queue — last-resort fallback

Keep `LobbyDO` FIFO + `worldCapacity`, but as a **global** cap across all zones (total active peers),
set to ~5,000. Normal operation never queues; the queue engages only beyond the zoned capacity.
Per-zone soft caps trigger **split (§6)**, not the queue. When `zonedWorld` is off, admission is exactly
today's single-DO behaviour.

## 10. Protocol additions (`shared/protocol`)

- C2S: observer handshake carries `observe=1`; `ZONE_READY` (client ack of promotion) optional.
- S2C: `ZONE_HANDOFF{to: cx, cy, grant?}` (promote destination), and a `ZONE_INFO{cell, bounds,
  neighbours}` sent at WELCOME so the client knows its cell geometry and when to subscribe.
- Everything else (SNAPSHOT, VEHICLE_SNAPSHOT, CHAT, OUTBID_CHANGED, PLAYER_JOIN/LEAVE) is reused
  unchanged in shape.
- **Player id uniqueness (corrected).** An earlier draft wrongly assumed session ids are globally
  unique — they are **per-DO `AUTOINCREMENT`** (`sessions.ts`), so two zones can both emit local id 1.
  A client merging SNAPSHOTs from its home + neighbour-observer sockets (§5–§7) would then confuse
  them. Fix: the **wire** id is cell-namespaced — `globalPlayerId(cellIndex, localId) =
  cellIndex·2^24 + localId` (`shared/world/zones.ts`, **landed P4e**), with the zone learning its own
  `cellIndex` from `resolveZoneName(request.url)` (the same function index.ts routed it by, so no
  request header/URL stamping). Internal maps stay local; only emitted ids are namespaced (WorldDO
  seeding/emission wiring is the P4e follow-up). **Implication for handoff:** a cell-namespaced id
  changes when a player crosses cells, so *seamless* handoff needs a **stable** global id (device-keyed
  or hub-allocated) — tracked as a handoff-phase decision, separate from the observer-merge fix above.

## 11. Wrangler, bindings, flag

- **Partitioning reuses the existing `WORLD` binding** (refinement found while building P3): each cell
  is a separate instance of the *same* `WorldDO` class via `WORLD.idFromName('z:cx:cy')`, so spatial
  partitioning needs **no new DO class and no wrangler migration** — `'sf'` is just the whole-city
  instance. Zone-specific behaviour (nearest-60, observers, handoff) is added by making `WorldDO`
  zone-aware (reading its cell from the first `?zone=` request) rather than introducing a parallel
  class, which keeps the single-world path identical and avoids a migration for the hot path.
- **No new DO or migration is needed after all (verified).** The globals phase was planned around a
  `GlobalHubDO` (a binding + an append-only `new_sqlite_classes` migration), but every §8 global turns
  out to be handled without it: VC-drop first-50 and funding credits are **atomic/unique in D1**
  (global by construction); the outbid crown (and friends presence) **fan out to every cell** via
  `worldBroadcastTargets(zoned)` → `allZoneIds(grid)` (empty cells are cheap no-ops, idempotent +
  retried — no active-zone registry); proximity chat and mayhem use the **border-observer relay**; and
  event rooms are anchor-local (covered by the same relay). So zoning adds **no new DO class and no
  wrangler migration** — a real de-risking of the ship (shared append-only migrations are the riskiest
  change). A `GlobalHubDO` would only be revisited if a future *city-wide per-event channel* (members
  anywhere, not anchor-local) is wanted; nothing today needs it.
- `shared/flags.ts`: `zonedWorld: false` (**landed, P3**). `index.ts` `/api/world`: when `zonedWorld`
  is on, `worldInstanceName()` resolves the cell (explicit `?zone=`, else `?spawn=` cm→m, else the
  Ferry default) and routes to that instance; otherwise the existing `WORLD('sf')` line runs untouched
  (**landed, P3**). The flag stays **off** in `tools/deploy/production/prepare.ts`'s allowlist for Sunday.
- **Admission/capacity** currently targets the `'sf'` reservation path, so zoned routing is exercised
  with `worldCapacity` **off** until the capacity phase makes reservations zone-aware (or moves the cap
  global). Prod keeps `zonedWorld` off, so this interim does not affect the single world.

## 12. Reuse strategy (why this is tractable by Monday)

`WorldDO` already simulates an arbitrary peer set with per-viewer interest; the zoned work is additive:

1. Make `WorldDO` **zone-aware** in place (not a parallel class): a `ZoneConfig` (cell bounds,
   neighbours, hubRef) learned from the first `?zone=` request and persisted, gating the new behaviour
   behind `zonedWorld`/having a cell — admission `fetch` already routes per-cell (P3), plus observer
   acceptance, `snapshot` selection (nearest-60 via P2 + later spatial hash), and handoff + hub routing.
   The whole-city `'sf'` instance simply has no cell and behaves exactly as today.
2. Pull the 4 global concerns (outbid fan-out, drop claim, event chat, session directory) behind a
   `GlobalHub` interface so single-world keeps its in-DO implementation and zoned uses the hub.
3. Keep the single-world classes as-is; all new behaviour is gated by `zonedWorld` and `ZoneDO`.

## 13. Load test plan (staging only)

Extend `tools/world-load.mjs` (which already builds a disposable Miniflare workerd world + N real
protocol clients and records `stepMs`/bytes):

- Add `ZoneDO`/`GlobalHubDO` to the harness bundle and bind `ZONE`/`HUB`.
- Scale clients **1,000 → 2,000 → 5,000**, each bot given a home position (spread across all cells,
  plus one **hotspot scenario** that dogpiles ~1,000 bots into a single event cell to exercise split).
- Bots **walk/drive across cell borders** on a route so handoff is continuously exercised.
- Record, per run: **CPU `stepMs` p50/p95 per zone**, **bytes/client/s**, snapshot cadence, **handoff
  count and any glitch** (a frame where a visible neighbour momentarily disappears, a dropped/duplicated
  player, or a `PLAYER_LEAVE`+rejoin flicker across a seam), reconnect-across-zones correctness, and
  zero unexpected disconnects/malformed frames.
- **Pass bar (proposed):** per-zone `stepMs` p95 within the DO tick budget at 5,000; bytes/client in the
  same ~8–20 KB/s envelope as the 100-bot `sxoh` run; zero handoff glitches on the border route; global
  invariants exact (outbid revision consistent everywhere, VC-drop claims ≤ 50 city-wide, funding
  once-ever).
- **Run against a STAGING deploy, coordinated with pane 5 (deploys/ops). Never load-test production.**
  The Miniflare harness runs locally for fast iteration; the final 1,000→5,000 acceptance runs against
  staging.

### 13.1 Harness as built (gtasf-drgc)

- **Pure, tested core — `tools/zoned-load/plan.ts`** (10/10): `distributeBots(n, grid, crossEvery)` spreads
  bots round-robin over every cell and marks every `crossEvery`-th bot a border-crosser;
  `countRejoinGlitches(presence)` scores handoff blinks from a per-tick presence stream; `byZone` groups
  per-bot samples for the per-zone breakdown.
- **Safety + topology — `tools/zoned-load/target.ts`** (7/7): `assertStagingTarget(url, extraMarkers)` is the
  hard "never production" gate — it refuses a missing/malformed URL, a non-web scheme, and any host matching
  `gtasf-production` / `gtasf.pages.dev` (or an operator-supplied `GTASF_ZONED_EXTRA_PROD_MARKERS`), and
  normalises http(s)→ws(s). `observerCellsFor` mirrors the client's `zoneView().observers`.
- **Local capstone — `tools/zoned-load/run.mjs`**: Miniflare, 40 bots × 20 zones, per-zone partitioning +
  distinct global-id blocks + bounded cadence. Fast iteration, not the acceptance gate.
- **Live staging driver — `tools/zoned-load/stage.mjs`** (bundles the codec + zone math + core via esbuild,
  Node global `WebSocket`): up to 5,000 real clients, each dialing its home zone (`?zone=cx,cy`) plus
  read-only observer sockets (`?observe=1`) that open/close as it nears borders; crossers walk a straight
  line and **re-home** at the border (drop the home socket, dial the new cell) to exercise handoff. Records
  bytes/client/s, snapshot cadence, RTT, and handoff rejoin-glitches; per-zone CPU/DO wall-time come from
  Cloudflare analytics (pane 5), out of band. Startup runs the safety gate before any socket opens.
- **Staging env contract (pane 5 to provide before the run):** a deploy with **`zonedWorld` ON** and
  **`worldCapacity` OFF** (no admission queue, or 5,000 bots sit in the lobby); the `wss://` origin passed as
  `GTASF_ZONED_STAGING_URL`; CF per-zone analytics access for the CPU side. Invocation:
  `GTASF_ZONED_STAGING_URL=wss://<staging> GTASF_ZONED_BOTS=1000 GTASF_ZONED_SECONDS=60 node tools/zoned-load/stage.mjs`,
  ramping 1,000→2,000→5,000. Client-side metric shape + CF-analytics correlation are **co-designed with pane 5**
  when staging is up; the driver and its pass thresholds may be tuned then.

## 14. Rollout / safety

- All work behind `zonedWorld` (off). Sunday's playtest is unaffected (single `WorldDO('sf')`).
- Land incrementally; each slice keeps the single-world path green (its tests must still pass).
- Monday enablement is a flag flip after the staging load test passes and is reviewed — tracked as its
  own acceptance step, not implied by unit tests.

## 15. Phased build plan (child beads of `gtasf-k1aa`)

1. **Grid + routing + flag** — `zonedWorld`, `ZONE`/`HUB` bindings, cell math + `?zone=` route +
   validation, `ZoneDO extends WorldDO`, `ZONE_INFO` at WELCOME. Single-world path untouched.
2. **Bounded interest** — spatial hash + nearest-60 selection in `snapshot.ts` (used by both paths;
   single-world benefits too).
3. **Neighbour observers** — observer handshake, read-only enforcement, client-side multi-socket merge.
4. **Handoff** — `receiveHandoff` RPC, `ZONE_HANDOFF`, occupied-vehicle/taxi transfer, seam
   leave-suppression, `SessionDirectory` for cross-zone resume.
5. **Globals** — **done without a hub (verified):** outbid crown fans out to every cell
   (`worldBroadcastTargets`→`allZoneIds`, P5a `pjvz`), proximity chat + mayhem relay across the
   border-observer band, VC-drop first-50 + funding credits are atomic/unique in D1; no `GlobalHubDO`,
   no migration (see §8/§11). Was: `GlobalHubDO` outbid fan-out, VC-drop atomic claim, event-chat routing, zone registry;
   funding detection per zone → D1.
6. **Split** — quadtree overload split (only if §13 hotspot run needs it).
7. **Load test** — extend `tools/world-load.mjs`; 1,000→5,000 on staging with pane 5.

## 16. Risks and open questions

- **Cross-zone resume correctness** (§7) is the subtlest piece — the `SessionDirectory` must be
  authoritative enough for reconnects without becoming a hot-path dependency.
- **Seam flicker**: getting leave-suppression and the observer→writable promotion exactly right so no
  player pops. Covered by the handoff glitch metric in §13.
- **Hotspot at one event** is the hardest load shape; the nearest-60 cap bounds per-player cost, but a
  single zone serving ~1,000 sockets may still need the split. The load test decides whether phase-6 is
  required for Monday.
- **Vehicle/taxi crossing a border mid-drive** — handoff of an in-progress route must not teleport or
  stall the car; needs a dedicated handoff test.
- Exact SF bbox + cell count to be pinned from the map manifest when slice 1 wires routing.
