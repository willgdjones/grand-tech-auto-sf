import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { flags } from '../../../shared/flags';

const databaseId = process.argv[2];
if (!databaseId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(databaseId) || /^0+-0+-0+-0+-0+$/.test(databaseId))
  throw new Error('Usage: tsx tools/deploy/production/prepare.ts <actual GTASF production D1 UUID>');
const account = 'YOUR_CLOUDFLARE_ACCOUNT_ID';
const reviewed = new Set([
  'bootstrapScene','multiplayer','onFoot','ps2Render','unifiedInput','testingHarness','worldCapacity','waitlist',
  'mapStreaming','terrain','landmarks','buildingFacades','radar','hud','driving','robotaxi','mobile','fullMap','waypoints',
  'eventsView','eventNavigation','eventsApi','deepLinkSpawns', // outbidBanner + outbidCrown removed for now (founder, Oct 4 ~13:00)
  // V2 SA map (PLAN-v2 decisions 7-8, pane 5): parchment pause-map, zoom/pan, click-anywhere
  // road-snapped waypoint + clear, one-blip-per-venue + next-24h focus + venue browser. Game-data/UI
  // only, no external secret; unit + bundle verified. Visual acceptance via pane 6's milestone smoke.
  'saMapStyle','venueGrouping','eventFocus24h',
  'gtmPipeline','gtmCatalogue','gtmSpawns',
  'fundingLoop','driveThroughFunding','capTable','fundedStars','events','eventVisits','eventsRefresh','sun','weather','saAtmosphere','loadingArt',
  'traffic','cableCars','radio','streetProps','parodyBillboards','groundTextures','roadDetails',
  'cityLife','hazards','nightLighting','chat','eventChat',
  // V2 milestone #1 (2026-10-03): game-data/UI surfaces — overhead nameplates, VC fund drops,
  // F-key feedback, What's-new/changelog. eventSubmission joins now that TYPESAFE_API_KEY is
  // provisioned (Jev gates spam) with the H6 rate-limit + M1 fail-safe landed. Founder-path smoke
  // green on current main; celebNpcs is added by the deployer only after the in-run look-check passes.
  'nameplates',/* fundDrops removed: founder, Oct 4 */'feedback','feedbackBuildTag','changelog','eventSubmission',
  // In-game referral rewards (deploy #2, founder decision): `referrals` + `referralWarmIntro` are a
  // FUNDING BONUS for inviting friends — pure game data, no money. The real-money referral flags
  // (referralCredit/referralClaims/referralCashout) are dropped and stay OFF permanently (payment guard).
  'referrals','referralWarmIntro',
  'characterPolish','vehiclePolish','arcadeHandling','roadRespawn','vehicleAudio',
  // V2.1 milestone #3 (2026-10-03, orchestrator-directed): buildingDetail (dev-on: awnings/fire
  // escapes/cornices/rooftop clutter), madMaxRobotaxi (instant pickup + reckless no-collision ride,
  // rider earns nothing), characterLooks (appearance sync — worker+web deploy together satisfies its
  // opcode gate), accountRecovery (GTASF-XXXX recovery codes — REQUIRES the RECOVERY_PEPPER prod secret,
  // provisioned via secrets.mjs). The three dev-off flags also go in productionOverrides below. NOT here:
  // skyAds/adSlots and the vivid building PALETTE (baked into the map -> needs a map rebuild -> follow-up).
  'buildingDetail','madMaxRobotaxi','characterLooks','accountRecovery',
  // Onboarding (gtasf-n34i, #5.2): client fresh-profile browser smoke PASS — the 3 SA intro slides render
  // with real art (onboarding-*.webp), device controls, the SA mission tutorial starts ("STEP 1 OF 4 ·
  // GET MOVING"), and the progressive HUD reveal gates to radar+funding only. Drive/award/identity are
  // unit-tested + headless-verified (ring relocated on-lane, orientation award idempotent) with an 8s
  // drive-step fallback; hot-disableable if the playtest shows issues. (gtasf-onboarding-smoke-enable-24i2)
  'onboarding',
  // Car handling (gtasf-car-handling-air-steer-6a92, #4, orchestrator-directed): hillJumps = real
  // ballistic airborne off crests + server airtime headroom. Smoothed/speed-sensitive steering ships
  // always-on via arcadeHandling (no flag). hillJumps is dev-off -> also in productionOverrides below.
  // Logic smoke green (controller/fleet + worker vehicles airtime tests); in-browser feel review is
  // pending a stable local stack (pane 6) -> verify on the deployed #4 and hot-disable if the feel is off.
  'hillJumps',
  // Economy v3 (founder APPROVED 2026-10-04 07:55/07:56 as a one-time ECONOMY RESET — wipe funding
  // progress, keep accounts). Enable = resetDeviceToEconomyV3 (store.ts lazy + enableEconomyV3Migration
  // bulk), IRREVERSIBLE: pane 5 MUST confirm the D1 backup is current before the enable deploy.
  // HELD OUT for #5.7 (orchestrator 08:3x): re-add here for #5.8 once the economy review signs off.
  // Deploy #6 (realisticRender + realisticFacades + storefrontPieces) was enabled then ROLLED BACK
  // 2026-10-04 07:39: HD overexposed, HD FiDi/Lombard boot hang (IBL off), Low ps2 cars white. Kept OUT of
  // the allowlist until the render lane fixes exposure + IBL-off boot + HD-gates vehicle/fleet loads AND
  // pane 6's headed look-check passes. Re-add here (+ productionOverrides) only then. See DEPLOY.md.
  // Economy v3 (#5.8): founder approved the table, the 40% event bases, demotion to Bootstrapping and a
  // one-time progress reset (2026-10-04 ~09:30); pre-enable review in docs/economy/v3-review.md.
  'economyV3',
  // Batch deploy (founder 10:1x "when all this finishes, queue a deploy"): robotaxi quick travel
  // (docs/engineering/quick-robotaxi.md, gtasf-afdt) and floating SA event titles with per-kind ring
  // colours and collected dimming (docs/engineering/event-labels.md, gtasf-8qxl).
  'quickRobotaxi', 'floatingEventNames', 'eventKindColors', 'dimCollectedMarkers',
  // Pre-freeze batch (Oct 4 ~12:25): board any moving vehicle (gtasf-miev).
  'rideAnyVehicle',
  // Founder-approved Ferry spawn fleet (Oct 4 ~14:25): ten enterable cars, safe 45s bay refill.
  // Implementation a672e90; delivery robot moved down the plaza. [gtasf-buv7/gtasf-qqju]
  'ferryParkedCars',
  // Stage-unlocked personal rides (G), remapped to economy v3 stars in 37c9dcd.
  'personalRides',
  // SA-style radio: 6 parody genre stations, DJs and ads, auto-on in vehicles (gtasf-jwxu).
  'radioStations',
  // Celebrity angel NPCs (founder approved roster; 'yes switch on angels in production', Oct 4 ~13:40).
  'celebNpcs',
  // Founder-approved X ads test (Oct 4): consent UI + local Worker forwarding verified.
  // Capture key/public IDs are vars; X_PIXEL_TOKEN and POSTHOG_SECRET_KEY stay secrets.
  'posthogAnalytics', 'xAdsPixel',
  // Graphics v2 (founder "Deploy to live", Oct 5 ~06:30) after the 04:45 clean preview + 06:15 city tour:
  // exactly the preview build (reviewed + graphicsV2). Sub-flags (rooftopClutter, gpuBirds, kerbParkedCars,
  // coarseBuildingCollision, realistic*) stay OUT until their own look/perf checks.
  'graphicsV2',
  // Batch deploy (founder "yes", Oct 5 ~14:10): email capture + verified-founder reward (gtasf-1aon/2904;
  // first deploy keeps send_email allowlisted to the founder for the gated test), feedback build tag
  // (gtasf-367l, migration 0032), Pacific Heights VC supercar (gtasf-txt), phone pinch zoom (gtasf-rmsv/85ol).
  'emailCapture', 'feedbackBuildTag', 'vcSupercar', 'touchCameraZoom',
  // Paintball batch (founder "yes ok to ship that", Oct 5 ~22:05): paint-first onboarding with colour-only
  // paintball (gtasf-playful-mayhem-x44e) and denser street/plaza pedestrians, including a Low crowd (gtasf-sena).
  'playfulMayhem', 'pedestrians',
  // Organiser outreach (founder pre-approved Oct 6 ~00:45): /e/<event> links + no-PII link counters (gtasf-w0s8).
  'organiserLinks',
  // Proximity voice behind the hidden ?voice=1 gate (founder "yes - launch voice behind secret link", Oct 6 ~13:00).
  // voicePublic stays OFF until the founder's phone + laptop test. Needs REALTIME_APP_ID/TOKEN + REALTIME_TURN_KEY_ID/TOKEN secrets.
  'proximityVoice',
  // Spoken bubbles (founder "Yes ship it", Oct 6 ~17:00): hold-to-talk -> Workers AI Whisper -> jev -> 🎙 bubble,
  // still behind ?voice=1 while voicePublic is off. Emits the AI binding.
  'voiceCaptions',
  // Voice for everyone (founder "Let's just turn voice mode on for everyone", Oct 6 ~21:55): drops the ?voice=1 gate.
  'voicePublic',
  // Graphics + perf batch (founder "Ship it all", Oct 7 ~11:30; docs/graphics-ship-list.md) + car contact (gtasf-4g29).
  'realisticRender', 'realisticFacades', 'rooftopClutter', 'rooftopClutterLow', 'storefrontPieces', 'hdUrbanSurfaces', 'streetDetail', 'embarcaderoPromenade', 'missionStreetDressing', 'kerbParkedCars', 'gpuBirds', 'propKnockover', 'skyAds', 'nearRoadGraph', 'layoutWorker', 'lowRadarBudget', 'lowInstancedQueue', 'chunkRoadMerge', 'lowDetailCull', 'fastRoadSampler', 'lowInstancedKerbCars', 'lowBatchedProps', 'lowPeerImpostors', 'emptyInstanceSkip', 'hiddenFleetMatrixSkip', 'fleetMatrixSkipDeep', 'staticMatrixFreeze', 'loadingBeacon', 'carCollisions',
  // SF look batch (founder standing goal + continuous-ship policy, Oct 7 ~20:00; docs/sf-data/ship-tonight.md).
  'atmosphereSky', 'realStreetTrees', 'buildingPaint', 'rooftopLife', 'titleFlyover',
  // Varied roofscape from the air (gtasf-2soo; Teleoperator aerial look gap). Baked roofs all rendered one flat
  // grey-tan; this gives roof up-faces a per-building tar/gravel/membrane grey variation at all distances (the HD
  // roof texture faded out past ~100 m), via the roof material hook (surfaceMaterials/urbanSurfaces), on HD and
  // Low. Colour stays realistic (no rainbow roofs); walls/terrain/roads untouched. A/B docs/sf-data/aerialgap
  // (Nob Hill->FiDi aerial, desktop+phone). Ferry phone perf ~60 with it on (docs/perf/roofvar-on). Dev default true.
  'roofToneVariety',
  // Living map (founder plan Oct 7; docs/sf-data/living-map/ship.md; continuous-ship policy).
  'eventPinsV2', 'minimapClues', 'robotaxiJump', 'placesLayer', 'placeSigns', 'placeStamps',
  // Procedural footsteps + city ambience (gtasf-bigk; founder "ship all", Oct 8). Zero downloads; in-game listen still owed.
  'proceduralSfx',
  // Pitching (living map P3): fictional angels + VC offices only, never real-person celebs (docs/sf-data/pitching-ship.md).
  'pitching', 'angelNpcs',
  // Aerial skyline haze (Teleoperator gap; A/B docs/sf-data/aerial-skyline/).
  'aerialSkylineHaze',
  // Floating-car fix (@ktwu01 tweet, Oct 9): fall when no ground sample; recover after 1.5 s hang.
  'carHangRecovery',
  // Aerial far-LOD ring v2 (look-check passed; docs/sf-data/aerial-skyline/far-city-*-ab.jpg).
  'aerialFarChunks',
  // aerialFarFill (gtasf look-gap Gap 1 vs teleoperator-reference.png): the far-LOD ring radius grew too slowly with
  // altitude (base 3 / step 14), so at the moderate aerial heights players actually use (~78 m) it was only ~1 km and
  // the FiDi at ~1.2 km floated alone across the bayWater void. Extends the ring to base 6 / step 9 / max 18 (~4.6 km)
  // so the whole downtown skyline fills in behind the foreground -- continuous city, matching the reference. HD-ONLY:
  // an aerial-fps probe (phone Low, 4x CPU throttle) showed the aerial Low view is already streaming-hitch-bound at
  // ~50 fps mean with the flag OFF and the fuller ring made it worse, so per the founder's "if Low can't afford it,
  // ship HD-only" it is gated off on Low -- Low keeps the stock ring, byte-identical. The far ring only activates
  // above 55 m, so street play / the phone-perf harness is unaffected (ferry Low 59.96 fps baseline, unchanged);
  // streamed coarse far-LOD, so no added emitted-payload bytes (87 MB budget untouched). HD is vsync-bound aloft.
  // A/B docs/sf-data/teleop-match-farfill-{off,on}/skyline-desktop.jpg (floating pair -> full skyline cluster). Dev
  // default true, so no productionOverride needed.
  'aerialFarFill',
  // Denser SF rooftop water towers (Teleoperator gap; look-check passed, docs/sf-data/rooftops/
  // watertowers-*-ab.jpg). Dev default is true, so no productionOverride needed.
  'rooftopWaterTowers',
  // Bigger, chunkier rooftop water tanks (gtasf-9tvf, Teleoperator look gap): scales the timber towers up so they
  // dominate the roofscape like the reference. Same instance count (larger matrices) -> no perf cost; ferry phone
  // perf 60.19 fps with it on. A/B docs/sf-data/rooftop-tanks. Pure geometry, flag-off byte-identical. Dev default true.
  'biggerWaterTanks',
  // Ferry Building spawn-view fidelity (gtasf-dtk5; the first thing every player sees). Arched windows get
  // recessed dark glazing behind a proud arched reveal + jambs (framed depth, dark-glazed on Low too); the clock
  // tower shaft gets corner quoins, two string courses and a bed mould; the arcade roofline gets a modillion
  // course. A/B docs/sf-data/ferryhd (spawn arcade + pitched-up tower, desktop+phone). Geometry-only on the single
  // merged landmark mesh (no texture, no draw call); ferry phone perf 60.09 fps / p95 21.9 ms with it on. Dev
  // default true, so no productionOverride needed.
  'ferryBuildingHd',
  // Aerial-perspective haze on the far-LOD ring (Teleoperator gap; founder look approved 2026-10-10). Phone perf
  // passed: canonical ferry gate 60.1 fps / p95 19.9 ms, and the downtown-aerial probe (where the ring is live)
  // adds 0.0 ms p95 over aerialFarChunks alone. Dev default is true, so no productionOverride needed.
  'aerialFarHaze',
  // Cheap far-LOD facade detail / window grid (Teleoperator gap; founder look approved 2026-10-10). The grid now
  // draws AFTER the scene fog and ranges to ~5.2 km (gtasf-d8vh), so it survives the haze and carries the deep
  // FiDi/Salesforce skyline as windowed massing instead of blank tan slabs. Phone perf passed: haight 60.10 fps /
  // p95 22.4 ms, soma 60.01 fps / p95 21.2 ms (docs/perf/skylinegrid-revert-r1); A/B docs/sf-data/aerialgap
  // (fidi-far-*-skyline-after). Dev default is true, so no productionOverride needed.
  'aerialFarFacade',
  // aerialFarTowerTone (gtasf look-gap Gap 2 vs teleoperator-reference.png): the far-LOD ring rendered the FiDi
  // skyline towers in their baked pale land-use tone, so from a high aerial they washed to flat near-white slabs
  // against the bright sky. Deepens + cools tall far fragments by WORLD HEIGHT (smoothstep 45->140 m; low warm
  // rooftops untouched) so the FiDi cluster reads as steel/glass with depth — clear at noon, naturally subdued
  // under the golden haze. Far-ring only, ~6 ALU in the fragment riding aerialFarFacade's program (no geometry/
  // draws/textures/payload). Ferry phone gate passed 60.1 fps / p95 21 ms (street-inactive; far cost <= facade's
  // measured within-noise +0.1 ms). A/B docs/sf-data/teleop-match-towertone-{strong,golden} vs teleop-match-farfill-on.
  // Dev default is true, so no productionOverride needed.
  'aerialFarTowerTone',
  // Coarse window grid on MID-DISTANCE building walls (gtasf-vc2d; Teleoperator aerial gap). aerialFarFacade only
  // grids the far-LOD ring; the mid-distance coarse FiDi towers (past the near atlas-front range, inside the
  // streamed chunks) rendered as blank pale/tan boxes from the air. Draws the same cheap window grid on the baked
  // 'buildings' material walls (surfaceMaterials.addBuildingWindowGrid, via the urbanSurfaces buildings branch),
  // gated to appear only past ~180-420 m and fade out by ~3.4 km where the far-LOD ring takes over (aerialFarFacade's
  // matching grid now applies AFTER the fog so it carries the deep skyline to the horizon), so near buildings (atlas fronts) and
  // the deep skyline are untouched. ~8 ALU ops, no geometry/draws/textures; HD + Low. A/B docs/sf-data/aerialgap
  // (fidi-far-*: blank boxes -> windowed towers, desktop+phone). Phone perf ferry/haight ~60 (docs/perf/coarsegrid-on).
  'coarseWindowGrid',
  // Fix for a live aerialFarChunks bug: clip the far ring to land so the Bay no longer renders as flat tan slabs
  // (floating land over water). A/B docs/sf-data/far-water/. Dev default is true, so no productionOverride needed.
  'aerialFarClipWater',
  // Make the Bay read as water from the air (gtasf-jyg4; Teleoperator aerial gap). aerialFarClipWater removed the
  // far water chunks, so the Bay was a geometry-less void the warm fog filled — a flat orange nothing from aerial.
  // Adds one camera-following plane just below sea level (bayWater.ts): land + near water occlude it, so it shows
  // only through open water, rendered as cool sky-tinted water fading to a cool haze (not the warm horizon). The
  // water's streamed-mirror material also fogs cool+capped. The Bay now reads as water with a horizon and a
  // land/water shoreline. A/B docs/sf-data/aerialgap (Nob Hill->FiDi aerial, desktop+phone). Ferry phone perf ~60
  // with it on (docs/perf/baywater-on). Flag-off byte-identical. Dev default true.
  'bayWaterRead',
  // waterGrazeCap (gtasf look-gap Gap 3 vs teleoperator-reference.png): at the grazing angles of an aerial/elevated
  // view, waterMirror's distant open-water term let the fresnel (up to .75) push the far surface to ~45-75% of the pale
  // sky colour, so large water read as a flat bright plane. Caps the grazing fresnel in that open-water branch only
  // (min(fresnel,.45)), so distant water keeps >=55% of its deep steel-blue; the near reflective mirror patches are
  // untouched (near-water reflections unchanged). Broad A/B docs/sf-data/water-graze/{before,after}-{noon,golden}
  // (aerial-bay + street-bay, desktop+phone): noon aerial deepens visibly (pale cyan -> blue-grey sea), golden is
  // subtle (bayWaterRead's cool fog already handles it and water doesn't over-darken), street/near-water unchanged.
  // One min() op, perf-neutral (ferry Low 60.05 fps, p95 20.8 ms). Flag-off byte-identical. Dev default true.
  'waterGrazeCap',
  // Authored paving on the Ferry Building spawn plaza (gtasf look gap #2 — first thing every new player sees). Phone
  // perf passed: canonical ferry gate 60.1 fps / p95 20 ms with it on (docs/perf/phone-ferry-paving). A/B
  // docs/sf-data/ferry-plaza/. Dev default is true, so no productionOverride needed.
  'ferryPlazaPaving',
  // civicPaving (gtasf-g36q; Union Square/SoMa street walk): the broad civic concrete (urbanSurfaces tiles 0/1/5 —
  // SoMa/Moscone/FiDi sidewalks + downtown plazas) rendered as one flat warm-tan sheet; only the Ferry plaza and
  // authored granite had real paving. Scores it into ~2 m slabs carried by per-slab TONE with hairline fwidth-AA
  // joints (barely darker, gone by ~24 m, faded past ~72/96 m); terrain surfaces only (skips the asphalt road +
  // the Ferry plaza + authored granite). A few ALU ops + one hash, no texture fetch/geometry/draws; HD + Low.
  // A/B docs/sf-data/ussoma-civic ({off,on}: flat tan sheet -> textured concrete slabs, desktop+phone). Phone perf
  // passed: ferry 60.06 fps / p95 22.3 ms, soma 60.02 fps / p95 19.8 ms, zero console errors (docs/perf/
  // civicpaving-on-r2). Dev default is true, so no productionOverride needed.
  'civicPaving',
  // unionSquarePlazaLow (gtasf-81df; Union Square street walk): Union Square read as a flat green lawn. Two bugs:
  // (1) the authored plaza block (rect registration + Dewey column/palms/benches) was gated HD-only (polish needs
  // graphicsV2Hd), so on phone/Low nothing placed and the ground never registered as a plaza; (2) even on HD the
  // ground stayed green because the plaza->granite conversion only matched mapped-lawn tiles (>6.5), but Union
  // Square's lawn is baked with a non-park green that classifies as unclassified (tile -1). This runs the block on
  // Low too AND extends the conversion to unclassified ground (tile<-0.5) inside the registered plaza rect, so the
  // ground is granite on BOTH HD and Low (rect-scoped; civic paving/roads untouched). A/B docs/sf-data/us-plaza-low
  // ({off,on}: green lawn -> granite plaza w/ column+palms, desktop+phone). Phone perf passed, zero errors:
  // unionsquare 60.03 fps / p95 22.0 ms, ferry 60.02 fps / p95 21.1 ms (docs/perf/unionsquare-low-on). Dev ON.
  'unionSquarePlazaLow',
  // warmShadowFill (teleoperator look #1; founder-approved): graphicsV2 cuts the ambient fill at low sun to keep
  // golden-hour contrast, which crushed shadowed (anti-sun) building faces to muddy dark. A dim warm directional
  // from opposite the sun lifts exactly those faces (strongest at low sun, off at night) — no milky global wash;
  // byte-identical off. A/B docs/sf-data/warm-shadow-fill (Ferry/Market/Lombard, desktop+phone Low). Phone perf
  // passed, zero errors: ferry 58.8 fps / p95 21 ms, soma 60.0 fps (docs/perf/warmfill-on; >= baseline). Dev ON.
  'warmShadowFill',
  // distanceHaze (teleoperator look #3; founder-approved, all tiers): at street level the SF-look altitude ramp
  // holds fog at the grade's full far (~800 m at golden), so mid-to-far blocks read crisp/flat where the
  // reference's distance recedes into a warm veil. Pulls the FOG IN at eye level (far ~560 m), fading back to the
  // ramp by ~45 m up (aerial untouched). foundation.ts grade block. First shipped HD-only because the phone-Low
  // ferry waterfront lost ~3 fps; root cause was the tighter fog shrinking camera.far onto a far-LOD/stream
  // boundary and churning it. Fixed by decoupling camera.far from the fog tightening (it follows the untightened
  // drawFar), so draw distance / streaming is identical to flag-off and only fog density changes — now on Low too.
  // Phone-Low gate passes: ferry 60.07 fps / p95 21.8 ms, soma 60.02 fps / p95 21 ms (docs/perf/disthaze-low-fix).
  // A/B docs/sf-data/distance-haze (Ferry/Market/Lombard, desktop + phone Low). Flag-off and the aloft ramp are
  // byte-identical. Dev ON.
  'distanceHaze',
  // filmicGrade (teleoperator look; founder-approved, HD only): a subtle cinematic finish in the post composite —
  // a gentle highlight shoulder (blown golden skies roll off instead of clipping) + a hair of warmth on the upper
  // mids — on top of the SA/SF grade. NOT the timeGrade stops, NOT bloom, no LUT texture (~6 ALU). GATED HD-only
  // (tier !== 'low'): the full-screen pass nudged phone-Low ferry/soma below the 60 fps floor (ON ~59.5-59.7 vs
  // OFF ~59.9-60.1), so Low is byte-identical. A/B docs/sf-data/filmic-grade (Ferry/Lombard/Mission, desktop+Low).
  // Flag-off and Low are byte-identical. Dev ON.
  'filmicGrade',
  // walkerRouteCache (perf, orchestrator 2026-10-13): look-safe sidewalk-route cache; ferry phone-Low props-present
  // 52.2 -> 58.9 fps (6df2c204). Was dev-on only, so #5.94 never actually shipped it.
  'walkerRouteCache',
  // pbrCarsV2 (GTA-pivot lane A #1, orchestrator 2026-10-13): the paid Meshy PBR fleet on graphicsV2 (Lambert-demoted
  // until realisticLightingV2). Close-ups docs/sf-data/pbr-cars/showroom-on; ferry phone 39.3 fps / p95 32.7 ms (b58cd779).
  'pbrCarsV2',
  // fogBank (GTA-pivot lane A #5, orchestrator 2026-10-14): Karl the Fog from the live weather feed; hidden + skipped
  // when dry. Phone-Low A/B docs/sf-data/fog; ferry phone 51.5 fps / p95 23.7 ms with fog active (6a552426).
  'fogBank',
  // rainRender + wetRoads (GTA-pivot lane A #5, orchestrator 2026-10-14): rain streaks with an overcast grade and a
  // wet-road sheen, only when the live feed reports rain. docs/sf-data/{rain,wetroads}; ferry phone 41.5 / 52.0 fps.
  'rainRender',
  'wetRoads',
  // neutralDaylight + skyCloudCover (Teleoperator look, orchestrator 2026-10-14): kill the midday olive/green cast
  // (tapered to 0 by golden hour) and fill the empty daytime sky. docs/sf-data/teleop-gap/{neutral,sky-clouds}-*;
  // grade-only / ferry phone 52.8 fps p95 23 ms.
  'neutralDaylight',
  'skyCloudCover',
  // towerGlassMask (white torn blotches on FiDi glass towers, 3f6ff90c) + stormHaze/weatherNight (storm days no
  // longer wash out to white; lights come on under heavy overcast, 4a78013d). docs/sf-data/{tower-mask,weathernight};
  // ferry phone 58.5 / 59.0 fps. Orchestrator 2026-10-14.
  'towerGlassMask', 'stormHaze', 'weatherNight',
  // ferryArcadeLit (spawn view: lit Ferry Building arcade instead of black voids, f54e6ef8; ferry phone 58.8 fps).
  'ferryArcadeLit',
  // ferryPlazaDressing (spawn plaza: market stalls, planters, trees, benches; ferry phone 58.8 fps, 9f520b1d) +
  // aerialFarCorridor (HD-only far massing: the city no longer floats across the water from the air, 1226e968).
  'ferryPlazaDressing', 'aerialFarCorridor',
  // trafficDrivers (GTA-pivot lane B, Combat 6b gtasf-ieoj) is NOT here: the showroom perf/look signed off, but
  // in-GAME the seated driver reads as INVISIBLE (opaque car glass/body occlusion on the real traffic kinds, +
  // the idle->sit crossfade left it standing/clipping — lane A found both during the teleoperator look push). Held
  // out of the reviewed set until that's fixed + re-verified in-game (not just the showroom). [gtasf-ieoj reopened]
  // warmGroundGrade (teleoperator look #2) is NOT here: the founder's phone-Low gate is mean >=60 at ferry +
  // soma, and two reruns at cpu-guard headroom both passed soma (60.02 / 60.08) but missed ferry (59.96, then
  // 59.57 fps; docs/perf/warmground-gate{,-r2}). No epsilon / no loosening the budget (founder), so it stays
  // out. Revisit if the ferry Low baseline clears 60 (it hovers ~58-60, so the road warm-grade can't be isolated
  // from the noise there). Visual A/B is clean (docs/sf-data/warm-ground-grade); the hold is purely the fps floor.
  // routeRibbonPaint (gtasf-6w96; SoMa street walk): the GPS route guidance ribbon (navigation/guidance.ts) is an
  // unlit yellow ribbon; its near segment, right under the player, read as a big flat neon slab across the sidewalk,
  // worst on Low (no tonemap). Warms it toward road paint, lowers base opacity (more on Low), and fades the alpha to
  // zero within ~4-13 m of the camera so it reads as a painted path leading ahead, not a slab underfoot. Ribbon
  // material only; a few fragment ALU ops, no geometry/draws. A/B docs/sf-data/routeribbon ({off,on}: neon slab ->
  // soft fading paint, phone+desktop). Phone perf passed, zero errors: ferry 60.06 fps / p95 21.1 ms, soma 60.03 fps
  // / p95 20.5 ms (docs/perf/routeribbon-on). Dev default is true, so no productionOverride needed.
  'routeRibbonPaint',
  // chinatownDragonGate (gtasf-4r9d; Chinatown street walk): Chinatown read as a generic street. Adds the Dragon
  // Gate (the paifang at Grant Ave & Bush) as a landmark — a three-bay gate with green glazed upturned-eave roofs,
  // red pillars, gold accents, guardian lions and hanging red lanterns — placed via the landmarks system
  // (geodeticToWorld, the verified frame). One merged vertex-coloured static mesh like the other landmarks; no
  // per-frame cost. A/B docs/sf-data/dragongate ({off,on}: generic street -> Chinatown gate, phone+desktop). Phone
  // perf: the gate adds ZERO cost (chinatown ON 59.95 fps ≈ OFF 59.92 fps, p95 ~21 ms, zero errors, docs/perf/
  // dragongate-{on,off}); the dense chinatown area itself sits at ~59.9 fps on the 4x synthetic harness independent
  // of the gate (the same 60-boundary behaviour as the ferry/soma scenarios), so the <60 is pre-existing, not the
  // gate. Dev default is true, so no productionOverride needed.
  'chinatownDragonGate',
  // castroRainbowCrosswalk (gtasf-mleo; Castro street walk): the Castro's famous rainbow crosswalks were missing.
  // The map renders Castro & 18th — a normal road intersection — as pale civic concrete (a surface misclassification;
  // Harvey Milk Plaza is at Castro & MARKET, not here), with no road-detail crossings to paint. This lays a scoped
  // decal at the intersection via the landmarks system (createCastroCrossing), placed at the road-graph junction node
  // (world -2398,2585 = lat/lon via the verified frame) and rotated to the tilted Eureka-Valley grid (Castro St
  // bearing 21.6deg): an UNLIT road-grey asphalt cross (matches the floored road albedo, not a near-black hole) so the
  // intersection READS AS ROAD, with four pride-flag crosswalks forming the iconic ring, one per leg. The junction is
  // on a ~3% cross-slope, so the tiled geometry is re-seated onto a smooth plane fit of the ground and raised just
  // clear of it (resampleTerrain, re-run each second by updateLandmarkTerrain) — no buried legs, no diagonal clip, no
  // warping. Vertex-coloured merged static mesh like the other landmarks; excluded from the map/taxi destination list;
  // scoped to that one spot. A/B docs/sf-data/castro-rainbow ({off,on}: concrete -> asphalt + rainbow ring; on has
  // aerial + topdown + phone). Phone perf: one more static unlit mesh + a 1 Hz conform loop, perf-innocent — castro
  // ON 59.9/60.1 fps ≈ OFF 60.1/60.0 fps, p95 ~20.8 ms both, zero errors; the dense Castro area straddles the 60
  // boundary with or without the decal (same as ferry/soma). Dev default true, so no productionOverride needed.
  'castroRainbowCrosswalk',
  // harveyMilkFlag (gtasf-3onc; Castro look gap): the Castro's signature marker -- the giant rainbow flag on its
  // tall flagpole at Harvey Milk Plaza (Castro & Market, above the Muni station, and the reason the rainbow
  // crosswalk at Castro & 18th is NOT the plaza) -- was missing entirely. Adds it as a scoped landmark
  // (createHarveyMilkFlag): a ~20 m flagpole with a gold finial flying the six-stripe pride flag, the flag carrying
  // a frozen billowing wave and drawn both-sided so it reads from either side. One merged vertex-coloured static
  // mesh like the dragon gate / lanterns -- no textures, no per-frame cost; HD + Low. A/B docs/sf-data/harvey-milk
  // ({before,after}: empty plaza -> flag flying, plaza/flag/street, desktop+phone). Phone perf: Harvey Milk Plaza
  // ON 60.0 fps / p95 22.8 ms / max 24.2 ms / 0 console errors (docs/perf/harveymilk-on). Flag-off byte-identical.
  // Dev default true, so no productionOverride needed.
  'harveyMilkFlag',
  // castroTheatre (gtasf; Castro look gap): the Castro Theatre (429 Castro St, 1922 movie palace) -- THE visual
  // anchor of the Castro, with its giant vertical "CASTRO" neon blade and illuminated marquee -- was missing; the
  // block rendered as generic rowhouses (confirmed via before-capture). Adds it as a scoped landmark
  // (createCastroTheatre): a Spanish-colonial facade with a projecting marquee, and the signature CASTRO blade rising
  // above the roofline. The facade/marquee structure is the usual lit vertex-coloured mesh; the blade (cream lit
  // field + bold red CASTRO + red border) and marquee chase-lights are a SECOND mesh rendered UNLIT (MeshBasicMaterial,
  // toneMapped off) like the Castro crossing / Harvey Milk flag, so the signage reads bright on BOTH HD and Low
  // (verified: blade legible as red neon on the phone/Low path) instead of dimming to a dark tower. Two merged static
  // meshes, no textures, no per-frame cost. A/B docs/sf-data/castro-theatre ({before,after}: generic block -> theatre,
  // hero/street, desktop+phone). Phone perf: Castro Theatre ON 60.1 fps / p95 20.9 ms / max 23.3 ms / 0 console errors
  // (docs/perf/castrotheatre-on). Flag-off byte-identical. Dev default true, so no productionOverride needed.
  'castroTheatre',
  // fishermansWharfSign (gtasf; Fisherman's Wharf look gap): the round "FISHERMAN'S WHARF" gateway sign at Taylor &
  // Jefferson -- red crab on a yellow ship's-wheel, the single most recognisable "you have arrived at the Wharf"
  // marker -- was missing (generic street; before-capture confirms). Adds it as a scoped landmark
  // (createFishermansWharfSign): two teal posts carrying a round board with the crab/wheel roundel and "FISHERMANS
  // WHARF" / "SAN FRANCISCO" lettering (the lettering helper gained H/M/W glyphs for this). Posts/back are the usual
  // lit vertex-coloured mesh; the bright painted sign FACE is a SECOND mesh rendered UNLIT (MeshBasicMaterial,
  // toneMapped off) like the Castro crossing, so it reads bright on BOTH HD and Low (verified legible on the
  // phone/Low path). Two merged static meshes, no textures, no per-frame cost. A/B docs/sf-data/fishermans-wharf
  // ({before,after}: generic street -> the sign, oblique/street, desktop+phone). Perf-innocent: Wharf steady-state
  // median ON 16.6 ms (60.2 fps) vs OFF 16.4 ms (61.0 fps) -- within noise; both fail the mean gate on the same
  // pre-existing dense-waterfront warmup hitch, not this sign (docs/perf/wharf-{on,off}, 0 console errors).
  // Flag-off byte-identical. Dev default true, so no productionOverride needed.
  'fishermansWharfSign',
  // ghirardelliSign (gtasf; Ghirardelli Square look gap): the giant illuminated GHIRARDELLI letters along the roof of
  // the old chocolate-factory building -- one of the most photographed signs in the city -- were missing (bare roof;
  // before-capture confirms). Adds a scoped landmark (createGhirardelliSign): a dark rooftop support frame carrying
  // the big cream letters, sized to ride the building's roofline (verified against the map building). The frame is the
  // usual lit vertex-coloured mesh; the letters are a SECOND mesh rendered UNLIT (MeshBasicMaterial, toneMapped off)
  // like the Castro crossing, so they read as bright sign letters on BOTH HD and Low (lettering helper gained G/D/L
  // glyphs). Two merged static meshes (~1.5k tris, 2 draw calls), no textures, no per-frame cost. A/B
  // docs/sf-data/ghirardelli ({before,after}: bare roof -> GHIRARDELLI letters, bay/oblique, desktop+phone).
  // Perf-innocent: this Aquatic-Park waterfront spot is a pre-existing heavy scene that misses the gate flag-on AND
  // flag-off (3 runs, medians 16.4/17.2/17.7 ms with NO clean flag ordering -- OFF had the lowest median but a worse
  // mean/max; p95 ~32 ms and the warmup maxes are the scene, not the 2-draw-call sign; docs/perf/ghirardelli-{on,off,
  // on2}, 0 console errors). Flag-off byte-identical. Dev default true, so no productionOverride needed.
  'ghirardelliSign',
  // peacePagoda (gtasf; Japantown look gap): Japantown had no landmark at all. Adds the Peace Pagoda
  // (createPeacePagoda) -- the ~22 m pale-concrete five-tier stupa in the Peace Plaza (a 1968 gift from Osaka), broad
  // stacked umbrella roofs on a tapering core, topped by a gold sorin finial -- so the Peace Plaza reads as Japantown.
  // One merged vertex-coloured static mesh like the dragon gate (concrete reads fine lit, no unlit pass); HD + Low.
  // A/B docs/sf-data/peace-pagoda ({before,after}: empty plaza -> the pagoda, plaza/oblique, desktop+phone). Perf: the
  // Japantown Peace Plaza spot sits right at the 60 fps gate flag-on AND flag-off (ON 59.9 fps vs OFF 60.0 fps, a 0.1
  // fps run-to-run difference; p95 ~21 ms, max 23/26 ms, 0 console errors; docs/perf/pagoda-{on,off}) -- the one small
  // lit mesh is perf-innocent. Flag-off byte-identical. Dev default true, so no productionOverride needed.
  'peacePagoda',
  // cablecarTurntable (gtasf; cable-car look gap): the wooden turntable where Powell cable cars are pushed around by
  // hand was missing. Adds it as a scoped landmark (createCablecarTurntable): a timber turntable disc in a dark pit
  // with running rails and a centre pivot, carrying a classic maroon-and-cream Powell cable car (open grip platform,
  // monitor roof); the "POWELL" roof board + headlight are a SECOND mesh rendered UNLIT (toneMapped off). NOTE on
  // placement: the Powell & MARKET turntable (the founder's suggestion) sits on a map-building footprint downtown
  // (would collide, like the Palace of Fine Arts), so it is placed at the HYDE & BEACH turntable instead -- the other
  // end of the Powell-Hyde line, in the open by Aquatic Park/Ghirardelli, where it reads cleanly. No textures, no
  // per-frame cost. A/B docs/sf-data/cablecar-turntable ({before,after}: empty loop -> turntable + car; overhead/hero/
  // street, desktop+phone). Perf-innocent: median ON 16.7 ms (59.9 fps) vs OFF 16.4 ms (61.0 fps) -- within noise;
  // both miss the mean gate on the pre-existing dense-waterfront warmup hitch (docs/perf/turntable-{on,off}, 0 console
  // errors). Flag-off byte-identical. Dev default true, so no productionOverride needed.
  'cablecarTurntable',
  // haightAshburySign (gtasf; Haight look gap): the famous crossed green HAIGHT / ASHBURY street-sign corner was
  // missing. Adds it as a scoped landmark (createHaightSign): a pole carrying two perpendicular green street blades
  // with white names (HAIGHT blade faces +Z, ASHBURY crosses it facing +X, its text mesh rotated 90deg). Pole/blades
  // are the usual lit mesh; the white names are UNLIT (toneMapped off) so they read on HD and Low (lettering helper
  // gained B/U/Y glyphs). The blades ride high (~6 m) so they clear the Haight's continuous shop awnings and read from
  // the street. No textures, no per-frame cost. A/B docs/sf-data/haight-ashbury-sign ({before,after}: generic corner
  // -> the crossed HAIGHT/ASHBURY signs; corner/close/wide, desktop+phone). Phone perf: Haight sign 60.0 fps / p95
  // 21.3 ms / max 22.5 ms / 0 console errors (docs/perf/haightsign-on). Flag-off byte-identical. Dev default true.
  'haightAshburySign',
  // sutroAviationBands (gtasf; citywide skyline): Sutro Tower's signature alternating aviation RED/WHITE bands used a
  // muted brick-red that washed to a pale slab at distance, so the banding -- the read that identifies it on the
  // skyline -- did not register. Switches the bands to a brighter saturated aviation red + a cleaner white and renders
  // the tower UNLIT (MeshBasicMaterial, toneMapped off) so the red/white holds its colour at skyline distance and on
  // the phone path. (The tower's low-poly slab silhouette is a separate pre-existing geometry thing, untouched; and in
  // a straight-into-the-sun golden backlit view it still silhouettes -- the band read shows in daylight/non-backlit
  // angles.) Applied inside createSutroTower, gated by the flag. A/B docs/sf-data/sutro-tower ({before,after} at noon:
  // muted pale -> visible red/white bands; skyline/closer, desktop+phone). Phone perf at Twin Peaks 60.0 fps / p95
  // 20.7 ms / max 24.1 ms / 0 console errors (docs/perf/sutro-on) -- material-only swap, perf-neutral. Flag-off
  // byte-identical. Dev default true, so no productionOverride needed.
  // coitFloodlight (gtasf; Telegraph Hill day read): Coit Tower reads only adequately by day and darkens on the
  // golden/Low paths. Renders the tower UNLIT (MeshBasicMaterial, toneMapped off) in bright warm floodlit cream so it
  // reads as a brighter, cleaner floodlit fluted column from North Beach / aerial by day, HD and Low (dark window/
  // arcade recesses kept dark for depth). Modest, honest scope: the daytime brightening is real but subtle (Coit's
  // base colour is already pale, so at bright noon before~after); the clearer gain is at golden/Low. NIGHT is
  // unchanged -- the night post-grade blues the whole frame and no landmark mesh can escape it, so a true night glow
  // needs night-lighting shader work, not this. A/B docs/sf-data/coit-tower/{before,after}-{noon,golden} (northbeach/
  // aerial, desktop+phone). Phone perf at North Beach 60.1 fps / p95 21.3 ms / max 22.7 ms / 0 errors (docs/perf/
  // coit-on) -- material-only swap, perf-neutral. Flag-off byte-identical. Dev default true, no productionOverride.
  'coitFloodlight',
  'sutroAviationBands',
  // transamericaCrown (gtasf; FiDi skyline day read): the Transamerica Pyramid's aluminium spire read as a dull tan
  // needle that blended into the quartz body and tapered to a sub-pixel point that vanished at skyline distance.
  // Rebuilds the spire (above y212) as a crisp UNLIT (MeshBasicMaterial, toneMapped off) bright-aluminium needle that
  // keeps its colour against the sky on HD and Low and at any time of day, capped by a beacon mast + a red aviation-
  // beacon tip (the "crown") so it stays a readable solid instead of a vanishing point. NIGHT is unchanged -- the
  // night post-grade blues the whole frame, so a true lit crown beacon needs night-lighting shader work, not this;
  // this is the structural day read. A/B docs/sf-data/transamerica/{before,after}-noon (crown/skyline, desktop+phone,
  // matched framing): before dull-blended needle -> after crisp bright needle + beacon. Phone perf at the Transamerica
  // spawn 60.1 fps / p95 20.8 ms / max 23 ms / 0 console errors (docs/perf/phone-d6-2026-10-12T20-17-18-559Z) -- one
  // small unlit mesh replacing the old spire, perf-neutral. Flag-off byte-identical. Dev default true, no override.
  'transamericaCrown',
  // goldenGateOrange (gtasf; hero landmark read): the Golden Gate Bridge's base colour (#c0362c) is a brick-RED, so up
  // close / on the span -- a drivable deep-link destination -- the most recognisable SF landmark read as a fire-engine-
  // red bridge, not its famous International ORANGE. Uses a brighter, truer International Orange (#e35c2a) for the
  // structural members (tower legs/portals, deck rails, cables + hangers) and splits them into their own mesh with
  // distance FOG DISABLED so the orange holds across the near/mid span. Still lit (Lambert) so the Art Deco towers keep
  // their form; grey deck/piers/anchorages stay fogged. Honest scope: fixes the on/near read; the far cross-city view
  // stays pale because at >1 km the thin members are sub-pixel and antialias into the sky (colour can't overcome that).
  // A/B docs/sf-data/golden-gate/{before,after}-noon (span/tower, desktop+phone, matched framing): brick-red -> vivid
  // orange on the span. Phone perf at the new goldengate spawn is streaming-bound at that remote NW location and reads
  // identical OFF vs ON (mean 36.6 vs 37.0 fps, p95 107.9 vs 107.7 ms, max 547 vs 561 ms; median 16.7 ms = 60 fps both)
  // -- docs/perf/phone-d6-2026-10-12T20-32-39-664Z (on) / -20-33-47-080Z (off): one extra static mesh, perf-neutral.
  // Flag-off byte-identical. Dev default true, no productionOverride.
  'goldenGateOrange',
  // ferryClockFaces (gtasf; Embarcadero spawn hero): the Ferry Building clock tower is the player's arrival view --
  // every spawn faces it -- but the four dials used a cream LIT face that picks up the lighting and dulls (at golden
  // hour it goes a dim golden-tan that blends into the warm tower stone; it washes further on the Low/phone path), so
  // the signature clock barely reads. Rebuilds the dials (bezel, face, twelve markers, hands) into their own mesh
  // rendered UNLIT (MeshBasicMaterial, toneMapped off) with a brighter ivory face and crisp near-black hands, so the
  // clocks read as bright white faces from the plaza on HD and Low at any time of day. Only the dials change; the tower
  // stays lit. A/B docs/sf-data/ferry-clock/{before,after}{,-golden} (clock/plaza, desktop+phone): noon both read
  // (full sun keeps the cream bright) but golden shows the win clearly -- before dims to tan, after stays bright white.
  // Phone perf at the ferry spawn is vsync-bound ~60 fps (mean 16.67 ms, p95 19.7 ms, max 22.4 ms, 0 console errors;
  // docs/perf/phone-d6-2026-10-12T20-50-50-477Z) -- the gate reads 59.9999 on a 1000/16.667 float epsilon, a
  // substantive pass. One small unlit mesh, perf-neutral. Flag-off byte-identical. Dev default true, no override.
  'ferryClockFaces',
  // pier39Sign (gtasf; Embarcadero waterfront look gap): the Pier 39 overhead entrance marquee read as dim cream letters
  // on a dark teal panel that darkens and washes on the Low/phone path, so the signature "PIER 39" was near-invisible
  // from the approach. Rebuilds the sign panel + name into their own mesh rendered UNLIT (MeshBasicMaterial, toneMapped
  // off) as bright red "PIER 39" on a cream panel (the real marquee), so it reads from the Embarcadero on HD and Low.
  // Only the sign face changes; the gantry posts stay lit. A/B docs/sf-data/pier39/{before,after} (central-axis, desktop
  // +phone, matched framing): before dim teal band -> after red marquee. Phone perf at the new pier39 spawn is
  // vsync-bound ~60 fps (mean 16.68 ms, p95 21.2 ms, max 23.3 ms, 0 console errors; docs/perf/
  // phone-d6-2026-10-12T22-07-09-717Z) -- one small unlit mesh, perf-neutral. Flag-off byte-identical. Dev default true.
  'pier39Sign',
  // embarcaderoStreetcar (gtasf; Ferry Building / Embarcadero spawn look gap): the default-spawn plaza read as empty
  // flat paving with no SF identity, yet the founder-ladder onboarding keeps a new player there for their first
  // minutes. Adds the iconic historic F-line streetcar (classic Muni green-and-cream PCC livery, trolley pole, rail
  // stub, bright unlit "EMBARCADERO" roll sign + red "F" badge) parked on the Embarcadero median by the Ferry Building
  // terminus where the real F-line loops. Static hero prop placed via the landmark system (createEmbarcaderoStreetcar),
  // rendered fully UNLIT (MeshBasic, toneMapped off) so the Muni green holds at the golden 18:15 spawn instead of
  // washing to tan when lit. Excluded from the radar landmark list (a prop, not a destination). Pure procedural
  // geometry -- ZERO payload bytes, no textures. Ferry phone gate 60.2 fps / p95 21.5 ms with the car in view
  // (docs/perf). A/B docs/sf-data/streetcar-{off,on}-golden (spawn hero + close + sign end, desktop+phone): empty
  // median -> green "EMBARCADERO" streetcar. Flag-off byte-identical (landmark skipped + radar-excluded). Dev default true.
  'embarcaderoStreetcar',
  // vaillancourtFountain (gtasf; Ferry/Embarcadero spawn look gap): the founder-ladder onboarding swings the camera to
  // the player's Embarcadero billboard, but the plaza behind it read as a vast empty flat lot. Adds the Vaillancourt
  // Fountain -- the brutalist jumble of precast square concrete tubes over a pool that is the signature landmark of
  // Embarcadero (Justin Herman) Plaza at the foot of Market -- as the backdrop hero (reads behind the billboard with
  // the F-line streetcar beside it). Landmark system (createVaillancourtFountain); angled tubes are beam() square
  // sections; LIT (neutral grey concrete reads fine through the golden cast). Solid to the player, radar-excluded.
  // Pure procedural geometry -- ZERO payload bytes, no textures. Ferry phone gate 60.0 fps / p95 22.1 ms with it (and
  // the streetcar) in view. A/B docs/sf-data/fountain-{off,on}-golden (spawn->SW backdrop, desktop+phone): empty plaza
  // -> fountain hero. Flag-off byte-identical (landmark skipped + radar-excluded). Dev default true.
  'vaillancourtFountain',
  // vcOfficeSigns (gtasf; robotaxi arrival look gap): the founder ladder sends players by robotaxi to real VC offices
  // (shared/content/pitchVcs.ts) to pitch, but those offices were visually unmarked generic buildings -- arrival was a
  // nameless kerb. Plants a kerb-level monument at each firm (createVcOfficeSign, placed in createPlacedLandmarks;
  // kerb offset + street-facing via world.nearestRoad in updateLandmarkTerrain once the road graph loads): a dark slab
  // with a per-firm accent + the firm NAME rendered UNLIT on both faces (MeshBasic, toneMapped off) so it reads bright
  // on HD + Low from either approach. No textures (vector lettering; added glyphs K/X/Z), no per-frame cost; 14 static
  // signs across the map (frustum-culled), ZERO payload. A/B docs/sf-data/vc-arrival-{off,on}-golden (a16z arrival,
  // desktop+phone): nameless building -> "ANDREESSEN HOROWITZ" monument. Flag-off byte-identical (signs not added;
  // not in the radar landmark list). Dev default true.
  'vcOfficeSigns',
  // cityLightsSign (gtasf; North Beach look gap): the City Lights Booksellers vertical blade sign at Columbus & Jack
  // Kerouac Alley -- the Beat-era landmark -- was missing. Adds it as a scoped landmark (createCityLightsSign): a dark
  // green projecting blade on a bracket off the building corner carrying the tall vertical "CITY LIGHTS" name.
  // Blade/bracket are the usual lit mesh; the white name + red border are a SECOND mesh rendered UNLIT (toneMapped
  // off) like the Castro crossing, so the sign reads bright on HD and Low. A/B docs/sf-data/city-lights ({before,
  // after}: bare corner -> the blade sign; overhead/street/oblique, desktop+phone). Phone perf at North Beach 60.0 fps
  // / p95 21.0 ms / max 26.7 ms / 0 console errors (docs/perf/citylights-on) -- two small static meshes, perf-innocent.
  // Flag-off byte-identical. Dev default true, so no productionOverride needed.
  'cityLightsSign',
  // grantAveLanterns (gtasf-e1sw; Chinatown street walk): Chinatown read as a generic street. Strings red paper
  // lanterns on sagging cables across Grant Ave through Chinatown, built from the road graph (every "Grant Avenue"
  // edge within the Chinatown Z/X bounds, one span per ~26 m with five hanging red-and-gold lanterns). One cheap
  // vertex-coloured merged static mesh, no textures/per-frame cost; HD + Low. A/B docs/sf-data/grant-lanterns
  // ({off,on}: bare street -> lantern-strung street, desktop+phone; aerial shows the full strung avenue). Phone
  // perf: zero cost — chinatown ON 60.11 fps ≈ OFF 60.03 fps, p95 ~21 ms, zero console errors (docs/perf/
  // grant-lanterns-{on,off}). Flag-off byte-identical. Dev default is true, so no productionOverride needed.
  'grantAveLanterns',
  // paintedLadiesColour (gtasf-xnq7; Alamo Square look gap): the authored Painted Ladies landmark rendered all 7
  // houses in one near-monochrome pale palette, so SF's most iconic Victorian row read as a uniform tan terrace.
  // A curated per-house palette (paintedLadyPalette.ts: sage/dusty-blue/ochre/terracotta-rose/mauve/olive/tan
  // bodies + their own trims, ordered so neighbours contrast, tuned for the SA grade) already existed but was
  // never wired to these houses. This wires paintedLadyScheme(i) into createPaintedLadies so each house gets its
  // distinct body + trim and the row reads as the Painted Ladies. Vertex colours on the existing merged static
  // mesh -- identical geometry/draws/shader, so zero perf delta by construction. A/B docs/sf-data/painted-ladies
  // ({before,after}: uniform tan row -> varied colour row, postcard/facades/topdown, desktop+phone). Phone perf:
  // Alamo Square ON 60.08 fps / p95 20.9 ms / 0 console errors (docs/perf/paintedladies-alamo-on). Flag-off
  // byte-identical. Dev default is true, so no productionOverride needed.
  'paintedLadiesColour',
  // Fix a live bug: the fund-drop drive-through gate (translucent cylinder) washed the whole screen orange when the
  // camera was inside the ring. Now the gate cylinder is hidden while the camera is within the volume (ring/label/
  // arrow/banner stay). A/B docs/sf-data/drop-gate/. Dev default is true, so no productionOverride needed.
  'dropGateNoInsideWash',
  // Aerial road read: lift the near-black asphalt toward mid grey at aerial/distant view, so streets don't read as
  // black voids from the title flyover (near street-level unchanged). A/B docs/sf-data/aerial-road/; phone perf
  // passed (ferry gate 60.2 fps / p95 21.1 ms). Dev default is true, so no productionOverride needed.
  'aerialRoadRead',
  // Green residential block interiors: tint the back/front-yard urban-ground (tile-0) in residential neighbourhoods
  // to varied lawn green, gated by a per-chunk distance-to-nearest-road mask so streets/sidewalks stay grey (the
  // carriageway shares tile-0 with the backyards in SF residential blocks). A/B docs/sf-data/block-interior/
  // mask-{before,after}-*.jpg (phone aerial clearly green, streets unchanged, street-level carriageway grey); Haight
  // phone perf passed 60.0 fps / p95 21 ms (docs/perf/phone-e4ev-haight-on). Dev default is true, so no override.
  'residentialBlockGreens',
  // Ground-contact AO at building bases (gtasf-a13b, look-gap item 5): a per-chunk distance-to-nearest-footprint
  // mask darkens the terrain/road/kerb albedo hugging building walls (floor 0.42, fade by ~9 m), grounding the
  // buildings with soft occlusion. One texture fetch + a smoothstep; no new draw calls/passes; HD + Low. A/B
  // docs/sf-data/contact-ao/*-{before,after}.jpg (phone street-level shows a clear grounding shadow at bases).
  // Phone perf neutral: ferry 60.06->60.07, haight 60.01->60.12, mission ~60 both (docs/perf/contactao-{off,on}).
  // Flag-off is byte-identical (all AO injections are flag-gated). Dev default true, so no override.
  'groundContactAO',
  // Fix a pre-existing PHONE/Low defect (gtasf-legibleroads): the urbanSurfaces road carriageway rendered
  // near-black on Low (dark asphalt albedo, and Low has no IBL and no tonemapping), so the near road read as a
  // jagged near-black slab against the lighter sidewalks. This floors the Low road albedo to a legible asphalt
  // grey at all distances (mirrors aerialRoadRead's max(color,~0.30); roads only; HD untouched, stays dark via
  // PBR+IBL). A/B docs/sf-data/legibleroads/*-{before,after}.jpg (phone road slab gone, desktop unchanged).
  // Phone perf neutral: ferry/haight/mission ~60 (docs/perf/legibleroads-on); the lift is one max(). Dev true.
  'legibleLowRoads',
  // Parks read as varied landscaping, not a flat vivid lawn (gtasf-wctq; spawn walk-around gap — the
  // Embarcadero median is the first green a new player sees). Mapped park terrain (tile 7) was one saturated green
  // with only a brightness mottle; this recolours it across three desaturated greens (mown / drier / shrub) using
  // the lawn noises already fetched (no added shader cost). Dry hillside (tile 8) untouched; runs on HD and Low.
  // A/B docs/sf-data/parkgreens (Embarcadero median + Dolores, phone+desktop). Ferry phone perf ~60 with it on
  // (docs/perf/parkgreens-on). Flag-off byte-identical. Dev default true, so no productionOverride needed.
  'richParkGreens',
  // Dolores Park reads as a specific place, not a flat green slab (gtasf-zcgx; Mission walk gap). Dolores is baked
  // with the castro/mission district park green ([0.23,0.43,0.18]), which does NOT match the tile-7 classifier, so
  // it classified as unclassified ground and got NO lawn treatment at all (not even richParkGreens) -- raw flat
  // baked green. This Dolores-scoped branch (keyed to the park's world-space rectangle, firing on unclassified/park
  // ground inside it) recolours the grass across large-scale section tone (deep mown green <-> sun-dried
  // yellow-green) with trampled worn-grass/dirt sitting patches; the park's footpaths are separate roads* meshes
  // (untouched) and read clearly against the varied lawn. A few noise evals, zero texture fetch, no geometry; runs
  // on HD and Low. A/B docs/sf-data/dolores-park/{before,after} (aerial/topdown/lawn/street, phone+desktop).
  // Perf-innocent: Dolores steady-state frame identical on/off (median 16.9 vs 16.8 ms; docs/perf/dolores-{on,off}
  // -- the dense Mission spot itself is sub-60 mean on and off, a pre-existing neighbourhood hitch, not this
  // feature), and ferry phone ~60 / p95 21.7 ms with it on (docs/perf/dolores-ferry-on), zero console errors.
  // Flag-off byte-identical. Dev default true, so no productionOverride needed.
  'doloresPark',
  // Alamo Square reads as a park, not a flat green slab (gtasf-95kq; completes the Painted Ladies postcard -- the
  // lawn the row sits above). Same root cause as Dolores: Alamo Square is baked with the western-addition district
  // park green ([0.16,0.33,0.10]), which does NOT match the tile-7 classifier, so it was unclassified ground with
  // no lawn treatment -- a raw flat slab. This Alamo-scoped branch (keyed to the square's world-space rectangle,
  // centre ~(-2272,864), firing on unclassified/park ground inside it) recolours the grass across section tone
  // (deep mown green <-> drier) with gentle worn patches, a touch lusher/less-worn than Dolores. Grass only; the
  // square's footpaths are separate roads* meshes (untouched). A few noise evals, zero texture fetch, no geometry;
  // runs on HD and Low. Same perf class as doloresPark (steady-state unchanged -- Alamo gate 60.08 fps without the
  // branch, 59.94 with it, within run-to-run noise). A/B docs/sf-data/alamo-square/{before,after} (lawn/postcard/
  // topdown, desktop+phone). Phone perf: Alamo Square ON 59.9 fps / p95 20.6 ms / 0 console errors
  // (docs/perf/alamogreens-on). Flag-off byte-identical. Dev default true, no productionOverride.
  'alamoSquareGreens',
  // districtParkGreens (gtasf; park-slab generalisation): the same district-override-park-slab fix (doloresPark/
  // alamoSquareGreens), generalised into a registry (web/src/render/urbanSurfaces.ts) so the remaining confirmed-flat
  // neighbourhood parks get varied landscaping from ONE template instead of per-park copies. Adds Lafayette Park and
  // Alta Plaza Park (both Pacific Heights, baked [.17,.34,.11]) and the Panhandle (Haight-Ashbury, baked [.20,.37,.15])
  // -- all district-override greens that do NOT match the tile-7 classifier, so they rendered as raw flat slabs with
  // no lawn treatment. Each is a world-space rect (frame from block corners, tools/park-frames.mjs) firing on
  // unclassified/park ground inside it, recoloured across section tone (deep mown green <-> drier) with gentle worn
  // patches, lush/low-wear palettes for these well-kept parks. Washington Square deliberately EXCLUDED -- it is baked
  // with the DEFAULT park green, classifies as tile-7 and already gets richParkGreens (confirmed via before-capture),
  // so it is not a gap. The registry also drives the doloresPark/alamoSquareGreens entries from the same template
  // (verified no regression). Grass only; footpaths untouched. Zero texture fetch, no geometry/draw calls; HD + Low.
  // A/B docs/sf-data/{lafayette,alta-plaza,panhandle}/{before,after} (oblique aerial, desktop+phone). Perf-innocent
  // (same class as doloresPark: cosmetic per-fragment recolour inside small rects, no new fetches); phone perf run
  // docs/perf/districtparks-on. Flag-off byte-identical. Dev default true, no productionOverride.
  'districtParkGreens',
  // Worn road paint on Low, matching HD (gtasf-izu9; spawn walk-around gap). HD's worn-paint fade
  // (roads.ts, hdPolish only) is skipped on Low, so generated lane/crosswalk paint renders at full texture
  // brightness with no tonemap — a tangle of neon markings at junctions, the brightest thing in the first-60s
  // spawn view. This brings the same wear fade to Low plus a desaturate+darken (stronger up close where the glare
  // is worst), so markings read as worn paint but stay navigable. Paint materials only; HD byte-identical.
  // A/B docs/sf-data/lowpaint (Embarcadero junction + median, phone). Ferry phone perf ~60 with it on
  // (docs/perf/lowpaint-on). Flag-off byte-identical. Dev default true, so no productionOverride needed.
  'legibleLowPaint',
  // No pure-black vehicles on Low (gtasf-4rx2; founder review). The Low ps2 path has no IBL/ambient lift, so a
  // parked car's body/glass face turned away from the sun collapses to pure black — a near-black blob when the car
  // sits against the camera (HD keeps it a dark grey). A small emissive floor on the PS2 vehicle materials
  // (polishVehicle) keeps shadow-side faces a dark-but-legible vehicle shape. Low only; HD byte-identical. Verify
  // docs/sf-data/review-fix/junction-car.jpg (black blob -> grey car). Flag-off byte-identical. Dev default true.
  'legibleLowVehicles',
  // Block-interior canopy MASS (gtasf-cf1a): the residential AERIAL leafiness gap. Instanced canopy "blobs" (a
  // crossed card + a big horizontal cap) scattered through residential block interiors (where roadDist>14m and
  // not under a footprint, LEAFY_RESIDENTIAL only), tall enough to read over the rooftops from the oblique
  // aerial. A/B docs/sf-data/leafy/haight-aerial-*-{before,after}.jpg (blocks go from open ground to leafy on
  // desktop + phone). Perf-safe: rendered ONLY from an aerial vantage (hidden at street level, where it is
  // occluded anyway) and its placement scan is deferred to idle, so street gameplay / the phone gate pay nothing
  // -- ferry 60.08; haight-props steady is noise-dominated (~54-59 with the canopy off OR on). Flag-off is
  // byte-identical. Dev true. [gtasf-cf1a]
  'blockInteriorCanopy',
  // Incremental coarse building-collision index (gtasf-3k35): add/remove a chunk's faces to the existing cell
  // grid instead of a full re-bucket per chunk mount -- saves ~165ms main-thread CPU across the Haight mount.
  // Collision RESULTS byte-identical (unit test incremental==full + identical live triangleTests + same-pose
  // placement look check, no props in buildings/roads). Pure perf, behaviour-identical. Dev default true.
  'fastStructureCollision',
  // Async whole-city routing index (gtasf-a989): build createMapRouter's index via an idle-sliced generator
  // (~6ms/slice) instead of one ~412ms synchronous frame -- kills the biggest prop-mount hitch (longest slice
  // 206->27.7ms, haight-props worst frame 809->423ms, Ferry unregressed). Routes byte-identical (unit test
  // incremental==sync + offline SF-graph run); nav smoke routed correctly. Pure perf, behaviour-identical.
  'asyncMapRouter',
  // Slice the radar's minimap road-tile Path2D build across idle callbacks (gtasf-347x) instead of one ~400ms
  // (4x-throttled phone) blocking frame on first draw -- the largest remaining post-READY mount frame, which
  // asyncMapRouter did not cover (buildRoadTiles lands just before propsDrawn). Same per-edge accumulation
  // (addRoadEdge), self-timed ~4ms slices, adaptive idle pump; tile geometry byte-identical to the sync path.
  // VERIFIED phone (4x throttle): haight-props full-window max 384->~300ms (the 371ms buildRoadTiles frame is
  // gone; the ~300ms residue is the pre-existing prop-mount cluster, present OFF too), own sliced frames capped
  // ~12ms; sustained steady fps unchanged (median 16.9->16.7ms, p90 ~21.5, trimmed-mean ~60.8 both); Ferry
  // unregressed (60.0-60.2). Flag-off runs the original synchronous buildRoadTiles (byte-identical). Pure perf.
  'slicedRoadTiles',
  // Founder ladder phase 1 (gtasf-founder-ladder-p1-ilnl; orchestrator sign-off on the in-game evidence):
  // the one-obvious-path onboarding shipped as a 50/50 A/B on NEW devices — the `ladder` bucket gets
  // found-your-startup → Embarcadero billboard → share → valuation; the `control` bucket keeps the current
  // onboarding. Returning players are untouched. Dev source stays false (so the 50/50 split does not hit
  // dev/preview captures), so founderLadder is also in productionOverrides below. billboard_seen + bucket +
  // founder_found events reach analytics via the already-reviewed posthogAnalytics.
  'founderLadder',
  // Founder ladder phase 5 (gtasf-ldlm; founder sign-off on the reshoot, 2026-10-13): free-roam meme-NPC
  // side quests — 3 fictional VC archetypes (Patagonia-vest VC / AI-pilled solo GP / wrapper-skeptic angel)
  // that roast the player's pitch via the REVIEWED pitch path (founderMemePitchTarget + handlePitchTap's
  // memeNpcId branch: fictional persona, never a real person/firm; per-SF-day cooldown; no Seed-floor leak —
  // money path reviewed, ca97ff51). Depends on pitching + founderLadder (both already reviewed). Distinct
  // silhouettes render in prod via the scoped forceLook (local render-only NPCs, independent of the still-off
  // characterLooks wire gate). Also lights up the radar quest-giver marker + "💬 Pitch a VC" legend (both
  // gated on this flag). Reshoot passed desktop + phone Low (docs/sf-data/founder-ladder/phase5-meme-*). Dev
  // source stays false (keeps it out of dev/preview captures), so memeQuests is also in productionOverrides.
  'memeQuests',
  // Founder ladder phase 5.1 (gtasf-ldlm): the drive ("escape the cone") + share ("repost my take") verb-variety
  // side quests — per-quest sub-gates under memeQuests, each a reviewed money path (runDriveQuest server-verifies
  // escapedCone + a per-SF-day ref; runShareQuest is client-trust with a once-ever ref; both source 'celebrity',
  // founder-approved payouts). Reachable only via the funding-routes allowlist fix (the handlers existed but 404'd
  // before — regression test added). NPCs render on walkable placements with labels + quest-matched E prompts.
  // In-game evidence docs/sf-data/founder-ladder/phase51-* (share card -> +$250k cheque -> once-ever blocked;
  // drive protester -> "escape the cone" -> +$1M cheque), desktop + phone Low. Dev source false -> also in
  // productionOverrides below.
  'driveQuest', 'shareQuest',
  // timeTrials (skill board, no valuation; server-authoritative submit re-reviewed) + seriesAQuest (Demo Day, Series A
  // floor stage-gated, 81908c49). Orchestrator 2026-10-14; docs/ship-packet-lane-c.md. seriesAQuest is dev-off -> also below.
  'timeTrials', 'seriesAQuest',
  // Lane C batch 2, money/server review passed 2026-10-14 16:xx (docs/ship-packet-lane-c-batch2.md): SF pilgrimage
  // (once-ever landmark refs, approach-from-150 m), Find Your Co-founders (server checkpoints, daily), Dolores doomer pitch
  // + AI-pendant joyride (reviewed pitch/drive paths, daily refs). acquihireQuest HELD (refund-vs-award race).
  'pilgrimage', 'cofounderHunt', 'doomerQuest', 'pendantQuest',
  // Multiplayer + combat phase 3, review-passed 2026-10-14 18:xx: live street races (no money; server checkpoints),
  // co-op heist getaway driver (own daily heist ref each), melee + peds fight back, health/armour pickups + armour
  // (store-distance checked, e667f565). HELD: mostWantedBounty (collusion farm), vehicleDamage, policeRam.
  'streetRaces', 'coopHeist', 'pedMelee', 'vitalsPickups',
  // Meshy-6 people (existing plan credits): SFPD officer, pedestrians, player looks + vertex-animated far crowd
  // (docs/reviews/2026-10-14-meshy-vs-cc0-people.md final SHIP; in-session A/B 34.8 vs 34.1 fps). Founder: characters suck.
  'meshyPeople', 'crowdVat',
  // PULLED 2026-10-15 02:50: adultDefaultLook + lowNearPeople (N1: black-silhouette people at night, phone Low rigged bodies +
  // black-cloth default rolls; docs/reviews/2026-10-15-world-alarm.md). shootingFeel SHIP (after-fix shots, firefight 44.6 fps).
  'shootingFeel',
  // 2026-10-15 05:50: N1 closed (docs/reviews/2026-10-15-night-people.md: avatarNightFill + adultDefaultLook + lowNearPeople
  // together, night spawn + near-walker shots, 57 fps); in-car opening (actionOpening SHIP, H1 fixed, money identical);
  // founder rank (read-only, docs/reviews/2026-10-15-founder-rank.md).
  'avatarNightFill', 'adultDefaultLook', 'actionOpening', 'founderRank', 'lowNearPeople',
  // personalCar (SAFE, docs/reviews/2026-10-15-batch3.md) + riskReward (robbery capped $5k, bust $2.5k / wasted $1k caps).
  // personalCar PULLED 2026-10-15 08:55: suspect for the P0 world-socket 1006 drops that began with #6.22 (QA f7d581d3).
  'riskReward',
  // 2026-10-15 10:50 (reviewer + critic SHIP): live night key light (no 03:00 navy slab), dawn sky guard, car close detail,
  // HUD menu fold + focus, ped idle variety, weapon poses + RMB aim-hold camera. personalCar stays off pending the P0.
  'liveNightKey', 'skyDawnGuard', 'carNearDetail', 'hudMenuFold', 'hudFocus', 'pedIdleVariety', 'weaponPoses',
  'waterfrontWalkers', // reviewer SHIP 10:58 (same walker count, authored promenade spans)
  'noonClearHaze', 'shoreSeams', // critic SHIP 12:33-12:41 (opening target reads at 600 m; shore seams)
  'loadingHook', // critic SHIP 13:30: hook line + verb + poster at 0.5 s (N13: ~90 of ~200 abandons at boot)
  'localBodyFirst', 'fireEscapeWalkups', // reviewer SHIP 14:19-14:27 (N12 no outfit morph mid-reveal, bounded 4 s; buried tower stack removed)
  'reconnectGrace', // reviewer SAFE 17:22: a brief socket drop keeps the run/wanted/heat (P0 j7wvv mitigation)
  'drivingFeel', // reviewer SHIP 19:37: moving phone-Low gate 58.8 fps / p95 21 ms at 48 m/s
  'trafficDrivers', // reviewer SHIP (docs/reviews/2026-10-15-traffic-drivers.md): drivers visible through traffic windscreens; perf ABBA clean
  'sampledAudio', 'reconnectNotice', // CC0 sampled guns/sirens/engine/barks/screams (reviewer perf PASS 36.3 fps at 4 stars; founder: don't wait for my review) + reconnect banner
  'twinStick', // founder decision (phone combat = twin-stick): FIRE is the right stick, hold to fire / drag to aim; perf PASS, touch-verified 3d9c6a78
  'pickupModels', // reviewer SHIP 14:18-14:43: 3D medkit + armour vest replace the emoji pickups
  // GTA V critique batch (docs/critique/2026-10-15-gta-v-gap.md; reviewed docs/reviews/2026-10-15-critique-batch.md,
  // 2026-10-15-death-clips-near-people.md, 2026-10-14-police-presence.md, 2026-10-15-parked-props.md): reference grade, Ferry
  // plaza setts + glazed arches, overcast rain, Broadway neon, SF General arrival, HUD declutter, on-foot inertia, GTA
  // mission titles, rigged Meshy people (cc0People + adult default look), death clips, near people on Low, armed SFPD
  // officers, parked food trucks/scooters. HELD: shootingFeel (needs after-fix shots + perf), actionOpening (H1), riskReward.
  'referenceGrade', 'ferryPlazaSetts', 'rainOvercast', 'broadwayNeon', 'sfGeneralArrival', 'hudDeclutter', 'onFootInertia', 'missionPresentation', 'cc0People', 'policePresence', 'parkedProps', 'meshyDeathClips',
  // Re-review passed 2026-10-14 19:45 (docs/reviews/2026-10-14-{blocked-flags-rereview,server-commits-sweep,night-lamps}.md):
  // Buy My Company (claim-first escrow), car damage/explosions (server-capped crash speed, burn timer), SFPD on foot,
  // police ram/fire/bust (LoS + same-level, fail closed), steal kerb-parked cars (1 per player, 30 per world; founder
  // 'can't get in cars'), night car lamps + lamp pool height fix. HELD: mostWantedBounty (A-M1 leaderboard skew).
  'acquihireQuest', 'vehicleNightLamps', 'lampHeightClear', 'vehicleDamage', 'sfpdOnFoot', 'policeRam', 'policeFire', 'policeBust', 'kerbCarTheft',
  // GTA V pivot combat & police (lane B) + the pitch-deck heist (lane C). FOUNDER GO 2026-10-14 09:xx. Money/server
  // review passed (docs/combat-lane-enable-brief.md, docs/economy/lane-c-payout-review.md); two-client PvP check;
  // phone firefight 40 fps / p95 34 ms (docs/perf/combat-enable-gates.md). Dependency order. Dev-off -> also below.
  // policeAir + trafficDrivers stay out (lane-A art).
  'combat', 'gore', 'weapons', 'serverHits', 'openPvp', 'wanted', 'gunShop', 'carjacking', 'storeRobberies', 'ragdollAudio', 'combatVfx', 'sfpdLook', 'missions',
  // Combat phase 2 (lane B), review-passed 2026-10-14 15:00: street-crime wanted, helicopter/SWAT (+ lane A art;
  // phone 33.4 fps / p95 42.5 ms at 4 stars), cost toast, combat_step analytics, radar blips, wanted escape flash.
  // HELD: policeFire, sfpdOnFoot, policeBust (police LoS/wall checks skipped when collision isn't loaded).
  'streetCrimeWanted', 'policeAir', 'policeAirArt', 'combatCostToast', 'combatAnalytics', 'combatRadarBlips', 'wantedEscapeFlash',
]);
// The pre-playtest snapshot includes accepted native character/car/handling
// and road-recovery work; its full founder journey exercises the R action.
// Vehicle audio passed native desktop/phone lifecycle proof before the pin.
// Milestone 3 enabled measured world systems and actual SF solar/NWS atmosphere.
// Chat's local wordlist runs without a key;
// moderation/provider/payment switches remain outside this allowlist.
// Events refresh is now scheduled: the 3-hourly cron drives the public official
// feed refresh (no secret required). Paste-a-link `eventSubmission` is enabled for milestone #1:
// TYPESAFE_API_KEY is provisioned (Jev gates spam) and the H6 rate-limit + M1 fail-safe gate landed.
// V2 funding (gtasf-prod-allowlist-funding-v2-yza0): driveThroughFunding + capTable are game-data
// logic with no external secret; verified green via worker/src/funding/credits.test.ts and
// web/src/funding/client.test.ts (38 tests). fundDrops joins in milestone #1 (wired + founder-path
// smoke green). floatingEventNames stays out (flag still false, pane 6 look gate); celebNpcs is added
// only after its in-run look-check passes (founder-approved roster on gtasf-xcar).
const productionOverrides = new Set(['fundedStars','events','eventVisits','sun','weather','traffic','cableCars',
  // V2.1 #3: ON in prod (orchestrator-directed) though dev source keeps them false until each pane's own gate.
  'madMaxRobotaxi','characterLooks','accountRecovery','hillJumps','economyV3','posthogAnalytics','xAdsPixel','emailCapture','playfulMayhem','voicePublic','pitching','angelNpcs','founderLadder','memeQuests','driveQuest','shareQuest','seriesAQuest','combat','gore','weapons','serverHits','openPvp','wanted','gunShop','carjacking','storeRobberies','ragdollAudio','missions','streetCrimeWanted','policeAir','combatCostToast','combatAnalytics','combatRadarBlips','wantedEscapeFlash','pedMelee','vitalsPickups','vehicleDamage','sfpdOnFoot','policeRam','policeFire','policeBust','kerbCarTheft','meshyPeople','policePresence','parkedProps','meshyDeathClips','shootingFeel','lowNearPeople','riskReward','weaponPoses','drivingFeel','sampledAudio']);
