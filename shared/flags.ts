/** Every feature is gated here. Enable unfinished integrations only with their bead's evidence. */
export const flags = Object.freeze({
  bootstrapScene: true, multiplayer: true, onFoot: true, ps2Render: true,
  // Realistic renderer (founder 2026-10-04, teleoperator look): ACES tone mapping, directional sun
  // shadows, PBR/MeshStandard materials, HDRI image-based lighting, SSAO, SMAA, reduced fog, bloom on
  // lights only; HD/Low graphics presets (web/src/render/graphicsPreset.ts). OFF until pane 6's
  // in-browser + phone-fps acceptance; the ps2Render path above is the fallback. [realisticRender]
  realisticRender: true,
  // realisticLightingV2 (GTA-pivot lane A #2): port the dead realistic path's ACES tone mapping + HDRI IBL env +
  // SSAO into the LIVE graphicsV2 HD path, behind this flag, so PBR cars (pbrCarsV2) and buildings light
  // realistically instead of flat ps2. Keeps the timeGrade palettes (the realistic post gets a final grade pass).
  // HD only (Low keeps ps2). Flag-off is byte-identical (graphicsV2 ps2 post). OFF until the desktop + phone-Low
  // A/B and the >=30fps phone gate pass. [gtasf-gta-pivot]
  realisticLightingV2: false,
  // Graphics v2 (docs/engineering/graphics-v2.md, founder-approved, soft launch): polish of the SA look —
  // colour grade, haze, sky/clouds/sun glow, golden-hour moods; building facades/roof clutter. HD gets the
  // heavy effects, Low only cheap wins. Dev ON; NOT in the prod allowlist until the founder approves a preview.
  graphicsV2: true,
  // Warm shadow fill (teleoperator-reference look #1): a dim, warm directional light from OPPOSITE the sun lifts
  // the shadowed (anti-sun) building faces that the graphicsV2 low-sun ambient cut crushes to muddy dark at golden
  // hour — warm detail back in shadow, toward the reference's warm cohesion, WITHOUT the milky global ambient wash.
  // Strongest when the sun is low, off at night; byte-identical when off (no fill light created). Dev ON; NOT in the
  // prod allowlist until the founder approves the A/B shots (Ferry/Market/Lombard, desktop + phone Low).
  warmShadowFill: true,
  // Warm ground grade (teleoperator-reference look #2): the carriageway reads cool-grey-flat against the warm
  // sidewalks/buildings — on Low it has no warm treatment at all (the warm bounce is HD/polish-only). Nudge the
  // road albedo toward a warm asphalt tone, scaled by how warm the sun is (golden hour), so night stays neutral.
  // Road materials only; byte-identical when off. Dev ON; NOT in the prod allowlist until the founder approves.
  warmGroundGrade: true,
  // Full takram AerialPerspectiveEffect on HD (gtasf-kpi9): a HalfFloat pmndrs composer (aerial perspective, low
  // bloom, ACES, sRGB) replaces the ps2 post while the physical sky is up, and the "lite" horizon fade is skipped.
  // Requires graphicsV2 + HD preset (takram sky loaded). OFF until a pane-6 desktop HD look at Ferry + Twin Peaks.
  aerialPerspectiveHd: false,
  // Real SF street trees (gtasf-umar): every DataSF Street Tree List tree (tkzw-k3nq, PDDL; PROVENANCE.md) at its mapped
  // position, shape-mapped onto the six foliage billboards, sized by DBH, instead of procedural street trees.
  // web/public/art/trees/street-trees.bin (527 KB gz, fetched after READY, not first load). Bounded by the street-prop capacity/radius
  // (Low 230 m). Dev ON; prod after the founder's look (docs/sf-data/).
  realStreetTrees: true,
  // More rooftop life (gtasf-3o55, founder look gap item 3) on top of rooftopClutter: water towers on 75% of walk-ups
  // (was 55%) with conical caps, stair/elevator penthouses on roofs > 20 m, two vent stacks per roof (HD). Inside the
  // existing per-chunk clutter budgets. Dev ON; prod after the founder's look (docs/sf-data/).
  rooftopLife: true,
  // Varied roofscape from the air (Teleoperator aerial look gap). The baked building roofs all render in one flat
  // grey-tan, so from a high aerial the city reads as a uniform tan sheet of rooftops instead of the reference's
  // varied grey-brown roofscape. This hooks the baked 'buildings' material (compactMesh.ts) and, on UP-facing
  // faces only (roofs, not walls — gated on the world normal), breaks the roof tone per building into realistic
  // tar / gravel / occasional pale-membrane greys via positional noise. Render-side (no re-bake), colour stays
  // realistic (no rainbow roofs); walls/terrain/roads untouched. Dev ON; add to prepare.ts after the aerial A/B.
  roofToneVariety: true,
  // Per-building pastel paint on residential mid-rises (gtasf-5mvt, founder look gap item 2): atlas fronts of apt/mix
  // styles take their building's own tint (40%, more saturated pastels), as vic/edw already did. Dev ON; prod after
  // the founder's look (docs/sf-data/).
  buildingPaint: true,
  // Living map pitching (gtasf-y5vc, docs/engineering/living-map.md): spoken pitches to angel NPCs / VC rings, scored by
  // an OpenRouter judge ($10/day, fallback over cap), modest cheques via funding credits. OFF: server logic + tests
  // only (worker/src/pitch); enable once WorldDO wiring, rings and the client button land and pass a phone check.
  pitching: false,
  // Roaming angel NPCs (living map item 8): 8 fictional angels outside SF tech places, reshuffled every 20 min by a
  // pure function of time (shared/content/angels.ts), so all clients and the server agree with no protocol. Only
  // pitchable by voice, so it needs pitching too. OFF until pitching ships.
  angelNpcs: false,
  // Title fly-over (gtasf-1ky0): an 8 s muted aerial loop of our own Ferry Building (181 KB AV1) fades in behind the
  // loading card if the plain landing page is still loading after 2.5 s; the poster stays as the fallback. Dev ON;
  // prod after the founder's call on the first-load budget (docs/sf-data/flyover-ferry-frame.jpg).
  titleFlyover: true,
  // SF look 3 (gtasf-r9f6, founder-approved): on desktop HD (graphicsV2 + takram sky loaded), turn on the full takram
  // aerial perspective composer (low bloom, ACES) plus a Lightroom-style grade preset (exposure, contrast, warmth,
  // saturation; sky/grade.ts, tune with ?grade=). Phones/Low keep the current sky and post. Dev ON; prod after the
  // founder's HD look at noon / sunset / night (docs/sf-data/).
  atmosphereSky: true,
  // Filmic finish (gtasf teleoperator look gap vs docs/sf-data/teleoperator-reference.png). The SA/SF post grade
  // is sophisticated but reads a touch digital/even; the reference has a cohesive cinematic tone. This adds a
  // subtle final step in the post composite (post.ts) — a gentle highlight shoulder + a hair of warmth on the
  // upper mids — on top of the existing split-tone/shoulder/exposure grade, NOT the timeGrade stops and NOT bloom.
  // No extra pass or LUT texture (~6 ALU in the composite fragment). Only acts where the SA grade is active (the
  // graded atmosphere path). GATED HD-ONLY (tier !== 'low'): as a full-screen composite pass it nudged phone-Low
  // ferry/soma below the 60 fps floor, so Low is byte-identical per the founder's "if perf fails, keep it HD-only"
  // rule. Flag-off and Low are byte-identical. Founder-approved (A/B docs/sf-data/filmic-grade/); in prepare.ts's
  // reviewed set.
  filmicGrade: true,
  // LiDAR roofs prototype (gtasf-6w9a): two test blocks (FiDi, Haight) rebuilt from USGS 3DEP heights + roof shapes
  // (flat / flat-parapet / gable / stepped, web/public/art/lidar/roofs-proto.json, 20 KB); baked buildings there are
  // discarded in the building shader. Feasibility prototype only: dev ON, never prod until a citywide bake exists.
  lidarRoofs: true,
  // Living map phase 1 (gtasf-stc2, docs/engineering/living-map.md). eventPinsV2: one pin per live / next-2h event
  // with its kind icon instead of numbered venue circles; '+N today' badge; titles from zoom 3. minimapClues: type
  // icons + a nearest-live ticker under the minimap. robotaxiJump: hailing a robotaxi is a 1-2 s cinematic jump to
  // the road-snapped destination (fare unchanged). Dev ON; prod after a photo + phone look-check.
  eventPinsV2: true,
  minimapClues: true,
  robotaxiJump: true,
  // critic N19: the quick (event) robotaxi ride arrives with a 0.6 s fade up from black instead of an instant cut, and the
  // player faces the event they rode to (its marker in view). Client-only; the server still picks the drop point.
  eventRideArrival: true,
  // critic N19c: the quick (event) robotaxi ride shows ~2.5 s of a client-only robotaxi driving the player along the nearest
  // road toward the event (camera on the car) instead of the lift-and-blur, then eventRideArrival's black cut + fade. The
  // server relocation and fare are unchanged. Needs robotaxiJump. Client-only.
  eventRideDrive: true,
  // critic N13i-a: hide the loading card after the first animation-loop frame is drawn (not at world-ready), so the first-frame
  // compile runs behind the card and the first visible game frame accepts input. Card stays up ~1-2 s longer on a 4x phone;
  // time-to-playable unchanged. 15 s fallback hide. Client-only.
  cardOnFirstTick: true,
  // Living map phase 2 display (gtasf-stc2): real SF places (web/public/data/places.json, built by tools/places for
  // gtasf-jcxw) as the map/minimap base layer - kind icons, names from zoom 3, glow when hosting a live event. Dev ON.
  placesLayer: true,
  // Place stamps (living map item 7): entering a real place's ring stamps it, stored per device in D1
  // (migration 0041_place_stamps; /api/places/stamps). Cosmetic, no money. Needs the prod D1 migration before enable.
  placeStamps: true,
  // In-world place signs (living map item 6): logo + name signs at the nearest real places (12 HD / 5 Low, 150 m).
  placeSigns: true,
  // Google Photorealistic 3D Tiles spike: also requires graphicsV2 and VITE_GOOGLE_MAPS_KEY.
  // Enable only in a preview build; exclude from production reviewed flags.
  googleTiles: false,
  // Realistic procedural facades (founder 2026-10-04 BUILDINGS direction, gtasf-2rup): under
  // realisticRender, inject a MeshStandard PBR facade shader on source building walls — a
  // manifest-driven albedo/normal/ARM atlas (CC0 now, Scenario texture modules next) applied
  // procedurally per district + building type, with real window frames, a ground-floor storefront
  // band and glass curtain-wall roughness/metalness for IBL reflections. Low preset: albedo-only.
  // Only takes effect when realisticRender is also on; the ps2 facade path is unaffected.
  realisticFacades: true,
  // Mounted input + transparent browser harness; scenarios/capture require explicit URL parameters.
  unifiedInput: true, testingHarness: true,
  // Explicit offline directing; production keeps this off until its capture review.
  cinematicCapture: true, loadingArt: true,
  // Configured concurrent capacity, FIFO queue, invite landing and input-idle release.
  worldCapacity: true, waitlist: true,
  // Freeze local matrices of static streamed-chunk subtrees (gtasf-pooa, Ferry Low CPU budget).
  staticMatrixFreeze: true,
  mapStreaming: true, terrain: true, landmarks: true, weather: true, sun: true,
  saAtmosphere: true,
  // fogBank (GTA-pivot lane A #5, Karl the Fog): a low drifting fog bank driven by the LIVE weather feed
  // (weatherGrade.state.fog). web/src/render/weather/fogBank.ts, mounted in createRenderFoundation and
  // updated per-frame. Density 0 (clear SF weather) => hidden + skipped, so it is byte-identical off and
  // when the feed says clear. ?fog=<0..1> overrides density for demo/capture. Dev-on: desktop + phone-Low
  // A/B (docs/sf-data/fog) and the 45s ferry phone gate pass (51fps mean / p95 24ms with fog active). Add
  // to prepare.ts's reviewed set to ship to prod.
  fogBank: true,
  // rainRender (GTA-pivot lane A #5, rain): camera-facing streak sheets driven by the LIVE weather feed's
  // new rain field (weatherGrade.state.rain). web/src/render/weather/rain.ts, mounted in createRenderFoundation.
  // Density 0 (dry) => hidden + skipped, byte-identical off and in dry weather. ?rain=<0..1> overrides for
  // demo/capture. Dev-on: desktop + phone-Low A/B (docs/sf-data/rain) and the 45s ferry phone gate pass
  // (41.5fps mean / p95 32ms with rain active). Add to prepare.ts's reviewed set to ship to prod.
  rainRender: true,
  // wetRoads (GTA-pivot lane A #5, wet-road sheen): when the live feed's rain > 0, the urbanSurfaces ground
  // shader darkens the asphalt and adds a grazing-angle sky-coloured sheen (fake reflection — no env/IBL on
  // the ps2 path), driven by uWet/uSkyColour (scalar + vec3, NO new samplers, so the road's 16-texture budget
  // is untouched). OFF when uWet=0 (dry) => byte-identical. ?rain=<0..1> drives it for demo/capture. Dev-on:
  // desktop + phone-Low A/B (docs/sf-data/wetroads) + 45s ferry phone gate pass (52fps mean / p95 24ms active).
  // Add to prepare.ts's reviewed set to ship to prod.
  wetRoads: true,
  // weatherNight (GTA-pivot lane A #5): heavy overcast / fog / rain brings the night lighting on earlier and
  // during the day (lit windows, shopfront signs, street lights) — the GTA storm look — by biasing the `night`
  // factor (foundation.ts) with weatherGrade.state cloud/fog/rain. Needs nightLighting. Clear weather => bias 0
  // => byte-identical. Dev-on: overcast-day A/B (docs/sf-data/weathernight) shows lit shopfronts under a noon
  // storm. Add to prepare.ts's reviewed set to ship to prod.
  weatherNight: true,
  // stormHaze (GTA-pivot lane A #5, orchestrator: "fix the fog washout"): under rain (and dense fog, half weight)
  // the overcast grade pulled sky/haze/sun/ambient to a PALE #b9c6d0 and the daylight sfLook beige brightened the
  // haze further, so a storm day washed the street canyon out to near-white (and the fog bank, which takes the
  // haze colour, with it). Pulls horizon/zenith/ambient + distance haze to a storm slate and damps the warm haze
  // pull, so a storm reads dark grey and weatherNight's lit windows read against it (web/src/render/foundation.ts).
  // Dry + fog-free => storm 0 => unchanged. Ship WITH weatherNight. A/B docs/sf-data/weathernight.
  stormHaze: true,
  // wetLampStreaks (GTA-pivot lane A #5, wet night): rain-wet roads at night mirror the street lamps and headlights as
  // long warm/white streaks stretched toward the camera (the GTA wet-night read). Reuses the existing night lamp
  // projection (lampLightMap.ts): a few view-dependent mirror taps of that texture on upward ground, Fresnel-weighted,
  // soft-kneed (no clip on Low's untonemapped path), added as emission. No new textures/draws. Driven by wetRoads' wet
  // signal (web/src/render/weather/wetness.ts) x lamp night (weatherNight also lights lamps in daytime rain), so dry => skipped. Needs
  // wetRoads + nightLighting + graphicsV2. ?rain=<0..1>&time=night for demo/capture. Dev-on; NOT in prepare.ts yet.
  wetLampStreaks: true,
  // rainNightDark (gtasf-d4uy1): the rain-overcast grade (web/src/render/foundation.ts) lerped night's navy sky,
  // ambient and tint to the pale daylight-overcast grey #b9c6d0 (+22% ambient), so a rainy NIGHT read as grey
  // daylight. Scales that overcast grade and stormHaze's mid-grey slate colour pulls by (1 - 0.85 * night); wet
  // roads, wetLampStreaks, shadows, lights-on bias and fog bank keep full wetness. Day/dry unchanged.
  // A/B docs/sf-data/rainnightdark. Dev-on; NOT in prepare.ts (enable after a founder look).
  rainNightDark: true,
  // Make coarse (citywide) districts' buildings solid by indexing their already-streamed render meshes
  // for collision — zero payload (the coarse bake ships no building collision JSON for the 80 MB budget;
  // gtasf-o0cb). Without this you drive straight through FiDi/SoMa blocks outside the detail corridor.
  // [gtasf-ntcl] Enable after a pane-6 in-browser check (no stuck cars on a fast citywide drive) and
  // a phone-Low perf pass, since it adds triangle collision tests across the mounted coarse chunks.
  // On for dev/preview (gtasf-2j18, real-data check OK); NOT in the prod reviewed allowlist until pane-6 drive + phone-Low perf pass.
  // Graphics V2 HD silhouettes: parapets, rooftop AC/water tanks, brick fire escapes (web/src/render/rooftopClutter.ts).
  // Also requires graphicsV2; skipped on Low. [gtasf-qc8o]
  rooftopClutter: true,
  // Cheap Low/phone variant of rooftopClutter (street parapets >=4 m, 1 AC unit, no rails, no shadows, detail LOD 200 m). [gtasf-qc8o]
  rooftopClutterLow: true, // phone harness (local dev, Mission): 24.86 -> 25.02 ms mean, p95 33.5 -> 32.3; prod needs allowlist
  coarseBuildingCollision: true,
  // Clock-driven blue night, emissive windows/signs and bounded road light cards.
  nightLighting: true,
  // Graphics v2 phase 2 item 7: instanced GPU pigeon flocks over the view (tokyo MIT port, web/src/render/gpuBirds.ts).
  // Also requires graphicsV2. Fewer birds on Low.
  gpuBirds: true,
  // Authored facade material on source building meshes; preserves map geometry and collision.
  buildingFacades: true,
  // Procedural facade shader (gtasf-l857): the ps2 addBuildingFacades whole-wall path generates brick /
  // stucco / glass, window grids, trim and colour from per-building attributes (land use from source wall
  // colour, a stable variant hash, district, street height) instead of sampling the facadeAtlas images, so
  // no atlas image is fetched. Keeps the per-chunk ground DataTexture + the night-window emission. Replaces
  // only the facadeAtlas whole-wall path; the frontFacadeMapping street-front cells are untouched in v1.
  // OFF: reachable + compiles + renders, but the look A/B, the bytes-saved cold-load trace and phone fps
  // are a founder visual sign-off before it ships (see web/src/render/FACADES.md).
  proceduralFacades: false,
  // Facade relief v2 (gtasf-l857, founder 2026-10-09 "layer on the atlas, don't replace it"): keeps the
  // reviewed facadeAtlas sample and LAYERS depth + variety on top of it in the ps2 textured path
  // (facades.ts) — per-floor lintel shadow + lit sill ledge, set-back (recessed) glazing, and a stronger
  // stable per-building hue/value shift so a block of identical boxes reads as distinct buildings. Albedo
  // only: no new texture, pass or fetch; cheap ALU, works HD + phone. Byte-identical when off (the GLSL is
  // only emitted when on). OFF until the founder look sign-off (A/B in docs/sf-data). Unrelated to the
  // proceduralFacades REPLACE path above, which stays off.
  facadeReliefV2: false,
  // Far-LOD skyline variety (gtasf-l857 task 2, founder 2026-10-09): the distant/mid towers currently fade
  // to one grey/lavender atlas-average tone (the NAIP aerial that would give real roof/facade colour is not
  // baked under the 80-87 MB budget), so a block of towers reads as identical boxes. This varies the FAR
  // tower colour + brightness per building from a stable hash (SF skyline tones: stone, tan, blue-grey,
  // bronze, slate, sage), only as walls fade to the far tone — near facades are untouched. Runtime shader
  // only: no aerial, no re-bake, no payload. Byte-identical when off. OFF until the founder look sign-off.
  farLodVariety: false,
  // Protruding SF bay windows on PHONE (gtasf-16e2): the frontFacadeMapping street fronts already extrude the
  // signature SF projecting bays (cell.bays, ~0.6 m deep, merged into the per-chunk 'Facade bays' LOD) on desktop,
  // but skip them on Low/phone (`if (options.low || bayCount>=128) continue`), so Victorian/Edwardian street
  // facades read FLAT on phone across the whole city — worst in the bay-dense neighbourhoods outside the detail
  // corridor (Haight-Ashbury, Western Addition/Painted Ladies, Hayes Valley, Castro, Mission, Noe). This enables
  // those SAME merged bays on phone for vic/edw styles (by facade STYLE, citywide — not by district), under a
  // tighter per-chunk bay cap and a shorter bay-LOD fade so the phone budget holds. Reuses the desktop-proven bay
  // geometry (no new path, few extra draws — the bays merge into one chunk batch). NOTE: homeFrontage/HOME_DISTRICTS
  // is NOT the phone-bay mechanism — frontFacadeMapping maps these street buildings and sets gtasfMappedFacadeIds,
  // which suppresses homeFrontage, so a HOME_DISTRICTS extension nets zero frontages (verified). Byte-identical when
  // off (the low bays are only emitted when on). HELD OFF — not clearly visible on phone: the prominent Victorians
  // in the dense neighbourhoods (Haight, Western Addition, Alamo Square) are LiDAR buildings with real captured bays,
  // which this atlas-facade path cannot touch (a 3 m depth diagnostic left the visible buildings unchanged). It only
  // adds bays to the less-prominent atlas vic/edw fronts, so the phone A/B read identical even at an oblique 15-50 m
  // row pose (docs/sf-data/phone-bays/obl-*). Code kept flag-off (byte-identical; perf was clean) in case atlas
  // coverage grows. [gtasf-16e2]
  phoneFacadeBays: false,
  // Peak-SA building detail (PLAN-v2.1 decision 4): instanced rooftop clutter (AC units, SF water
  // tanks, antennas, stair housings) + procedural cornices on the baked stock. Additive geometry only
  // (pane 9 owns colour/atlas). Production enablement needs pane-6 phone-perf proof (mean>=60fps) in
  // prepare.ts's reviewed allowlist; on locally for the look review.
  buildingDetail: true,
  // Source-ground scenery reviewed on desktop and low-tier phone with production bloom.
  streetProps: true,
  // graphicsV2 street life (gtasf-7moo): cosmetic, non-networked parked cars along kerbs citywide, pooled
  // nearest-N (HD heavier, Low light). Local-on; production needs the look check and phone perf.
  kerbParkedCars: true,
  // Loose-arcade (gtasf-arcade-props-knockover-30v0): the driver's car topples nearby small props
  // (hydrant/newspaper/sign/meter); they lie flat, then rise. Local-on after real keyboard/touch
  // contact/reset + desktop animation review (render/props/KNOCKOVER.md). Deployment stays separate.
  propKnockover: true,
  // Parked realistic street props (gtasf-parked-vehicle-props-5fx4): food trucks + rental e-scooters
  // dressed around SF landmarks under realisticRender (web/src/render/props/parkedVehicles.ts). OFF
  // until pane 1 wires createParkedVehicles into main.ts (mount root + update + dispose, like
  // createStreetProps) and pane 6 tunes placement heights/positions and verifies the look. The Meshy
  // extras self-gate on realisticRender + driving, so this is a no-op on the ps2 renderer.
  parkedProps: false,
  // pbrCarsV2 (GTA-pivot lane A #1): render the paid Meshy PBR fleet (web/src/assets/realisticVehicles.ts,
  // web/public/assets/vehicles-pbr/) on the LIVE graphicsV2 path instead of only the dead !graphicsV2 realistic
  // path. HD loads the full .glb (near) + .low.glb (far); Low uses the .low.glb (~5k tris) as the model. Replaces
  // the CC0 kit + Lambert polish for fleet/traffic/robotaxi/cable-car/bus when on. Flag-off is byte-identical (the
  // CC0 path). Dev-on for the look A/B (desktop + phone Low); watch the Low material read (no PBR env on the ps2
  // path) and the phone-fps gate (>=30 mean / p95<=50). [gtasf-gta-pivot]
  pbrCarsV2: true,
  // Meshy ground-floor storefronts (gtasf-realistic-facade-meshy-pieces-xyrw): instance the Meshy
  // storefront hero piece onto each qualifying building's street wall (merged per chunk, like
  // shopfrontSigns), under realisticFacades. web/src/render/props/facadeStorefronts.ts, wired in
  // foundation.ts. OFF until pane 6 tunes the piece's facing/depth/scale and verifies the look +
  // phone perf. buildingDetail has no ground-floor facade, so this does not double-place.
  storefrontPieces: true,
  parodyBillboards: true,
  groundTextures: true,
  // Generated SF pavement/plaza/lot atlas; HD only, independent of realisticRender. Needs /art/urban-surfaces.webp.
  hdUrbanSurfaces: true,
  // Founder dropped Lombard flower beds from the playtest. Keep OFF unless explicitly re-approved.
  lombardFlowers: false,
  roadDetails: true,
  // Realistic street detail (teleop look, gtasf-street-detail-paint-ss3d / gtasf-street-furniture-realistic-bkc0):
  // stop lines, red/yellow/white kerb paint, manholes and taller kerb faces on sourced roads; mailboxes, bike
  // racks, cobra-head street lamps and denser trees in streetProps. Dev-on for the look review; keep it out of
  // the production allowlist (prepare.ts) until pane 6's desktop + phone-low look/fps check passes.
  streetDetail: true,
  // chunkWorldFreeze (perf, phone-Low props-present gate): streamed chunk subtrees (buildings/roads/ground) are
  // static after placement (LOD only toggles visibility). On main they still get walked + world-recomposed every
  // frame in updateMatrixWorld — the top self-time in the phone-Low steady frame (updateMatrixWorld 6% >>
  // multiplyMatrices 2.2%; prior staticPropMatrices froze the compose, NOT the traversal). This composes each
  // chunk subtree once then no-ops its root updateMatrixWorld, pruning the whole static subtree from the per-frame
  // scene cascade. Chunk-roots only (pure geometry; no movers). Flag-off is byte-identical. Dev-measured before
  // re-gating lowStreetFurniture. [gtasf street-prop Low perf pass]
  chunkWorldFreeze: false,
  // walkerRouteCache (perf, phone-Low props-present): streetWalkers.refill rebuilds sidewalk routes every 0.25s
  // and routeFor re-samples STATIC terrain heavily (~10 sideways offsets x ~20 heightAt/safe samples per span) to
  // find each route — the dominant heightAt caller (87% of heightAt self-time in the ferry props-present profile).
  // A span+side's route is deterministic from the static heightfield, so cache the found Route and reuse it on
  // later refills instead of re-sampling. Look-safe (terrain never changes; cache cleared past a size cap and on
  // dispose). Flag-off is byte-identical. [gtasf street-prop Low perf pass]
  walkerRouteCache: true,
  // Low-path street furniture (gtasf teleoperator look; founder: visible street-level payoff on phone Low along
  // the Ferry->Market spawn walk). The commercial-frontage furniture (benches, newsracks, bins, planters,
  // parking meters + new bollards between the poles) is HD-ONLY today (layout polish = graphicsV2 && !low && hd),
  // so phone Low reads as empty sidewalks. This runs the same instanced furniture on Low for commercial frontages
  // (The Embarcadero + the 'route'-density commercial streets the spawn walk follows into Market), bounded by the
  // existing per-kind Low instance cap. Requires graphicsV2. Flag-off is byte-identical (the Low placements are
  // gated on it). Dev ON; NOT in prepare.ts's reviewed set. NOTE: street props (all of them) mount ~25-30s AFTER
  // READY on the whole-city graph, so the headless look-capture + the ordinary phone-perf scenarios both fire
  // BEFORE props exist and cannot show/measure this (see memory street-props-mount-after-ready). Verify LIVE by
  // walking the Embarcadero/Market/FiDi sidewalks; perf-gate with a gtasf-hale-style props-present run.
  lowStreetFurniture: true,
  // Critic N23 residual (lane D): wet roads mirrored only lamps; lit shopfronts gave no light. With this ON commercial
  // frontages (route-density non-residential streets + the Embarcadero) carry light-only 'shopGlow' sites 4 m back from the
  // kerb, drawn by the night lamp map as dimmer oblong warm/cool pools that light the sidewalk and, with wetLampStreaks,
  // streak in wet asphalt. No mesh, no collision; costs only lamp-map quads at night. Off = byte-identical layout.
  // Dev OFF until verified in-game (10-18 night captures were void: machine load kept street props from mounting).
  shopfrontGlow: false,
  // GTA-style drive-through checkpoint pillars (gtasf-c0kh/gtasf-pmf5, PLAN-v2 decision 1 feel): a
  // translucent additive light column rising from each event marker ring so events read as
  // checkpoints from the street. WIRED inline in web/src/events/markers.ts (additive open cylinder on
  // the max-12 nearby markers, hidden on collected; override via createEventMarkers({checkpointPillars})).
  // Local-on with desktop/phone marker smoke (events/MARKERS.md); production/perf gates remain separate.
  checkpointPillars: true,
  radar: true, hud: true, driving: true, robotaxi: true, mobile: true,
  // Ferry starter + nine kerbside bays, replenished by WorldDO. Review for production allowlist.
  ferryParkedCars: true,
  // A VC's parody supercar parked in Pacific Heights near Jackson & Fillmore (worker district parking, needs
  // graphicsV2 + the whole-city road graph). Enterable/drivable like other parked cars. [gtasf-txt]
  vcSupercar: true,
  // Quick travel, fare debit and destination preload. Local dev on; requires migration 0030;
  // production requires the quick-robotaxi playtest check. Zoned handoff is not supported.
  quickRobotaxi: true,
  // Dev-only moving traffic takeover / route passengers. Production requires boarding, same-deck
  // exits and multiplayer review; keep out of the production allowlist. Zoned handoff unsupported.
  rideAnyVehicle: true,
  // Active phone pinch zoom (spread = closer, converge = farther; same 2.5-12 m clamp as the wheel).
  // On for dev/preview after an emulated two-finger check (gtasf-rmsv); NOT in the prod allowlist until a
  // physical phone pass. [gtasf-85ol]
  touchCameraZoom: true,
  // Mad-Max robotaxi (PLAN-v2.1, gtasf-jl6b): instant curb pickup (no 150m approach), reckless fast
  // ride, and passengers earn no drive-through funding while riding (resumes on exit). Server-side
  // lane follower never collides. Off reverts to the v2 approach/board/credit behaviour. Default OFF
  // until the ride feel + client weave/drift/air visuals are verified in-browser (pane 6), then flip on.
  madMaxRobotaxi: false,
  // Local character/material polish and short-grip arcade handling (gtasf-xsfw).
  characterPolish: true, vehiclePolish: true, arcadeHandling: true,
  // Visual-only hill air on steep crests (Lombard/Russian Hill). Physics stays ground-locked, so no
  // regression risk; OFF until pane 6 reviews the look in-browser and enables it (gtasf-arcade-hill-air-5bsi).
  hillJumps: false,
  // Stage-unlocked personal rides (scooter/skateboard/e-bike/onewheel/segway, ~2x sprint) pulled out
  // anywhere (PLAN-v2.1). All five desktop/phone tiers, mounted poses and remote visibility passed
  // native review; evidence in movement/PERSONAL-RIDES.md (gtasf-v21-personal-rides-5yfa).
  personalRides: true,
  // Playful Mayhem (founder feature): non-lethal logo paintball + confetti + water balloons. OFF until
  // render (decals/particles), sync and moderation land and pane 6 verifies (gtasf-playful-mayhem).
  playfulMayhem: false,
  // Organiser links gtasf.com/e/<event-id> (docs/gtm/organiser-outreach.md part 1): spawn facing the venue with its
  // ring selected, "<Event> is on the map" card, one-tap Share on X via X's compose intent (organiser posts; we never
  // post), UTMs utm_source=organiser&utm_campaign=event_on_map&utm_content=<id>. Unknown ids -> normal spawn. [gtasf-w0s8]
  organiserLinks: true,
  // Steep unbuilt urban ground (Corona Heights, Twin Peaks flanks) shades as dry grass/scrub instead of grey
  // lots (urbanSurfaces.ts). OFF until a desktop+phone look at the Castro tour spot (37.7609,-122.4350). [gtasf-917l]
  hillsideScrub: false,
  // Night lit windows on brick/mixed generated fronts (gtasf-jtkf). OFF: their half-res window mask also covers wall,
  // so lit 3x3.6 m cells rendered as flat orange blotches across whole walls (SoMa, Hayes, Castro; overnight
  // Oct 7 tour, docs/graphics-ship-list.md). Towers keep lit windows. Enable once the brick masks are crisp.
  brickNightWindows: false,
  // Embarcadero bay-side promenade dressing (planters/benches/palms/tree wells) on HD graphicsV2 props.
  // Cosmetic; needs one HD look at the Ferry spawn before trusting it. [gtasf-67vc]
  embarcaderoPromenade: true,
  // Mission Street sidewalk dressing (tree wells, benches, planters, bins) on HD graphicsV2 props. Cosmetic;
  // needs one HD look at the Mission tour spot (37.7599,-122.4148). [gtasf-i2hd]
  missionStreetDressing: true,
  // Local candidate: reviewed rigs and main integration; final mounted proof in gtasf-2hm.1.
  pedestrians: true,
  // Local candidate: mounted directions/collision/desktop/phone acceptance in gtasf-1blk.
  coffeeQueues: true,
  // Enable after integrated SF-weekend, directions and desktop/phone picnic proof (gtasf-gdzt).
  doloresWeekend: false,
  // Native audio lifecycle and loop wiring ready; local mounted-game proof tracked in gtasf-shr.1.
  vehicleAudio: true,
  // Procedural street SFX (gtasf-bigk): on-foot footsteps + a low city ambience bed synthesised with Web
  // Audio (web/src/audio/sfx.ts), joining the existing procedural crunch (crunch.ts), paint splat
  // (splat.ts) and engines (vehicles.ts). Zero audio downloads. Dev ON; add to the prod allowlist after a
  // founder in-game audio listen.
  proceduralSfx: true,
  // Empty recovery command; WorldDO chooses and validates the road destination.
  roadRespawn: true,
  fullMap: true, waypoints: true,
  // Native walk accepted over loaded authored plazas (gtasf-bo9q; web/src/radar/WALKING.md).
  walkingRoutes: true,
  // Experimental paired map codec (gtasf-zzpr). Enable only after source parity, full city budgets and cold READY proof.
  compactMapAssets: false,
  // SA pause-menu map restyle (PLAN-v2 decision 7): parchment texture, district labels,
  // wheel/pinch/button zoom with drag pan, and click-anywhere road-snapped waypoints.
  // Waypoint placement still requires the `waypoints` flag; the venue browser works regardless.
  saMapStyle: true,
  eventsView: true, eventNavigation: true,
  // routeRibbonPaint (gtasf look gap, SoMa street walk): the GPS route guidance ribbon (navigation/guidance.ts) is a
  // 1.8 m unlit yellow MeshBasicMaterial raised along the active route. Its near segment, right under the player,
  // perspective-stretches into a big flat neon-yellow slab across the sidewalk/crossing — worst on Low, which has no
  // tonemap so 0xffd45f renders at full neon. This (a) fades the ribbon's alpha to zero within ~4-13 m of the camera
  // so it reads as a painted path leading AHEAD, not a slab underfoot, and (b) drops its base opacity (more on Low)
  // and warms it slightly toward road paint. Ribbon material only; a few fragment ALU ops, no geometry/draws. Flag-
  // off byte-identical. Add to prepare.ts after the A/B.
  routeRibbonPaint: true,
  // chinatownDragonGate (gtasf look gap, Chinatown street walk): Chinatown reads as a generic street — no identity.
  // This adds the Dragon Gate (the paifang at Grant Ave & Bush) as a landmark: a three-bay gate with green glazed
  // upturned-eave roofs, red pillars, gold accents, guardian lions and hanging red lanterns (the Grant Ave lantern
  // look, built into the gate). Placed via the landmarks system (geodeticToWorld, the verified frame). One merged
  // vertex-coloured mesh like the other landmarks; honours flags.landmarks. Flag-off byte-identical. Add to
  // prepare.ts after the A/B + perf.
  chinatownDragonGate: true,
  // castroRainbowCrosswalk (gtasf look gap, Castro street walk): the Castro's famous rainbow crosswalks are missing.
  // The map renders Castro & 18th — a normal road intersection — as pale civic concrete (a surface misclassification;
  // Harvey Milk Plaza is at Castro & MARKET, not here), and there are no road-detail crossings there to paint. This
  // lays a scoped flat decal at the intersection (via the landmarks system, createCastroCrossing): a dark asphalt
  // cross over the two carriageways so the intersection READS AS ROAD, with the four pride-flag crosswalks painted on
  // it. Vertex-coloured merged mesh like the other landmarks; scoped to that one spot. Flag-off byte-identical. Add
  // to prepare.ts after the A/B + perf.
  castroRainbowCrosswalk: true,
  // harveyMilkFlag (gtasf look gap, Castro): the Castro's signature marker -- the giant rainbow flag on its tall
  // flagpole at Harvey Milk Plaza (Castro & Market, above the Muni station) -- was missing entirely. This adds it
  // as a scoped landmark (createHarveyMilkFlag via the landmarks system): a ~20 m flagpole with a gold finial
  // flying the six-stripe pride flag, the flag carrying a frozen billowing wave and drawn both-sided. One merged
  // vertex-coloured static mesh like the other landmarks -- no textures, no per-frame cost; HD + Low. Flag-off
  // byte-identical. Add to prepare.ts after the A/B + perf.
  harveyMilkFlag: true,
  // castroTheatre (gtasf look gap, Castro district): the Castro Theatre (429 Castro St, 1922 movie palace) is THE
  // visual anchor of the Castro, with its giant vertical "CASTRO" neon blade sign and illuminated marquee -- and the
  // block renders as generic rowhouses with none of it. Adds a scoped landmark (createCastroTheatre via the
  // landmarks system): a Spanish-colonial movie-palace facade with a projecting marquee, and the signature vertical
  // CASTRO blade rising above the roofline. Facade/marquee structure are the usual lit vertex-coloured mesh; the
  // blade letters, blade frame and marquee chase-lights are a SECOND mesh rendered UNLIT (MeshBasicMaterial,
  // toneMapped off), like the Harvey Milk flag / Castro crossing, so the neon reads bright on BOTH HD and Low
  // instead of dimming to muddy red. Two merged static meshes, no textures, no per-frame cost. Flag-off
  // byte-identical. Add to prepare.ts after the A/B + perf.
  castroTheatre: true,
  // fishermansWharfSign (gtasf look gap, Fisherman's Wharf): the round "FISHERMAN'S WHARF" gateway sign at Taylor &
  // Jefferson -- with its red crab on a yellow ship's-wheel -- is the single most recognisable marker that you have
  // arrived at the Wharf, and it was missing (generic street). Adds it as a scoped landmark (createFishermansWharfSign
  // via the landmarks system): two teal posts carrying a round board with the crab/wheel roundel and "FISHERMANS
  // WHARF" / "SAN FRANCISCO" lettering. Posts/back are the usual lit vertex-coloured mesh; the bright painted sign
  // FACE is a SECOND mesh rendered UNLIT (MeshBasicMaterial, toneMapped off) like the Castro crossing, so it reads
  // bright on BOTH HD and Low. Two merged static meshes, no textures, no per-frame cost. Flag-off byte-identical.
  // Add to prepare.ts after the A/B + perf.
  fishermansWharfSign: true,
  // ghirardelliSign (gtasf look gap, Ghirardelli Square): the giant illuminated GHIRARDELLI letters along the roof of
  // the old chocolate-factory building -- one of the most photographed signs in the city -- were missing. Adds a
  // scoped landmark (createGhirardelliSign via the landmarks system): a dark rooftop support frame carrying the big
  // cream letters, sized to ride the building's roofline. The frame is the usual lit vertex-coloured mesh; the
  // letters are a SECOND mesh rendered UNLIT (MeshBasicMaterial, toneMapped off) like the Castro crossing, so they
  // read as bright sign letters on BOTH HD and Low. Two merged static meshes, no textures, no per-frame cost.
  // Flag-off byte-identical. Add to prepare.ts after the A/B + perf.
  ghirardelliSign: true,
  // peacePagoda (gtasf look gap, Japantown): Japantown had no landmark at all. Adds the Peace Pagoda (createPeacePagoda
  // via the landmarks system) -- the ~30 m pale-concrete five-tier stupa in the Peace Plaza (a 1968 gift from Osaka),
  // broad umbrella roofs stacked on a tapering core, topped by a gold sorin finial -- so the Peace Plaza reads as
  // Japantown. One merged vertex-coloured static mesh like the dragon gate (concrete reads fine lit, no unlit pass).
  // No textures, no per-frame cost; HD + Low. Flag-off byte-identical. Add to prepare.ts after the A/B + perf.
  peacePagoda: true,
  // cablecarTurntable (gtasf look gap, Powell & Market): the wooden turntable at Hallidie Plaza where the single-ended
  // Powell cable cars are pushed around by hand -- one of the city's most-photographed spots -- was missing. Adds it
  // as a scoped landmark (createCablecarTurntable via the landmarks system): a timber turntable disc in a dark pit
  // with running rails and a centre pivot, carrying a classic maroon-and-cream Powell cable car (open grip platform,
  // monitor roof). Body is the usual lit vertex-coloured mesh; the "POWELL" roof board + headlight are a SECOND mesh
  // rendered UNLIT (MeshBasicMaterial, toneMapped off) so they read on HD and Low. No textures, no per-frame cost.
  // Flag-off byte-identical. Add to prepare.ts after the A/B + perf.
  cablecarTurntable: true,
  // haightAshburySign (gtasf look gap, Haight-Ashbury): the famous crossed green HAIGHT / ASHBURY street-sign corner
  // -- the icon of the Haight -- was missing. Adds it as a scoped landmark (createHaightSign via the landmarks
  // system): a pole carrying two perpendicular green street blades with white street names (the HAIGHT blade faces
  // +Z, the ASHBURY blade crosses it facing +X). Pole/blades are the usual lit mesh; the white names are UNLIT
  // (toneMapped off) so they read on HD and Low. The lettering helper gained B/U/Y glyphs for ASHBURY. The blades ride
  // high (~6 m) so they clear the Haight's continuous shop awnings and read from the street (a tall corner sign-post),
  // which also makes them visible to players walking the block. No textures, no per-frame cost. Flag-off
  // byte-identical. Add to prepare.ts after the A/B + perf.
  haightAshburySign: true,
  // sutroAviationBands (gtasf look gap, citywide skyline): Sutro Tower's signature alternating aviation RED/WHITE
  // bands are the read that identifies it on the skyline, but the landmark used a muted brick-red that washes to a
  // pale slab at distance (and darkens on Low), so the banding does not read. With this ON, the bands use a brighter
  // saturated aviation red + a brighter white and the tower is rendered UNLIT (MeshBasicMaterial, toneMapped off) so
  // the red/white holds its colour at skyline distance and on the phone path. Applied inside createSutroTower, gated
  // by this flag; no textures, no per-frame cost. Flag-off byte-identical. Add to prepare.ts after the A/B + perf.
  sutroAviationBands: true,
  // coitFloodlight (gtasf look gap, Telegraph Hill, DAYTIME read): Coit Tower is a pale/floodlit fluted concrete
  // column, but the landmark rendered as a dull, dim tower that reads weakly from North Beach / aerial. With this ON,
  // the tower is rendered UNLIT (MeshBasicMaterial, toneMapped off) in bright warm floodlit cream so it reads as the
  // bright pale fluted column by day (noon + golden), on HD and Low, with the dark window/arcade recesses kept dark
  // for depth. (Night is unchanged -- both lit and unlit read dark-blue under the night post-grade, which no landmark
  // mesh can escape; a true night glow needs night-lighting shader work, not this.) Applied inside createCoitTower,
  // gated by this flag; no textures, no per-frame cost. Flag-off byte-identical. Add to prepare.ts after the A/B + perf.
  coitFloodlight: true,
  // transamericaCrown (gtasf look gap, FiDi skyline, DAYTIME read): the Transamerica Pyramid's signature aluminium
  // spire reads as a thin pale needle that blends into the quartz body and tapers to a near-point that vanishes at
  // skyline distance. With this ON, the spire (above y212) is rebuilt as a crisp UNLIT (MeshBasicMaterial, toneMapped
  // off) bright-aluminium needle that keeps its colour against the sky on HD and Low and at any time of day, capped
  // by a small beacon housing and a red aviation-beacon tip (the "crown") so the needle stays a readable solid at
  // distance instead of a sub-pixel vanishing point. (The true night-lit crown beacon is still blocked by the night
  // post-grade, which blues every mesh; this is the structural day read, not a night glow.) Applied inside
  // createTransamericaPyramid, gated by this flag; no textures, no per-frame cost. Flag-off byte-identical. Add to
  // prepare.ts after the A/B + perf.
  transamericaCrown: true,
  // goldenGateOrange (gtasf look gap, hero landmark): the Golden Gate Bridge's base colour (#c0362c) is a brick-RED, so
  // up close / on the span the most recognisable SF landmark reads as a fire-engine-red bridge rather than its famous
  // International ORANGE. With this ON, the orange structural members (tower legs/portals, deck rails, main cables +
  // hangers) use a brighter, truer International Orange (#e35c2a) and are split into their own mesh with distance FOG
  // DISABLED so the orange holds its colour across the near/mid span instead of washing toward the sky. Still lit
  // (Lambert, flatShading) so the Art Deco towers keep their form; the grey deck/piers/anchorages stay fogged. Honest
  // scope: this fixes the on/near-bridge read (a drivable deep-link destination) -- the far cross-city view stays pale
  // because at >1 km the thin members are sub-pixel and antialias into the bright sky, which colour can't overcome.
  // Applied inside createGoldenGateBridge, gated by this flag; one extra static mesh, no per-frame cost. Flag-off
  // byte-identical. Add to prepare.ts after the A/B + perf.
  goldenGateOrange: true,
  // ferryClockFaces (gtasf look gap, Embarcadero spawn hero): the Ferry Building clock tower is the player's arrival
  // view -- every spawn faces it -- but the four 22 ft dials use a cream LIT face that darkens on the tower into a dull
  // faint disc, so the signature clock barely reads from the plaza (and washes further on the Low/phone path). With
  // this ON, the dials (bezel ring, face, twelve markers, hands) are rebuilt into their own mesh rendered UNLIT
  // (MeshBasicMaterial, toneMapped off) with a brighter ivory-white face and crisp near-black markers/hands, so the
  // four clocks read as bright white faces from the arrival plaza on HD and Low, like the real Ferry Building. Only
  // the dials change; the tower stone/belfry stay lit. Applied inside createFerryBuilding, gated by this flag; no
  // textures, no per-frame cost. Flag-off byte-identical. Add to prepare.ts after the A/B + perf.
  ferryClockFaces: true,
  // ferryArcadeLit (Teleoperator street-detail push, lane A): the Ferry Building's ground-floor arcade + three
  // entrance arches were dark glass that read as pure BLACK voids under the grade — the biggest flat patch in the
  // spawn view. They move into their own UNLIT mesh (like ferryClockFaces) as warm, lit marketplace interiors (a
  // few shops dimmer), mullions kept in front. web/src/render/landmarks/towers.ts. One extra draw; HD + Low.
  // Also fixes the hd bay glass + mullions sitting INSIDE the wall box (the bays rendered as plain stone). Flag-off
  // builds exactly as before. A/B docs/sf-data/ferry-arcade; phone-Low ferry 58.8 fps / p95 19.8 ms. Dev-on.
  ferryArcadeLit: true,
  // ferryPlazaDressing (GTA/Teleoperator street-detail push, lane A): the spawn plaza was a flat empty tile field. Dress it
  // like a real civic plaza — Ferry Plaza farmers market stalls (white peaked tents + produce), raised planters with
  // shrubs/flowers, street trees in grated pits, slatted benches, Recology bins, a news kiosk and an Embarcadero-edge
  // bollard line — all merged into the Ferry landmark mesh (0 extra draws), with solid footprints. Spawn sight-line and
  // the plaza actors' spots stay clear. web/src/render/landmarks/towers.ts. Flag-off builds exactly as before.
  // A/B docs/sf-data/ferry-plaza; phone-Low ferry 58.8 fps / p95 20.5 ms. Dev-on.
  ferryPlazaDressing: true,
  // gtasf-hjjda (critic N19c, lane D): the routable Embarcadero lanes cross the dressed plaza deck at local z ~42-48, so the
  // outer farmers-market stall row and outer planters stood on the carriageway (traffic, GPS line and the event robotaxi
  // drove through the tents). With this ON they move hall-side (stalls z 31 + 22, planters z 30 + 22). Off = the live
  // ferryPlazaDressing layout. Dev ON; NOT in prepare.ts's reviewed set.
  ferryStallsOffRoad: true,
  // ferryPlazaSetts (GTA V gap critique #4, lane A): the arrival plaza still read as one flat beige deck (the
  // ferryPlazaPaving hairline pavers fade out by 28 m) and the clerestory arches read as black holes. Adds a coarser
  // course to the Ferry surface shader (urbanSurfaces.ts) that holds to ~90 m: 3 x 1.5 m staggered granite slabs with
  // soft AA joints (x0.86, never a dark net), per-slab tone, and 6 m / 17 m grime + wear that never fades; glazes the
  // upper arches (sky-grey glass + mullion cross, towers.ts). A few fragment ALU ops, no draws/textures; HD + Low.
  // (A first try, a separate canvas-textured deck mesh, read dark/purple brick: it missed the Ferry surface's polish.)
  // Off = byte-identical. A/B docs/sf-data/ferry-setts: passes; phone-Low ferry 53.6 fps / p95 33 ms. Dev-on; ready for prepare.ts.
  ferryPlazaSetts: true,
  // pier39Sign (gtasf look gap, Embarcadero waterfront): the Pier 39 overhead entrance marquee read as dim cream letters
  // on a dark teal panel that darkens and washes on the Low/phone path, so the signature "PIER 39" barely reads from the
  // approach. With this ON, the sign panel + name are rebuilt into their own mesh rendered UNLIT (MeshBasicMaterial,
  // toneMapped off) as bright red "PIER 39" on a cream panel (the real marquee), so it reads from the Embarcadero on HD
  // and Low. Only the sign face changes; the gantry posts stay lit. Applied inside createPier39, gated by this flag; no
  // textures, no per-frame cost. Flag-off byte-identical. Add to prepare.ts after the A/B + perf.
  pier39Sign: true,
  // embarcaderoStreetcar (gtasf look gap, Ferry Building / Embarcadero spawn): the default-spawn plaza reads as empty
  // flat paving with no San Francisco identity, yet the founder-ladder onboarding keeps a new player there for their
  // first minutes. Adds the iconic historic F-line (Market & Wharves) streetcar in the classic Muni green-and-cream
  // PCC livery -- trolley pole + an UNLIT "EMBARCADERO" roll sign and red "F" route badge (MeshBasic, toneMapped off,
  // reads bright noon/golden/night on HD + Low) -- parked at the Ferry Building terminus where the real F-line loops.
  // A static hero prop placed via the landmark system (createEmbarcaderoStreetcar), off the driving lane, solid to the
  // player. Excluded from the radar landmark list (a prop, not a destination). No textures, no per-frame cost.
  // Flag-off byte-identical (landmark skipped in createPlacedLandmarks + radar). Add to prepare.ts after the A/B + perf.
  embarcaderoStreetcar: true,
  // vaillancourtFountain (gtasf look gap, Ferry/Embarcadero spawn): the founder-ladder onboarding swings the camera
  // to the player's billboard on the Embarcadero, but the plaza behind it reads as a vast empty flat lot. Adds the
  // Vaillancourt Fountain -- the brutalist jumble of precast square concrete tubes over a pool that is the signature
  // landmark of Embarcadero (Justin Herman) Plaza at the foot of Market -- as the backdrop hero. Built via the
  // landmark system (createVaillancourtFountain); angled tubes are beam() square sections. Concrete is neutral grey
  // so it stays LIT (reads fine through the golden cast, unlike the streetcar's green). Solid to the player.
  // Excluded from the radar landmark list. No textures, no per-frame cost. Flag-off byte-identical (landmark skipped
  // in createPlacedLandmarks + radar). Add to prepare.ts after the A/B + perf.
  vaillancourtFountain: true,
  // spawnClearOfLandmarks (critic N18, gtasf-coloq): deep-link / spawn snapping also respects landmark solid
  // footprints (the fountain basin, Pier 39 obstacles), moving a blocked point to the nearest clear spot within ~20 m.
  // Client-only. Dev-on; for prepare.ts: ?at=37.7952,-122.3940,200 lands on the plaza, not in the pool.
  spawnClearOfLandmarks: true,
  // vcOfficeSigns (gtasf look gap, robotaxi arrival): the founder ladder sends players by robotaxi to real VC offices
  // (shared/content/pitchVcs.ts) to pitch, but those offices were visually unmarked generic buildings -- arrival was a
  // flat, nameless kerb. Plants a kerb-level monument sign at each firm (createVcOfficeSign, placed in
  // createPlacedLandmarks): a dark slab with a per-firm accent + the firm NAME rendered UNLIT on BOTH faces (MeshBasic,
  // toneMapped off) so it reads bright on HD + Low and from either robotaxi approach. No textures (vector lettering),
  // no per-frame cost; 14 static signs across the map (frustum-culled). Flag-off byte-identical (signs not added; not
  // in the radar landmark list). Add to prepare.ts after the A/B + perf.
  vcOfficeSigns: true,
  // cityLightsSign (gtasf look gap, North Beach): the City Lights Booksellers vertical blade sign at Columbus & Jack
  // Kerouac Alley -- the Beat-era landmark -- was missing. Adds it as a scoped landmark (createCityLightsSign via the
  // landmarks system): a dark green projecting blade on a bracket off the building corner carrying the tall vertical
  // "CITY LIGHTS" name. Blade/bracket are the usual lit mesh; the white name + red border are a SECOND mesh rendered
  // UNLIT (MeshBasicMaterial, toneMapped off) like the Castro crossing, so the sign reads bright on HD and Low. No
  // textures, no per-frame cost. Flag-off byte-identical. Add to prepare.ts after the A/B + perf.
  cityLightsSign: true,
  // vesuvioSign (gtasf look gap, North Beach): Vesuvio Cafe -- the Beat-era bar next to City Lights at Columbus &
  // Jack Kerouac Alley -- was missing. Adds its sign as a scoped landmark (createVesuvioSign via the landmarks
  // system): a warm red-maroon projecting blade on the building corner carrying the vertical "VESUVIO" name in amber
  // neon, opposite the City Lights blade to complete the Beat corner. Blade/bracket are the usual lit mesh; the amber
  // name + red border are a SECOND mesh rendered UNLIT (toneMapped off) so it reads bright on HD and Low (lettering
  // helper gained the V glyph). No textures, no per-frame cost. Flag-off byte-identical.
  // SHELVED 2026-10-12 (flag off): Vesuvio sits at the exact Columbus/Jack Kerouac corner the cityLightsSign blade
  // already anchors, and the dense North Beach block offers no clear sightline -- every camera angle is blocked by the
  // City Lights building, adjacent facades, awnings and a foreground pole (same open-wall problem as missionMural).
  // The builder + gate are preserved byte-identical for when a cleaner placement or the alley opens up; City Lights
  // already carries the Beat-corner identity in the shipped build. NOT in prepare.ts reviewed set.
  vesuvioSign: false,
  // missionMural (gtasf look gap, Mission alleys): the Mission's Clarion/Balmy alley walls are covered in bold vivid
  // community murals, but the alley rendered as plain walls. Adds a painted mural wall as a scoped landmark
  // (createMissionMural via the landmarks system): a stylised but unmistakably Mission composition (bold colour
  // fields, a radiant sun, a dove, papel-picado banners, geometric borders) in the vivid Mission palette, standing
  // against the alley wall. Rendered as one UNLIT mesh (MeshBasicMaterial, toneMapped off) -- a mural is flat paint,
  // so the colours read vivid on HD and Low. No textures, no per-frame cost. Flag-off byte-identical. SHELVED dev-OFF:
  // the mural builds/renders, but the dense Mission map does NOT have the narrow Clarion/Balmy alleys as open gaps
  // (buildings merge over them), so a mural placed "in" the alley lands inside a building (same as the Palace / Powell
  // & Market). A 9x11 mural needs ~15-20 m of open space in front to read, which only the streets provide. Turn on
  // once it is placed on a verified street-facing open wall (or the alley is opened in the map bake). NOT in prepare.ts.
  missionMural: false,
  // grantAveLanterns (gtasf look gap, Chinatown street walk): red paper lanterns strung on cables across Grant Ave
  // through Chinatown, the way the real street is dressed, so Chinatown reads like Chinatown rather than a generic
  // street. Built from the road graph (every "Grant" edge within the Chinatown Z/X bounds): a sagging cable span
  // per ~26 m with five hanging red-and-gold lanterns. One cheap vertex-coloured merged static mesh, no textures/
  // per-frame cost; HD + Low. Flag-off byte-identical. Add to prepare.ts after the A/B + perf.
  grantAveLanterns: true,
  // paintedLadiesColour (gtasf look gap, Alamo Square): the authored Painted Ladies landmark (createPaintedLadies,
  // 7 stepped Victorians at Steiner & Hayes) renders in one throwaway near-monochrome pale palette, so SF's most
  // iconic Victorian row reads as a uniform tan terrace from the postcard viewpoint. A curated per-house palette
  // (paintedLadyPalette.ts: sage/dusty-blue/ochre/terracotta-rose/mauve/olive/tan bodies, each with its own trim,
  // ordered so neighbours contrast, tuned for the SA grade) already exists but was never wired to these houses.
  // This ON wires paintedLadyScheme(i) into the builder: each house gets its distinct body + trim so the row reads
  // as the "Painted Ladies". Just vertex colours on the existing merged mesh -- no geometry, textures or per-frame
  // cost; HD + Low. Flag-off byte-identical (the current inline palette). Add to prepare.ts after the A/B + perf.
  paintedLadiesColour: true,
  // Venue grouping + next-24h focus (PLAN-v2 decision 8): one map blip per venue with a
  // +N-this-week badge and a venue browser; eventFocus24h limits blips to the next 24 hours
  // (with a weekend fallback to the soonest events so the pre-Tech-Week map is never blank).
  venueGrouping: true, eventFocus24h: true,
  // Readable names above world event markers (PLAN-v2 decisions 1 + 8). Local-on after native
  // desktop/phone text-fit and overlap review; production/phone-fps remain separate. Evidence in
  // web/src/events/MARKERS.md. [gtasf-v2-floating-names-gpi4]
  floatingEventNames: true,
  // Dim 3D world event markers for events the player has already collected (drive-through pays
  // once ever, PLAN-v2 decision 1), matching the radar's "collected goes dim" so a player does not
  // chase a ring that will pay nothing. Markers self-fetch /api/funding/collected; a venue marker
  // dims only when ALL its focus events are collected. Local-on after actual payout/reload smoke;
  // needs driveThroughFunding. Evidence in web/src/events/MARKERS.md. [gtasf-ykbb]
  dimCollectedMarkers: true,
  // Per-kind colour on the 3D world event markers so you can tell an investor ring from a party ring,
  // matching the radar legend (PLAN-v2.1 radar/map, gtasf-event-marker-kind-colors-66ct). Dev-on;
  // off reverts markers to the single gold ring. Preview venues keep the pale preview material.
  eventKindColors: true,
  traffic: true, cableCars: true, muni: true, chat: true,
  // Serve the canonical event database independently of the scheduled crawler.
  eventsApi: true, events: false, eventVisits: false, eventChat: true, fundedStars: false,
  // Public official feed refresh; paid enrichment remains off (gtasf-dgx9).
  eventsRefresh: true,
  // Paste-a-link community event submission (PLAN-v2 decision 9). Works locally with a
  // parsed-public-SF-event check; production enablement additionally requires TYPESAFE_API_KEY
  // so Jev gates spam/legitimacy. Admin removal needs an ADMIN_TOKEN secret.
  eventSubmission: true,
  fundingLoop: true,
  // Economy v3 (PLAN-economy-v3): the harder 5-star ladder (Seed→Series D "Decacorn", no Unicorn/
  // Pre-IPO/Hectocorn) + far smaller simulator-calibrated payouts, continuous burn and current-vs-
  // lifetime. Default OFF: shared/funding.ts keeps the v2 Pre-seed→Hectocorn ladder + large payouts
  // until this flips WITH the one-time proportional D1 rescale migration of existing totals (j3ud).
  economyV3: false,
  // VC fund drops (PLAN-v2 decision 3): server-scheduled "come pitch!" checkpoints, first-50
  // drive-through cheques, live N/50 counter, banner + radar blip, cap-table source.
  fundDrops: true,
  // Fix a live bug: the fund-drop drive-through gate (drops/checkpoint.ts) is a translucent gold cylinder rendered
  // DoubleSide, so when you walk/drive INTO it (as intended) the inner wall washes the whole screen orange. This
  // renders the gate FrontSide instead — the outward-facing cylinder still reads as a gold gate on approach, but has
  // no faces pointing at an inside camera, so it never tints the screen from within the ring. Dev ON (bug fix); reviewed.
  dropGateNoInsideWash: true,
  // Paid sponsor slot that renames a drop under a real VC/startup. An ad product; stays off
  // until Stripe keys exist (checkout gated), like billboards/outbidCheckout.
  fundDropSponsors: false,
  // Drive-through event payouts (PLAN-v2 decision 1): passing through an event marker (on foot or
  // driving) pays once ever — no 20s "work the room" dwell. Off reverts to the v1 room path.
  driveThroughFunding: true,
  // Cap-table data model + /api/funding/captable read (PLAN-v2 decision 5): lists every backer
  // (events, VC drops, celebrity angels, warm intros). Pure game data; no external integration.
  capTable: true,
  // No-key local snapshot is guarded by ENVIRONMENT=local at its API; live ingest remains off.
  localEventSnapshot: true,
  gtmPipeline: true, gtmCatalogue: true, gtmSpawns: true, officeClaims: false, officeClaimDelivery: false,
  deepLinkSpawns: true,
  billboards: false, impressions: false, rentals: false, stripe: false,
  // Display canonical confirmed totals; Checkout awaits configured GTASF test providers.
  outbidBanner: true, outbidCheckout: false, outbidCrown: true, outbidPlane: false,
  // Enable after GTASF keys/event IDs, privacy choice and live tracking verification (F13/F14).
  posthogAnalytics: false, xAdsPixel: false,
  // Referrals are IN-GAME ONLY (founder decision 2026-10-03): sharing + observed-play funding rewards
  // (warm intros, starter cheque, milestones) are on; all cash credit/claims/cash-out are permanently
  // off and excluded from the production allowlist. Keep these keys false (referral code still reads them).
  referrals: true, referralCredit: false, referralClaims: false,
  referralWarmIntro: true, referralCashout: false,
  // Local flavour acceptance: source/media checks passed; native proof remains tracked in 8kbq.
  // Original genre stations, DJs and fictional ads. Requires /audio/radio station MP3 set.
  // Production activation belongs to the release allowlist; false retains the three CC0 loops.
  radioStations: true,
  // Validated external event links from world labels/rings; release allowlist controls production.
  worldEventLinks: true,
  moderation: false, admin: false, radio: true, hazards: true, cityLife: true,
  // In-game "What's new" panel (once per deploy) and the /changelog page, driven by CHANGELOG.md.
  changelog: true,
  // F-key feedback to D1 + grouped admin digest (PLAN-v2 decision 10). Submit needs only the DB
  // binding; the admin digest/screenshot endpoints stay hidden until an ADMIN_TOKEN secret is set.
  // Production enablement additionally needs 'feedback' added to prepare.ts reviewed + migration 0019.
  feedback: true,
  // gtasf-367l: stamp each feedback submission with the build/changelog version (for rapid-deploy
  // triage). Requires migration 0032 (feedback.build column) to be applied and 'feedbackBuildTag' is
  // added to prepare.ts's reviewed allowlist — the worker only references the build column while this
  // is on, so leaving it off keeps feedback inserts working exactly as before the column exists.
  feedbackBuildTag: true,
  // Hidden parody angel-investor NPCs (PLAN-v2 decision 4, bead gtasf-v2-angel-npcs-v4i6). Dev-on so
  // the feature is reachable in local v1 and the founder can review it in-game; it is NOT in
  // prepare.ts's `reviewed` allowlist, so production forces it OFF until the founder approves
  // docs/content/celebs.md (real names shown low-poly, no face, tagged "parody").
  celebNpcs: true,
  // Overhead player nameplates "Startup · nick · stage · $raised" (PLAN-v2 decision 6, gtasf-5dlu).
  // Dev-on so it is reachable in local v1 once main.ts feeds it peer names (PLAYER_JOIN) and the
  // funding leaderboard; shows nothing until wired, so it is safe on. Chat bubbles float above it.
  nameplates: true,
  // Account recovery (gtasf-17df): save your startup as a GTASF-XXXX-XXXX code and restore the full
  // profile on a new device. Server stores only a peppered hash; prod additionally needs the
  // RECOVERY_PEPPER secret (added to prepare.ts reviewed + a prod secret) before it can flip on.
  accountRecovery: false,
  // Spatial zoning: route /api/world to a per-cell WorldDO instance so one shared SF can
  // hold ~5,000 concurrent (docs/engineering/zoned-world.md, gtasf-k1aa). OFF until the
  // neighbour-observer, handoff and global-hub phases land and the staging load test
  // passes; while off, /api/world stays on the single WorldDO('sf'), so Sunday's playtest
  // is byte-for-byte unchanged.
  zonedWorld: false,
  // Bounded interest in the SINGLE world: cap each player's SNAPSHOT to the nearest ~60 others
  // (docs/engineering/zoned-world.md §6/§15.2 — the zoned path always caps). OFF so today's whole-city
  // path is byte-identical; flip (after a pane-6 two-tab + crowd feel check) to cut snapshot bandwidth
  // in a launch-day crowd (up to the worldCapacity cap) without affecting normal <60-nearby play.
  boundedInterest: false,
  // Character looks + status progression (docs/protocol/appearance-sync.md, gtasf-hrmk/u1g4/i85j):
  // per-player appearance id synced via SET_APPEARANCE/APPEARANCE so remotes render status looks.
  // OFF until the worker+web feature deploys together (the gate keeps old in-flight clients from
  // seeing the new APPEARANCE opcode); kept out of the prod allowlist until then.
  characterLooks: false,
  // "Become an angel" paid player-sponsored angel NPCs (docs/engineering/become-an-angel.md,
  // gtasf-become-an-angel-7ggb). Dev-on so /api/angels + the HUD are reachable and testable with the
  // Stripe TEST keys (card 4242). It is a checkout flag, so it MUST stay out of prepare.ts's prod
  // `reviewed` allowlist until the founder approves one real low-value USD purchase end-to-end
  // (founder 2026-10-03); the submit route also fails closed without TYPESAFE_API_KEY + a checkout.
  becomeAnAngel: true,
  // Ambient flying parody ads: a blimp over the Bay/FiDi + banner planes along the Embarcadero and
  // SoMa (founder playtest feedback, gtasf-more-billboards-sky-ads-hyvs). Dev-on; each is a presell
  // 'plane-flyover' slot showing a parody creative — a sold creative + checkout stay gated like billboards.
  skyAds: true,
  // Clickable "Buy this billboard" badges + a gated ad-slot page (founder feedback,
  // gtasf-buy-ad-slot-page-yxua). Shows the slot id/location/starting price; the Buy CTA stays gated
  // (disabled) until the founder enables live checkout (rentals + stripe, pane 7 ledger).
  adSlots: true,
  // Hold-to-talk proximity voice chat (FB2 gtasf-slzj): browser Web Speech transcribes locally and
  // posts through the SAME Jev chat moderation as typed chat; a server ElevenLabs STT adapter is the
  // fallback. OFF until browser/mic QA + an ELEVENLABS_API_KEY for the fallback.
  voiceChat: false,
  // Real-time proximity voice (docs/engineering/proximity-voice.md, gtasf-1sy5): push-to-talk Opus via
  // Cloudflare Realtime, server-authoritative who-can-hear (40 m fade, same vehicle, same event room),
  // verified-email speakers only, per-player mute/report. Dev only: production needs the founder's
  // Realtime app (REALTIME_APP_ID var + REALTIME_APP_TOKEN secret), emailCapture live, and the preview
  // 2-tab + phone check before it joins the prepare.ts allowlist.
  // TURN: with REALTIME_TURN_KEY_ID var + REALTIME_TURN_KEY_TOKEN secret set, GET /api/voice/ice mints 1 h TURN
  // credentials per opted-in device (rate-limited, burst 6 then 1 per 20 s); without them clients get STUN only.
  proximityVoice: true,
  // Hidden launch gate for proximity voice (gtasf-ws4j). With proximityVoice ON but voicePublic OFF, the voice UI,
  // client and /api/voice/* routes (and voice reports) are active only in a tab opened with ?voice=1 (remembered in
  // sessionStorage for that tab; the client sends X-GTASF-Voice: 1 and the worker refuses voice routes without it).
  // Turn voicePublic ON (and add it to prepare.ts reviewed) to give voice to every player.
  voicePublic: false,
  // Spoken bubbles (docs/engineering/spoken-bubbles.md, gtasf-qjja server; client is 1.0's bead): hold-to-talk clips are transcribed
  // server-side (ElevenLabs Scribe via POST /api/voice/caption -> WorldDO), moderated like typed chat (blocklist +
  // TypeSafe jev; each rejection is a strike toward the 24 h voice ban) and broadcast as a chat bubble with a 🎙
  // marker (CHAT_SPOKEN) to everyone in chat range / the event room. No audio stored; transcripts only when attached
  // to a report (last ~2 min, deleted after 7 days). Hard cap $20/day of transcription (captions pause, audio keeps
  // working). STT is Cloudflare Workers AI Whisper (wrangler 'AI' binding, emitted by prepare.ts when voiceCaptions is reviewed) and migration 0038; also behind ?voice=1 until
  // voicePublic. Dev on, NOT in the prod reviewed allowlist until the founder tests.
  // Spoken bubbles (docs/engineering/spoken-bubbles.md, gtasf-gc9q client / gtasf-qjja server): hold V or the mic
  // button to say something; ElevenLabs batch STT + jev moderation turn it into a 🎙 chat bubble for players within
  // chat range. The mic button is for everyone (no voice opt-in), but only under ?voice=1 until voicePublic.
  // Needs ELEVENLABS_API_KEY (worker secret) and the founder's yes. Dev on, prod off.
  voiceCaptions: true,
  // First-run onboarding: 3 SA intro slides, an SA mission tutorial (Founder Orientation ring, one-time
  // award), progressive HUD reveal and contextual hints (PLAN-onboarding.md, gtasf-n34i). Gates the
  // `/api/onboarding` state routes and the client flow. OFF until the client slides/tutorial DOM are
  // wired into main.ts (pane 6) and the Orientation award lands (pane-14/funding); kept out of the prod
  // allowlist until then. Jev username moderation on the identity screen (pane 3) needs TYPESAFE_API_KEY.
  onboarding: true,
  // Align first-time E/T hint chips with actionable targets; founder review/approval before enabling.
  contextualInteractionHints: false,
  // Show first-time onboarding notices one at a time. Enable only after founder-approved
  // HUD review; remains off in production during the soft launch. [gtasf-ekvt]
  onboardingNoticeQueue: false,
  // Email capture + verification (founder 2026-10-04, gtasf-1aon): an optional SA card after the first
  // cheque (and once more at the first star) offers "Save your startup" — enter an email, verify via a
  // 6-digit code OR a magic link, and earn a cosmetic "Verified founder" nameplate tick + a modest one-time
  // cheque (~10 min of early econ-v3 earnings; one per profile AND per address). Sends via the Cloudflare
  // Email Service send_email binding (noreply@gtasf.com); the worker self-gates the feature OFF when the
  // binding is absent, so there is never a fake "check your inbox". Stores only hashed codes; NEVER logs
  // addresses or codes. OFF until a real send to the founder's address succeeds in production (see
  // DEPLOY.md) and it is added to prepare.ts's reviewed allowlist. Also in Game options as "Save your
  // startup"; PostHog event email_captured (no PII). [gtasf-1aon]
  emailCapture: false,
  // Friends system: globally-unique usernames, mutual opt-in friend requests, friends panel, radar feed,
  // "go to friend" robotaxi and friend DMs (PLAN-v2.1 decision 5, gtasf-q4yo). Gates /api/friends/* and
  // the client UI. OFF until the client panel + the radar/taxi/DM wiring land and it is reviewed; kept out
  // of the prod allowlist until then. Jev username moderation needs TYPESAFE_API_KEY (local rules apply regardless).
  friends: false,
  // Phone/Low minimap budget: the round minimap redraws at DPR 1 every 100 ms (was DPR<=2 every 60 ms) on
  // Low/coarse-pointer devices. Expanded map unchanged. Needs pane 6's phone look before the prod allowlist. [gtasf-c8sj]
  lowRadarBudget: true,
  // Hidden fleet vehicles (far-culled / cruise) skip per-frame world-matrix updates. [gtasf-c8sj]
  hiddenFleetMatrixSkip: true,
  // gtasf-dr19: DEEP fleet matrix skip. hiddenFleetMatrixSkip set model.root.matrixWorldAutoUpdate=false on
  // hidden/settled vehicles, but in three.js 0.186 scene.updateMatrixWorld recurses into EVERY child
  // unconditionally — so matrixWorldAutoUpdate=false only skips the root's own multiply, and the renderer
  // still walks + multiplies all ~40-48 children of every far vehicle. Profiling the haight-props steady
  // state showed that is ~half the scene's 2,054 nodes (22 cable cars = 1,056 objects + 6 buses = 240,
  // all invisible/far in Haight) and updateMatrixWorld+multiplyMatrices is ~15.5% of the steady frame. This
  // overrides a hidden/settled vehicle root's updateMatrixWorld with a no-op so the renderer skips the WHOLE
  // subtree walk, restoring the prototype method the frame it becomes active again (the game already calls
  // model.root.updateWorldMatrix(true,false) with the fresh pose when a vehicle comes near, so the transition
  // frame is correct; invisible/static vehicles keep a correct frozen matrixWorld). No visual change: hidden
  // vehicles don't render, settled parked cars don't move. Requires hiddenFleetMatrixSkip. Multi-run clean steady
  // (hitch frames removed) 57.8->60.05 fps (+2.3, matrix 2.47->1.21 ms/frame, p95 24.1); ferry no regression;
  // same-pose desktop+phone look A/B visual-neutral (docs/perf/dr19-*, docs/sf-data/haight-perf). It also correctly
  // implements what hiddenFleetMatrixSkip's comment already claimed (that one only skips the root's own multiply).
  // Dev ON; in the prod reviewed set. [gtasf-dr19]
  fleetMatrixSkipDeep: true,
  // gtasf-dr19: stop the per-frame whole-scene matrix force-cascade. By default scene.matrixAutoUpdate is
  // true, so every frame three.js recomposes the (identity, never-moving) scene matrix, sets
  // matrixWorldNeedsUpdate and force-cascades updateMatrixWorld as force=true into EVERY descendant — which
  // makes the existing staticMatrixFreeze (chunk subtrees set matrixAutoUpdate=false) still run their
  // multiplyMatrices, because under force=true the multiply is only guarded by matrixWorldAutoUpdate. Setting
  // scene.matrixAutoUpdate=false stops the cascade: static nodes (chunks/scenery already frozen) then skip
  // their multiply, and moving nodes self-force from their own updateMatrix (matrixAutoUpdate stays true), so
  // nothing visible changes. The scene sits at the origin (identity) and is never transformed, so freezing its
  // local matrix is safe. Complements fleetMatrixSkipDeep (which handles the moving far vehicles). Verified safe +
  // visual-neutral (matrix 1.21->0.996 ms, firms p95 24.1->23.6; ferry/READY no regression), but its MEAN gain is
  // within session noise, so HELD OFF pending a founder call to enable it for the p95 firming. [gtasf-dr19]
  freezeSceneMatrix: false,
  // Street-prop kinds with zero instances nearby are hidden instead of issuing empty draws. [gtasf-c8sj]
  emptyInstanceSkip: true,
  // Low Ferry coffee-queue regulars use the instanced crowd silhouette (1 draw) instead of rigged avatars. [gtasf-c8sj]
  lowInstancedQueue: true,
  // Merge each streamed chunk's same-material road pieces (roads_*, roads_surface_join_*) into one mesh. [gtasf-c8sj]
  chunkRoadMerge: true,
  // Low: per-chunk facade fronts/detail/signs/lamp posts beyond 150 m skip rendering (base boxes keep their facade shader). [gtasf-c8sj]
  lowDetailCull: true,
  // Road height sampler reads flat Float32 segment endpoints instead of graph point arrays (same results). [gtasf-c8sj]
  fastRoadSampler: true,
  // Whole-city street-prop layout runs in a worker (decodes its own road graph copy); inline fallback on failure. [gtasf-c8sj]
  layoutWorker: true,
  // Low kerbside parked cars: near model merged per material and drawn instanced (few draws for the whole pool). [gtasf-c8sj]
  lowInstancedKerbCars: true,
  // Low street props: all prop-material kinds in one BatchedMesh (multi-draw + per-instance culling). [gtasf-c8sj]
  lowBatchedProps: true,
  // Low: remote players beyond 25 m draw as instanced crowd silhouettes (1 draw) instead of rigged avatars. [gtasf-c8sj]
  lowPeerImpostors: true,
  // Cold load: when the spawn lies inside manifest.roadGraphNear coverage (Ferry 1.5 km, /go/ places 600 m),
  // READY waits only on roadgraph-near.bin (~3.6 MB gz vs 11 MB); the full city graph is fetched after READY
  // and swapped in for routing, road snap/heights, radar and scenery. Needs tools/map/roadgraph-subset.mts
  // run on the published bake (deploy.mjs does it before publication), a phone cold-load trace
  // (tools/perf/phone-cold-load.mjs) and a desktop/phone look at spawn + drive-out before enabling. [gtasf-0k01]
  // ON (1.0, Oct 6 01:00): phone trace world-ready 22.2 s -> 16.8 s. Without a published roadGraphNear the client
  // falls back to the full graph. Still wants pane 6's spawn + drive-out look on the deploy candidate.
  nearRoadGraph: true,
  // gtasf-ep30n: build the cold-load landmark geometry in ~12 ms slices (MessageChannel yields) instead of one ~2.5 s
  // long task on a 4x phone — the loading card no longer freezes at 3-6 s (where real phone visitors abandon), fetches
  // issued just before it go out, and the road-graph decode can interleave. Same landmarks, same order. Client-only.
  // OFF 10-19 (the #6.42 cold-READY regression): local cold A/B, phone 4x / 9 Mbps, HEAD + the #6.42 set: first live frame
  // 29.6 s with it vs 24.8 s without (4+4, no overlap); the slices push the build behind world-loaded. 48 ms slices
  // (landmarkSliceLong) are no better: 28.9 vs 25.2 s unsliced. Dropped from #6.42. Evidence docs/perf/coldready-641-vs-642.
  slicedLandmarkBuild: false,
  // gtasf-ep30n: routing sooner on a busy phone — router-build idle callbacks every 100 ms with ~12 ms bursts when the last
  // frame left headroom (else one slice per ~400 ms). Off = the 5623b89a cadence (400 ms, one slice). Lane B attributes
  // ~4.5 fps of the phone firefight gate to the cadence (disputed, load-confounded): keep OFF in prod until that gate passes.
  routerHeadroomBursts: true,
  // gtasf-ep30n: on the full-graph upgrade, rebuild the minimap road tiles into a fresh map and swap when done (no blank
  // window). Off = clear and refill progressively (pre-5eda8664). Lane B attributes ~3.7 fps of the firefight gate to it:
  // keep OFF in prod until that gate passes.
  minimapTileSwap: true,
  // gtasf-ep30n N16: the radar router starts on the full routing graph as soon as it's decoded instead of after the three
  // city-wide index builds (it snaps with its own structures), so routes/GPS come sooner after READY on a phone. Client-only.
  earlyRouterGraph: true,
  // gtasf-ep30n N16: build the radar router in ~12 ms setTimeout tasks (like the city-index runner) instead of idle callbacks,
  // which a busy phone never grants (router build 8-11 s on a 4x phone). Client-only; perf-gate before shipping.
  routerTaskSlices: true,
  // gtasf-fddi / critic N16: build the radar router's structures in routing.worker.ts from a copy of the restored full road-pack
  // bytes (same decode + routingSubgraph as main, so edge order matches by construction), in parallel with main's unpack;
  // main only assembles. Needs earlyRouterGraph. Falls back to the on-main build on any worker failure. Client-only.
  routingWorkerPacked: true,
  // gtasf-fddi / critic N16: assemble the radar router from the routing worker's structures + a typed light-edge view as soon
  // as the worker finishes, without waiting for main's full-graph unpack (byte-identical routes, routingPacked.test.ts).
  // Needs routingWorkerPacked. Falls back to the main-graph path on any failure. Client-only.
  routerLightEdges: true,
  // No-PII loading funnel beacons (start / ready / abandon-before-READY with stage + elapsed bucket) to
  // /api/loading/beacon -> D1 loading_beacon_counts (migration 0037). Needs the migration applied in prod. [gtasf-loading-abandon]
  loadingBeacon: true,
  // gtasf-j7wvv: consent-free aggregate counts of world sessions, live-socket drops (close code + session age) and rejoins
  // (gap) — POST /api/net/beacon -> D1 net_beacon_counts (migration 0052; apply it before enabling in prod). Same guards
  // as loadingBeacon (no ids, bots skipped, per-IP limit). Server + client; dev-on, prod via prepare.ts after review.
  netBeacon: true,
  // gtasf-ep30n (lane C cold-phone trace: READY ~9.8 s, ~4 s of it server latency on the critical path): open the world
  // socket as soon as the spawn pose is snapped instead of after boot + the funding-profile read (the server resolves the
  // nickname from the device cookie itself); its messages queue until boot attaches the handlers. main.ts. Client-only
  // (net path). Dev-on.
  earlyWorldSocket: true,
  // gtasf-ep30n: on a cold WorldDO (night / after a Cloudflare reset) the city-graph load ran inside blockConcurrencyWhile and
  // held every request — admission reserve ~1 s and the funding profile 2-4 s on lane C's cold-phone trace. Load it in the
  // background; only GET /api/funding/profile and /internal/admission/reserve|cancel skip the wait (WorldDO roadFreeRoute).
  // SERVER (WorldDO). Dev-on; prod via prepare.ts after review.
  worldRoadsBackground: true,
  // Real car-vs-car contact (founder: 'cars don't bump into each other'): the driven car hits fleet cars (AI traffic,
  // robotaxis, buses, other players' cars) and kerb parked cars as car-shaped capsules, loses speed, bounces off,
  // crunches (synthesised, no asset), shakes the camera, and nudges AI cars client-side. Remote players' cars are
  // never moved (each owner pushes itself). Needs a founder drive-feel check before the prod allowlist.
  carCollisions: true,
  // Fix the blank grey facade slabs on the dense map (gtasf-facade-exposed-clearance-l6sy, follow-up to
  // gtasf-6w9a). Two parts: (1) readFacadeBuildings adds a geometric exposure test — a wall is "exposed" (open
  // ground in front, earns a facade) when the freer of its two normal directions is clear for ~6 m, which
  // recovers open faces the old single near-roof 0.8 m point probe missed when the triangle normal pointed
  // inward (kept as a union, so it only ever ADDS exposure). (2) The shipped build gated the windowed
  // bigExposed/coarseWall fronts behind !options.low, so on phones the many wide coarse-chunk walls (whole
  // dense-map districts stream as coarse) rendered as flat grey slabs — the real cause of the Mission/Haight/
  // Castro slabs; now a sizeable exposed or coarse wall gets the windowed tile on the low preset too (same quad
  // count, fronts still culled beyond 150 m on low). Party walls stay matte. Dev ON; prod after the founder's
  // look A/B + phone-fps gate (docs/sf-data/exposed-clearance/, docs/perf/exposed-clearance/).
  exposedByClearance: true,
  // Aerial skyline haze (gtasf look gap vs docs/sf-data/teleoperator-reference.png). The fog far distance also
  // drives camera.far, and the shipped altitude ramp only reached ~x4 very high up, so from a typical ~170 m
  // aerial the FiDi skyline (Transamerica / Bay Bridge / Salesforce Tower) was fogged into the haze and near the
  // clip plane. This steepens the ramp (foundation.ts) so distant landmarks read from the air with atmospheric
  // depth. Street level (k=1) is byte-identical, so no gameplay or phone-fps cost; the extra draw distance only
  // applies when the camera lifts well above ground (aerial, "lift off", title fly-over). Does NOT fill the
  // mid-ground residential (that is a separate chunk-streaming gap). Dev ON; prod after the founder's aerial
  // look A/B (docs/sf-data/aerial-skyline/skyline-{golden,noon}-ab.jpg).
  aerialSkylineHaze: true,
  // Street-level distance haze, all tiers (gtasf look gap vs docs/sf-data/teleoperator-reference.png).
  // aerialSkylineHaze only EXTENDS the fog aloft; at street level the altitude ramp holds k=1, so mid-to-far
  // blocks sit at the grade's full fog far (~800 m at golden) and read crisp/flat where the reference's distance
  // recedes into a warm veil (atmospheric perspective). This pulls the FOG IN at eye level only (~0.70 -> fog far
  // ~560 m), fading back to the ramp by ~45 m up, so aerial / title views are untouched. foundation.ts grade
  // block. First shipped HD-only because the phone-Low ferry waterfront lost ~3 fps; root cause was the tighter
  // fog shrinking camera.far onto a far-LOD/stream boundary and churning it. Fixed by decoupling camera.far from
  // the fog tightening (it follows the untightened drawFar) — draw distance / streaming identical to flag-off,
  // only fog density changes — so it runs on Low too: phone-Low gate passes ferry 60.07 / soma 60.02 fps, p95
  // <=22 ms (docs/perf/disthaze-low-fix). Flag-off and the aloft ramp are byte-identical. In prepare.ts reviewed
  // set (founder-approved); A/B docs/sf-data/distance-haze (desktop + phone Low). Dev ON.
  distanceHaze: true,
  // Hanging-car fix (gtasf, @ktwu01: a new player's car hung in the air above the rooftops on GET MOVING).
  // Two parts: (1) controller.ts — when there is no terrain sample under the driven car (an unloaded chunk /
  // void, e.g. while a new player's spawn chunk is still streaming), it falls under gravity instead of locking
  // to its own height and hanging; (2) an auto-recovery safety net (vehicles/driving/hangRecovery.ts, wired in
  // main.ts) that recovers the car to the nearest road once it has hung — no ground under it, or hovering > 4 m
  // up with ~zero vertical velocity — for more than 1.5 s, covering the roof/footprint-gap cases the fall fix
  // and the roof guard miss. Recovery itself (recoverRoad) now snaps to the nearest road client-side so it works
  // even before the player is connected. Dev ON; a plain correctness fix, safe to put in the prod allowlist.
  carHangRecovery: true,
  // cameraRenderedGround (gtasf-h2qrw, Coit Tower east "missing hillside"): the chase camera cleared itself against the
  // coarse collision heightfield only, but the DRAWN LOD terrain sits up to ~1.5 m off that field on steep hills (Coit
  // summit: field 89.35 m, mesh 90.05 m, camera 89.65 m), so the camera ended up under the rendered hill and, with
  // back-face culling, saw straight through it to the Bay water and the slope's house walls (read as an "inverted
  // city"). Now the camera also clears the drawn terrain/road surface on the player's deck (RenderedGroundIndex, the
  // same index road paint uses; tunnels keep their own deck via the reference height). Off = field only, byte-identical.
  // Dev ON; a plain correctness fix for the prod allowlist after the Coit look-check.
  cameraRenderedGround: true,
  // gtasf-r1fpj: draw the on-foot avatar on the RENDERED road/terrain when it sits up to 1.5 m above the road-graph height the
  // player walks on (steep blocks, e.g. Hyde St at Bush: the body sank to mid-thigh). Visual only: foot.y and the server
  // pose are unchanged. Enables the lazy RenderedGroundIndex (shared with cameraRenderedGround). Client-only.
  footRenderedGround: true,
  // gtasf-fht16: the camera/foot rendered-ground lookups build the RenderedGroundIndex in slices (one chunk per task) instead of
  // synchronously on the first query (~0.2-0.3 s on a 4x phone right before the first live frame); they read null (their
  // existing fallback) until it lands. Road drape (graphicsV2) still builds it synchronously. Client-only.
  renderedGroundSliced: true,
  // #6.42 idle phone gate (lane D bisect): post-READY sliced builds (full road-graph unpack, city indexes, rendered ground,
  // router fallback) yield once per animation frame (100 ms fallback when hidden) instead of chained setTimeout(0), which
  // left ~4 ms between 12 ms slices (~75% of a frame-bound phone's main thread while a build ran). Client-only.
  slicesFramePaced: false, // measured 10-18 22:4x after the c6aa0f54 revert: WORSE (20.0 fps / p95 71 vs 23.0 / 55) — do not ship
  // c6aa0f54's post-READY city-index bursts (yield after ~12 ms of work instead of after every 512-edge step). Off: lane D's
  // #6.42 bisect pinned the idle phone gate's 2x regression on it (chained 12 ms setTimeout(0) bursts ~75% main-thread duty).
  // Re-enable only with a paced variant that passes the gate. Client-only.
  roadIndexBursts: false,
  // gtasf-7vt00: serve roadgraph.bin's brotli twin (<key>.br, uploaded by map publication) to clients that send 'br' — 10.9 MB
  // gzip -> 6.2 MB, so phone GPS/routing is ready ~4 s sooner at 9 Mbps after READY. Missing twin = the gzip object as today.
  // Worker path (needs reviewer) + the live release needs its .br uploaded (tools/map/publication.ts on the next publish).
  mapBrotliAssets: false,
  // critic 09:3x / gtasf-7vt00: route on the spawn-area graph (decoded at boot) until the city router lands, so the opening's
  // GPS/event routes work ~1 s after READY instead of ~20 s on a 9 Mbps phone; unreachable-yet = 'loading roads…'. Client-only.
  nearRouterFirst: true,
  // reviewer 13:3x / critic 13:4x: the loading beacon also counts a coarse client class (browser / inapp / preview from the
  // User-Agent, server-side) and whether the page was ever visible, so link-preview renderers stop hiding in mobile 'abandons'.
  // Needs migration 0053 (orchestrator applies it in prod) BEFORE the flag ships; writes are best-effort either way. No PII.
  loadingBeaconClass: true,
  // missionPresentation (docs/critique/2026-10-15-gta-v-gap.md #17): the GTA V frame around the existing missions —
  // a yellow title slab when a job starts, the current objective as one line in the mission-text spot (bottom-centre,
  // above the controls; above the minimap on phones), a MISSION PASSED band with the reward counting up, and MISSION
  // FAILED when a job ends any other way. web/src/founder/missionPresentation.ts, fed from the runner's onStep /
  // onObjective in main.ts; pure DOM, no game or money state. Off = byte-identical (nothing mounts). Dev ON; prod
  // after the desktop + phone look (docs/sf-data/missions/presentation-*).
  missionPresentation: true,
  // landmarkCardTrees (docs/critique/2026-10-15-gta-v-gap.md #19): the authored landmarks (Ferry plaza tree pits, the six
  // Embarcadero palms, SF General's yard) built their trees from icosahedron blobs and nine flat fronds inside the
  // vertex-coloured landmark mesh, while the street trees next to them are photo cards from the sf-trees atlas. This
  // draws those landmark trees as the same crossed atlas cards (legacy PNGs on Low), web/src/render/landmarks/cardTrees.ts.
  // Off = the blob trees, byte-identical. Dev ON; prod after the Ferry spawn + SF General look (docs/sf-data/card-trees).
  landmarkCardTrees: true,
  // hudDeclutter (docs/critique/2026-10-15-gta-v-gap.md #6): GTA V's HUD is minimap, cash, weapon, stars. Two cheap
  // pieces of ours that never go away: your OWN startup plate floating over your own head, and the two-line key legend
  // at the bottom. With this on, the self plate shows for 10 s after spawn and 6 s after your profile changes (a cheque,
  // a new round), then hides; the key legend shows for 25 s, then only for 10 s after a mode change (entered a car) or
  // when the pause menu closes; the pointer-lock fallback hint ('Use arrow keys to look…') shows 8 s per refused lock
  // attempt instead of forever. Peers' plates and the phone HUD are untouched. Off = always-on, as today.
  hudDeclutter: true,
  // hudMenuFold (critique #6, lane C part; gtasf-8c8wo): two more pieces of furniture fold into the ☰ pause menu — the
  // radar's live-event ticker (moves into the Tech Week group, still tappable there) and the always-on PRIVACY button
  // (a "Privacy settings" button in the menu opens the same consent panel; the first-visit consent prompt is unchanged).
  // The OUTBID banner is already hidden for founder-ladder players. Phone (critic R5): the ♫ STATION button folds into the
  // ☰ Radio group and the touch 🎙 shows only while another player is within 40 m. Off = all stay on the HUD. Dev-on.
  hudMenuFold: true,
  // phoneFrame (critique #17 "the phone shown as a phone frame", gtasf-8c8wo): the jobs phone (N / ☰ → Phone) is drawn
  // as a handset — dark bezel, a status bar (carrier, the live SF time, signal + battery), a home bar — and slides up
  // from the bottom edge, desktop and touch alike. Same rows and buttons inside. Off = the gold-bordered panel. Dev-on.
  phoneFrame: true,
  // hudFocus (critic N2/N4 — the most-repeated replay finding, gtasf-8c8wo): one message at a time. A bottom-centre
  // message hides the ones below it in priority (conversation > mission objective > DISPATCH > look hint > key legend),
  // and MISSION PASSED / FAILED, RANK UP and the SA stingers stand alone for their few seconds (notices, hints, radio
  // chatter step aside). CSS only (web/src/hud/hudFocus.css); nothing is dropped, just not drawn on top of each other.
  // Off = everything draws at once, as today. Dev-on.
  hudFocus: true,
  // stuntBonus (GTA V critique "cheap GTA staples": hillJumps is the best feel in the game; gtasf-8c8wo): a car jump with
  // >= 1 s of real air and >= 12 m covered lands with a GTA-style "STUNT BONUS · 34 m · 1.6 s air" splash, and the
  // device's best jump is kept ("NEW BEST"). web/src/founder/stuntBonus.ts. Client-only: no money, no server.
  // Needs hillJumps. Off = no splash. Dev-on.
  stuntBonus: true,
  // loadingHook (critic N13, gtasf-ep30n): the first 3 s on a phone, where 90 of ~200 abandons happen at boot. The loading
  // card gets a hook line ('Steal a car. Pitch a VC. Put your startup on a billboard.'), a moving shimmer + a verb line that
  // changes every second until the real stages take over, a slow poster pan, the poster preloaded from the <head>, and the
  // PRIVACY button held back until READY (it's in the ☰ menu). Static index.html reads this at BUILD time (web/htmlFlags.ts
  // stamps data-loading-hook). Off = today's card. Dev-on; prod after the next funnel snapshot's A/B read.
  loadingHook: true,
  // deepLinkPoster (critic N13k, lane D): deep links (/go/<slug>, /e/<event>, ?at=), the shared path a friend's or an event's
  // link arrives by, paint the loading poster at first paint like the plain URL, instead of a bare card until the four boot
  // round trips end. index.html picks Lombard / Golden Gate / Ferry from the slug (art.ts swaps it if the resolved place
  // differs). Static HTML reads this at BUILD time (web/htmlFlags.ts). Off = deep links keep today's late poster. Dev-on.
  deepLinkPoster: true,
  // walkUpPitch (funnel, gtasf-8c8wo): real players reach the Pre-seed walk-up and leave before pitching (0 real first-pitch
  // cheques on 10-15). Walking within 5 m of the Pear VC partner now opens the conversation by itself — no 'tap Enter /
  // exit' — like walking into a GTA mission marker; it re-arms after 12 m away. PITCH NOW stays. Client-only; same pitch
  // path. Off = E / Enter-exit or PITCH NOW only. Dev-on.
  walkUpPitch: true,
  // savedLoadout (critique #20 persistence, gtasf-8c8wo): the guns you BOUGHT come back next session. The server already
  // keeps purchases per device (combat_weapons, the gun shop's idempotency key); GET /api/combat/loadout reads them
  // (read-only: no money, no writes) and the client grants them when combat starts, so the wheel no longer shows a price
  // for a gun you own. World pickups stay per-session. Needs combat + weapons + gunShop. Dev-on, prod-off.
  savedLoadout: true,
  // taxiFareJob (GTA V critique "not in the 20": a taxi-fare job, gtasf-8c8wo): the 'Drive a Fare' mission (F at the
  // Ferry Building taxi stand) — get in a car, pull up at the stand, drive the fare to Union Square; daily, 1x demo base.
  // Both steps only count from the DRIVER's seat (server: pose driver flag in advanceCheckpoints + the delivery check).
  // A new valuation source: dark until the money review + walkable/look evidence. Needs missions. Dev-on, prod-off.
  taxiFareJob: true,
  // giverFrustumCull (gtasf-8c8wo, lane C #6.43 idle gate 10-19): mission-giver NPCs outside the camera view are hidden and not
  // animated. Avatar meshes are frustumCulled=false (avatarPoseBounds isn't in prod), so each giver was skinned + drawn every
  // frame from anywhere; taxiFareJob's stand giver behind the Ferry spawn measured -1.9 fps (phone Low, Ferry idle, 3 ABBA
  // pairs). Client-only, nothing on screen changes. Dev-on; for prepare.ts with or before taxiFareJob.
  giverFrustumCull: true,
  // chequeOnce (critic N3, lane C): a reload replayed the last cheque card ('CHEQUE SECURED +$76k', cha-ching, award hooks)
  // because the first status read still answers it as 'awarded'. Shown award ids persist per device (localStorage ring of
  // 50); never-shown awards still show after a reload. Client-only display; the ledger is untouched. Dev-on.
  chequeOnce: true,
  // deferFarLandmarks (gtasf-g8ty9, lane C): on the default Ferry arrival, 13 far street-level landmarks (landmarks.ts
  // DEFERRABLE_LANDMARK_IDS; out of view from the plaza, no boot-time consumer) build in slices after READY instead of before
  // it — about a third of the pre-READY landmark build, which READY awaits. Walkable surfaces re-scan when they join. Deep
  // links build everything up front as before. Client-only.
  // OFF (measured 10-19, tools/_defer-landmarks-ab.mjs, local stack, phone 4x / 9 Mbps, 3 alternating runs): world-loaded
  // 15.1 s deferred vs 14.7 s all-up-front = no READY win — with slicedLandmarkBuild the build already overlaps the map
  // download, which is the long pole. Also a defect to fix before any reuse: the late group's mount helpers (~14 objects)
  // were moved into the landmarks group with the 11 landmarks (71 children vs 57). Kept for a slower-CPU re-test only.
  deferFarLandmarks: false,
  // landmarkSliceLong (lane C, #6.42 cold-READY hold 10-19): with slicedLandmarkBuild the pre-READY landmark build runs in
  // 48 ms slices instead of 12 ms. Local cold A/B (b8b2e816): the #6.42 set's first frame came ~3.7 s after #6.41's, with
  // world-loaded waiting ~4 s on the 12 ms-sliced build. Only the loading card animates before READY.
  // MEASURED no fix (10-19): HEAD + #6.42 set, unsliced 25.2 s vs 48 ms slices 28.9 s to the first live frame (4+4).
  landmarkSliceLong: false,
  // lookUnlockReward (critic 20c, lane D look review 10-19): a funding-round tier reads as an event. In the wardrobe the current
  // tier gets a gold CURRENT chip and a tier reached since the last opening a gold NEW chip (per device); the toast says
  // '<TIER> TIER REACHED' and that the nameplate + Wardrobe show it. No outfit promise: the tier garment doesn't render on
  // Meshy bodies (the visible tier dress is lane D's gtasf-4vgje). Client-only, inside characterLooks. Dev-on.
  lookUnlockReward: true,
  // plazaLabelFade (critic 20f, lane C): world-space NPC sprite labels (the plaza VC partner, mission givers) fade to ~12 %
  // while the centre slot (centerSlotQueue) shows something, so MISSION PASSED / a payout card / NEW LOOK UNLOCKED never
  // print over them, and ease back after. Client-only. Dev-on.
  plazaLabelFade: true,
  // onFootInertia (docs/critique/2026-10-15-gta-v-gap.md FEEL): walking applied full speed on the first frame and snapped
  // the yaw to the stick, so the player stopped and reversed like a cursor. Now the planar velocity ramps toward the
  // input (~0.13 s in, ~0.09 s out) and the yaw sweeps with the motion, GTA-style; rides keep their instant response
  // and the server speed cap is never exceeded (speeds only ever lag the target). Off = the instant movement, byte-identical.
  onFootInertia: true,
  // Aerial far-LOD city ring (gtasf look gap vs docs/sf-data/teleoperator-reference.png). The base world only
  // streams a 3x3 chunk grid (~384 m) around the player, so from a high aerial the mid-ground between the
  // foreground and the FiDi skyline was an empty haze void. When the camera lifts well above the ground this
  // streams the cheap coarse-LOD chunks (detail:'low', ~21 KB / ~1000 tris each) in a full ring, from the edge
  // of the near 3x3 (no gap) out to ~3.6 km desktop / ~1.25 km phone (radius scales with altitude + tier). The
  // chunks mount at their real baked height (so they sit on the ground, continuous with the foreground) via a
  // flat fog-lit per-building tone — NOT the procedural facade shader, which aliases into speckle at distance —
  // and are visual-only (no collision, camera boxes, facade fronts, shadows or water). Loaded after READY,
  // disposed when the camera descends, so street play, first load and collision are byte-identical.
  // 2026-10-11: founder aerial look signed off (it was already prod-only via override; now dev-ON too for
  // parity). The empty haze void between the foreground and the FiDi skyline is gone -- the whole city streams
  // to the horizon and the Transamerica Pyramid / Salesforce Tower read against the sky, matching the reference
  // (A/B docs/sf-data/farlod/fidi-from-*-{before,aerialfaron}.jpg, desktop + phone). Street gates unaffected
  // (the ring is not loaded at street level): ferry 60.0, haight-props in its noise band. In the prod reviewed set.
  aerialFarChunks: true,
  // aerialFarFill (gtasf look-gap, Gap 1 vs teleoperator-reference.png): extends the aerialFarChunks ring so the city
  // fills the mid-distance at the MODERATE aerial heights players actually use, not only at high altitude. The ring
  // radius grows as `base + (height-55)/step`; stock is base 3 / step 14 / max {low 5, HD 14}, so at ~78 m the ring is
  // only ~1 km (radius 4) and the FiDi at ~1.2 km floats across the bayWater void. With this ON (HD-ONLY): HD gets a
  // generous ring (base 6, step 9, max 18 ≈ 4.6 km) reaching the full skyline. Visual-only coarse far-LOD (no
  // collision/facade/shadow/first-load); streamed, so no added emitted-payload bytes. Perf: the far ring only activates
  // above 55 m, so the street phone-perf harness (ground play) is unaffected; an aerial-fps probe (phone Low, 4x CPU
  // throttle) showed the aerial Low view is already streaming-hitch-bound at ~50 fps mean with the flag OFF and the
  // fuller ring made it worse, so per the founder's "if Low can't afford it, ship HD-only" this is gated off on Low --
  // Low keeps the stock aerialFarChunks ring. HD is vsync-bound aloft with headroom. Flag-off / Low: byte-identical.
  // Add to prepare.ts after the A/B + perf.
  aerialFarFill: true,
  // aerialFarCorridor (far-LOD massing, lane A): from the air the city had a hole of open bay between the detailed near
  // blocks and the far skyline (Telegraph Hill -> FiDi read as an island across water). Cause: the far ring streams only
  // chunks tagged detail:'low'; the 78 full-detail corridor chunks (Ferry->Columbus->Lombard, incl. North Beach /
  // Jackson Square) have no tag, so outside the near 3x3 nothing rendered them. They now join the far ring at their
  // smallest LOD (~97 KB gzip each, aerial-only, streamed after READY like the rest of the ring). HD-ONLY: phone Low
  // parked aerial fell to ~12 fps (vs 22-33) with them, so Low keeps the stock ring. web/src/render/chunks/world.ts.
  // Flag-off (or Low) byte-identical. A/B docs/sf-data/far-corridor; HD aerial 39.7 vs 40.5 fps (no cost). Dev-on.
  aerialFarCorridor: true,
  // Denser SF rooftop water towers (gtasf look gap vs docs/sf-data/teleoperator-reference.png, whose rooftops are
  // studded with the classic timber water towers). rooftopLife put a tank on ~75% of 4-9 storey brick/apt/mix
  // walk-ups; this raises that toward the reference: ~92% of a wider set of mid-rises (3+ storeys / >=9 m, plus
  // Edwardians and up to ~14 storeys), and a second tank on large roofs. Still bounded by the existing per-chunk
  // tank budget, so no runaway geometry. Dev ON; prod after the founder's look (aerial + street A/B).
  rooftopWaterTowers: true,
  // Larger, more prominent rooftop water tanks (gtasf look gap vs teleoperator-reference.png, whose timber towers
  // DOMINATE the roofscape from the air). rooftopWaterTowers already studs ~92% of mid-rise roofs, but each tank is
  // small (1.6 m drum / 3.2 m on 2.4 m legs). This widens them to CHUNKY (~2.7 m drum / 3.6 m on 2.6 m legs, not
  // taller/pole-like) so the towers read as the iconic fat timber silhouettes of the reference, aerial + golden hour.
  // Same instance count (just larger matrices) → no new draws/instances, negligible perf. Default OFF pending the
  // A/B docs/sf-data/rooftop-tanks (low aerial + close roofs, desktop+phone): towers now clearly stud the roofscape,
  // chunky not pole-like. Ferry phone perf 60.19 fps / p95 20.5 ms with it on. Dev ON; in the prod reviewed set. [gtasf-9tvf]
  biggerWaterTanks: true,
  // Ferry Building landmark fidelity to the authored-detail standard (gtasf-dtk5). It is the player's spawn
  // view, so detail matters: the arcade's arched windows rendered as flat dark painted arches with no depth, and
  // the clock tower's stacked-box tiers read as a stair-stepped silhouette. With this ON (near detail only), the
  // arches get a recessed, dark glazed pane behind a proud arched reveal frame (archFrame) with side reveal
  // jambs, so they read as framed windows with depth; the shaft gets vertical corner quoins, two string courses
  // and a bed-mould below the top cornice to clean the silhouette; and the arcade roofline gets a modillion
  // course. The glass stays DARK (not a mid grey-blue) so it keeps contrast on the Low ps2 path, which has no
  // env/tonemap and washed a lighter pane out to a pale wall-coloured outline on phone (founder, main device).
  // Geometry-only on the single merged landmark mesh (no texture, no draw call added); flag-off is byte-identical.
  ferryBuildingHd: true,
  // Aerial-perspective haze on the far-LOD ring (gtasf look gap vs docs/sf-data/teleoperator-reference.png). The
  // aerialFarChunks mid-ground renders distant downtown as flat fog-lit massing in its baked land-use tone, so from
  // a high aerial the FiDi towers read as a cold, hard-edged grey-blue CAD pile instead of the reference's soft
  // warm-grey skyline receding into haze. This blends each far fragment toward the scene's CURRENT haze colour
  // (so it tracks golden/noon/navy-night), ramped by view depth from ~550 m to ~2.3 km (to 0.55), over scene fog.
  // Far-LOD only (near buildings keep full facade detail); one smoothstep+mix in the fragment, so phone-cheap.
  // Founder look approved 2026-10-10; phone perf passed (canonical ferry gate 60.1 fps / p95 19.9 ms, and the
  // downtown-aerial probe where the ring is live adds 0.0 ms p95 / +0.08 ms mean over aerialFarChunks alone —
  // within noise, docs/perf/phone-farhaze-ferry + docs/perf/aerial-farhaze). Dev ON; in the prod reviewed set.
  aerialFarHaze: true,
  // Cheap procedural facade detail on the far-LOD ring (gtasf look gap vs docs/sf-data/teleoperator-reference.png).
  // aerialFarChunks renders distant downtown (Salesforce/FiDi cluster) as flat pale untextured massing, so the
  // mid-ground towers read as blank boxes next to the banded near buildings. This draws a window grid directly in
  // the far fragment shader — one dark line per ~3.6 m floor (windows/spandrels) and per ~6 m column (mullions),
  // only on near-vertical faces (roofs stay clean) — anti-aliased with fwidth so it NEVER aliases into speckle the
  // way the full near facade shader does at distance, and faded out past ~1.9 km so the deep skyline stays flat
  // under the haze. Far-LOD only; ~8 ALU ops in the fragment, no extra geometry/draws/textures, so phone-cheap.
  // Founder look approved 2026-10-10; phone perf passed (canonical ferry gate 60.2 fps / p95 21.5 ms with haze+facade
  // both on, and the downtown-aerial probe adds ~0.1 ms p95 over aerialFarChunks+haze alone — within noise,
  // docs/perf/phone-facade-ferry + docs/perf/aerial-facade-perf). Dev ON; in the prod reviewed set.
  aerialFarFacade: true,
  // aerialFarTowerTone (gtasf look-gap, Gap 2 vs teleoperator-reference.png): the far-LOD ring renders the FiDi
  // skyline towers (Transamerica / 555 / Salesforce cluster) in their baked pale land-use tone, so from a high
  // aerial they wash to flat near-white slabs that barely separate from the bright sky — the reference's towers
  // read as deeper steel/glass with height. This deepens+cools far fragments by WORLD HEIGHT (smoothstep 45->140 m,
  // so low warm rooftops are untouched) so tall massing gains glass-tower depth and contrast against the sky.
  // Far-LOD ring only (rides the aerialFarFacade custom program), ~6 ALU in the fragment, no geometry/draws/textures.
  // Flag-off: byte-identical (the varying, program-key tag and injected lines are all gated off the flag). Dev ON;
  // reviewed-set pending the teleop-match A/B.
  aerialFarTowerTone: true,
  // hazeRecede (Teleoperator look push): the distant skyline should RECEDE into a soft warm haze, not glow. The
  // golden-hour sun-lerp (foundation.ts ~L523) washes mid/far buildings bright at low sun; this desaturates the
  // final scene-fog colour toward its own luminance in daylight, so the distance loses punch and reads as
  // atmospheric depth (fog colour only — sky background + foreground untouched). OFF pending the A/B; then dev-on.
  hazeRecede: false,
  // skyCloudCover (Teleoperator look push): the reference sky is full of layered marine cloud; ours is a near-empty
  // saturated gradient (the dominant golden). Boost the procedural cumulus/wisp coverage + density (sky.ts) so the
  // sky reads as an atmospheric cloudscape, keeping the warm sun-lit per-cloud shading (not grey overcast).
  // Tapered by sun height (hs) so it fills the daytime blue sky and leaves the warm golden-hour sky unchanged.
  // Dev-on (founder: ship with the next batch); A/B docs/sf-data/teleop-gap/sky-clouds-{off,on}-noon. Add to
  // prepare.ts's reviewed set to ship to prod.
  skyCloudCover: true,
  // neutralDaylight (Teleoperator look push): SF midday reads olive/yellow-green — the SA midday `tint`
  // ([0.99,1.01,1.04] cyan push, post.ts whole-frame multiply) over a greenish daytime ambient (#dcefe9) and
  // yellow sun (#fff0bb). The reference noon is neutral-to-slightly-cool with clean whites/greys. This pulls the
  // daytime tint/ambient/sun toward neutral (timeGrade.ts), strongest at high sun and fading out by golden hour so
  // the warm sunset is untouched. Dev-on: A/B (docs/sf-data/teleop-gap/neutral-{off,on}-{desktop,phone} noon +
  // neutral-{off,on}-golden) — noon olive cast -> clean neutral daylight on desktop + phone-Low, golden-hour
  // untouched. Grade colour math only (no shader/draw change), byte-identical off. Add to prepare.ts reviewed set.
  neutralDaylight: true,
  // Coarse window grid on MID-DISTANCE building walls (Teleoperator aerial gap). aerialFarFacade only grids the
  // far-LOD ring; the mid-distance coarse FiDi towers (beyond the near facade-atlas range, inside the streamed
  // chunks) render as blank pale/tan boxes from the air. This draws the same cheap window grid — a dark line per
  // ~3.6 m floor and per ~6 m column, near-vertical faces only, fwidth anti-aliased — on the baked 'buildings'
  // material walls, gated to appear only PAST the atlas-front range (~180-420 m ramp) and fade out by ~3.4 km where
  // the far-LOD ring takes over, so near buildings (covered by the atlas fronts) stay untouched. (aerialFarFacade
  // grids the far-LOD ring and now applies after the fog, so the deep FiDi skyline reads as windowed to the horizon.)
  // ~8 ALU ops, no geometry/draws/textures; HD + Low.
  coarseWindowGrid: true,
  // glassTowerReflect (Teleoperator look push, lane A #1): the FiDi/SoMa towers read as flat matte boxes; the
  // reference's curtain-wall towers reflect the sky like glass — dark/steel head-on, mirror-bright at grazing
  // angles. Adds a cheap fake sky reflection (no env map / no new uniform; sun-warmth read from
  // directionalLights[0].color) on the two materials that render tower walls:
  //  1. web/src/render/frontFacadeMapping.ts (the NEAR/mid front panels, <~450 m, glass+office styles only): the
  //     existing flat tower sky-glow becomes VIEW-DEPENDENT — a world-space Fresnel mirror strong on the crisp
  //     glass panes (frontMask.g) plus a whole-wall grazing sheen so the curtain wall reflects the sky. (+ a
  //     vFrontWorldN varying, flag-gated.)
  //  2. web/src/render/facades.ts addBuildingFacades (the MID/far base facade walls, >~150 m): at the END of the
  //     wall block it deepens+cools the final diffuse toward a steel-glass tone, then reflects the sky (Fresnel),
  //     ramped in by world height (low-rise stays matte) and camera distance, banded per floor.
  // ~16 fragment ALU per material, no geometry/draws/textures; HD + Low. Flag-off byte-identical (every injected
  // line, varying and program-cache tag is build-time gated off the flag). A/B docs/sf-data/glass-tower (Ferry/
  // Market/FiDi, desktop + phone-Low). Orchestrator look review 2026-10-14: before/after nearly identical at the
  // FiDi cluster, NOT shipping — back to dev-off (it also amplified the tower-mask blotches, see towerGlassMask).
  glassTowerReflect: false,
  // towerGlassMask (orchestrator top-priority look bug, 2026-10-14): ragged WHITE blotches at the bases/corners of
  // the glass towers. Cause: the packed tower-style window masks (tools/art/pack-facade-atlas.mjs marks "window" =
  // darker than 0.55x the cell median) are inverted on light-blue curtain walls — the real panes land in R, while
  // G (glass) covers only the dark reflected-building silhouettes, trees and the lobby band. The front shader's
  // day glass glow (and night windows) are G-masked + dark-only, so they lit exactly those silhouettes. Fix, tower
  // cells only (web/src/render/frontFacadeMapping.ts): glass = the clean panes (R, minus the black frames), no
  // dark-only gate, and no day glow (the light-blue atlas already reads as glass). Night windows now light whole
  // panes per window cell (~30% lit, ramped in at real night only). Flag-off byte-identical. HD + Low. A/B
  // docs/sf-data/tower-mask; phone-Low ferry night 58.5 fps / p95 20.3 ms. Dev-on; prod via prepare.ts.
  towerGlassMask: true,
  // frontCoplanarDedupe (founder playtest 2026-10-14, "flashing building" at Powell & Sutter): the facade
  // flickered with vertical streaks. Probe: two front panels (a tower cell and an office cell) at the SAME depth, from
  // two overlapping source footprints on one wall, z-fighting. web/src/render/frontFacadeMapping.ts skips a front
  // whose wall lies in an already-fronted wall's plane (same facing, <0.3 m) and is >=80% covered by it (tallest
  // building wins). Build-time only, fewer quads; HD + Low. Flag-off byte-identical. A/B docs/qa/founder-2026-10-14.
  frontCoplanarDedupe: true,
  // sfGeneralArrival (QA lane E P3, 2026-10-14): every WASTED/BUSTED respawn lands on the road east of SF General, facing
  // a vast empty paved plain (US-101 corridor; coarse bake). web/src/render/landmarks/sfGeneral.ts dresses the snapped
  // respawn point as a hospital arrival: SF GENERAL monument + red EMERGENCY pylon (unlit lettering), ambulance bay with
  // two ambulances, a staff car park and a screened tree line. Solid props, each cluster seated on its own sampled ground.
  // ~12 small merged meshes near SF General only; no radar blip. Flag-off byte-identical. A/B docs/sf-data/founder-qa-1014.
  sfGeneralArrival: true,
  // nearestHospitalRespawn (critic N20, gtasf-ceent, LANE B server death path): WASTED/BUSTED respawns at the NEAREST of
  // four real hospitals (SF General, Saint Francis Memorial, UCSF Mission Bay, St. Mary's; shared/combat/respawn.ts) to
  // where the player went down, instead of always SF General (4.7 km from the Ferry start). Server (WorldDO.respawnAt)
  // + client fallback share the pick. Only SF General has the authored arrival dressing. Dev-on; server path: needs the
  // reviewer + an in-game Ferry death that lands downtown before prepare.ts.
  nearestHospitalRespawn: true,
  // quickDropKerb (critic N19b, gtasf-aka3g, LANE B server): the quick (event) robotaxi stops in the KERB-side lane and the
  // passenger steps 2.6 m to the kerb side onto the sidewalk, instead of any lane + a driver-side step into traffic.
  // The funding-ring guard stays (margin widened for the longer step). worker/src/world/quickRobotaxi.ts. Dev-on;
  // server path: reviewer + unit tests before prepare.ts.
  quickDropKerb: true,
  // frontFarFade (Teleoperator street-detail push, lane A): mid-distance blocks behind the Embarcadero/Market streets
  // read as MUSHY walls of periodic dark blobs. Cause (layer attribution: hiding the base walls kept it, hiding the
  // fronts removed it; full-res the blobs are a regular grid): each front floor is its own quad mapped to one storey of
  // the atlas cell, and at distance the UV inset clamp (<=24% of the span per side) makes it sample only the middle of
  // the storey row, smearing the windows into blobs. The base facade underneath has a crisp procedural window grid.
  // Dither the front panels out between 230 and 300 m (interleaved-gradient-noise discard, no pop) so the base facade
  // carries the far view; near views unchanged. web/src/render/frontFacadeMapping.ts. Flag-off byte-identical.
  // A/B docs/sf-data/front-far; phone-Low ferry on 54.2 / off 51.5 fps back-to-back (no cost). Dev-on.
  frontFarFade: true,
  // Clip the far-LOD ring to land (fixes a live aerialFarChunks visual bug). The coarse bay chunks are flat terrain
  // painted with the mapped water colour, but mountFar carries no water overlay/mirror, so open Bay renders as flat
  // tan slabs that read as land floating over the water (and waterfront landmarks like the Ferry Building sit on a
  // hard-edged tan plateau). This drops every far terrain triangle whose three vertices are all the exact mapped
  // water colour (UNORM8 26,59,105, as waterMirror detects it), keeping shorelines, and skips a chunk left with no
  // geometry — so the distant Bay recedes as open water/haze (like the reference) and ~50 pure-water chunks never
  // mount (fewer draws). One-time index rebuild per far chunk at mount; no per-frame cost. Dev ON (bug fix); reviewed.
  aerialFarClipWater: true,
  // Make the Bay read as water from the air (Teleoperator aerial gap). The streamed water surface (waterMirror.ts)
  // applies the normal warm golden-hour scene fog, so from a high aerial the whole Bay washes out to one flat
  // orange void — no sea surface, shoreline or wave sheen. This swaps the water's fog for a COOL sky-reflection
  // grey-blue (not the warm horizon) and CAPS it so some water tone always survives, plus a faint wave sheen in the
  // mid-haze band. The cool water then contrasts the warm land, so the shoreline reads. Water material only (the
  // mirror surfaces); HD + Low. Flag-off byte-identical. Dev ON; add to prepare.ts after the aerial A/B.
  bayWaterRead: true,
  // waterGrazeCap (gtasf look-gap Gap 3 vs teleoperator-reference.png): seen at the grazing angles of an aerial/elevated
  // view, the waterMirror DISTANT open-water term `mix(colour, skyColour, fresnel*(.6+.4*ripple))` lets the fresnel
  // (up to .75 at grazing) push the whole far surface to ~45-75% of the pale sky colour, so large water areas read as a
  // flat bright plane rather than deep sea. This CAPS the grazing fresnel in that open-water branch only (min(fresnel,
  // .45)), so distant water keeps >=55% of its deep steel-blue water tone and reads as sea; the near reflective mirror
  // patches (the `if` branch) are untouched, so wet near-water reflections are unchanged. One min() op; no geometry/
  // draws/textures. Flag-off byte-identical (cap .45 only ever lowers fresnel, which maxes at .75). Dev ON; add to
  // prepare.ts after the broad A/B (noon/golden, street + aerial).
  waterGrazeCap: true,
  // Authored paving on the Ferry Building plaza (gtasf look gap #2 — the spawn plaza every new player sees first).
  // The Ferry plaza deck currently renders as one flat warm-tan civic-paving tone (urbanSurfaces tile 1), so it
  // reads as a blank slab. This draws a ~1.5 m stone-paver grid straight in the Ferry surface fragment, aligned to
  // the building: the read is carried by per-paver TONE, with hairline joints that are barely darker and gone by
  // ~20 m (so no dark net), plus warm brick-band rows — fwidth anti-aliased and faded past ~28 m. Ferry surface only
  // (roads/sidewalks/terrain untouched); a few fragment ALU ops, no extra geometry/draws/textures, so phone-cheap.
  // Phone perf passed: the canonical ferry gate (which spawns on this plaza) is 60.0 fps / p95 21.9 ms with it on
  // (docs/perf/phone-ferry-paving). A/B docs/sf-data/ferry-plaza/*-ab.jpg. Dev ON; in the prod reviewed set.
  ferryPlazaPaving: true,
  // civicPaving (gtasf look gap, Union Square/SoMa street walk): the broad civic concrete surface (urbanSurfaces
  // tiles 0/1/5 — SoMa/Moscone sidewalks, FiDi, downtown plazas) renders as one flat warm-tan sheet with only a
  // tiny grain, so near-field sidewalks and plazas read as a blank slab. Only the Ferry plaza (ferryPlazaPaving)
  // and authored granite plazas got real paving. This scores the general civic paving into ~2 m slabs carried by
  // per-slab TONE (the paving read), with hairline fwidth-AA joints that are barely darker and gone by ~24 m (so
  // no dark net), faded past ~72/96 m. Skips the Ferry surface (keeps its bespoke pavers) and authored granite
  // (urbanPlaza). A few fragment ALU ops + one hash, no texture fetch/geometry/draws; HD + Low. A/B
  // docs/sf-data/ussoma-civic ({off,on}: flat tan sheet -> textured concrete slabs). Phone perf passed: ferry 60.06
  // fps / p95 22.3 ms, soma 60.02 fps / p95 19.8 ms, zero console errors (docs/perf/civicpaving-on-r2). Dev ON; in
  // the prod reviewed set.
  civicPaving: true,
  // unionSquarePlazaLow (gtasf look gap, Union Square street walk): two bugs left Union Square reading as a flat
  // green lawn, worst on phone. (1) The authored plaza block (rect registration + Dewey column / palms / benches) is
  // gated on `polish` in createStreetPropLayout, which needs the HD preset (graphicsV2Hd), so on the phone/Low gate
  // device nothing placed and the ground never registered as a plaza. (2) Even on HD the ground stayed green: the
  // plaza->granite conversion only fired for mapped-lawn tiles (urbanTileIn>6.5), but Union Square's lawn is baked
  // with a non-park green that classifies as tile -1 (unclassified), so the gate never matched it. This flag (a)
  // runs the Union Square block on Low too, and (b) extends the granite conversion to unclassified ground (tile<-0.5)
  // inside the registered plaza rect — so the ground becomes granite on BOTH HD and Low. Rect-scoped (only inside
  // Union Square's rect); civic paving/roads (tiles 0-6) untouched. A handful of props + the existing granite shader.
  // Flag-off byte-identical. A/B docs/sf-data/us-plaza-low. Add to prepare.ts after the phone A/B + perf.
  unionSquarePlazaLow: true,
  // Aerial road read (gtasf look gap vs docs/sf-data/teleoperator-reference.png at ~150 m flyover height). The worn
  // asphalt is near-black, so from the title flyover over Mission/SoMa the streets read as black voids between the
  // lit buildings and light sidewalks. This lifts only the ASPHALT branch of the road shader toward a mid grey,
  // gated on 3D view distance (~70→180 m) so near street-level asphalt is untouched and only the aerial/distant road
  // surface greys up. One smoothstep+mix in the fragment; no geometry/draws. A/B docs/sf-data/aerial-road/ (Mission
  // + SoMa — wide streets go from black voids to mid-grey). Phone perf passed: ferry gate 60.2 fps / p95 21.1 ms
  // with it on (docs/perf/phone-aerial-road). Dev ON; in the prod reviewed set.
  aerialRoadRead: true,
  // Green residential block interiors (gtasf look gap vs the reference's green block interiors). From above, the
  // ground inside residential blocks (back/front yards, the urban-ground tile-0) renders as flat tan paving, so Noe/
  // Haight blocks read as tan dirt between the houses instead of the reference's green yards. In a residential block
  // the carriageway and the backyards are the SAME tile-0 terrain surface (residential streets have no separate
  // asphalt road mesh), so tinting tile-0 greens the STREET too. Fix: a per-chunk distance-to-nearest-road mask
  // (urbanRoadMask.ts, a coarse 64x64 DataTexture built at mount from the chunk's nearestRoad query) gates the green
  // so it applies ONLY where the ground is (a) residential urban-ground (vResGround, the district vertex colour) AND
  // (b) past the carriageway+sidewalk (roadDist > ~threshold); streets and sidewalks stay grey. Runtime-only, no
  // re-bake: the mask is built only for chunks touching a residential district (others bind a 1x1 all-zero mask) and
  // freed on unload. One extra branch + one small texture fetch in the terrain fragment; no geometry/draws. Default
  // OFF pending the aerial + street A/B (docs/sf-data/block-interior/mask-{before,after}-*.jpg) and the Haight phone
  // perf gate (the mask grid is built where this is on). [gtasf-e4ev] A/B passed (docs/sf-data/block-interior/
  // mask-{before,after}-*.jpg): phone aerial block interiors clearly go tan->green with streets/sidewalks staying
  // grey, desktop aerial a modest-but-correct read (dense rowhouses occlude interiors at the oblique angle),
  // street-level carriageway unchanged (the exact pose the shader-only dead-end greened). Haight phone perf passed
  // 60.0 fps / p95 21 ms, 0 errors (docs/perf/phone-e4ev-haight-on). Dev ON; in the prod reviewed set.
  residentialBlockGreens: true,
  // Denser residential street-tree canopy (gtasf look gap vs the reference's leafy Mission/Noe/Haight blocks). Two
  // levers, both gated here: (1) procedural FILL trees along residential (LEAFY_RESIDENTIAL) sidewalks between the
  // real DataSF trees (crowded(6) keeps them off existing trees/poles; real=true so they ground-sample at mount on
  // hilly blocks); (2) a raised per-kind tree instance budget (streetProps capacity 240->384 HD / 90->140 low) so
  // more of both render — the near-first staging was dropping the distant canopy (verified: ~644 -> ~998 rendered
  // tree instances at Haight, +55%). Effect is a modest, street-dependent leafiness bump (clearest on already-treed
  // residential streets like Noe 24th; the aerial reads only a little leafier). Default OFF — did NOT pass the
  // founder/orchestrator look-check at 14:45; raised-capacity phone perf not re-gated yet. A/B same-pose
  // docs/sf-data/res-trees/res-trees-*-ab.jpg.
  // 2026-10-11 (gtasf-t4q5): added a new lever the earlier subtle attempt lacked -- fuller/more-mature tree
  // canopies (streetProps width x1.32 / height x1.22, canopy only, perf-safe). A fresh same-pose A/B
  // (docs/sf-data/leafy/haight-aerial-*) shows the DOMINANT gap (the residential AERIAL "open ground" read) is
  // STILL unmoved: SF blocks are rooftop-dominated from above and billboard street trees do not register as
  // canopy mass there -- the same conclusion the two prior attempts reached. Canopy lever kept in code (improves
  // the look at street level), but the flag stays OFF: denser/bigger billboard street trees are not the fix for
  // the aerial gap. The real lever is block-INTERIOR canopy MASS (backyard trees, where the reference's green
  // actually sits) or a non-billboard canopy -- a bigger art task, tracked separately.
  denseResidentialTrees: false,
  // Rear-yard tree clumps (gtasf-6x2e, gtasf look gap vs the reference's leafy residential blocks — real SF canopy
  // sits in the BACKYARDS, not on the sidewalk). In LEAFY_RESIDENTIAL districts, createStreetPropLayout drops a
  // sparse clump of 2-3 trees deep inside the block interior (~26 m past the kerb-normal), gated by a nearest-road
  // distance query (createRoadSnapper) so a clump only lands in a genuine mid-block backyard (roadDist > 18 m, past
  // the carriageway+sidewalk and not on an adjacent street); narrow/irregular blocks reject. Both sides, hash-gated
  // to a fraction of pole segments so it stays "a few clumps", not a forest. Trees are real=true (ground-sampled at
  // mount on hills) and reuse streetTreeKind + the shared street-tree instance pool. REUSES the denseResidentialTrees
  // raised per-kind capacity path (streetProps 240->384 HD / 90->140 low) for headroom WITHOUT enabling
  // denseResidentialTrees itself (its sidewalk fill was look-rejected). EVALUATED (gtasf-6x2e): the clumps DO
  // render (window.__gtasfTrees, ~+24 yard sites in view, +54 trees total once the cap bump lands), but at the
  // oblique golden-hour aerials they read SUBTLE and are hard to separate from the existing DataSF street trees,
  // while the shared capacity bump pushes the Haight phone gate to the edge (59.48 fps raw; 60.04 only on a
  // rerun). Not worth the phone perf for that subtle a gain, so it stays OFF (NOT in the reviewed set). Revisit
  // only after a phone perf-headroom pass on the residential render path. [gtasf-6x2e]
  residentialYardTrees: false,
  // Block-interior canopy MASS for the residential AERIAL leafiness gap (gtasf-cf1a). The prior tree attempts
  // (denseResidentialTrees, residentialYardTrees, the fuller-canopy lever) all read SUBTLE from the aerial
  // because SF blocks are rooftop-dominated and the vertical crossed-card STREET trees read edge-on (thin) from
  // above. The reference's green actually sits in the block INTERIORS (backyards). blockCanopy.ts scatters
  // instanced canopy "blobs" through residential block interiors (grid-sampled where roadDist > 14 m and NOT
  // inside a building footprint, LEAFY_RESIDENTIAL districts only -- i.e. exactly where residentialBlockGreens
  // already greens the ground), each a crossed-card tree plus a HORIZONTAL canopy cap so it reads as green
  // canopy mass from the oblique aerial. Backyards are hidden from the street by the row houses, so this is an
  // aerial lever. Instanced (one mesh per chunk, shared geometry/material, alphaTest no-blend), density + per-
  // chunk cap lower on phone. A new per-chunk system mounted beside urbanSurfaces. Add to prepare.ts once the
  // reference-low-aerial A/B (desktop + phone) and phone perf (haight-props + ferry) pass. [gtasf-cf1a]
  blockInteriorCanopy: true,
  // Ground-contact ambient occlusion / contact shadows at building bases (gtasf look-gap item 5: "soft shadows
  // / AO where buildings meet the ground"). The terrain/road/kerb surface shader darkens the ground where it
  // hugs a building footprint, grounding the buildings and adding the depth the flat-lit scene lacks vs the
  // Teleoperator reference. Driven by a coarse per-chunk distance-to-nearest-building-edge mask
  // (urbanContactMask.ts, built once at mount from the chunk's own footprints, like the residentialBlockGreens
  // road mask) sampled in the existing urbanSurfaces shader (one texture fetch + a smoothstep; no new draw
  // calls, no new passes), so it runs on HD AND phone/Low (polish=graphicsV2 path). The darkening multiplies
  // diffuseColor near the wall (AO floor ~0.66) and fades out by ~6 m. Off keeps the ground flat-lit. Dev ON;
  // add to prepare.ts once the A/B (desktop + phone, aerial + street) and phone perf pass. [gtasf-a13b]
  groundContactAO: true,
  // Fix a pre-existing PHONE/Low defect: the urbanSurfaces road carriageway renders near-black on Low (dark
  // asphalt albedo + Low has no IBL and no tonemapping), so the near road reads as a jagged near-black slab
  // against the lighter sidewalks, much darker than the distant road (which aerialRoadRead greys past ~70 m on
  // the separate roadTextures arterial path). This lifts the Low urbanSurfaces road toward a legible asphalt
  // grey at ALL distances (floor its albedo, mirroring aerialRoadRead's max(color, ~0.30)), so streets read as
  // streets on phone. Roads only (sidewalks/terrain are already legible); HD is untouched (it stays dark via
  // PBR + IBL) and flag-off keeps the current behaviour. Dev ON; add to prepare.ts after the phone A/B + perf.
  // [gtasf-hkka]
  legibleLowRoads: true,
  // Parks read as varied landscaping instead of one vivid flat lawn (gtasf spawn walk-around gap; the Embarcadero
  // median is the first green a new player sees). Mapped park/grass terrain bakes to a single saturated green
  // ([0.26,0.42,0.21], urbanSurfaces tile 7) and the lawn shader only brightness-mottles it, so from the street it
  // reads as a flat video-game lawn. With this ON the park branch recolours across three desaturated, natural
  // greens — mown lawn, drier yellow-green and shrub/hedge beds — selected by the SAME three lawn noises the branch
  // already fetches (no added shader cost), with a soft mowing stripe. Dry-hillside ground (tile 8) is untouched,
  // as are HD-only paths; this runs on HD and Low alike (polish=graphicsV2). Flag-off is byte-identical. Dev ON;
  // add to prepare.ts after the phone A/B (Embarcadero median + a real park) + ferry perf.
  richParkGreens: true,
  // Dolores Park reads as a specific place, not a flat green slab (founder Mission walk gap). Unlike the
  // Embarcadero median, Dolores is baked with the castro/mission district park green ([0.23,0.43,0.18]), which
  // does NOT match the tile-7 classifier, so it classifies as unclassified ground and gets NO lawn treatment at
  // all (not even richParkGreens) -- it renders as the raw flat baked green. With this ON a Dolores-scoped branch,
  // keyed to the park's world-space rectangle (centre ~(-1634,2703), 108x296 m, grid rotated ~3deg) and firing on
  // unclassified/park ground inside it, recolours the grass across large-scale section tone (deep mown green <->
  // sun-dried yellow-green) with trampled worn-grass/dirt sitting patches. Grass only: the park's footpaths are
  // separate roads* meshes, untouched, and read clearly once the lawn around them is varied. A few extra noise
  // evals, zero texture fetch, no geometry/draw calls, so it runs on HD and Low alike and conforms to the park's
  // slope (the terrain's own surface). Edge-feathered. Flag-off is byte-identical. Dev ON; add to prepare.ts
  // after the aerial + phone A/B + phone perf.
  doloresPark: true,
  // Alamo Square reads as a specific place, not a flat green slab (founder Alamo Square walk; completes the Painted
  // Ladies postcard -- the lawn the row sits above). Same root cause as Dolores: Alamo Square is baked with the
  // western-addition district park green ([0.16,0.33,0.10]), which does NOT match the tile-7 classifier, so it is
  // unclassified ground and gets no lawn treatment (not even richParkGreens) -- a raw flat slab. With this ON an
  // Alamo-scoped branch, keyed to the square's world-space rectangle (centre ~(-2272,864), 154x170 m, grid rotated
  // ~7deg) and firing on unclassified/park ground inside it, recolours the grass across section tone (deep mown
  // green <-> drier) with gentle worn patches -- a touch lusher/less-worn than Dolores since the square is better
  // kept. Grass only; the square's footpaths are separate roads* meshes, untouched. A few noise evals, zero texture
  // fetch, no geometry/draw calls; HD + Low; conforms to the hilltop slope. Edge-feathered. Flag-off byte-identical.
  // Dev ON; add to prepare.ts after the A/B + phone perf.
  alamoSquareGreens: true,
  // districtParkGreens: the SAME district-override-park-slab fix (see doloresPark/alamoSquareGreens), generalised to
  // a registry so the remaining confirmed-flat neighbourhood parks get varied landscaping in one place instead of a
  // per-park copy. Covers Lafayette Park and Alta Plaza Park (both Pacific Heights, baked [.17,.34,.11]) and the
  // Panhandle (Haight-Ashbury, baked [.20,.37,.15]) -- all district-override greens that do NOT match the tile-7
  // classifier, so they render as raw flat slabs with no lawn treatment at all. Each park is a world-space rectangle
  // (centre/axes/half-extents from its block corners) firing on unclassified/park ground inside it, recoloured across
  // section tone (deep mown green <-> drier yellow-green) with gentle worn patches, lush/low-wear palettes for these
  // well-kept parks. Washington Square is deliberately EXCLUDED: it is baked with the DEFAULT park green, classifies
  // as tile-7 and already gets richParkGreens, so it is not a flat slab. Grass only; footpaths are separate roads*
  // meshes, untouched. A few noise evals per park, zero texture fetch, no geometry/draw calls; HD + Low. The registry
  // (web/src/render/urbanSurfaces.ts) also drives the doloresPark/alamoSquareGreens entries from one template, so all
  // five district-park slabs share one code path. Flag-off byte-identical. Dev ON; add to prepare.ts after A/B + perf.
  districtParkGreens: true,
  // Worn road paint on Low, matching HD (gtasf spawn walk-around gap). The HD "worn paint" treatment
  // (roads.ts, hdPolish only) fades lane/crosswalk paint with a wear-noise + camera-distance mask so markings
  // read as weathered, not solid. On Low (phone) that treatment is skipped, so the generated yellow/white paint
  // renders at full texture brightness with no tonemap — a tangle of neon markings at junctions, the brightest
  // thing in the first-60s spawn view. With this ON the Low paint materials get the same wear fade plus a small
  // brightness mute, so markings read as worn paint. Paint materials only (asphalt/terrain untouched); HD
  // unchanged. Flag-off is byte-identical. Dev ON; add to prepare.ts after the phone A/B + ferry perf.
  legibleLowPaint: true,
  // No pure-black vehicles on Low (founder review of the spawn walk-around). The Low ps2 path has no IBL/ambient
  // lift, so a parked car's body/glass face turned away from the sun collapses to pure black — a near-black blob
  // when the car sits right against the camera (HD keeps it a dark grey). This adds a small emissive floor to the
  // PS2 vehicle materials on Low (polishVehicle) so shadow-side faces stay a dark-but-legible vehicle shape. Low
  // only; HD byte-identical. Flag-off byte-identical. Dev ON; add to prepare.ts after the phone check.
  legibleLowVehicles: true,
  // Dense flower colour on the Lombard crooked-street beds (gtasf look gap #1). The hydrangea garden
  // (lombardFlowers.ts) already instances florets, but tints them with pale pastels (#ddb4cc etc.) over a cream
  // petal card, so from the street the famous beds read as flat green. This swaps in a vivid hydrangea palette
  // (deep blue, magenta, violet, hot pink, white) and plants one extra, slightly larger bloom per bed, so the
  // switchbacks carry dense colour like the real Lombard. Instanced (no new draw calls); the extra florets are a
  // bounded per-bed count, HD gets a touch more than Low. Default OFF pending the founder's look
  // (docs/sf-data/lombard-flowers/*-ab.jpg). NOTE: only has any effect when lombardFlowers is on, which the founder
  // explicitly dropped from the playtest — so this stays OFF and out of the prod allowlist until the founder
  // re-approves the Lombard beds. Dormant enhancement, ready to flip on with lombardFlowers.
  lombardFlowerColour: false,
  // Optional alternate colour grade (gtasf, founder A/B vs the vivid default): a desaturated, soft, overcast
  // grey-warm film look toward docs/sf-data/teleoperator-reference.png — lower contrast, warmth pulled back off
  // the orange, saturation well down (sky/grade.ts FILMIC_OVERCAST_GRADE). Swaps only the post-grade preset, so
  // the sky/sun/geometry are unchanged. Default OFF: the shipped PLATEAU look is untouched (post.test.ts still
  // passes). This exists purely so the founder can pick the mood from photos (docs/sf-data/filmic-grade/).
  filmicOvercast: false,
  // referenceGrade (GTA V gap critique #5, lane A; orchestrator decision 2026-10-15: drop the vivid lock): the default
  // look moves from the pumpkin golden hour / clear-blue noon toward docs/sf-data/teleoperator-reference.png. A final
  // stage in the post composite (HD + Low, web/src/render/post.ts REFERENCE_GRADE) removes ~half the per-time tint's
  // hue, split-tones a cool blue-grey shadow side against warm-neutral highlights, lifts blacks (slightly blue), and
  // drops saturation ~14% and contrast ~2% (first A/B at -20%/-8% read milky). No extra pass or texture. Off = vivid (the
  // "vivid" toggle). post.test.ts covers both. A/B docs/sf-data/reference-grade (Ferry golden + noon, FiDi, phone): passes. Dev-on; ready for prepare.ts.
  referenceGrade: true,
  // rainOvercast (GTA V gap critique #14, lane A): rain already greys the sky and drops the sun, but the post tint kept
  // the time-of-day orange, so rain read as streaks over a sunny pumpkin frame. Under rain (live feed or ?rain=) the
  // tint lerps to a cool overcast neutral and drops ~0.6 EV, and the haze/fog + clouds pull to a blue-grey
  // (web/src/render/foundation.ts). Wet roads stay on the existing wetRoads path. No cost. Off = byte-identical.
  // A/B docs/sf-data/rain-overcast (?rain=1, golden): passes. Dev-on; ready for prepare.ts.
  rainOvercast: true,
  // broadwayNeon (GTA V gap critique #15, lane A; night look is lane D's nightWarmth): North Beach's Broadway strip
  // (Columbus -> Kearny) is SF's neon street but read like any block at night. Eight neon blade signs (stacked letters,
  // both faces) + four fascia signs on the real DataSF facade lines, generic words only, in ONE unlit mesh (MeshBasic,
  // toneMapped off: bright on HD + Low) plus one lit backing mesh. web/src/render/landmarks/broadwayNeon.ts. Off =
  // not added. A/B docs/sf-data/broadway-neon (night + golden, phone): passes. Dev-on; ready for prepare.ts.
  broadwayNeon: true,
  // marketNeon (GTA V gap critique #15, lane D): mid-Market 5th -> 7th, SF's old theatre row, read as a dark wide street at
  // night. Twelve blade signs + three fascias (generic words) on the 120 ft facade lines, clear of the OSM cross streets,
  // built with broadwayNeon's createNeonStrip (one UNLIT mesh + lit backing). web/src/render/landmarks/marketNeon.ts.
  // Off = not added. Dev-on. Night A/B passes (docs/sf-data/market-neon); in-view cost 1.5-3.5 fps on the headless phone
  // harness, so prepare.ts only after the Ferry phone gate with it on + a reviewer call.
  marketNeon: true,
  // marketNeonLazy (#6.43 cold-READY split 1, 10-19: the night bundle read +5.6 s, bimodal): marketNeon leaves the pre-READY
  // landmark build and mounts once the camera is within 700 m of mid-Market (main.ts). Needs marketNeon. Off = built at boot.
  marketNeonLazy: true,
  // meshyTierDress (critique 20c reopened, lane D, gtasf-4vgje): the prod player's Meshy body never showed the round tier
  // (its clothes are baked; the fitted garment kit is template-only), so an unlock changed nothing visible. This dresses the
  // SAME body in a chunky tier garment on the Chest bone (Seed vest -> Series A navy + lapels + watch -> ... ; tierDress.ts),
  // for the local player and remotes (their relayed stageRound). Off = no garment on Meshy bodies (today).
  meshyTierDress: true,
  // shoreSeams (critic openingDrive #4, lane A): blue seams on the Embarcadero between Howard and the Ferry. Two causes,
  // both seen on the published map: (1) shoreline terrain baked with the water colour (UNORM8 26,59,105) sits 0.1-2 m
  // above the bay plane (-0.4 m), so it renders as lit pale-blue wedges; (2) slivers in the ground show the 60 km bay
  // plane through them as blue hairlines. Fix: (1) the terrain vertex shader drops sea-level water vertices to -6 m
  // (under the plane, which becomes the water; a level waterline, no discard) and the fragment removes the blue from the
  // land side of shoreline triangles; (2) the bay plane takes a coastline land mask and, within 450 m, renders over land
  // as a daylight-scaled ground tone; it draws after the opaques so the fetch only runs on visible pixels.
  // web/src/render/{urbanSurfaces,bayWater}.ts. Off = byte-identical. A/B + phone perf (~1 fps, = off)
  // docs/sf-data/shore-seams. Leftover: one pier/seawall water gap by the Ferry is map data (bake follow-up).
  shoreSeams: true,
  // noonClearHaze (critic openingDrive #3, lane A): at clear noon the street-level distanceHaze pull-in (fog far x0.70,
  // ~570 m) fully hazed the Ferry Building from the opening drive (~600 m), so the first drive read bleached. High
  // clear sun now relaxes the pull-in back to the grade's fog far (~820 m). The window is the same as neutralDaylight,
  // so golden hour and night keep their veil, and cloud or rain restore it. Fog density only: camera.far is unchanged,
  // so it costs no fps. web/src/render/foundation.ts. Off = byte-identical. A/B docs/sf-data/noon-haze.
  noonClearHaze: true,
  // lowStorefrontGlow (GTA V gap critique #15 night, lane A): at night on phone Low the street ground floors were dark,
  // because HD leaves the 0-3.6 m storefront storey to the box facade's lit shop band, but Low's photo front panels
  // cover it. The Low ground-floor street storefront quad (same styles/walls as the HD rule) now glows warm: interior
  // light in the photo's dark glazing plus a soft spill, with ~80% of ~6 m shops open. One vertex attribute and a few
  // ALU ops on Low front panels; HD is unchanged. web/src/render/frontFacadeMapping.ts. Off = byte-identical.
  // A/B docs/sf-data/low-storefronts.
  lowStorefrontGlow: true,
  // Sequenced post-READY mount (gtasf-3k35 part b). The whole-city scenery builds (street props,
  // parody billboards, road details) and the radar canvas redraw all run on the main loop every frame,
  // so during the ~15-25 s-after-READY mount burst several do their heavy slice in the SAME frame — the
  // profiled pile-up (haight-props baseline: a 754 ms frame plus a cluster of 115-380 ms frames right
  // before props draw). With this on, a tiny per-frame scheduler (web/src/render/mountScheduler.ts) lets
  // only ONE of those heavy stages advance per frame, so their slices never stack. Byte-identical
  // placement/look (pure scheduling); no-op when off. HELD OFF — NEUTRAL: runtime profiling disproved the
  // premise. The 754-860 ms mount frame is NOT the gated builder stages (those run in a worker / are 2 ms
  // sliced) but `createMapRouter` (web/src/radar/routing.ts, a ~412 ms SYNCHRONOUS whole-city routing-index
  // build on the full-graph swap) + pedestrians graph build + the radar Path2D index. So this scheduler
  // gates the wrong stages and does not flatten the pile-up (haight-props max 754->860 ms, noise). Kept
  // off; the scaffold is reusable if a future fix slices createMapRouter. [gtasf-3k35]
  sequencedMount: false,
  // Incremental (idle-sliced) whole-city routing-index build (gtasf-a989). createMapRouter builds the radar's
  // routing index (nodes map + directed adjacency + lane spatial grid) in ONE synchronous pass — ~412 ms on the
  // 4x-throttled phone / ~135 ms desktop — which lands as a single blocking frame in the post-READY mount burst
  // (profiled share of the ~754-860 ms haight-props hitch). With this ON, radar.ts builds the SAME index through
  // createMapRouterIncremental, a generator yielding every ~6 ms (MAP_ROUTER_SLICE_MS), driven across idle
  // callbacks/frames so no single frame does the whole build. The index and every route are byte-identical to the
  // sync path (one shared build code path; a unit test asserts incremental==sync); only WHEN the work happens
  // changes. Availability is unchanged: the radar has no prior/near-graph router, so `router` is undefined until
  // the build finishes exactly as today — route requests meanwhile show "loading roads…" and replan on completion,
  // just resolved a little later in wall-clock. VERIFIED: longest contiguous build slice 206 ms -> 27.7 ms on the
  // 4x-throttled phone (no build frame >150 ms), haight-props worst frame 809.8 -> 423.4 ms; Ferry unregressed
  // (60.1 fps); routes byte-identical (unit test + offline SF-graph run); nav smoke routed correctly (minimap route
  // line, J-panel GO, /go/lombard road route). Dev ON; in the prod reviewed set. [gtasf-a989]
  asyncMapRouter: true,
  // Whole-city routing index BUILD in a Web Worker (gtasf-fddi). asyncMapRouter above still builds the index
  // (nodes map + directed adjacency + lane spatial grid) ON the main thread — ~261 ms (4x-throttled phone) —
  // and even idle-sliced those slices smear into the post-READY steady window. With this ON, radar.ts spawns
  // routing.worker.ts, which fetches the SAME route-graph JSON, runs buildRouterStructures off-main (so the
  // main thread does ZERO index-build work), and streams the plain-data structures back (typed arrays as
  // transferables, nodes/outgoing/cells as batched entries so each deserialize task stays small). The main
  // thread then calls assembleMapRouter over its own graph copy — edge order is identical (same JSON file), so
  // the structures' edge INDICES line up and every route is byte-identical to createMapRouter (a unit test
  // asserts assembleMapRouter(graph, buildRouterStructures(graph))==createMapRouter(graph)). Availability is
  // unchanged: `router` stays undefined until assembly completes, exactly as today (route requests show
  // "loading roads…" and replan on completion). Falls back to the asyncMapRouter/sync on-main path on any
  // worker error (spawn/fetch/parse/onerror) and when there is no fetch URL (options.routeGraph override), so
  // routing is never left dead. Precedence: routingWorker > asyncMapRouter > sync. Takes effect only where
  // `Worker` exists (browser). route() stays synchronous on main; only the index build moves.
  // CAVEAT — currently INERT IN THE REAL APP: main.ts (createRadar) passes `routeGraph` (the in-memory
  // world.routingGraph), never `routeGraphUrl`, so the worker's fetch URL is undefined and the driver falls
  // through to the on-main path. Enabling this flag is therefore a NO-OP in production as wired (it only runs
  // the worker in URL-driven contexts like radar/check.ts). Making it move the ~261 ms build off main needs
  // one of: (a) rewiring radar/main to URL-drive routing AND proving the fetched JSON's edge order is
  // byte-identical to world.routingGraph (the collision-audited connected component) — a navigation-critical
  // correctness risk; or (b) posting the in-memory graph to the worker, whose structured clone of the
  // multi-MB graph is a non-sliceable ~150-300 ms main-thread frame that likely negates the build it saves.
  // The routing index is "worker-hard" for exactly these reasons; this flag + routing.worker.ts are safe,
  // byte-identical groundwork (a unit test asserts assembleMapRouter(graph, buildRouterStructures(graph)) ==
  // createMapRouter(graph)), not yet a shipped win. Not added to prepare.ts (ships OFF). [gtasf-fddi]
  routingWorker: false,
  // Cheaper coarse building-collision INDEX CONSTRUCTION (gtasf-3k35 part a). Runtime profiling DISPROVED
  // the "a single collides query is 100-333 ms" premise: the query is cheap (~3.3 candidates/query, 1469
  // triangle tests across 160k queries, 0.5% of a haight-props profile). The real per-coarse-chunk-mount
  // cost is StructureCollisionIndex.setChunk: ~824 ms of triangle extraction across 9 chunks PLUS a full
  // re-bucket of every accumulated triangle on EVERY setChunk/removeChunk (~213 ms churn, near-quadratic as
  // coarse chunks stream in). This makes the bucketing INCREMENTAL — a chunk's faces are added to / removed
  // from the existing cell grid instead of rebuilding the whole grid — so construction is linear, not
  // quadratic. Collision RESULTS are identical (same cells, same faces; collides() is unchanged), so prop
  // placement and camera/player collision are byte-identical — verified by a same-pose look check
  // (docs/sf-data/mount-collision/: settled prop counts identical, no props in buildings/roads), a unit
  // test proving incremental==full across add/remove/re-set, and byte-equal live triangleTests. Saves
  // ~165 ms main-thread CPU across the Haight mount (coarse rebuildMs 213->48). Off keeps the full-rebuild
  // path. Dev ON; in the prod reviewed set. [gtasf-3k35]
  fastStructureCollision: true,
  // Slice the radar's minimap road-tile build across idle callbacks instead of one blocking frame (gtasf-347x).
  // radar.ts caches every city road edge as per-256 m-tile Path2D geometry (roadTiles) so the canvas transform
  // can redraw the whole network each frame without reprojecting vertices. That build walks EVERY graph edge and
  // runs lazily on the first draw — ~400 ms (4x-throttled phone) as a single blocking frame in the post-READY
  // mount burst (the real ~400 ms MAX stutter that the asyncMapRouter work did not cover: buildRoadTiles lands
  // just before propsDrawn, so it is the largest remaining mount frame). With this ON the SAME per-edge
  // accumulation (addRoadEdge, one shared code path) runs as a self-timed generator yielding every ~6 ms
  // (ROAD_TILE_SLICE_MS), driven across requestIdleCallback (timeout 400 ms) so no single frame absorbs the whole
  // build. Tile geometry is byte-identical to the sync path (same edges, same order, same Path2D ops); only WHEN
  // the work happens changes. The minimap draws whatever tiles have landed (it redraws on its own 60-100 ms
  // cadence), so roads fill in over a few idle slices instead of popping after a stall; completion forces one
  // repaint. Lazy trigger (first draw) and the graph-upgrade rebuild are preserved. Off keeps the single
  // synchronous buildRoadTiles. Dev ON; in the prod reviewed set. [gtasf-347x]
  slicedRoadTiles: true,
  // Founder ladder (docs/PLAN-founder-ladder.md, founder-approved 2026-10-12; gtasf-founder-ladder-p1-ilnl):
  // the one-obvious-path onboarding — spawn → found your startup (generated name + reroll) → your startup on
  // an Embarcadero billboard within 60 s → share card → valuation as the HUD score. A/B against the current
  // onboarding, 50/50 on NEW devices only (returning players keep the normal game). Everything is gated here at
  // the founder-ladder entry points, so with this OFF the build is byte-inert and the current onboarding runs
  // for everyone. OFF until each step has desktop + phone look evidence (docs/sf-data/founder-ladder/); add to
  // prepare.ts's reviewed set only once that phone evidence is in. [gtasf-founder-ladder-p1-ilnl]
  founderLadder: false,
  // LANE C GTA V critique #13 (gtasf-action-opening): the founder ladder's first minutes in-world instead of a modal chain
  // — found with the generated startup name (no naming modal; rename in Game options), no share card, the Pre-seed
  // and Seed pitches are bottom-of-screen conversations with a GTA-style cheque count-up, and the Seed step is a DRIVE
  // to First Round (GPS; robotaxi still offered). Every money call is identical (same pitch endpoints + line indexes).
  // Needs founderLadder + pitching. Dev-on; prod-off until a look/funnel check.
  actionOpening: true,
  // LANE C GTA V critique #13 (orchestrator 2026-10-15, gtasf-8c8wo): the opening starts IN A CAR — a new player (no deep
  // link, not yet founded) spawns on the Embarcadero at Howard St (FOUNDER_OPENING_DRIVE_START), the server seats them in
  // an opening car (C2S OPENING_CAR: on the nearest road, once per session, only at the start; no wanted, no money), the
  // billboard reveal plays, then "Drive to Pear VC" with GPS to the plaza partner, whose pitch conversation is unchanged.
  // Needs actionOpening + founderLadder + driving. Dev-on; prod-off until a look/funnel check.
  openingDrive: true,
  // LANE C guided GTA-style opener (gtasf-dzrrn, plan velvety-tickling-ripple item 2): a ~20 s skippable first mission for a
  // device that hasn't seen it (new devices + once for returning ones; localStorage gtasf.opener.v1): on foot at the Ferry,
  // the Pear VC partner rings (text-only call: portrait + subtitles) → walk (WASD) → get in the highlighted car (beam,
  // minimap waypoint, E key cap) → drive to the partner, who now waits ~370 m down the Embarcadero (FOUNDER_OPENER_ANGEL;
  // the worker's voice-pitch spot moves with it), then the existing walk-up pitch. Plus a persistent controls panel
  // (WASD/Shift/E/Space, F/right-mouse/Z when combat is on), dismissible + remembered. Replaces openingDrive's in-car spawn
  // while on. No money-path change. Needs founderLadder + actionOpening + pitching + driving + hud. Dev-on; prod waits
  // for the P0 load-time fix, then prepare.ts.
  guidedOpener: true,
  // LANE C GTA V critique #20 (gtasf-founder-rank): a Founder Rank — XP from jobs, the heist, pitches, side quests,
  // pilgrimages, crimes, bounties, event cheques and fund drops, counted READ-ONLY from the season ledgers (no new money
  // or writes; GET /api/funding/rank) -> level + title on the crown chip and a RANK UP notice. Dev-on, prod-off.
  founderRank: true,
  // LANE C GTA V critique #20 slice 2: a personal car — the last road car you DROVE and left is yours: saved per device
  // (D1 personal_cars, migration 0051), never swept while you're online, parked where you left it when you come back,
  // a "your car" radar blip, and "Deliver my car" (nearest road, 60 s cooldown) in the jobs phone. No money. Needs
  // `driving`; single-world only (off under zonedWorld). Dev-on, prod-off.
  personalCar: true,
  // garageSlots (critique 20e, lane C, gtasf-n1bns; docs/PLAN-garage.md): extra saved-car slots on top of personalCar — slots
  // grow with the funding look tier (1/2/3/4), 'Keep this car' fills slots 1+, each reached tier gifts a car once. Server path
  // (D1 garage_cars/garage_gifts, migration 0054; WorldDO delivery with the reviewer's 7 conditions). OFF until the WorldDO +
  // phone wiring and the reviewer pass land.
  garageSlots: false,
  // gtasf-l9j3r (critic note 1 on taxiFareJob, 'the fare is invisible'): the Drive a Fare passenger — a rigged NPC waits at
  // the Ferry taxi stand, walks to the player's passenger door when the car pulls up, rides in the front passenger seat
  // (translucent glass), and steps out at Union Square. Client-only presentation inside taxiFareJob (no money path). Dev-on.
  taxiFarePassenger: true,
  // critic N34: MISSION PASSED, the JOB DONE / cheque payout card and RANK UP fired together and overprinted into one block.
  // They now take turns in one centre slot (web/src/hud/centerSlot.ts): band first, then the card, then RANK UP; an item
  // alone keeps its duration, with one waiting it gives way after 1.4 s. The taxi fare holds the slot until the fare is out.
  // Client-only presentation. Dev-on.
  centerSlotQueue: true,
  // Founder ladder phase 5 (docs/PLAN-founder-ladder-phase5.md; gtasf-ldlm): free-roam meme-NPC side
  // quests — fictional archetypes (never real people) that pay valuation. Gates the NPC render + quest
  // interaction. OFF until each quest's money path is reviewed and it has desktop + phone look evidence;
  // enable per-quest, not all at once.
  memeQuests: false,
  // Founder ladder phase 5.1 (gtasf-ldlm): the Robotaxi-protester "escape the cone" DRIVE quest — a
  // per-quest sub-gate under memeQuests so this verb can ship separately from the pitch quests (per the
  // "enable per-quest, not all at once" note). Gates the drive NPC's render + the /api/funding/drive-*
  // endpoints. OFF until the founder reviews DRIVE_QUEST_PAYOUT_CENTS and it has look evidence.
  driveQuest: false,
  // Founder ladder phase 5.1 (gtasf-ldlm): the Thought-leader "repost my take" SHARE quest — a per-quest
  // sub-gate under memeQuests. Gates the share NPC's render + the /api/funding/share-claim endpoint. ⚠️ its
  // credit is client-trust (unverifiable), so OFF until the founder approves the approach + SHARE_QUEST_PAYOUT_CENTS.
  shareQuest: false,
  // Founder ladder phase 6 (docs/PLAN-founder-ladder-phase6.md; gtasf-ldlm): the Series A round quest — Demo
  // Day at a FICTIONAL hacker house (no real accelerator). Gates the Series A pitch route in handlePitchTap
  // (vcId === FOUNDER_SERIES_A_ID → founderSeriesATarget + the Series A valuation floor) plus the client
  // Demo Day step + venue/followers. Sub-gate under founderLadder. OFF until the money path is reviewed and it
  // has desktop + phone look evidence (Demo Day card + Series A cheque + Bay Bridge billboard + the followers).
  seriesAQuest: false,
  // GTA V pivot — LANE B: COMBAT & POLICE (docs/PLAN-gta-pivot.md section B; pane GTASF:0.2). Master gate for
  // the combat subsystem: the 18+ click-through gate, the health/armour HUD, death → WASTED → respawn at SF
  // General (−2% valuation, min $1k) and busted (−5%). Both death costs are SERVER-authoritative money paths
  // (worker) with unit tests. With this OFF the client renders the current HUD unchanged (no health/armour, no
  // 18+ gate) and the server applies no death/busted valuation costs — byte-inert. Weapons, server-validated
  // hits, wanted/SFPD, carjacking, gun shop, store robberies and PvP each land behind their OWN sub-flag added
  // with their feature. OFF until desktop + phone Low evidence (docs/sf-data/combat/) and the orchestrator's
  // server/money review; add to prepare.ts's reviewed set only then. [gtasf-combat-gate-health-economy-8cqg]
  combat: false,
  // combatVfx (GTA-pivot lane A #6): real gunfire visuals on lane B's deps.fire.onShot — muzzle flash + flash
  // light, tracer, impact sparks + dust, and blood spray + decal. web/src/combat/vfx.ts, wired in main.ts.
  // Blood is additionally gated by flags.gore + the player gore toggle (isGoreEnabled). Pooled; no per-shot
  // alloc. Only fires when combat is active (onShot). Dev-on: desktop + phone-Low A/B (docs/sf-data/combat) +
  // 45s ferry phone gate pass (53.6fps mean / p95 25ms, VFX firing). Ships with combat via prepare.ts.
  combatVfx: true,
  // sfpdLook (GTA-pivot lane A #2): client-side SFPD police look — black-and-white patrol livery on POLICE_FLAG
  // 'subaru' cruisers (web/src/combat/sfpdLivery.ts, applied in fleet.ts by cloning the body material) + an
  // officer avatar look (navy uniform, cap, badge). Pursuit cars only appear with combat+wanted, so this is
  // byte-inert in prod until then. OFF until the desktop + phone-Low A/B; then dev-on.
  sfpdLook: true,
  // GTA V pivot — gore (founder 2026-10-13: "GTA-level blood", behind an 18+ gate AND a gore toggle). This flag
  // gates whether the gore subsystem (blood decals/particles from lane A) is available at all; inside it the
  // player's gore toggle (persisted per device, default ON once past the 18+ gate) turns the blood on/off. With
  // this OFF there is no blood path regardless of the toggle. Requires combat. OFF until lane A's blood visuals
  // land and a founder look. [gtasf-combat-gate-health-economy-8cqg]
  gore: false,
  // GTA V pivot — LANE B weapons (docs/PLAN-gta-pivot.md §B.3): fists/bat/pistol/SMG/rifle, the weapon wheel,
  // desktop mouse aim (pointer lock + drag fallback) and phone twin-stick, and the shared rayVsWorld for
  // bullets + line of sight. Local fire feedback only until step 3's server-validated hits apply damage.
  // Requires combat. OFF until the wheel/aim land with desktop + phone evidence and the orchestrator's review;
  // not in prepare.ts until then. [gtasf-combat-weapons-aim-qqrp]
  weapons: false,
  // GTA V pivot — LANE B server-validated hits (docs/PLAN-gta-pivot.md §B.4): the client sends COMBAT_FIRE
  // (weapon + aim dir); WorldDO validates fire rate, range and line of sight against the SERVER's authoritative
  // poses, applies damage to the target, and broadcasts COMBAT_HIT. Health is server-owned; death → WASTED runs
  // the valuation cost server-side (server-minted 'srv:' incident ids). Requires combat + weapons. OFF until the
  // server/money review and a headless hit→damage→death check; not in prepare.ts until then. [gtasf-combat-server-hits-jilc]
  serverHits: false,
  // GTA V pivot — LANE B open PvP (docs/PLAN-gta-pivot.md §B.9): lets a shot harm ANOTHER PLAYER in the shared
  // world. serverHits owns the hit-validation machinery; this is the distinct opt-in that actually passes other
  // players as targets, so PvP can't go live by enabling serverHits alone. A PvP death costs the victim only the
  // standard wasted penalty (-2%) — no bounty, no transfer. Requires combat + weapons + serverHits. OFF until the
  // server/money review and a headless two-client hit→death check; not in prepare.ts until then. [gtasf-combat-open-pvp-x75y]
  openPvp: false,
  // GTA V pivot — LANE B gun shop (docs/PLAN-gta-pivot.md §B.9): a parody SF-VC storefront ("Lead Capital")
  // that sells pistol/SMG/rifle, priced in valuation and SCALED BY STAGE (buyWeapon, server-authoritative
  // debit + per-device ownership idempotency, migration 0043). Requires combat + weapons. OFF until the
  // storefront/pickups land with evidence and the server/money review; not in prepare.ts until then. [gtasf-combat-gunshop-nnna]
  gunShop: false,
  // GTA V pivot — LANE B wanted level + SFPD (docs/PLAN-gta-pivot.md §B.7): server-authoritative wanted 1–5
  // (shared/combat/wanted.ts — crimes add heat, heat decays on line-of-sight escape + cooldown), SFPD units
  // spawned from the traffic sim with pursuit and escalation (cars → roadblocks → helicopter → SWAT), and the
  // wanted-stars HUD. Requires combat. OFF until the server/money review and a headless wanted→pursuit check;
  // not in prepare.ts until then. [gtasf-combat-wanted-sfpd-lmu9]
  wanted: false,
  // GTA V pivot — LANE B street-crime wanted (shared/combat/streetCrime.ts): the server raises wanted for public
  // gunfire (any non-melee COMBAT_FIRE → 'mayhem', rate-limited, capped at 2 stars) and for a shot passing through
  // an SFPD unit in line of sight ('cop-hit'). Peds are client-only, so the client also confesses peds it wastes
  // (C2S COMBAT_CRIME: shot, or knocked down by the local car at speed — the run-over topple ships with this flag)
  // → rate-limited 'ped-kill' on the SENDER only. Server path; requires combat + wanted + serverHits. OFF until the
  // server review; then the orchestrator adds it to prepare.ts. [gtasf-laneb-combat-epic-igho.2/.3]
  streetCrimeWanted: false,
  // GTA V pivot — LANE B SFPD bust (shared/combat/bust.ts): a wanted player who stays on foot, slower than a run,
  // within 7 m of a ground SFPD unit for 2.5 s is BUSTED — the SERVER applies −5% valuation (srv: incident, the
  // existing 'busted' penalty), clears wanted, respawns at SF General and sends S2C BUSTED for the screen. Only for
  // players who opted into combat. Money/server path; requires combat + wanted. OFF until the orchestrator's server
  // review; then add to prepare.ts. [gtasf-laneb-combat-epic-igho.5]
  policeBust: false,
  // GTA V pivot — LANE B SFPD return fire (shared/combat/policeFire.ts): from 2 stars, each ground unit chasing a
  // player shoots at them in range (35 m) + line of sight every 1.5 s; hit chance falls with distance and speed
  // (halved in a car); 9 damage through the SERVER health, a kill is the normal WASTED (−2%, server-applied). Shots
  // are broadcast as COMBAT_HIT with the unit as shooter; clients draw the tracer + gunshot. Money/server path;
  // requires combat + wanted + serverHits. OFF until the orchestrator's server review. [gtasf-laneb-combat-epic-igho.6]
  policeFire: false,
  // GTA V pivot — LANE B wanted escape cue (client-only): the lit wanted stars blink while no SFPD unit is within
  // sight (70 m; helicopter 130 m) — the same test the server uses before heat may decay — so players can tell
  // they are losing the police. Pure HUD; no server/money path. [gtasf-laneb-combat-epic-igho.9]
  wantedEscapeFlash: false,
  // gtasf-66lvh LANE B clear SFPD escape (shared/combat/escape.ts; tunables in shared/combat/sfpdTuning.ts): out of
  // police sight for 3–12 s (by stars) → SEARCHING, stay unseen 6–24 s more → wanted CLEARED. Parking-garage hideouts
  // (cover + ×2 clock), outrunning every unit by 200 m (×1.5), a car swap while unseen (skips to searching) and respray
  // shops (unseen driver: wanted cleared, once a minute) speed it up. Server sends S2C WANTED_ESCAPE; the HUD flashes the
  // stars while seen and shows an EVADING/SEARCHING bar while hidden, the radar shows garages (P) + respray shops.
  // Server path (clears wanted, no money); requires combat + wanted. Dev-on 10-20: server SAFE (2bdb9f76), HUD cue +
  // flags-on frames met (e7dd25f1). prepare.ts (with sfpdFairness) still needs the reviewer's phone 1-3 star chase
  // playtest on a prod-like stack (local LoS has no collision). N38: prod's legacy decay can clear stars before dispatch.
  wantedEscape: true,
  /** Critic N38 (lane B, SERVER): until a unit has sighted the player in this pursuit, the escape clock AND the legacy heat
   *  decay hold — so stars can't bleed away before the police arrive (1 prod crime in ~10). The hold ends on a sighting,
   *  a unit within sight range, or 30 s in total (dispatch delay included) (shared/combat/escape.ts stepSightingHold). Works with or without
   *  wantedEscape. No money. Needs reviewer sign-off + unit tests (escape.test.ts) before prepare.ts. */
  escapeWaitsForSighting: true,
  /** Critic N38 root cause (lane B, SERVER): with line of sight on, the first tick stored the CRIME SPOT as 'last seen', so
   *  every unit drove there and never toward a player who walked on: never seen, stars bled away (the 70 m cruisers). Until
   *  some unit has seen the player in this pursuit, units steer to the real position (callers keep reporting it); after
   *  the first sighting, breaking sight sends them to the last-seen spot as before. No money. Reviewer + tests before prepare.ts. */
  dispatchTracksUntilSighted: true,
  /** Lane B (phone chase playtest 10-20): while the escape clock is held (escapeWaitsForSighting) the HUD countdown froze at
   *  e.g. 'EVADING 9s' for up to 30 s; after 1.5 s without movement it reads 'EVADING · SFPD on the way'. Client-only HUD. */
  escapeHoldLabel: true,
  /** Lane B (SERVER, phone seen-then-hide chase 10-20): with wantedEscape on, the legacy heat decay no longer runs beside the
   *  escape clock, so stars clear only when the SEARCHING bar fills (it cleared 3 stars ~3 s after reaching a garage while
   *  the HUD said 'SEARCHING 7s'). No effect without wantedEscape (legacy decay unchanged). No money. Reviewer + tests. */
  escapeOwnsClear: true,
  // gtasf-66lvh fairer SFPD (shared/combat/sfpdTuning.ts SFPD_FAIR vs SFPD_CLASSIC): 3 s dispatch delay + one unit per
  // 4 s, fewer units per star, 10/15/20 s before roadblocks/helicopter/SWAT, slower cruisers/heli, 55 m sight, weaker
  // fire (6 dmg, 0.4→0.06 hit), PIT from 3★ with half the damage rate, 10 s / 6 heat/s decay, no roadblocks ahead of a
  // hidden player. Off = the classic numbers byte-for-byte. Server path (balance only, no money). Dev-on; prod needs
  // prepare.ts after server review + founder OK.
  sfpdFairness: true,
  /** gtasf-ex3nf (lane B, critique #16 residual): SFPD officers charging in the open near a player who is SHOOTING run to the
   *  far side of the nearest stopped cruiser and fight from there (the policePresence door hold) instead of running into
   *  the line of fire. Server path: unit tests + reviewer before prepare.ts. Off = officers charge as before. */
  sfpdCover: true,
  // GTA V pivot — LANE B combat places on the radar (client-only): a green '$' pin per robbable store and a red
  // crosshair pin per free weapon pickup, so players can find them; hidden after "Play without combat". Needs the
  // matching features (storeRobberies / gunShop pickups) to be on. Pure HUD. [gtasf-laneb-combat-epic-igho.11]
  combatRadarBlips: false,
  // GTA V pivot — LANE B SFPD officers on foot (worker/src/world/police.ts maintainOfficers): a cruiser that stalls
  // (no progress for 2 s while > 7 m from a wanted player — e.g. the player is deep in a plaza/park) deploys up to
  // min(2, stars) officers who run (5 m/s, building-blocked) to 1.5 m; they count for bust/fire/line of sight.
  // Server sends them as S2C OFFICERS; the client renders lane A's createSfpdOfficer (web/src/combat/policeOfficers.ts).
  // Server path; OFF until the orchestrator's server review + flags-on evidence. [gtasf-laneb-combat-epic-igho.13]
  sfpdOnFoot: false,
  // GTA V pivot — LANE B combat cost note (client-only): after a server-applied death or bust debit the player sees
  // what it cost ("Hospital bill: −$X" / "Bail: −$X"), from the valuation before vs. after the post-debit refresh.
  // Pure HUD copy, no money path. [gtasf-laneb-combat-epic-igho.14]
  combatCostToast: false,
  // GTA V pivot — LANE B combat funnel analytics: 'combat_step' events (18+ gate shown/accept/decline, weapon pickup,
  // gun bought, robbery, wasted, busted, wanted level up) so the founder can see whether combat is played. No PII;
  // rides the existing posthogAnalytics consent/flag. [gtasf-laneb-combat-epic-igho.15]
  combatAnalytics: false,
  // GTA V pivot — LANE B vehicle damage + explosions (shared/combat/vehicleDamage.ts, worker/src/world/vehicleDamage.ts):
  // vehicles lose HP to gunfire (server-validated shots) and to crashes of the car you drive (C2S VEHICLE_CRASH,
  // self-damage only); they smoke <50%, burn <25% (burning down) and EXPLODE at 0 — S2C EXPLOSION, blast damage to
  // opted-in players in 8 m (server-applied; a kill is the normal WASTED −2%), chain damage to nearby cars, wreck kept
  // 20 s. Server/money path (deaths); OFF until review + evidence. [gtasf-laneb-combat-epic-igho.16]
  vehicleDamage: false,
  // GTA V pivot — LANE B health + armour pickups (shared/combat/pickups.ts): server-owned armour that absorbs damage
  // first (PvP, police fire, blasts), world health/armour pickups with a 60 s respawn granted server-side on proximity
  // (S2C PICKUP_STATE), and S2C COMBAT_VITALS so the HUD shows the exact server health + armour. Server path; OFF until
  // review + evidence. Armour at the gun shop rides on this flag. [gtasf-laneb-combat-epic-igho.17]
  vitalsPickups: false,
  // GTA V pivot — LANE B melee takedowns (shared/combat/pedMelee.ts): fists/bat KNOCK a pedestrian down (it gets back
  // up; confessed as an 'assault', COMBAT_CRIME kind 3, not a kill), and after a knockout a bystander sometimes fights
  // back — runs at the player and swings; a landed swing is C2S PED_PUNCH, server-applied (7 dmg, rate-limited,
  // through armour; a kill is a normal WASTED). Server path; OFF until review + evidence. [gtasf-laneb-combat-epic-igho.18]
  pedMelee: false,
  // GTA V pivot — LANE B police PIT / ramming (shared/combat/policeRam.ts): at 2★+ cruisers chasing a DRIVING player
  // close in and ram the car (3 s cooldown per unit): each ram costs it 180 vehicle HP through the vehicleDamage path
  // (smoke → fire → explosion) and S2C POLICE_RAM shoves the driver's car. Needs vehicleDamage. Server path; OFF until
  // review + evidence. [gtasf-laneb-combat-epic-igho.19]
  policeRam: false,
  // Founder playtest (gtasf-0lnjq): the cars parked at the kerb were collision-only props, so E said 'Walk closer to a
  // vehicle' next to most cars. With this on, E within 3 m of a kerb car steals it: the prop hides, C2S KERB_CAR_TAKE,
  // and the server (on foot, within reach, next to a real road, no car already there, rate-limited) spawns a real fleet
  // car at that pose and seats you; car-theft wanted when combat is on. Server path; OFF until review + evidence.
  kerbCarTheft: false,
  // GTA V pivot — LANE B drive-bys (gtasf-hthnh): aim + fire guns from a car you drive or ride in (crosshair, click / F /
  // phone FIRE). Melee switches to your best gun. Server: a shot from inside never hits your own car (vehicleOnShot
  // exclude) nor the players sharing it, and melee from a vehicle is refused. OFF until review + evidence.
  driveBy: false,
  // GTA V pivot — LANE B health regen (shared/combat/regen.ts, gtasf-th81j): after 5 s without damage, health refills at
  // 2 HP/s up to half (50); above that you need a health pickup. Server-owned (WorldCombat.regenerate, integer health +
  // carry), synced to the HUD with COMBAT_VITALS. OFF until review.
  healthRegen: false,
  // GTA V pivot — LANE B shooting feel (critique #7, web/src/combat/shotFeel.ts): crosshair bloom + recoil camera kick
  // on each shot, white hit-marker X + tick on a server-confirmed hit (red on a kill), red hurt vignette + camera jolt
  // when hit, and a flinch on the player hit. Client-only/cosmetic; gun meshes + aim clip are lane D's. OFF until looked at.
  shootingFeel: false,
  // GTA V pivot — LANE B sampled SFX (critique #8, web/src/audio/samples.ts): CC0 / public-domain recordings replace the
  // synth for gunshots (pistol / SMG / rifle, with tails), the melee punch, the car-crash crunch, and a distant-siren bed
  // while wanted; the SFPD wail/yelp, the engine loop pitched by speed, voiced SFPD barks (captions match) and pedestrian
  // screams on panic (web/public/audio/combat, ~390 KB lazy-loaded on combat start; licences in PROVENANCE.md). Synth
  // stays as the fallback. OFF until heard.
  sampledAudio: false,
  // GTA V pivot — LANE B (critique 'no grunt' on the receiving end): a short CC0 pain grunt when a hit lands on you (full
  // level) or on another player / SFPD officer near you (distance-attenuated). web/src/audio/hurtGrunts.ts; ~9 KB under
  // /audio/combat, preloaded with the other combat samples. Needs sampledAudio. Client-only. Dev-on.
  hurtGrunts: true,
  // GTA V pivot — LANE B (critique: "melee is a whoosh with no swing animation"): each melee attack throws the arm —
  // fists a 260 ms right jab, the bat a 420 ms two-handed sweep across the front (web/src/avatar/heldWeapon.ts swing
  // phase, driven from main.ts on the melee shot); other players' melee plays on their avatar from the server's COMBAT_HIT
  // broadcast (weapon + shooter). Client-only. Dev-on.
  meleeSwing: true,
  // GTA V pivot — LANE B (prod #6.41 combat frame: BUSTED drawn over SF General): the server respawns a killed/arrested
  // player ~0.3 s after the event, mid fade-in, so the WASTED/BUSTED card played at the hospital. While the card is up the
  // rendered camera + body hold at the spot of the death/arrest; the fade-out reveals SF General. main.ts; client-only. Dev-on.
  deathCamHold: true,
  // GTA V pivot — LANE B (gtasf-kd2rv follow-up): the client aim raycast walks a per-mesh triangle grid for heavy static
  // meshes (web/src/combat/rayGrid.ts) instead of testing every triangle. At the Ferry plaza a cast cost ~38 ms at phone
  // Low x4 (Ferry Building ~20 ms), so aiming while firing failed the firefight gate. Same exact hits; grids build lazily
  // in idle slices for heavy meshes within 150 m. Visual-only (the server validates hits). Client-only. Dev-on.
  aimRayGrid: true,
  // aimSkinnedCapsule (gtasf-zd91j, LANE B): aim rays test each character as one vertical cylinder at its avatar root
  // instead of three's per-vertex CPU-skinned SkinnedMesh raycast (aim-sweep firefight p95 ~130 ms with avatarPoseBounds'
  // wide bounds). Visual only (tracer/impact point); the server validates hits. The local player's avatar is skipped.
  // Dev-on; for prepare.ts with avatarPoseBounds: the aim-sweep firefight ABBA (AIMSWEEP=1 B_OFF=aimSkinnedCapsule).
  aimSkinnedCapsule: true,
  // serverTerrainLos (gtasf-fajmy, LANE B server): PvP shot and police sight/fire line of sight also test the drawn ground
  // (each chunk's terrain.bin, loaded with its collision in CombatCollision), so shots no longer pass through hills. Unknown
  // terrain doesn't block. OFF, dev too, until lane D's road-graph height bake (gtasf-8mjjf) lands: where the graph sits
  // under the drawn hill a player's shots would be blocked both ways. Then: firefight ABBA + reviewer before prepare.ts.
  serverTerrainLos: false,
  // resumeHeightResnap (gtasf-8mjjf publish blocker #1, LANE B server): on resume / DO wake, an on-foot session's stored
  // height is snapped to the current road graph (within 6 m) when it's off by > 2 m, so a map whose graph heights moved
  // (the coarse-chunk lift raises hill streets up to ~10 m) can't trap a resumed hill player in a CORRECTION loop under the
  // street. Dev-on; must ship with (or before) the 8mjjf map publish. Server path: reviewer.
  resumeHeightResnap: true,
  /** gtasf-9jl2j (lane B, critique #11): getting in/out of a car animates (walk to the driver's door, ease into the seat;
   *  out of the seat, walk to the kerb spot) instead of a one-frame teleport. Client-only cinematic; the server's seat/exit
   *  is unchanged and the car holds still while you climb in. Off = the old instant seat. */
  carEnterAnim: true,
  /** gtasf-4f9ac (lane B): one shared AudioContext for the sound modules (sfx, samples, crunch, explosion, splat, gunshot,
   *  siren, police barks, shot feel) instead of each creating its own at its first sound: one audio render thread instead
   *  of up to nine, and no per-browser context cap. (The first creation in a page is the expensive one — ~1 s in headless at
   *  the first sound — and is unchanged; later ones were ~1 ms.) Vehicle audio and live voice keep their own. Off = as before. */
  sharedAudioContext: true,
  // LANE B world-socket drops (gtasf-j7wvv, orchestrator 2026-10-16): a small 'Reconnecting…' banner when the world socket
  // is down for more than 1 s (Cloudflare replaces the WorldDO instance every ~8-40 min; a frozen world with no word reads
  // as a hang), then 'Reconnected' for 1.4 s. Sub-second blips show nothing; the first join keeps its loading UI.
  // Client-only (web/src/net/reconnectNotice.ts). Dev-on.
  reconnectNotice: true,
  // LANE B twin-stick (founder decision 'twin-stick controls on phone'; critic: the phone had a FIRE button plus a free
  // camera drag, not a right stick): the FIRE button becomes the right stick — hold to fire, drag it to aim (camera.look
  // with a 1.6x gain), its label following the thumb. Left stick still moves. Client-only (combat/fire.ts). Dev-on.
  twinStick: true,
  // LANE B desktop aim controls (founder 2026-10-17: "very hard to aim and shoot on keyboard"). GTA-style mouse +
  // keyboard combat: a click while pointer-locked and armed is a SHOT (it used to drop the lock), the first click only
  // captures the mouse, a refused re-lock after Esc retries instead of falling back to drag forever, RMB grabs the lock
  // and soft-locks a target near the crosshair, shots converge from the chest onto the crosshair point (the server
  // casts from the chest), bullet magnetism (3 deg mouse / 9 deg keyboard-only), Z locks/cycles the nearest target
  // (camera tracks it; F/LMB fire at it), a red crosshair + lock bracket, crisper/lower-sensitivity aim camera with a
  // small aim FOV zoom. Client-only and visual: the server re-resolves every hit (combat/aimAssist.ts, fire.ts,
  // input/pointer.ts). Dev-on; prod needs prepare.ts after a founder look.
  aimControls: true,
  // GTA V pivot — LANE B driving feel (critique #10): walls bounce the car back with 30% of its speed (yawing it off a
  // side-swipe) instead of a dead stop, with a crunch + 150 ms shake; a chase-cam profile in cars (6 m boom, flatter
  // pitch, FOV +8° at 30 m/s). Handbrake tyre smoke + skid marks too (web/src/vehicles/skids.ts). Client-only. OFF until felt.
  drivingFeel: false,
  // GTA V pivot — LANE B risk/reward rebalance (critique #12, orchestrator-decided; MONEY, server path): a store robbery
  // pays max($750, min(1% of current valuation, $5k)) (review RR-H1 cap); BUSTED −5% capped at $2,500; WASTED capped at $1,000 (with its $1,000 floor
  // that is a flat $1,000, clamped to the balance). Weapons are already kept on death; gun prices stay the stage price
  // capped at 10% of valuation. Unit tests in shared/combat/economy.test.ts + storeRobbery.test.ts; needs reviewer sign-off.
  riskReward: false,
  // GTA V pivot — LANE B police presence (critique #16): at 2★+ SFPD officers who step out of a parked cruiser hold at
  // its door and fire from there (server, worker/src/world/police.ts; they chase once you're >30 m or the car moves);
  // SFPD text barks ("Freeze! SFPD!", "Shots fired!", "Hands where I can see them!") and a one-line dispatch radio
  // ticker at each new star (client, web/src/combat/policeBarks.ts). Stolen cruiser = 2★ already (car-theft + cop-hit).
  policePresence: false,
  // LANE B reconnect grace (P0 gtasf-j7wvv): Cloudflare-dropped world sockets (1006) reconnect in 1-4 s, but the server
  // tore down the player's robotaxi trip, seat and in-progress runs (mission / drive / robbery / trial) on close, so a drop
  // cost a ride or a job. With this on, a vanished client (non-1000 close) keeps them paused for RECONNECT_GRACE_MS and a
  // same-session resume picks them up; a ?at= deep-link resume and grace expiry still clear them (anti-teleport kept).
  // Server only (worker/src/world/WorldDO.ts). Dev-on; prod-off until reviewed.
  reconnectGrace: true,
  /** gtasf-giklk (lane B, server): the message-budget close (4004 'server: message budget exceeded') gets the same
   *  reconnectGrace hold as a 1006 drop, so runs, rides and seats survive the client's immediate resume. A steady client
   *  hits the budget when a network stall delivers its queued frames as one burst (a phone time trial lost its finished
   *  run). The budget itself is unchanged. Off = the budget close clears the runs at once, as before. */
  budgetCloseGrace: true,
  // GTA V pivot — LANE B pickups (critic R4 'emoji in a green tube'): health/armour/weapon pickups show a spinning 3D
  // model (medkit, vest, lane D's procedural weapon) over the aura instead of an emoji sprite (web/src/combat/pickupModels.ts).
  // Client-only. Look-checked 2026-10-16 (docs/sf-data/combat/pickups/{off,on}-desktop.jpg; the medkit/vest were scaled up
  // to fill the aura). Dev-on; off keeps the emoji.
  pickupModels: true,
  // GTA V pivot — LANE B carjacking (docs/PLAN-gta-pivot.md §B.6): taking over a MOVING traffic car pulls its
  // driver out (a pull-out ragdoll cosmetic beside the car) and is a car crime — it raises the 'car-theft' wanted
  // heat so the SFPD react (needs `wanted` to be visible). Stealing a parked/empty car stays a free, no-star grab.
  // Requires combat (the eject cosmetic) + rideAnyVehicle (the traffic takeover). OFF until the server review +
  // a headless carjack→wanted check; not in prepare.ts until then. [gtasf-combat-carjacking-tbmw]
  carjacking: false,
  // GTA V pivot — LANE B store robberies (docs/PLAN-gta-pivot.md §B.8): a few SF corner stores / boba shops the
  // player can hold up — stand inside, hold to rob, and the SERVER pays a modest valuation credit (once per store
  // per day, deduped by the funding_credits ref like missions) and the SFPD get a 2-star wanted. Requires combat;
  // the 2-star response needs `wanted`. OFF until the money-path review + a headless rob→payout→wanted check and
  // walkable-verified store coords; not in prepare.ts until then. [gtasf-combat-store-robberies-709v]
  storeRobberies: false,
  // GTA V pivot — LANE B air + SWAT escalation (Combat 5b, docs/PLAN-gta-pivot.md §B): at wanted 4 a helicopter
  // joins the pursuit (hovers, wide spotlight sight that makes escape harder); at wanted 5 SWAT vans join. Car
  // GLBs stand in (heli='supercar' at altitude, SWAT='bus') until lane-A ships 'police-heli'/'swat-van' art, so
  // this is OFF even when `wanted` is on — flip it only once the real models land. Requires combat + wanted.
  // [gtasf-gdiv]
  policeAir: false,
  // policeAirArt (GTA-pivot lane A #6): the real art for lane B's Combat 5b units — a procedural b&w SFPD
  // helicopter (spinning rotors, red/blue belly strobes, a sweeping searchlight beam + a night ground pool via
  // lampLightMap) for POLICE_FLAG 'supercar' entries, and an armoured black SWAT van for POLICE_FLAG 'bus'.
  // web/src/combat/policeAir.ts, swapped in by fleet.ts. Fetch-free (no download cost). Byte-inert until
  // policeAir spawns those units; `?policeairdemo` (testing harness) places one of each by the viewer for
  // capture. Evidence: docs/sf-data/police-air. Ships with policeAir via prepare.ts.
  policeAirArt: true,
  // GTA V pivot — LANE B traffic-car drivers (Combat 6b, gtasf-ieoj): seat a modelled NPC driver in the nearest
  // traffic cars so the world reads as driven and a carjack pulls out a visible person. Decoupled overlay (reads
  // fleet.cars, parents a pooled seated avatar to the car's seat node — no fleet.ts edit), frozen 'sit' pose so
  // there's no per-frame mixer cost. It was shelved because the fleet body is one opaque mesh with the windows baked
  // into its texture, so the driver was invisible in-game. Now (3b6c1bd6) vehicles/carGlass.ts makes the window texels of
  // cars that carry a driver a tinted translucent pane (per-type height band + non-flat normal + dark albedo), drivers
  // are lifted per body so the head fills the window under the roof, and robotaxis/buses get none. Showroom evidence
  // docs/sf-data/traffic-drivers/*-glass4/5 (desktop HD + phone Low). Dev-on. Before prepare.ts: an in-game frame
  // of a passing traffic car (a local single-player stack had no traffic near the camera) + the phone perf gate
  // (the pane pass adds <=8 transparent draws; earlier 45.7 fps / 25.6 ms p95 at ferry Low). [gtasf-ieoj]
  trafficDrivers: true,
  // frozenDrivers (gtasf-zd91j, lane B): seated traffic drivers are baked once into static, cullable meshes from their
  // settled 'sit' pose instead of staying live skinned avatars (frustum culling off, skeleton every frame). The
  // phone firefight ABBA put trafficDrivers alone at ~9.3 fps (27.1 vs 36.4) (prod #6.41 26.9 fps). Dev-on; for prepare.ts: the
  // firefight ABBA (tools/_laneb-firefight-abba.sh B_OFF=frozenDrivers) + an in-game frame of a seated driver.
  frozenDrivers: true,
  /** N13j follow-up (lane B): when the CC0 driver body arrives, rebake ONE pooled traffic driver per 30-frame check instead of
   *  every one in the same frame (an ~830 ms freeze ~9 s into a 4x phone's opening). Client-only. Off = all in one frame. */
  spreadDriverRebake: true,
  /** N13j follow-up (lane B): traffic-driver bakes fold each bone's transform once and blend four matrices per vertex,
   *  instead of three matrix products and a normal-matrix inverse per vertex (the CC0 body's rebake was ~1 s on a 4x
   *  phone). Same result as three's skinning shader. Client-only. Off = the old per-vertex path. */
  fastDriverBake: true,
  /** Lane B (late-opening profile, lane C's router): decodeRouterEdges builds one class instance per edge with a shared
   *  prototype getter, not an object + getter + closure per edge (~12x cheaper; the whole-city decode was most of a 1.9 s
   *  long task on a 4x phone). Client-only, same RouterEdge shape. Off = the object-literal decode. */
  classRouterEdges: true,
  // GTA V pivot — LANE B death polish (docs/PLAN-gta-pivot.md §B): procedural ragdoll-lite (a canned fall/crumple
  // pose blend, no physics engine) when a ped or player is wasted, plus a synthesised SFPD siren that rises when
  // pursuit cars are near. Requires combat (sirens also require wanted, naturally empty without police). Pure
  // client cosmetics — no server/money path — but kept behind its own flag for a clean look gate. OFF until the
  // desktop + phone screenshots land; not in prepare.ts until then. [gtasf-combat-ragdoll-audio-peds-q66p]
  ragdollAudio: false,
  // GTA V pivot — LANE C: MISSIONS & QUESTS (docs/PLAN-gta-pivot.md section C). Master gate for the mission
  // framework: the mission runner + minimap letter markers + the in-game phone, and the SERVER-validated mission
  // payout (handleMissionStart/Complete → runMission, source 'celebrity', ref mission:<id>). Single currency =
  // valuation. With this OFF no mission NPCs/markers mount and the mission-start/complete routes 404 — byte-inert.
  // OFF until the money path is reviewed and there's desktop + phone Low evidence (docs/sf-data/missions/); add to
  // prepare.ts's reviewed set only then. The first mission is "Steal the Pitch Deck" (shared/founder/missions.ts).
  missions: false,
  // GTA V pivot — LANE C: TIME TRIALS (docs/PLAN-gta-pivot.md section C). Gate for the time-trial races + the
  // per-route daily best-time leaderboard (shared/founder/timeTrials.ts: Lombard switchbacks, Embarcadero sprint,
  // Twin Peaks). Time trials are a SKILL board, not an economy sink — a run earns a best TIME, never a valuation
  // credit — so no money-path review is needed, only the server best-time validation (anti-cheese floor). With
  // this OFF no trial markers mount and the leaderboard routes 404 — byte-inert. Dev-on 2026-10-14 for the ship
  // packet (money/server re-review passed; SKILL board, no economy path); ships via the prepare.ts reviewed set.
  timeTrials: true,
  // GTA V pivot — LANE C task 6: SF PILGRIMAGE (shared/founder/pilgrimage.ts). 12 iconic landmarks listed on the jobs
  // phone with GPS routing; reaching one pays a small ONCE-EVER valuation credit (+ a once-ever bonus for all 12).
  // Money path (worker/src/founder/pilgrimage.ts + WorldDO /api/funding/pilgrimage[-claim]): authoritative-pose
  // proximity + anti-teleport (a site must be approached from 150 m+ since the last deep link / robotaxi jump / respawn).
  // Dev-on; OFF in production until the orchestrator money review adds it to prepare.ts's reviewed set.
  pilgrimage: true,
  // Founder-ladder meme roster (gtasf-ldlm): the "Dolores Park doomer" pitch NPC (shared/founder/memeQuests.ts
  // 'dolores-doomer', per-NPC flag on top of memeQuests). Reuses the reviewed pitch judge/cheque/per-SF-day cooldown,
  // but is a NEW daily pitch source, so dev-on and OFF in prod until the economy review adds it to prepare.ts.
  doomerQuest: true,
  // Founder-ladder meme roster (gtasf-ldlm): the hacker-house recruiter's "Find Your Co-founders" mission
  // (shared/founder/missions.ts 'cofounder-hunt', per-mission flag on top of missions): a SoMa loop of 3 pickups,
  // each a server-verified checkpoint, paying demo*2 per SF day. A NEW valuation source, so dev-on and OFF in prod
  // until the economy review adds it to prepare.ts.
  cofounderHunt: true,
  // gtasf-sstf8 (critic 10-19 night item): the co-founder recruits are PEOPLE — a rigged avatar + name label waits on the
  // pavement at each pending recruit spot, joins and trails the player (the Series A crew's formation, hidden while driving)
  // and stays at the hacker house on MISSION PASSED (web/src/founder/cofounderRecruits.ts). Cosmetic and local: the server
  // checkpoints are unchanged. Dev-on; prod after a real-run look on both profiles + the phone gate.
  cofounderRecruits: true,
  // Critic N41: each job objective is routed like the job start (map line + world GPS line, hailable with H) instead of
  // only a minimap letter; cleared when the job ends unless the player picked another destination (main.ts routeObjective).
  // Client-only. Dev-on; prod after a real-run look.
  missionObjectiveRoute: true,
  // Critic N39 (lane E reproduced on prod): the SEED CLOSED 'Find a job' quest card hid only via its own CTA, so a job
  // started from the phone, a call or a giver ran under it. A live job now hides it (controller.ts jobStarted). Client-only.
  questYieldsToJob: true,
  /** Critic N42 (lane B): with hudFocus, the founder quest card (PITCH NOW) hides while a payout card (STORE ROBBED / JOB
   *  DONE / CHEQUE SECURED) shows, instead of printing over it. Client CSS only (hudFocus.css). Off = both draw. */
  questYieldsToPayout: true,
  // radarRouteRetry (found on the 10-20 local job run): radar.setDestination refuses and DROPS a destination it can't route
  // yet; early in a session only the near-Ferry router is up, so a far job start/stop, Demo Day, a pilgrimage site or a race
  // start got no route line. main.ts routeDestination keeps it selected and retries every 2 s (<= 2 min). Client-only.
  radarRouteRetry: true,
  // cofounderShortLoop (critic N41, lane E's road-routed timings: 14-15 min of walking): 'Find Your Co-founders' swaps the
  // designer's Caltrain stop (across the I-80/rail barrier) for Howard St by Moscone (shared/founder/missions.ts). Changes a
  // server-validated checkpoint (the same spec on both sides; the travel floor shrinks with it), so it ships with a review.
  cofounderShortLoop: true,
  // giverDoneToday (job playthrough 10-20): after MISSION PASSED the giver still said 'PRESS E TO START' for a job the server
  // refuses until tomorrow. A job paid today now reads 'DONE FOR TODAY · BACK TOMORROW' (server list at mount + each PASSED).
  // Client-only.
  giverDoneToday: true,
  // sceneCompileEarly (gtasf-ep30n, perf experiment): compileAsync the scene at world-ready so shader links overlap the ~2.5 s
  // of setup, awaited (<= 1.5 s) before the loop. OFF until a cold-READY ABBA (MODE=coldready) shows card-hidden improves.
  sceneCompileEarly: false,
  // Critic N42: the founder quest card steps aside while a centre-slot moment is on screen (payout card, RANK UP, MISSION PASSED,
  // STORE ROBBED) and comes back after (controller centerHold, per frame). Needs centerSlotQueue (the slot only tracks items it
  // queues). Client-only.
  questYieldsToCenter: true,
  // coastlineCanvasUpload (gtasf-9oe0r): the bay-water shore mask uploads its 2048^2 canvas directly as an R8 texture instead of a
  // 16 MB getImageData readback + 4M-texel copy (~600 ms of a cold 4x phone boot). Same mask; check the shore seams look.
  coastlineCanvasUpload: true,
  // hudBatchedReads (cold-phone boot, LT_TOP 10-20): phoneHud.update reads the notice / action-stack / toolbar sizes first and writes
  // their CSS variables after, instead of read-write-read-write (each write forced the next read's full layout: reserveActionSpace
  // 418 ms self at 4x). ResizeObservers still correct any size a write changes. Client-only.
  // OFF (10-20 A/B, 2+2 cold 4x-phone runs): no win; setup window off 1.63/2.16 s vs on 2.20/2.38 s, same CSS values. The first
  // forced layout after the HUD build dominates and is paid either way.
  hudBatchedReads: false,
  // routeReplanOffRoute (gtasf-fddi): the radar re-planned the whole route every 35 m walked; a 5-7 km plan is 130-290 ms of main
  // thread on a 4x phone. While the player is within 20 m of the drawn line, keep it and only refresh the distance label;
  // re-plan when they leave it. Client-only.
  routeReplanOffRoute: true,
  // routerTypedAstar (gtasf-fddi): the radar's A* over integer node indices + typed arrays instead of string-keyed Maps (a 5-7 km
  // plan was 130-290 ms of main thread at 4x). Byte-identical routes (routing tests). Client-only.
  routerTypedAstar: true,
  // Critic N47 (lane E's prod runs). heistGetaway: the heist's 'Lose the heat' says how ('take a car, or get out of their sight'),
  // and its start routes to the nearest parked civilian car within 120 m as 'Getaway car' (or says how to break sight). Client-only.
  heistGetaway: true,
  // acquihireConfirm: Buy My Company's 10 % debit no longer fires on the first E; the first press names the price, a second
  // within 6 s buys. Client-only (the server's start/escrow is unchanged).
  acquihireConfirm: true,
  // heistHeatOnLeave (critic N47, SERVER, review): the heist's wanted heat is raised when the player first gets 50 m from the grab, not at
  // mission-start (a cruiser could already be parked at the office). WorldDO startMissionRun / notePoseProgress.
  heistHeatOnLeave: true,
  // failBandReason (critic N47 nit): a failed escape shows the MISSION FAILED band with 'They caught up. Try again.' as its
  // subtitle, not the band plus a separate toast for the same event (needs missionPresentation). Client-only.
  failBandReason: true,
  // jobRideHint (critic N41 lever 3): a job with a loop over ~1.2 km, started on foot, says once to grab a car (main.ts onStep
  // 'start'). Client-only.
  jobRideHint: true,
  // routeSnapFallback (lane E 10-20 route rerun): the router snapped a route's start to the single nearest lane; by stacked roads
  // (I-80 ramps, the Howard St bridge) that can be an on-ramp/one-way into a dead piece, so a job leg had no route until the
  // player moved. On failure, retry from the next-nearest start lanes, then one other end lane (radar/routing.ts). Client-only.
  routeSnapFallback: true,
  // Founder-ladder meme roster (gtasf-ldlm): the AI-pendant founder's "wear my pendant for one drive" joyride (memeQuests
  // 'ai-pendant-founder', per-NPC flag; also needs memeQuests + driveQuest). Same server-verified drive quest as the
  // cone (demo*2 per SF day), own wording, no cone. A NEW daily valuation source: dev-on, prod-off until review.
  pendantQuest: true,
  // Founder-ladder meme roster (gtasf-ldlm): the burnt-out founder's "Buy My Company" acqui-hire (missions 'acquihire',
  // worker/src/founder/acquihire.ts + migrations 0046_acquisitions, 0047_acquisitions_delivering). MONEY PATH: the start DEBITS 10% of valuation into a
  // D1 escrow (refunded on abandon/teleport/disconnect/timeout), the server-checked delivery pays 1.5× back. Dev-on;
  // OFF in production until the orchestrator review adds it to prepare.ts (and migrations 0046 + 0047 are applied to prod D1; #6.12 applied both).
  acquihireQuest: true,
  // LANE C multiplayer quest 1 (gtasf-mp-street-races): live street races at time-trial markers — host at a 'T', nearby
  // players are invited (30 s join), server countdown, in-order gates + finish from server poses, placings by server
  // time; each finisher's time posts to the route's daily board. NO valuation. Needs timeTrials. Dev-on, prod-off
  // until reviewed (new S2C QUEST opcode + /api/funding/race-host|race-join).
  streetRaces: true,
  // LANE C (critique "multiplayer features must work in an empty cell"): when nobody joins a street race in the 30 s
  // window, three fictional NPC rivals race you instead of the race cancelling — predetermined server finish times
  // around the route's par (quick / par / slow, seeded jitter, never under the anti-teleport floor), rival blips on
  // the minimap and a live POS n/N. Rivals never post to the board; no valuation. Needs streetRaces. Dev-on, prod-off.
  raceRivals: true,
  // LANE C multiplayer quest 2 (gtasf-mp-most-wanted-bounty): the richest combat-opted-in founder online (≥ $100k, not a
  // bot, not already taken down today) carries a "Most Wanted" bounty marker; the first OTHER player to take them down
  // with a server-validated PvP kill (marker up 3 min; target ≥ 3× the killer; never friends or a pair with a PvP kill
  // in 7 days) collects the victim's own WASTED debit, capped at $50k — VICTIM-FUNDED, nothing minted. Once per target
  // and per killer per SF day (bounty_claims 0048 claim-first, pvp_kill_log 0050). Needs combat + openPvp. Dev-on,
  // prod-off until reviewed (money path).
  mostWantedBounty: true,
  // LANE C multiplayer quest 3 (gtasf-mp-coop-heist): a second player joins a running pitch-deck heist as the getaway
  // driver (invite to players within 150 m of the rival's office; join within 60 s, standing there). The crew runs the
  // same server checks as a solo heist (grab, travel floor from the join, heat lost, at the drop) and is paid only with
  // the leader's delivery (same moment or within 2 min) — the normal heist credit under the crew's OWN daily heist ref,
  // so no device can earn more per day than solo. Needs missions. Dev-on, prod-off until reviewed (money path).
  coopHeist: true,
  // LANE D characters (gtasf-laned-crowd-variety-ghdkz): the instanced crowd (all of phone Low, HD beyond the rigged
  // near walkers, coffee queue, remote impostors) draws varied, proportioned SF people — per-instance clothing/skin/hair
  // colours, hairstyles, jackets, skirts, shorts, bags, glasses and build (web/src/render/crowdBody.ts). Still one draw
  // call, no textures. Off = the original shared silhouette, byte-identical. Dev-on: showroom + in-game ferry A/B
  // (docs/sf-data/crowd-looks), ferry phone-Low 36.9 fps / p95 32.6 ms (docs/perf/crowdvariety-on). Orchestrator look review
  // (2026-10-14): still reads as box mannequins and is disputed on phone perf -> OFF; superseded by the CC0 character bake-off.
  crowdVariety: false,
  // LANE D night (gtasf-laned-vehicle-night-lamps-5y4j4): visible headlamp + taillight glow on every moving car at night
  // (web/src/render/vehicleLamps.ts) — one instanced additive billboard draw, fades in with night, headlamps fade from
  // behind. Needs graphicsV2 + nightLighting. Off = byte-identical (nothing created). Dev-on: night A/B desktop + phone-Low
  // (docs/sf-data/night-street/lamps-*), paired ferry phone-Low perf neutral (22.6 vs 22.1 fps, same load). Cosmetic: add to prepare.ts to ship.
  vehicleNightLamps: true,
  // LANE D night (gtasf-laned-headlight-blob-7wn8m): HD headlight ground pools get a soft knee + dimmer white so they stop
  // reading as a flat white jagged blob (lampLightMap.ts). HD only; off = byte-identical.
  softHeadlightPools: false,
  // LANE D night (gtasf-laned-headlight-blob-7wn8m): ROOT-CAUSE fix for the jagged white headlight/lamp pool edge — clear
  // the lamp map's height channel to street level instead of 0 (lampLightMap.ts), so bilinear filtering no longer cuts a
  // texel-grid edge through the pool. All tiers; off = byte-identical. Dev-on: night A/B desktop + phone-Low
  // (docs/sf-data/night-street/pools-heightclear-*); a clear-value change, so no per-frame cost.
  lampHeightClear: true,
  // LANE D (gtasf-laned-busy-streets-uylos): busier arterial sidewalks — Market, the Embarcadero, Mission, Montgomery, Columbus
  // etc. hold 3 walkers per route side and the street-walker pool grows (Low 24->34, HD 88->110). Meant for the crowdVat
  // crowd (GPU ~free); per-walker CPU is the cost, so it needs a quiet-machine ferry+soma phone-perf gate. Off = unchanged.
  busyStreets: false,
  // LANE D (gtasf-laned-meshy-people-lu1vh): Meshy-6 characters (existing plan credits) — SFPD officer, pedestrians, player
  // looks — rigged by Meshy, bones renamed to the hoodie rig (tools/assets/build-meshy-people.mjs -> avatars/meshy-*.glb, ~0.4 MB
  // each, after READY). Off = not loaded and pruned from production builds. Dev-on: reviewer SHIP (AzureRobin,
  // docs/reviews/2026-10-14-meshypeople-code.md Final), quiet ferry phone-Low 60.0 fps / p95 21.2 ms, crowd VAT A/B neutral.
  meshyPeople: true,
  // LANE D (gtasf-meshy-vat-close-faces-wu8uy): phone Low + crowdVat keeps 3 rigged Meshy pedestrians for the people nearest the
  // camera (streetWalkers.ts; 24-bone rigs, 3 bodies loaded after READY), so faces don't melt at <3 m. Off = Low is VAT only.
  lowNearPeople: false,
  // LANE D (gtasf-laned-busy-streets-uylos): street walkers fill spans AHEAD of the player's travel direction first (the chase
  // camera looks that way) and recycle walkers left >40 m behind, so the limited pool is where the player can see it
  // (phone-Low sidewalks read empty otherwise). Off = nearest-first, unchanged.
  walkersInView: false,
  // LANE D (gtasf-meshy-vat-close-faces-wu8uy): Meshy bodies load the head-mapped set (meshy-<id>.hm.glb): head triangles get
  // cylindrical UVs + their own 512x256 texture baked from the 2048 px source, so faces stay sharp up close (the 512 px atlas
  // shatters the face into tiny islands). +28 KB over the 12 bodies (body atlas q82->q70 pays for most). Off = original set.
  meshyHeadMaps: false,
  // LANE D (GTA V critic #9): wasted Meshy pedestrians play a real fall (forward/backward death clips from Meshy's library,
  // 108 plan credits) instead of the rigid plank topple. One shared 27 KB meshy-clips.glb retargeted per body (riggedAvatar
  // pose()); VAT/CC0 bodies keep the plank. Off = plank + file pruned.
  meshyDeathClips: false,
  // LANE D (GTA V critic #18): new players start in a realistic Meshy wardrobe look (jeans/blazer/bomber) instead of a hoodie +
  // shorts palette (main.ts). Needs cc0People + meshyPeople (wardrobe bodies); saved outfits unchanged. Off = random palette/look.
  adultDefaultLook: true,
  // LANE D (GTA V critic #15 'night is a flat navy wash'): darker, warmer night ground (half the albedo road fill on a warm
  // base, nightLights.ts), dusky sodium-tinted night haze instead of navy (foundation.ts) and a stronger orange city glow on
  // the horizon (sky.ts). Off = current night.
  nightWarmth: false,
  // LANE D (GTA V critic #7, with lane B): the equipped weapon (procedural low-poly pistol/SMG/rifle/bat, 0 bytes) in the
  // local player's hands, and an arm IK aim pose for 1.5 s after each shot, body turned to the aim (avatar/heldWeapon.ts,
  // main.ts). Needs weapons. Off = empty hands.
  weaponPoses: false,
  // LANE D (QA P1 gtasf-f2jj8): at night people (Lambert, lit only by the dim moon/ambient) went to near-black silhouettes
  // on HD once the dark-clothed Meshy bodies shipped; cars/buildings/roads have their own night fills. A small
  // albedo-proportional emissive lift that follows the night level (render/characterNight.ts) on rigged avatars + the VAT
  // crowd. Off = unlit people at night.
  avatarNightFill: true,
  // LANE D (critic N5, gtasf-xuiyv): on phone Low the Meshy cars are the ~5k-tri .low.glb, which reads as a crumpled blob
  // at 1-2 m (e.g. the robotaxi right after drop-off). With this, a car type's HD glb (already shipped for desktop) loads
  // lazily the first time one comes within 14 m and is shown within 8 m (vehicles/models/vehicle.ts). Off = low only.
  // v2: HD for the single nearest car within 6 m, loaded only within 6 m. Phone-Low Ferry ABBA (Prius at 4.9 m, HD the
  // whole run): 40.2/39.9 fps vs base 42.8 (+1 contended outlier); docs/sf-data/car-near-detail/v2-*. Dev-on.
  carNearDetail: true,
  // LANE D (critic N10, gtasf-yzssn): desktop HD at overcast dawn showed white clouds on a near-black sky (the physical
  // atmosphere is dark with the sun at the horizon while the grade is still day). Use the SA dome unless the sun is clearly
  // up (y > 0.06) and cloud cover < 0.6 (foundation.ts). Off = physical sky whenever grade.night < 0.5.
  skyDawnGuard: true,
  // LANE D (critic N6, gtasf-vwvkl): on the live clock past dusk the key light was zeroed (astronomical sun far below the
  // horizon), so 03:00 was one flat navy value; the time presets keep the grade's cool night key. Blend to that key as the
  // sun drops from -2 to -8 deg (render/weather/solar.ts). Off = ambient-only live nights.
  liveNightKey: true,
  // LANE D (critic #18 'idle variety'): some rigged walkers get habits from Meshy library clips in the shared meshy-clips.glb
  // (needs meshyDeathClips' file): 1 in 5 texts while walking, 1 in 5 stops 6-9 s for a phone call, 1 in 5 stops to look around
  // (streetWalkers.ts). +44 KB on meshy-clips.glb. VAT/CC0 bodies unchanged. Off = plain walk/idle.
  // Phone-Low SoMa ABBA: base 46.6/57.9 vs flag 50.3/50.4 fps (noise); evidence docs/sf-data/idle-variety/. Dev-on.
  pedIdleVariety: true,
  // LANE D (critic N37, gtasf-b5vdc): a shot or a robbery empties the block. Street walkers within 40 m of gunfire (or a
  // robbery start) sprint off their routes away from it and fade out past ~55 m; the block stays clear ~20 s before it
  // refills. Some rigged walkers cower (Meshy library crouch, meshy-panic-clips.glb, +22 KB, loaded only with this flag), and
  // 1 in 10 stops to call it in on a phone (pedIdleVariety's phonecall). Local and cosmetic: no server or money path.
  // Off = today's reaction (18 m, 2.2 s, a jog to the route end).
  crowdPanic: true,
  // LANE D (critic N37 at the spawn plaza, gtasf-b5vdc): the Ferry Building plaza's looping walkers (ferryPedestrians.ts) bolt
  // from gunfire too: within 40 m they sprint off, scattered off the line of fire, fade out past 55 m, and return to their loops
  // ~20 s after the last shot. Needs crowdPanic + combat. Separate flag so crowdPanic's finished gate stands. Off = they keep
  // strolling through a firefight.
  ferryPanic: true,
  // LANE D (gtasf-wsqvc, lane C's program timeline): Facade fronts compiled ~21 programs lazily after READY (the 350-700 ms
  // opening long tasks). On = the free parts only, no shader text change: side walls keyed plain/siding/windowed (the other
  // kinds compiled identical text under separate keys), and facades skip the lamp map (a no-op on walls that, built before or
  // after a chunk's lamp pass at random, doubled every program). Per-style front programs remain. Off = as before.
  frontProgramFold: true,
  // LANE D (gtasf-wsqvc): with frontProgramFold, also fold the per-style front numbers into uniforms (one front program).
  // OFF: identical look, but the full fold (this + the free parts) lost ~5 fps idle and ~3.5 fps firefight on phone Low (ABBA
  // 10-20, native '(program)' time up); the branchy shader is the likely cause, the free parts can't add GPU work.
  frontUniformFold: false,
  // LANE D (gtasf-wsqvc follow-up): start compiling a streamed chunk's programs when it mounts (after its material patches)
  // and when its facades rebuild (an atlas page arrived), with renderer.compileAsync on the driver's threads, instead of
  // compile + link blocking its first draw (the per-style facade fronts above all). sceneCompileEarly only covers boot.
  // Off = programs compile on first draw.
  chunkCompileAsync: false, // OFF (lane C 4-arm gate 10-20 13:0x): doubled programs 56 -> ~100, cut no link (compile key != draw key)
  // LANE D (critic 12:1x, gtasf-wsqvc): with chunkCompileAsync, keep a facade group built after the first frame HIDDEN until
  // compileAsync has linked its programs (capped at 1.5 s), so its first draw never blocks on a link. Fronts already pop in
  // when an atlas page lands; this delays that a little. OFF until lane C's 3-arm timeline says chunkCompileAsync alone is not enough.
  chunkCompileHold: false,
  // LANE D (critic N48): rooftopClutter fire escapes (brick walk-ups) skip a wall where a shorter neighbour stands in front of it
  // (the lower landings sat INSIDE the neighbour and the upper ones floated over its roof as bare dark slabs, Jackson Square),
  // and each storey gets stepped treads + outer posts so the stack reads as a fire escape, not loose slabs. Desktop only for
  // the treads/posts (Low keeps landings). Off = the old landing + rail stack everywhere.
  fireEscapeFix: true,
  // LANE D (critic N48, the real cause): HD commercial street fronts leave the 0-3.6 m ground floor to the box shader's shop
  // band and start the photo panel above it, but the panel's first storey still took the photo's GROUND-floor row, so doors,
  // steps and the shop awning appeared on the 2nd storey (Jackson Square). On = that storey takes a middle (upper) row.
  // Off = the ground-floor row there.
  storefrontUpperRows: true,
  // LANE D (critic N48 nit): fire escapes still read as solid dark fills; the fill was the rail, a SOLID 0.9 m sheet. On = an
  // open railing (top + mid bar between the posts) and a thinner 5 cm weathered-steel landing grating. Off = as shipped.
  fireEscapeLight: true,
  // LANE D (lane C openingDrive critic #3): walkers on the bay-side Embarcadero promenade, Howard St -> Ferry Building, where
  // the opening drive passes (the boulevard's road spans never reach it). Authored lat/lon lines in streetWalkers.ts. Off = none.
  waterfrontWalkers: true,
  // LANE D (gtasf-qzg58, critic N12): the local player's wardrobe body downloads first, at READY (no 3 s grace), and the crowd
  // VAT / walker bodies / shared clips wait for it, so the new player stops changing clothes ~30 s into the reveal. Off = all after READY+3 s.
  // gtasf-iedec (lane D, from lane B's zd91j): riggedAvatar sets frustumCulled=false on every SkinnedMesh (bind-pose
  // bounds miss seat/run poses), so off-screen police, SWAT, players and drivers still draw. With this ON each avatar's
  // SkinnedMeshes get a fixed pose-covering bounding sphere (0.8 m up, 2.4 m radius in the avatar root's space) and culling
  // stays on. Flag-off is byte-identical. Dev ON; NOT in prepare.ts's reviewed set (needs the firefight ABBA).
  avatarPoseBounds: true,
  // Critic N20 follow-up (lane D): nearestHospitalRespawn wakes players at Saint Francis, UCSF Mission Bay or St. Mary's on an
  // anonymous street. With this ON each gets a lit monument sign ahead of the waking player, a red EMERGENCY pylon and an
  // entrance canopy (web/src/render/landmarks/hospitalEntrances.ts), placed from an in-game occupancy grid so nothing lands
  // on the road or in a building. Off = not built. Dev ON; NOT in prepare.ts's reviewed set.
  hospitalEntrances: true,
  localBodyFirst: true,
  // LANE D (gtasf-avas): fire-escape stacks only on walk-up heights (<=30 m roof); off = any unmapped building >=11 m (glass
  // towers included, where the stack was buried in the facade). HD only (pieces are desktop).
  fireEscapeWalkups: true,
  // LANE D (critic R1): the chase camera never sits inside a street-tree card. A tree instance whose canopy footprint contains the
  // camera collapses in the vertex shader (no per-pixel discard, so Low too), replacing the HD 4x4 Bayer near-fade speckle.
  // Off = HD dither fade, Low none.
  foliageCanopyHide: true,
  // LANE D (gtasf-dqtn2): an event picked before the full road graph lands (~READY..+30 s) is remembered and applied once routing
  // is ready ('Routing to <event>…'), instead of 'Road directions are loading. Try again' and a dropped pick. Off = old message.
  deferredEventPick: true,
  // LANE D (gtasf-tr62l): street trees load the DataSF set minus trunks within 2 m of a lane centre (8,497 of 138,723, e.g. a SoMa
  // plane on the double yellow), filtered offline (tools/map/street-trees-offroad.mts -> art/trees/street-trees-offroad.bin; the
  // build ships only the set in use). Off = the full set.
  treesOffCarriageway: true,
  // LANE D (critic nit on gtasf-tr62l): a street tree hugging a facade turns its crossed cards so one lies along the wall and
  // narrows the one pointing into it (leaves stop slicing through the building). Off = authored yaw + size everywhere.
  treeFacadeAlign: true,
  // LANE D (critic N17): the Ferry Building hall's two end faces get the side arcade (3 lit ground arches + clerestory windows,
  // pilasters, cornice band) instead of a bare windowless stone slab seen from the Embarcadero. Off = bare ends.
  ferryEndArcades: true,
  // LANE D characters (gtasf-laned-cc0-characters-km1i6): CC0 Quaternius Ultimate Modular Men/Women bodies (business, casual,
  // formal, worker, beach, punk; men + women) on the hoodie's rig for near street pedestrians — HD's 16 rigged walkers and the
  // 6 nearest on phone Low (web/src/avatar/people.ts; ~4 MB of avatars/*.glb loaded after READY). Off = hoodies only, nothing
  // loaded. Licences: web/public/assets/LICENSES.md + PROVENANCE.md. Dev-on (bake-off + in-game evidence in
  // docs/sf-data/character-bakeoff; Low uses no skeletons). Cosmetic: add to prepare.ts to ship.
  cc0People: true,
  // LANE D (gtasf-laned-crowd-vat-y7x9d): the instanced crowd (phone Low everywhere, HD beyond the rigged near walkers, the
  // ferry plaza) draws the CC0 cc0People bodies as a baked vertex-animation LOD (web/src/render/crowdVat.ts; avatars/crowd-vat.*,
  // ~1.9 MB after READY, tools/assets/build-crowd-vat.mjs) — one draw per body — instead of the box mannequin. Off = box crowd.
  // Dev-on: in-session phone-Low ferry A/B (tools/_crowd-ab-perf.mjs) VAT on 28.1 vs off 27.4 fps, same frames/load (docs/perf/crowdvat-ab).
  crowdVat: true,
});
export type Feature = keyof typeof flags;
