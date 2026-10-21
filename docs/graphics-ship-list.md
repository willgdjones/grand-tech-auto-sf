# Graphics + perf ship list (overnight Oct 6–7)

Founder ask: "how can we get everything better graphics too?" This page tests every finished graphics and perf flag
that is on in dev but not in prod. It ends with one batch to approve and a list of flags to hold back.

Method:
- Preview builds were published to `preview.gtasf.pages.dev` (Pages preview branch only; the production Worker and
  data were not touched). They talk to the live production API and world, so the Ferry has the live crowd.
- `tools/graphics-tour.mjs` captured the same 14 spots on desktop HD and phone Low:
  - the 12 tour spots, plus the Mission district and the Embarcadero promenade;
  - once at night (live clock) and once at 14:00 (`?time=14:00`);
  - from gtasf.com (before) and the preview (after).
- Phone fps comes from `tools/phone-perf.mjs`: 1080x2400 at DPR 2.75, 4x CPU throttle, Low, 120 frames, Ferry and
  SoMa.
- All captures: 0 console errors, both before and after.

**Caveat on fps:**
- The host was shared and busy all night (load 9–57). Production itself read 21–33 fps at Ferry and 19–29 at SoMa,
  depending on the run. Small fps differences are noise. Paired runs and repeated stalls are the reliable signals.
- `phone-perf.mjs` gained `GTASF_PHONE_INTRO_OPTIONAL=1`, recorded in `report.config`. Production fails the harness's
  "fresh profile shows the intro" check today: the intro is not visible at READY under 4x throttle. These numbers are
  before/after comparisons, not the official phone gate.

## Recommended batch (approve as one)

**Visual (12):**

| Flag | What it adds | Evidence |
|---|---|---|
| realisticRender | PBR lighting/materials | Subtle at night. HD boot ~2x slower (8–15 s vs 5–8 s) but it loads. |
| rooftopClutter, rooftopClutterLow | rooftop dressing | No breakage seen. |
| storefrontPieces | Meshy hero pieces (awnings, bays…) | HD only. No breakage seen. |
| hdUrbanSurfaces | HD road/sidewalk surfaces | SoMa: clean kerb + double yellow lines. |
| streetDetail | street furniture | Mission / SoMa. |
| embarcaderoPromenade | promenade dressing | Embarcadero shots. |
| missionStreetDressing | trees, planters, benches on Mission | **Biggest win**: `day-13-mission-desk.jpg`, `13-mission-phone.jpg`. |
| kerbParkedCars | parked cars along kerbs | Mission, promenade, Lombard. |
| gpuBirds, propKnockover, skyAds | ambient birds, knockable props, sky ads | No breakage seen. |

**Perf (10):**

| Group | Flags | Phone result |
|---|---|---|
| Chunk/road | lowRadarBudget, lowInstancedQueue, chunkRoadMerge, lowDetailCull, fastRoadSampler | **Best numbers of the night**: Ferry 36.8 fps, p95 35 ms; SoMa 42.1 fps, p95 31 ms; worst frame 45 ms. Prod at similar load: 21–29 fps, p95 50–100 ms. |
| Instancing | lowInstancedKerbCars, lowBatchedProps, lowPeerImpostors, emptyInstanceSkip, hiddenFleetMatrixSkip | Within noise of prod (Ferry 15.7–24.6 fps vs prod 21.3–24.9); no stalls over 320 ms. |

## nearRoadGraph alone: phone world-ready 18.8 s → 6.6 s (measured 11:00 Oct 7)