for (const name of reviewed) if (!(name in flags) || (!(flags as Record<string, boolean>)[name] && !productionOverrides.has(name)))
  throw new Error(`Production feature has not been enabled in reviewed source: ${name}`);
// A LIVE Stripe key is configured, so every real-money / checkout flag MUST stay out of the
// production allowlist until the founder signs off one approved low-value test charge end-to-end
// (then refunds it). This guard fails the prod config build if any ever sneaks into `reviewed`.
const PAYMENT_FLAGS = ['stripe', 'outbidCheckout', 'outbidPlane', 'fundDropSponsors',
  'becomeAnAngel', 'billboards', 'impressions', 'rentals', 'officeClaims', 'officeClaimDelivery',
  'referralCredit', 'referralClaims', 'referralCashout'];
for (const name of PAYMENT_FLAGS) if (reviewed.has(name))
  throw new Error(`Refusing to build production config: real-money flag '${name}' is in the reviewed allowlist. Checkout stays OFF in production until the founder approves a live test charge (gtasf-xcar-style gate).`);
const local = parseEnv(await readFile('worker/.dev.vars','utf8'));
// STRIPE_PUBLISHABLE_KEY is the pk_live_* publishable key: public by design (safe in worker vars and
// the web bundle as VITE_STRIPE_PUBLISHABLE_KEY). It cannot create a charge without the server-side
// secret + an enabled checkout flag, both of which stay off. The sk_live secret is a Wrangler secret,
// never a var here. Optional (picked up only if present in .dev.vars); not in the required list below.
const publicNames = ['X_PIXEL_ID','X_EVENT_PLAY_START','X_EVENT_OUTBID_PURCHASE','X_EVENT_AD_PURCHASE','POSTHOG_KEY','POSTHOG_HOST','POSTHOG_PROJECT_ID','STRIPE_PUBLISHABLE_KEY'] as const;
const publicVars: Record<string,string> = {};
for (const key of publicNames) if (local[key]) publicVars[key] = local[key]!;
for (const key of ['X_PIXEL_ID','X_EVENT_PLAY_START','X_EVENT_OUTBID_PURCHASE','X_EVENT_AD_PURCHASE'])
  if (!publicVars[key]) throw new Error(`Missing public configuration ${key}`);
