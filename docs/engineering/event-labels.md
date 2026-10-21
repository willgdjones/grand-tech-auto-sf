# GTASF: event titles visible in the 3D world (ship before tonight's 18:00 freeze)

## Context
The founder sees only gold circles at events, with no titles. The label code exists, but **it never reaches production**:
- `floatingEventNames` is `true` in `shared/flags.ts:123`, but it isn't in the prod `reviewed` allowlist (`tools/deploy/production/prepare.ts`; the prod build writes `flags[key] = reviewed.has(key)`).
- The same is true of `checkpointPillars`, `dimCollectedMarkers` and `eventKindColors`.
- Even when on, today's labels only exist for the **12 nearest markers within 220 m** (`web/src/events/markers.ts:228-281`). They use a dark panel, and overlapping labels are hidden.
- The prepare.ts:75 and markers.ts:19-20 comments saying it's "off pending look gate" are stale.

Founder decisions from the grilling:
- **Content:** title and live status at range. Time, payout and host/venue appear under it when you're within about 80 m.
- **Range:** up to about **500 m**.
- **Crowding:** **show all** labels in range, and they **must never overlap**.
- **Style:** **SA-style floating text**: bold outlined SA type, no box.
- **Phones/Low:** fewer labels (about 6, about 250 m).
- **Timing:** tonight, deployed by the orchestrator after a prod check.

## Design (all in `web/src/events/markers.ts` + small helpers)
1. **Separate labels from rings.**
   - Rings keep their current pooled ≤12 within 220 m (cheap, and they're the trigger).
   - Labels get their **own pool**: every venue marker within 500 m (desktop/HD) or 250 m (Low/phone).
   - A desktop safety cap of about 60 sprites, nearest first. There's no visible priority hiding; the cap only guards performance and is far above what the downtown screen can hold.
   - Venue-grouped like today (`setEvents`, `focusVenues`, `venueGrouping` + `eventFocus24h`, both ON in prod).
2. **SA floating text.** Replace the dark panel in the label canvas (`markers.ts:79-117`) with `drawOutlinedText` from `web/src/theme/saText` (already used by fund-drop labels in `web/src/drops/checkpoint.ts:14-32`):
   - cream title with a black outline;
   - a red "LIVE NOW" badge or a gold "6:30 PM";
   - close-range detail lines: "$2.3k · by <host> · <venue>".
   - Use `depthTest: false` like fund drops so buildings don't swallow labels, and fade opacity with distance so far labels stay subtle.
3. **Detail by distance.**
   - Within 80 m: title, time/live, payout, host/venue.
   - Beyond: title plus the live badge only.
   - The texture redraws only when `labelKey` changes (existing).
4. **Never overlap, never hide.** Replace "hide the farther label" in `placeLabels` (`markers.ts:184-227`) with **placement**:
   - project each label to an NDC box (existing code), then process nearest first;
   - try the anchor, then step upward in label-height increments (a stack), with a thin leader line from the ring to the raised label;
   - if there's still no free slot after N steps, shrink it to a compact title-only chip and try again.
   - Reuse the box-intersection logic from `cullOverlappingLabels` in `web/src/radar/districts.ts:102`.
   - Recompute placement at about 10 Hz (not every frame) and smooth the movement so labels don't jitter.
5. **Payout on labels.** Use `FUNDING_BASE_CENTS[classifyEventKind(title, venue)]` (`shared/funding.ts:114`, v3-aware), with the max per venue as `radar.ts:307-308` does.
6. **Low/phone.** Pass `graphicsPreset()` (`web/src/render/graphicsPreset.ts:44`) or the foundation tier into `createEventMarkers` (`main.ts:540`) for the 6-label / 250 m limits and smaller canvases.
7. **Prod flags.** The orchestrator adds `floatingEventNames`, `eventKindColors` and `dimCollectedMarkers` to `reviewed` at deploy. `checkpointPillars` stays out unless the prod screenshot shows it helps.
   - Fix the stale comments.
   - CHANGELOG: "Event names now float above every event, with time, payout and host up close."

## Owner (respects the max-4 rule: robotaxi Codex + economy Claude + this = 3 active)
- **Codex (window codex2 pane 4, idle, low effort, did vehicle/LOD rendering):** owns `web/src/events/markers.ts`, the label helpers and the `main.ts:540` options line only (codex2.2 owns other main.ts robotaxi wiring, so coordinate via Agent Mail if both touch main.ts).
- **Orchestrator:** deploys after a prod check (rollback: the previous SHA).

## Verification
- Unit tests:
  - the placement never produces overlapping boxes (random dense layouts);
  - the label text at near vs far distance;
  - the payout string per kind (v3 values);
  - the Low preset caps.
- Local: `tools/heavy.sh npx tsc --noEmit -p web/tsconfig.json` plus those tests, and ONE headed screenshot downtown (Powell/Moscone) at 1280x800.
- Prod check after deploy (headed, real GPU):
  - Ferry, Mission and downtown (?at=37.7840,-122.4010, SoMa): titles are readable;
  - no overlapping labels in the dense cluster;
  - detail lines appear when walking within 80 m;
  - 0 console errors;
  - the phone viewport shows about 6 labels.
- If it fails, keep `floatingEventNames` out of the allowlist; the circles stay.