nearRoadGraph-only build plus the dry-run near graph, phone cold load (390x844 DPR 3, 4x CPU, 4G), 2 runs: world-ready
**6.67 / 6.61 s vs 18.8 s live**, first-load transfer **7.8 MB vs 13.55 MB**. Loading is where 73% of new players are
lost (1,011 of 1,380 since #5.31), so this is the most valuable flag on the list. The publish step is rehearsed
against live (sha match, backup + rollback printed; gtasf-0k01).

## Load check before shipping (10:05 Oct 7): batch first load 15.31 MB → 14.91 MB after a fix (budget 15 MB)

`tools/perf/phone-cold-load.mjs` (390x844 at DPR 3, 4x CPU, 4G), against the live API:

| Build | READY | First-load transfer |
|---|---|---|
| prod | 19.8 s (world-ready 18.8 s) | 13.55 MB |
| 27-flag batch (local dist) | world-ready 19.3 s (READY mark missing: readyMs -1) | **15.31 MB, over the 15 MB first-load budget** |

- **Fixed (753bd099):** the extra was the facade storefront hero pieces (`facades-pbr/entrance.low.glb`
  244 KB, `storefront.low.glb` 169 KB). `createFacadeStorefronts` had no HD check, so Low phones (coarse pointer → auto
  Low) downloaded them. Re-run with the fix: **14.91 MB**, under budget but with almost no headroom; no facades-pbr
  requests; world-ready 19.8 s.
- `readyMs: -1` on local-dist runs is the tool's own behaviour (phone-cold-load.mjs line 52), not a missing READY
  mark. Compare world-ready.
- No load-time win yet: the live map doesn't publish the near graph. The phone load cut (~20 s to ~6 s locally) only
  lands on the first deploy with nearRoadGraph, which publishes it (6c690e50). Loading is the biggest funnel leak:
  1,011 of 1,380 new players since #5.31 left before reaching the game (prod D1).

## Clean fps delta (03:20 Oct 7): alternating prod / batch at similar load (7–10)

120 s warmup, 120 frames, prod and batch alternated twice (prod, batch, prod, batch):

| | Prod runs | Batch runs | Mean prod → batch |
|---|---|---|---|
| Ferry | 44.5, 47.1 fps (worst 37, 37 ms) | 44.5, 44.3 fps (worst 34, 44 ms) | 45.8 → 44.4 (−3%) |
| SoMa | 45.2, 44.7 fps (worst 42, 40 ms) | 49.8, 39.2 fps (worst 28, 50 ms) | 45.0 → 44.5 (−1%) |

**Level within noise.** The full 27-flag batch adds every visual on this page at essentially no phone fps cost once
scenery is mounted. Worst frames stay at 28–50 ms throughout.

## Whole-batch phone check (02:45 Oct 7; superseded by the clean delta above)

All 27 flags in one build (dry-run at HEAD) against prod. 120 s warmup, so scenery is mounted in both. Phone harness:
1080x2400 at DPR 2.75, 4x CPU, Low, 120 frames.

| Run | Ferry | SoMa |
|---|---|---|
| **Batch (load 10)** | **41.1 fps, p95 32.5 ms, worst 50 ms** | **40.7 fps, p95 32.9 ms, worst 42 ms** |
| Prod (load 22) | 35.7 fps, p95 42 ms, worst 50 ms | 38.9 fps, p95 38.7 ms, worst 86 ms |
| *Noisy first pair:* batch (load 17) / prod (load 33) | 17.0 / 21.7 fps | 27.7 / 17.0 fps |

- The clean pair shows no phone fps cost from the full batch once scenery is mounted, and better worst frames.
- The batch ran at lower host load than prod, so treat the gain as "no regression", not as a measured speed-up.
- 0 console errors in every run.

## FINAL v2 (02:30 Oct 7): ship ALL 27 flags — layoutWorker cleared

1.0 spotted that the layoutWorker "regression" wasn't a like-for-like comparison. Without the worker, prod's
street-prop layout takes 40–90 s on the phone harness, so prod's 2 s-warmup window had **no street props, kerb cars or
road details mounted yet**. With the worker they mount early, inside the window.

Re-measured both after a 120 s warmup, so scenery is mounted in both (`GTASF_PHONE_WARMUP_MS=120000`, 120 samples):

| Build | Ferry | SoMa |
|---|---|---|
| prod (load 10) | 34.1 fps, p95 45 ms, worst 63 ms | 38.7 fps, p95 35 ms, worst 68 ms |
| **layoutWorker** at HEAD (load 15) | **40.2 fps, p95 33 ms, worst 39 ms** | **41.2 fps, p95 35 ms, worst 58 ms** |

Steady state with layoutWorker is better than prod, even at higher host load. The early mount stall that prod pays
later (40–90 s in) is reduced by 121c43a2 + f6f6730d (shaders compiled and textures uploaded hidden before reveal).
**Add layoutWorker to the batch.**

## FINAL (00:50 Oct 7): ship 26 of 27 flags (superseded by v2 above) — hold only `layoutWorker`

- Every flag in the lists below **plus realisticFacades** (fixed at 008ca827, see next section) **plus
  `nearRoadGraph`, `loadingBeacon`, `staticMatrixFreeze`**.
- Hold **`layoutWorker`**: it alone causes the recurring phone stall.

The four held "structural" flags were split with local builds measured against the live API
(`GTASF_PHONE_LOCAL_DIST`). Phone Low, Ferry and SoMa, 2 runs each:

| Build | Ferry fps | SoMa fps | Worst frame |
|---|---|---|---|
| nearRoadGraph + layoutWorker | 24.9–29.8 | 24.5–29.0 | **522–546 ms every run** |
| loadingBeacon + staticMatrixFreeze | 34.3–34.7 | 29.3–33.2 | 43–89 ms |
| nearRoadGraph alone | 23.6–41.2 | 30.7–35.6 | 39–154 ms |
| **layoutWorker alone** | 26.8–29.8 | 24.7–25.7 | **491–673 ms every run** |

- Why layoutWorker stalls: a CDP profile shows the stall is not the worker. It is road details' whole-city index
  (`roads.ts` indexLayout, ~0.7 s). It used to run before READY and now lands after it, because the worker lets READY
  fire sooner. Follow-up: **gtasf-trqe**.
- nearRoadGraph is harmless, but it has **no effect until the map publish runs the subset step**: the live manifest has
  no `roadGraphNear`. Its phone load win (33 s → ~6 s locally) only lands then.
- **Deploy note for nearRoadGraph:** with it in the allowlist, the next routine `--skip-map` deploy publishes the
  near graph and **replaces the live `map/lombard/manifest.json` in R2** (6c690e50, reviewed OK; refused unless cut
  from the live road graph). Save the current manifest first (`curl -s https://gtasf.com/map/lombard/manifest.json`)
  so rollback is one re-upload.
- loadingBeacon needs migration 0037 and its prepare.ts review.

Ship list for `tools/deploy/production/prepare.ts` reviewed:
realisticRender, realisticFacades, rooftopClutter, rooftopClutterLow, storefrontPieces, hdUrbanSurfaces, streetDetail,
embarcaderoPromenade, missionStreetDressing, kerbParkedCars, gpuBirds, propKnockover, skyAds, nearRoadGraph,
lowRadarBudget, lowInstancedQueue, chunkRoadMerge, lowDetailCull, fastRoadSampler, lowInstancedKerbCars,
lowBatchedProps, lowPeerImpostors, emptyInstanceSkip, hiddenFleetMatrixSkip, staticMatrixFreeze, loadingBeacon.

## Update 00:50: realisticFacades fixed at 008ca827 — add it to the batch (23 flags)

AmberValley's **008ca827 [gtasf-oeua]** instances the Meshy hero pieces with a cap. Before, every placed copy was
cloned and transformed on the main thread; a CDP profile showed `applyMatrix4`, `setXYZ` and `computeBoundingSphere`
dominating, with 5 s+ freezes. The world socket timed out before opening, which caused the hang.

All-flag build at 008ca827 on HD at 14:00: Embarcadero 5.3 s, Columbus 5.3 s, Chinatown 4.8 s, Lombard 4.7 s,
Coit 5.3 s, FiDi 4.0 s, promenade 5.1 s to READY, 0 errors. Earlier builds: never or 80 s.
Ship realisticFacades **only with a deploy at or after 008ca827**. Hero pieces are HD-only, so the phone numbers below
are unaffected.

![FiDi, all flags fixed](graphics-ship-list/fixed-08-fidi-desk.jpg)
![Chinatown, all flags fixed](graphics-ship-list/fixed-04-chinatown-desk.jpg)

## Hold (do not ship yet)

| Flag | Why | Evidence |
|---|---|---|
| ~~realisticFacades~~ (fixed: see update above) | **HD boot hang** (before 008ca827) at north-east spots: Embarcadero, Chinatown, Lombard, Coit and FiDi never reached READY; Columbus took 80 s. "Still connecting to the city… Reload city". This is the same hang behind deploy #6's rollback. | Two full tours (night and 14:00). Bisect: the same build minus realisticFacades loads all of those on HD in 8–15 s. Phone Low is unaffected. |
| **nearRoadGraph, layoutWorker, loadingBeacon, staticMatrixFreeze** | Together they cause recurring 0.8–1.4 s main-thread stalls on phone, in every run with them, and never in runs without them. The full batch's SoMa drop (22.7/19.5 fps vs prod 29.3/28.4 in paired runs) includes these stalls. | `perf-S4` and the full and perf-only builds (artifacts/graphics-tour). They were not split into pairs because the Cloudflare preview token started failing at ~00:20 Oct 7 (401). The next step is to bisect these four. Also note: nearRoadGraph does nothing until the map publish runs the subset step (the live manifest has no `roadGraphNear`), and loadingBeacon needs migration 0037. |

Upside on hold: the full batch reached READY faster on phone (17–23 s vs prod 22–34 s), which is likely from
layoutWorker or nearRoadGraph. That is worth it once the stall is found.

## Known issues (not blocking the batch)

- **Jagged white headlight pools at night, already in prod:** the bright white pool next to the parked cars
  (promenade, Mission) comes from a passing *fleet* car's headlights (`fleet.ts`: only moving or driven vehicles get
  `gtasfHeadlight`), not from kerbParkedCars. The stair-stepped edge is the lamp light map's texel resolution
  (`lampLightMap.ts`). Corrected after a code check; the first draft blamed kerbParkedCars.
