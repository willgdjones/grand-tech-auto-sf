# GTASF: robotaxi as quick travel (ship before tonight's 18:00 freeze)

## Context
The founder wants robotaxis to take you straight where you want to go. Today a ride is a real-time, server-authoritative drive along the road graph:
- `LocalRobotaxis` in `worker/src/world/localRobotaxi.ts` moves the cab every tick, capped "never teleport a whole trip".
- Pickup is about 13–15 s in classic mode; prod runs `madMaxRobotaxi` (instant board, 2.4× speed).
- A cross-city ride still takes minutes, which is dead time for a game about attending events.

Founder decisions from the grilling:
- **Ride feel:** the taxi pulls up in about 3 s and you hop in. Then an **SA-style title card** plays: letterbox bars, a quick shot of the taxi driving off, cut to black with the destination name, cut in at the drop-off. You step out.
- **Skip:** the first ride plays in full; after that any key skips once the destination has loaded.
- **Destinations:** Tech Week events (V), any map click (M), landmarks/quick destinations, and accepted friends (dropped on the nearest road within about 50 m; the friend gets an "X is on the way" notice).
- **H key:** opens an SA-styled **"Where to?" picker**:
  - the current map pin or event at the top, then nearby events, landmarks and friends, each with its fare;
  - M and V also get a **"Ride here · $X"** button.
- **Fare:** distance-based, about **$100 + $150/km** (Ferry→Lombard ≈ $550, cross-city ≈ $1.5k).
  - The **first 3 rides per profile are free**.
  - If you can't afford it, the taxi refuses ("Not enough funding: walk or drive") and you travel yourself.
  - Funding never goes negative.
- **Payouts:** no payout on arrival. You're dropped next to the event, outside its ring, and enter it yourself. Passengers never earn drive-through payouts (the existing madMax rule).
- **Old ride:** the real-time ride is **removed**; traffic robotaxis still roam as scenery.
- **Timing:** tonight, behind a flag. Deploy only if it passes the prod check; otherwise the current ride stays for the playtest.

## Design

### Server (`worker/src/world/localRobotaxi.ts`, `WorldDO.ts`)
New flag `quickRobotaxi` (shared/flags.ts, ON in dev once done, added to the prod allowlist only after the check). With it on, `hail(peer, destination)`:
1. **Validate the destination.** Snap it to a road with `resolveRobotaxiDestination` / `roads` snapping (reuse the existing logic). For an event or landmark, pick a drop point on the road **outside the event ring radius**: use the route's `approach` point (as `selectEvent` does in `web/src/main.ts:596-616`) and push it out to ring radius + 10 m. For a friend, use the nearest road within 50 m of their current pose (only if `friends` is on and they're an accepted friend).
2. **Quote and charge the fare atomically** through the funding authority (owned by the economy lane, below). Reject with `ROBOTAXI_STATE {status:'unaffordable', fare}` if not affordable.
3. **Pickup:** spawn the cab about 25 m up the road (`roads.approach(pickup, 25)`) so it pulls up in about 3 s, then board. Force-board after 4 s if the player hasn't walked over (madMax already has a `force` board path at `:53`).
4. **Quick trip:** send `ROBOTAXI_STATE {status:'quick', destination, title, durationMs: 4000}`. Without stepping the route, after the client confirms `ready` (destination chunks loaded) or a 6 s timeout:
   - teleport cab and passenger to the drop point (reuse the `recoverRoad` pattern at `WorldDO.ts:820-842`: reset `session.movement`, `carryCm: 0`, send `CORRECTION`);
   - `fleet.exit` the player beside the cab and send `arrived`;
   - the cab drives off and despawns as now (`:132-135`).