if (reviewed.has('posthogAnalytics')) {
  if (!publicVars.POSTHOG_KEY?.trim()) throw new Error('Missing public configuration POSTHOG_KEY');
  publicVars.POSTHOG_HOST ||= 'https://eu.i.posthog.com';
  const host = new URL(publicVars.POSTHOG_HOST);
  if (host.protocol !== 'https:' || host.username || host.password || host.search || host.hash)
    throw new Error('POSTHOG_HOST must be an HTTPS ingestion host without credentials or query');
}
const config = {
  $schema: '../node_modules/wrangler/config-schema.json', name: 'gtasf-production', account_id: account,
  main: 'src/index.ts', compatibility_date: '2026-09-28', compatibility_flags: ['nodejs_compat'], workers_dev: true,
  // Workers Logs (orchestrator 2026-10-15, P0 world-socket 1006 drops): persisted logs that survive `wrangler tail` disconnects.
  observability: { enabled: true, head_sampling_rate: 1 },
  vars: { ENVIRONMENT: 'production', LAUNCH_MODE: 'open', WORLD_CAPACITY: '150', // public since Oct 4 ~11:25 PT (founder: 'make it public now')
    // Citywide robotaxi/traffic routing (gtasf-u4al): WorldDO follows the published map manifest's
    // release-pinned roadgraph.bin + sha256 (the graph browsers load); unpublished -> embedded corridor.
    WORLD_ROAD_GRAPH_KEY: 'map/lombard/manifest.json', ...publicVars },
  alias: { '@gtasf/shared/flags': './.wrangler/production/flags.ts' },
  durable_objects: { bindings: [{ name: 'WORLD', class_name: 'WorldDO' }, { name: 'LEDGER', class_name: 'LedgerDO' }, { name: 'LOBBY', class_name: 'LobbyDO' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['WorldDO','LedgerDO'] }, { tag: 'v2', new_sqlite_classes: ['LobbyDO'] }],
  d1_databases: [{ binding: 'DB', database_name: 'gtasf-production', database_id: databaseId, migrations_dir: 'migrations' }],
  r2_buckets: [{ binding: 'ASSETS', bucket_name: 'gtasf-assets-production' }],
  // Cloudflare Email Service binding for emailCapture (gtasf-1aon); gtasf.com is onboarded for sending.
  ...(reviewed.has('emailCapture') ? { send_email: [{ name: 'EMAIL' }] } : {}),
  // Workers AI (Whisper) for spoken-bubble STT (gtasf-qjja); only bound when voiceCaptions is reviewed.
  ...(reviewed.has('voiceCaptions') ? { ai: { binding: 'AI' } } : {}),
  queues: { producers: [{ binding: 'JOBS', queue: 'gtasf-jobs-production' }], consumers: [{ queue: 'gtasf-jobs-production', max_batch_size: 10, max_retries: 3 }] },
  // Every three hours: scheduled() sends a refresh-events job (guarded by flags.eventsRefresh).
  // The 08:00 reprice cron stays off until flags.rentals is enabled.
  triggers: { crons: ['0 */3 * * *'] },
};
await mkdir('worker/.wrangler/production', { recursive: true });
const selected = Object.fromEntries(Object.keys(flags).map(key => [key, reviewed.has(key)]));
await writeFile('worker/.wrangler/production/flags.ts', `// Explicitly reviewed private playtest features; external providers remain off.\nexport const flags = Object.freeze(${JSON.stringify(selected, null, 2)});\nexport type Feature = keyof typeof flags;\n`);
await writeFile('worker/wrangler.production.jsonc', JSON.stringify(config, null, 2) + '\n');
const pageVars = Object.fromEntries(Object.entries(publicVars).map(([key,value]) => [`VITE_${key}`,value]));
const services = [{ binding: 'API', service: 'gtasf-production' }];
await writeFile('web/wrangler.production.jsonc', JSON.stringify({
  $schema: '../node_modules/wrangler/config-schema.json', name: 'gtasf',
  pages_build_output_dir: './dist-production', compatibility_date: '2026-09-28',
  services, vars: pageVars, env: { preview: { services, vars: pageVars } },
}, null, 2) + '\n');
await writeFile('worker/.wrangler/production/public-vars.json', JSON.stringify(publicVars, null, 2) + '\n');
await writeFile('worker/.wrangler/production/manifest.json', JSON.stringify({ account, databaseId, launchMode: 'invite', capacity: 150, flags: selected }, null, 2) + '\n');
console.log(`Prepared ${resolve('worker/wrangler.production.jsonc')}; no remote mutation. INVITE_CODE is a separate Wrangler secret.`);