- **Night facades, already in prod:** big flat orange blotches across whole walls instead of lit windows (SoMa, Hayes,
  Castro). This is in prod today, not caused by any flag here. It's a priority look bug of its own.
  **Fixed in source (ships with the next deploy): `brickNightWindows` flag, default OFF.** Brick/mixed fronts no
  longer glow at night; towers keep their lit windows. A stricter mask at half strength (variant B) still blotched.
  Night A/B against live (prod / A no brick glow / B strict mask, 0.4):
  ![SoMa night brick](graphics-ship-list/night-brick-windows-soma.jpg)
  ![Hayes night brick](graphics-ship-list/night-brick-windows-hayes.jpg)
- **To watch at night: towers.** A close-up tower wall at FiDi (03:54) showed one flat pale-yellow panel. The lamp
  light map is ruled out: it only lights upward-facing surfaces. The likely source is tower lit windows (towers keep
  the glow that brickNightWindows removed from brick), with the mask covering wall as it did on brick. That's one
  close-up frame only, so nothing changed. If it shows up from street distance, gate tower glow like brick.
- **FiDi night HD, resolved:** the one capture missing event titles and radar dots was a one-off. Two re-runs of the
  full 27-flag build at FiDi at night (03:54) both show every event title and the radar event dots.
- **Phone harness intro check, resolved (244d44a3):** not a player bug. With the paint intro on, onboarding replaces the
  slides with the 'Paint the Ferry Building' mission by design, and the harness now accepts either one.