5. **Payout safety:** the passenger is never credited during the trip (extend the `PASSENGER_FLAG` skip in `worker/src/funding/world.ts:222` to quick trips regardless of madMax). Arrival is outside rings by construction.
6. **Remove the real-time ride path** when the flag is on (keep the code for the flag-off fallback tonight).
7. **Zoned world** is off (`zonedWorld: false`). Document that a quick trip across cells needs a handoff later, but don't build it.

### Fare and free rides (economy lane, `worker/src/funding/*`, `shared/funding.ts`)
- `robotaxiFareCents(distanceM) = 100_00 + 150_00 × km`, rounded to $10, with the distance measured from the pickup and drop points.
- A new **debit** path: an idempotent ledger row keyed by ride id that subtracts the fare in one conditional D1 statement (`WHERE funding >= fare`), so funding never goes negative and one ride can't be charged twice. Burn maths must treat it like any other balance change, and demotion to Bootstrapping still applies.
- `free_rides_used` per profile (0–3). The first 3 quotes are $0, and it survives the reset (new profiles start at 0).
- Expose `quoteRide(device, distance)` and `chargeRide(device, rideId, fare)` for the robotaxi server code.
- Tests: the fare formula; free rides 1–3 then paid; insufficient funds rejected; idempotent charge; never negative.

### Client (`web/src/vehicles/robotaxi/client.ts`, `web/src/main.ts`, `web/src/hud/*`)
- **H opens "Where to?"**, an SA-styled panel matching the pause menu from #5.9 (`b2a62d8`).
  - Rows: the current pin or event, nearby events (from the events list), landmarks (`PLACES` in `web/src/spawn/locations.ts:10`) and friends (if `friends` is on).
  - Each row shows its fare, or "FREE (2 left)". Picking a row sends `ROBOTAXI_HAIL`.
- **M and V get a "Ride here · $X" button** that calls the same hail.
- **Title card** on `status:'quick'`:
  - letterbox bars, about 1 s of the taxi pulling away (camera behind the cab), cut to black;
  - the destination name in SA type ("LOMBARD STREET"), cut in;
  - meanwhile call `world.ensureAround(dropPoint)` (the `correct()` pattern at `main.ts:376-389`) and send `ROBOTAXI_READY` once loaded;
  - any key skips after the first ride (remember first-ride-seen in profile or localStorage), but only once ready.
- Toasts for `unaffordable` ("Not enough funding: $X fare") and for a friend's "X is on the way".
- CHANGELOG entry (player-facing).

## Owners (respects the max-4-agents rule; low effort)
- **Codex (window codex2 pane 2, just finished the HUD):** server quick trip + client picker + title card. It owns `localRobotaxi.ts`, the robotaxi parts of `WorldDO.ts`, `web/src/vehicles/robotaxi/*`, the picker in `web/src/hud/*` and `main.ts` wiring.
- **Economy (Claude sub3, 0.2):** fare/free-ride debit API + tests. It owns `worker/src/funding/*` and `shared/funding.ts`. It agrees the `quoteRide`/`chargeRide` contract with the Codex agent on Agent Mail first.
- **Orchestrator:** deploys #5.10 itself (dry run, flag list, prod check, rollback to `b2a62d8`).

## Verification
- Unit tests:
  - the fare and debit (economy);
  - the drop point lies outside the ring;
  - the quick trip teleports and exits the player with no credit while a passenger;
  - an unaffordable fare is rejected.
- Local: `tools/heavy.sh npx tsc --noEmit -p web/tsconfig.json` and the worker tsconfig, plus those tests.
- Prod check after deploy (headed, real GPU, fresh profile):
  1. press H, see the picker with fares and "FREE (3 left)";
  2. pick Lombard: taxi pulls up within 4 s, title card plays, you arrive near Lombard on foot, funding unchanged (free ride);
  3. pick an event: you arrive outside its ring and no payout fires until you walk in;
  4. two tabs: the other player sees you get in and later reappear;
  5. 0 console errors.
- If any of this fails, keep `quickRobotaxi` out of the allowlist for tonight; the current ride stays.
