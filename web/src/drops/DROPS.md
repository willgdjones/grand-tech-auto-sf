# VC fund drops — module contract (PLAN-v2 decision 3)

Owner: SwiftBay (pane 3) · bead `gtasf-v2-vc-fund-drops-27v2` · flag `fundDrops` (on), `fundDropSponsors` (off, Stripe-gated).

Server-scheduled "`<Fund>` announces a new fund — come pitch!" checkpoints. A continuous clock-driven
schedule keeps exactly one parody fund live at an SF spot at a time, rotating every 15 min. The first
50 players to **drive or walk through** the open checkpoint get a one-ever **$250k** cheque. The server
(WorldDrops) detects the pass-through authoritatively; the client only displays and polls.

## Pieces
- `shared/drops.ts` — schedule, types (`FundDrop`, `LiveFundDrop`, `FundDropState`, `FundDropClaim`).
- `worker/src/funding/drops.ts` — `WorldDrops` (tick detection + `/api/drops/state`) and
  `handleDropsRequest` (public-Worker forwarder). Wired into `WorldDO` already.
- `worker/src/funding/dropsStore.ts` — D1 claim ledger `fund_drop_claims` (migration 0018), atomic
  first-50. `listDropCapTable(db, deviceId)` → the `fund-drop` rows for the unified cap table (pane 4).
- `web/src/drops/{client,banner,checkpoint,radarBlip}.ts` — see below.

## main.ts wiring (pane 1) — exact additive diff

1. Imports (near the funding imports):
```ts
import { createDropsClient } from './drops/client';
import { createDropBanner } from './drops/banner';
import { createDropCheckpoint } from './drops/checkpoint';
```

2. After `const fundingRoom = createFundingRoom({ ... });`:
```ts
const dropBanner = createDropBanner();
const dropCheckpoint = createDropCheckpoint({ scene, surfaceHeightAt: surface.heightAt });
const drops = createDropsClient({
  onClaim: claim => { dropBanner?.celebrate(claim); notify(`CHEQUE SECURED · +${formatFunding(claim.amountCents)} from ${claim.fundName}`, 8000); },
  onError: text => notify(text, 8000),
});
drops?.init();
```

3. In the per-frame loop (next to `funding.update(...)`, NOT gated on `funding`):
```ts
if (drops) { drops.update(foot, mode, connected, now); dropBanner?.update(drops, Date.now()); dropCheckpoint?.update(drops, now); }
```
`now` is the loop's performance-clock value (same one `streetProps.update` uses); the banner takes
`Date.now()` for the close countdown.

4. Cleanup (next to `funding?.destroy()`):
```ts
drops?.destroy(); dropBanner?.destroy(); dropCheckpoint?.destroy();
```

No changes to the funding/event paths. Drops are independent of event rooms.

## index.ts (public Worker)
Add once (already on the shared tree): `import { handleDropsRequest } from './funding/drops';` and, after the
funding route, `const drops = await handleDropsRequest(request, env); if (drops) return drops;`.

## Radar/map (pane 2/5)
`dropRadarBlips(drops)` → `DropRadarBlip[]` (`{id,title,x,z,lat,lon,remaining,capacity,mine,out}`), world
x/z in the peer frame. Draw a gold diamond + optional "N/50"; dim `mine`, grey `out`.

## Cap table (pane 4, decision 5)
Drop cheques are in `fund_drop_claims` and already union into `funding_earnings`. For the per-player cap
table also read `listDropCapTable(db, deviceId)` and merge by `claimedAt`.

## Sponsor ad product (decision 3, flag `fundDropSponsors` — off, Stripe-gated)
Each drop is an advertisable slot: a real VC/startup can sponsor it under its real name (parody by
default). Admin plumbing (invisible unless `fundDropSponsors` + `ADMIN_TOKEN` are set), direct D1 writes:
- `POST /api/drops/sponsor` `{slot,name,url?,logoUrl?}` — assign a slot to a sponsor.
- `POST /api/drops/sponsor/clear` `{slot}` — release back to parody.
- `GET /api/drops/sponsors` — list current overrides.

`WorldDrops` reads these via `dropSponsorOverrides` and renames the drop through `activeDrops(now,
sponsors)`, leaving geometry/window unchanged. The paid purchase/checkout path is **Stripe-gated and
deferred** (`flags.stripe` off); operator-set is the current route.