## Photos

Each image is before (gtasf.com) on the left, after on the right.

- **Daytime 14:00, all flags:** `docs/graphics-ship-list/day-<spot>-desk.jpg` and `day-<spot>-phone.jpg`
- **Night (live clock), all flags:** `docs/graphics-ship-list/<spot>-desk.jpg` and `<spot>-phone.jpg`
- **Recommended batch (no realisticFacades) at the hang spots:** `docs/graphics-ship-list/batch-{04-chinatown,06-lombard,08-fidi}-desk.jpg`

Highlights:

![Mission daytime](graphics-ship-list/day-13-mission-desk.jpg)
![SoMa daytime](graphics-ship-list/day-09-soma-desk.jpg)
![Embarcadero promenade daytime](graphics-ship-list/day-14-embarcadero-promenade-desk.jpg)
![Mission phone night](graphics-ship-list/13-mission-phone.jpg)
![Chinatown, recommended batch](graphics-ship-list/batch-04-chinatown-desk.jpg)

## State left behind

- `preview.gtasf.pages.dev` currently runs the **S4 build** (`nearRoadGraph,layoutWorker,loadingBeacon,staticMatrixFreeze`
  plus graphicsV2), not the batch. Republish the batch once the Cloudflare token is refreshed:
  `npm run deploy -- --preview --flags realisticRender,realisticFacades,rooftopClutter,rooftopClutterLow,storefrontPieces,hdUrbanSurfaces,streetDetail,embarcaderoPromenade,missionStreetDressing,kerbParkedCars,gpuBirds,propKnockover,skyAds,nearRoadGraph,layoutWorker,lowRadarBudget,lowInstancedQueue,chunkRoadMerge,lowDetailCull,fastRoadSampler,lowInstancedKerbCars,lowBatchedProps,lowPeerImpostors,emptyInstanceSkip,hiddenFleetMatrixSkip,staticMatrixFreeze,loadingBeacon`
  (all 27 flags; still 401 at 05:39 Oct 7).
- Raw captures and perf reports: `artifacts/graphics-tour/` (ignored).
- Tour script: `tools/graphics-tour.mjs <base> <out> [desk|phone|both] [spots]`, with `TOUR_TIME=14:00` and
  `TOUR_LOCAL_DIST=<built web dir>` for flag bisects against a live API.

To ship the batch, add the 22 flags to `tools/deploy/production/prepare.ts` reviewed. Production enables only
reviewed flags.
