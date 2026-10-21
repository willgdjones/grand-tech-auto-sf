# Changelog

All notable player-facing changes to Grand Tech Auto: San Francisco.

This file is the **source of truth** for the in-game "What's new" panel and the
`gtasf.com/changelog` page (PLAN-v2 §11). The build step turns these entries into
JSON; the in-game panel shows the newest unseen entry's 3–5 fun bullets once per
deploy to returning players.

- Realistic people (behind flag meshyPeople): San Francisco's pedestrians, the SFPD and your own wardrobe now use detailed, fully textured characters — tech workers in fleece vests, joggers, commuters in blazers and denim, a proper navy-uniformed SFPD officer — with natural walks and idles, all the way out to the far crowd [gtasf-laned-meshy-people-lu1vh]

- Cleaner night streets (behind flag lampHeightClear): headlight and street-lamp light on the road is now a soft glow instead of a big white patch with jagged edges [gtasf-laned-headlight-blob-7wn8m]

- Real people on the streets (behind flags cc0People + crowdVat): the box-mannequin crowd is gone — pedestrians are now proper men and women in suits, dresses, tees and jeans, hi-vis and beachwear, each with their own colours and skin tone, walking and idling around the city; on desktop the people nearest you are fully animated, and you can wear one of the new bodies yourself from the Outfit button (O) [gtasf-laned-cc0-characters-km1i6]

- Night driving looks the part (behind flag vehicleNightLamps): every moving car now shows glowing headlamps and red taillights after dark, so streets read as lines of light [gtasf-laned-vehicle-night-lamps-5y4j4]

- Real people on the sidewalks (behind flag crowdVariety): the city's pedestrians are no longer identical mannequins — hoodies, blazers, coats, vests, dresses, shorts, beanies and caps, backpacks and totes, glasses, long hair and buns, every skin tone and build; the people closest to you on desktop wear their own lanyards, earbuds, coffee and tote bags [gtasf-laned-crowd-variety-ghdkz]

- Police with teeth (behind flags, off): SFPD shoot back from 2 stars (policeFire); linger near them on foot and you're BUSTED for 5% bail (policeBust); officers jump out of their cruisers and chase you into plazas (sfpdOnFoot); gunfire, hitting or ramming cops and mowing down pedestrians all raise your stars (streetCrimeWanted); a police helicopter at 4 stars and SWAT vans at 5 (policeAir); your stars blink while you're losing them (wantedEscapeFlash); robbable stores and weapon pickups on the radar (combatRadarBlips); and a "Hospital bill / Bail" note shows what each death or arrest cost (combatCostToast) [gtasf-laneb-combat-epic-igho]

- Combat fixes: you can now see and hear other players' gunfire (tracers, impacts, and a crack that fades with distance), and pedestrians scatter from it; police cruisers no longer freeze down the road, drive through buildings or park on top of you; your money updates right away after you're wasted; and robbing a store says STORE ROBBED instead of "angel cheque" [gtasf-laneb-combat-epic-igho]

- Combat is here: real guns (pistol, SMG, rifle, plus fists and a bat) from a weapon wheel, free pickups around the city and a parody gun shop priced in valuation; hold up corner stores and boba shops for cash; jack cars straight out of traffic; open PvP; and an SFPD wanted level up to 5 stars with pursuits and roadblocks. The 18+ check only appears the first time you reach for a weapon, and "Play without combat" keeps the city peaceful [gtasf-laneb-combat-epic-igho]

- Side quest (behind flag acquihireQuest, off): a burnt-out founder in Hayes Valley sells you their startup for 10% of your valuation — get the laptop to the hacker house within 10 minutes and flip it for 1.5× back (refunded if the deal falls through) [gtasf-ldlm]

- Time trials: two new races — the Mission Street Dash (drive, waterfront to Civic Center) and the Telegraph Hill Climb (on foot to Coit Tower) — and every race is now on your phone with par, today's best and GPS routing. Your times actually land on the daily board now [gtasf-ldlm]

- Jobs: your phone rings — once a day a shady contact calls with a job, and Answer routes you straight to it. Close Seed and the quest card now points you at "Find a job"; jobs you've already done today show "Done today" instead of letting you run them for nothing; and you can abandon a job from the phone (missions) [gtasf-ldlm]

- Jobs: the in-game phone (jobs list + collectibles) opens from the ☰ menu on phones and with N on desktop (missions) [gtasf-ldlm]

- Fixes: pitching a side-quest VC twice in a day now says "come back tomorrow" instead of trapping you in the pitch card (and side-quest cards have a "Not now"); the crown banner's rank matches your nameplate right after a cheque; on phones the valuation pill and Privacy button no longer hide behind other HUD; a failed robotaxi to your Seed meeting offers "Try again" [gtasf-ldlm]

- SF Pilgrimage (behind flag pilgrimage, off): 12 iconic landmarks — Coit Tower, Lombard, the Painted Ladies, Twin Peaks and more — on your phone with GPS routing; walk or drive to each for a one-time valuation cheque, plus a bonus for collecting all 12 [gtasf-ldlm]

- Side quests (behind flags, off): a Dolores Park doomer who needs convincing AI won't end us (doomerQuest), and a hacker-house recruiter who sends you around SoMa to find three co-founders and bring them home (cofounderHunt) [gtasf-ldlm]

- Combat (first slice, superseded by the combat launch above): the first slice of GTA-style combat — an 18+ content gate with a blood/gore toggle, a health and armour HUD, and a WASTED / BUSTED screen; dying costs valuation (−2% wasted, min $1k; −5% busted) and respawns you at SF General [gtasf-combat-gate-health-economy-8cqg]

- Founders: the crown is now earned — it belongs to whoever holds the highest live valuation. A banner up top shows your rank in the field and who's wearing the crown, so you always know how far you are from the top (founderLadder) [gtasf-founder-ladder-p1-ilnl]

- Founders: your billboard climbs as you raise — a bigger valuation moves your startup onto more prominent sites, from Market Street at Seed up to the Bay Bridge approach, the 101 skyline, and the Salesforce Tower crown for SF's #1 (founderLadder) [gtasf-founder-ladder-p1-ilnl]

- Founders: once your startup is up on the Embarcadero billboard, the share card has a "Share on X" button that opens X with your boast and billboard link pre-filled — you post it from your own account (founderLadder) [gtasf-founder-ladder-p1-ilnl]

- Founders: pitch for your first cheque — a VC partner waits on the Ferry plaza, and you tap one of three pitch lines (no mic needed) to face the AI judge, bank a Pre-seed cheque, and put your opening valuation on the board (founderLadder) [gtasf-founder-ladder-p1-ilnl]

- Founders: raise your Seed — once Pre-seed closes, a partner at a real SF firm wants a meeting, so hail a robotaxi to their office, pitch the Seed round, and watch the full city — radio, map, free roam — unlock (founderLadder) [gtasf-founder-ladder-p1-ilnl]

- Events: the "V for event details" hint finally works — press V (or J when voice is on) at a Tech Week marker to open its detail card, or anywhere to toggle the upcoming-events list [gtasf-event-card-unreachable-2kvx]

- Billboards: San Francisco is filling up with founders' startups — startups from the leaderboard now rotate through real billboard sites across the city, so the skyline reads like a live cap table [gtasf-founder-ladder-p1-ilnl]

- HD (behind flag aerialPerspectiveHd, off): full physical aerial perspective so distant hills and towers fade into the real sky [gtasf-kpi9]

- Voice: the radio drops to 40% while voice is on and to 10% while someone nearby talks, and voices are louder and evened out; holding V always shows a big 🎙 Talking… pill, the email box, or a clear reason [gtasf-ws4j]

- Phones: the 🎨 paint button pulses with a TAP badge on the first step until you fire your first shot [gtasf-playful-mayhem-x44e]

- Paintball: real-looking paint splats — irregular blobs with droplets and drips that run down walls, a spray of paint on impact and a wet splat sound (playfulMayhem) [gtasf-playful-mayhem-x44e]

- Phones: other players more than 12 m away draw as light crowd silhouettes, so busy plazas stay smooth (flag lowPeerImpostors) [gtasf-c8sj]

- Phones: poles, signals, lamps and other street furniture draw in one batch with per-item culling (flag lowBatchedProps) [gtasf-c8sj]

- Phones: kerbside parked cars draw as a handful of batches instead of ~10 pieces per car (flag lowInstancedKerbCars) [gtasf-c8sj]

- Street lights, hydrants, trees and parked cars now appear about 1 s after you spawn instead of up to a minute later; the layout runs in the background (flag layoutWorker) [gtasf-c8sj]

- Phones: the city's street furniture finishes laying out about twice as fast after you spawn, so early frames stutter less (flag fastRoadSampler) [gtasf-c8sj]

- Phones: far-away shopfronts, signs and lamp posts are skipped on Low; distant buildings keep their windows (flag lowDetailCull) [gtasf-c8sj]

- Phones: each map chunk draws its roads in one go instead of a dozen pieces (flag chunkRoadMerge) [gtasf-c8sj]

- Smoother frames near event rings, the GPS line and VC drop gates: they draw in one pass instead of two [gtasf-c8sj]

- Phones: Ferry coffee-queue regulars use the light crowd model on Low (flag lowInstancedQueue) [gtasf-c8sj]

- Phones: fewer wasted draw calls from empty street-prop and billboard batches (flag emptyInstanceSkip) [gtasf-c8sj]

- Phones: minimap event dots skip emoji and glow on Low (lowRadarBudget) [gtasf-c8sj]

- Phones: lighter minimap redraw and no per-frame work for far-away cable cars and buses (flags lowRadarBudget, hiddenFleetMatrixSkip) [gtasf-c8sj]

- Phones: street furniture and parked cars finish loading in seconds instead of minutes, so the city stops stuttering after you spawn [gtasf-c8sj]

- Embarcadero promenade: bay-side planters, benches, palms and tree wells on HD (flag embarcaderoPromenade) [gtasf-67vc]

- Pier 39 and Lake Merced urban land get district paving instead of legacy flat green (1300 m borrow near Pier 39 only) [gtasf-8imu, gtasf-2am9]

- Chinatown: Meshy storefront pieces no longer float above shop awnings as giant blurry windows (only on walls that start at the street and face open sidewalk) [gtasf-r8tb]

- Chinatown/Haight: building hero pieces (cornices, bay windows) repeat along the wall instead of stretching into giant blurry blocks (scale capped 1.25x) [gtasf-insx]

- Castro hillside scrub reads clearly: kicks in from ~10 deg slopes, golden grass with dark scrub clumps (flag hillsideScrub) [gtasf-917l]

- Mission Street sidewalks get ficus trees, benches, planters and bins on HD (flag missionStreetDressing) [gtasf-i2hd]

## Conventions
- One `## [Unreleased]` section collects entries until a milestone deploy, which
  promotes it to `## [<date>] — <milestone>`. At the deploy, run
  `npx tsx tools/changelog/release.mjs "<milestone>" [YYYY-MM-DD]` (before build-web);
  it promotes the section, opens a fresh Unreleased and regenerates the embedded source,
  so returning players' in-game "What's new" shows that deploy's bullets.
- Group lines under `### Added`, `### Changed`, `### Fixed`.
- Write **player-facing, fun** bullets (this is shown in-game), not internal notes.
- Every shipped feature adds an entry **in the same change** that ships it, tagged
  with its bead id, e.g. `- New: drive through an event to get funded. [gtasf-xxxx]`.
- Features stay behind their `shared/flags.ts` switch; only flip the flag (and add
  the entry) when the feature's acceptance evidence is recorded.

## [Unreleased]

### Added
- Walking has weight now: you lean into a start, carry a step when you let go, and turns sweep instead of snapping. [gtasf-onfoot-inertia-xo0c2]
- A cleaner screen: your own startup plate shows for a few seconds after you spawn or your valuation changes instead of floating over your head forever, and the key legend fades out once you know the keys (it returns when you get into a car or close the menu). [gtasf-hud-declutter-x6hwz]
- The Ferry plaza's trees and the Embarcadero palms are real trees now, not green blobs: the same photo-card trees the streets use. [gtasf-landmark-card-trees-aeyhp]
- Jobs now play like missions: a title card when one starts, the current objective in the mission-text spot, and a MISSION PASSED card that counts your reward up (or MISSION FAILED if it goes wrong). [gtasf-mission-presentation-ffmye]
- Every founder now starts with a ridiculous generated startup name (hello, Quantum Burrito) so you can get funded from your very first ring. Rename it any time in Game options. [gtasf-ighk]
- Phones get into the city about a third faster, and the loading screen fills a progress bar as San Francisco comes together (paving the Embarcadero, parking the robotaxis…). [gtasf-ce5s]
- Event organisers get their own link: gtasf.com/e/<event> drops you at the venue with the event ring lit and a one-tap Share on X. [gtasf-w0s8]
- The Embarcadero waterfront is now a paved promenade instead of a flat green field. [gtasf-w4k8]
- Paintball first! New founders start by splatting the Ferry Building in their startup's colour: press Q or tap the big 🎨 button (X swaps paint, confetti and water balloons). [gtasf-playful-mayhem-x44e]

### Changed
- Smoother frame rate on phones around the Ferry Building: the city's buildings and streets no longer get recalculated every frame. [gtasf-pooa]

### Fixed
- Coit Tower's east hillside is back: the chase camera could slip just under the drawn hill on the summit and see straight through it to the Bay. [gtasf-h2qrw]
- A player who died at the exact moment the server hiccuped could be left lying at zero health with no hospital trip and no respawn; the world now notices anyone stuck dead for a few seconds and sends them to SF General, and a reload never brings you back dead. [gtasf-kill-settle-before-broadcast-yda5o]
- The city is busy again: far more people on the sidewalks, a bustling Ferry plaza crowd, and phones finally get pedestrians too. [gtasf-sena]
- Friends ignores late roster refreshes so older results cannot replace your latest friend list. [gtasf-43rk]
- Event refreshes keep the newest calendar and ignore older responses that arrive late. [gtasf-mxus]
- Event search keeps its panel open while you cancel or choose characters with an input method. [gtasf-c65v]
- Event ride buttons now show unavailable fares and retry guidance when a lookup fails, while map and event-page links stay usable. [gtasf-l5pq]
- Feedback and pause-menu shortcuts now leave text-composition keys alone while you choose characters. [gtasf-qvwy]
- Graphics options now show the quality selected by your current link instead of highlighting an overridden saved setting. [gtasf-nzkr]
- Game options now highlights the time of day actually in use, including time settings from shared links. [gtasf-tzdv]
- Links set to live time now follow the real SF clock even if you previously saved a different time of day. [gtasf-ca1m]
- Closing the robotaxi picker now reliably releases its cursor hold and ignores late fare updates. [gtasf-9eht]
- Robotaxi destinations now tell you when a fare lookup fails, with guidance to retry instead of checking forever. [gtasf-461g]
- Close a direct message in one tap to get back to the city; your unsent draft stays ready for later. [gtasf-uz0x]
- Friend request buttons now wait for your response to finish and show a retry message if it fails. [gtasf-gk2v]
- Friends keeps focused and hovered roster buttons in place during background updates, so choosing a conversation or request is steadier. [gtasf-kaa4]
- Friends: connection failures now ask you to retry instead of saying your username was rejected or missing. [gtasf-1zqs]
- Friends: username claims and friend requests wait for the current submission, keeping your text safe from late responses and repeated taps. [gtasf-vgev]
- Saving your startup prevents overlapping recovery-code requests, and selects the code for manual copying when clipboard access is unavailable. [gtasf-eeol]
- Reopening Add event keeps game controls paused correctly and retains the progress message while your link is being checked. [gtasf-4lyd]
- Friends now shows the same funding-stage names as the rest of the HUD, including the current Seed and Decacorn milestones. [gtasf-3n3c]
- Friends: DM refreshes no longer overlap, new messages clear the empty-thread notice, and incoming replies keep your place while reading older messages. [gtasf-336s]
- Friends: each conversation keeps its own draft, and failed DMs show an error beside the message without losing your text. [gtasf-wuhy]
- Feedback text stays read-only while sending, so later edits cannot disappear on success; failed sends unlock the draft for editing and retry. [gtasf-65n2]
- Event notices only advertise funding bonuses when funding is enabled, and screen readers keep community-event labels alongside raise estimates. [gtasf-39cq]
- Inline chat keeps your draft while you choose or cancel characters with an input method. [gtasf-osfm.1]
- Arriving at an event keeps you moving even with funding disabled: a quick toast replaces the automatic event popup. [gtasf-96rj.1]
- Graphics preview: plaza pedestrians keep their strolls inside the plaza instead of searching sideways into surrounding streets. [gtasf-7moo]

### Added
- **Preview only:** opt-in proximity voice with hold-V/phone push-to-talk, nearby spatial audio, speaking icons and quieter radio while talking. Events use J when voice is enabled in the build. Production awaits Realtime provisioning and two-tab/phone checks. [gtasf-ukif]
- **Preview only:** Game options voice opt-in and player-nameplate mute/report controls, with a voice privacy notice. Voice starts off each visit. [gtasf-tqg7]
- Some VC left their absurd supercar parked in Pacific Heights. Find it near Jackson and Fillmore, press E, and take it for a spin. [gtasf-txt]
- Muni 39 Coit buses now run from Pier 39 up Telegraph Hill to Coit Tower; wait at a stop and press E (or Enter on phones) to ride. [gtasf-4hsj]
- Share a Haight-Ashbury arrival with `/go/haight-ashbury`, landing on Haight Street by Ashbury. [gtasf-vw0o]
- Phone: pinch with two fingers to zoom the chase camera in and out. [gtasf-rmsv]
- See everything that's new: open ☰ (or Game options) and tap "What's new · Changelog" to scroll through every update.
- Graphics preview: Union Square is a granite plaza again with the Dewey Monument column, palms, benches and planters; parks and lawns get mottled, mown grass instead of flat green. [gtasf-7moo]
- Graphics preview: SoMa and Mission rooftops get parapets, AC units and timber water tanks, and brick walk-ups get black fire escapes. [gtasf-qc8o]
- Graphics preview: livelier streets — cars parked along the kerbs citywide (clear of hydrants and junctions), twice as many walkers on HD sidewalks, and more benches, bins and newspaper boxes on commercial blocks. [gtasf-7moo]
- Pause map: zoomed out over downtown, venue markers no longer pile on top of each other; the liveliest venue in each spot shows, and zooming in reveals the rest. [gtasf-crwk]
- Graphics preview: downtown blocks outside the detailed corridor are now solid, so you can no longer drive through FiDi/SoMa buildings. [gtasf-2j18]
- Graphics preview: glass tower side walls light up window by window at night instead of going dark. [gtasf-6qqv]
- Graphics preview: on HD, road paint and crossings now follow the real hill surface, so markings no longer sink or float on SF slopes.
- Graphics preview: at night office and apartment windows switch on and off, with a mix of warm and cool light. [gtasf-nhvn]
- Graphics preview: traffic lights show amber for the last few seconds of green. [gtasf-nhvn]
- Graphics preview: flocks of pigeons wheel over the city wherever you are, fewer on Low. [gtasf-nhvn]
- Graphics preview: on HD, the Bay and city lakes mirror the sky and skyline (Ferry Building, Bay Bridge) with gentle ripples; Low gets rippled sky-tinted water. [gtasf-lxll]
- Graphics preview: street lamps and moving headlights illuminate the road surface at night, with a smaller light map on Low. [gtasf-jog3]
- Optional Google 3D preview: stream the real city with attribution when configured; the GTASF map remains available while tiles load. [gtasf-eltv]
- Graphics preview: neighbourhood homes gain small chimneys, capped vents and roof hatches, with lighter rooftop detail on Low. [gtasf-p1rv]
- In the gated interaction-hint update, first-time car and angel hints follow the action you can actually take and clear while a menu is open. [gtasf-r4i9]

## [2026-10-05] — A fresh coat of paint for San Francisco

### Added
- The whole city got a makeover: a real atmospheric sky with sunsets that glow, and clouds and stars at night.
- Buildings wear proper San Francisco fronts: brick warehouses in SoMa, Victorian row houses, Edwardian flats, glass towers downtown and shopfronts with awnings.
- Parked cars line the district streets. Walk up to one, press E and drive off.
- Nudge an empty robotaxi and it spins aside, then gets back on its route.
- Six kinds of real SF street trees, benches, bins, bike racks and planters dress the sidewalks.
- Streets get worn asphalt, painted kerbs, crossings and warm paving; the Ferry plaza gets stone pavers.
- On HD, people stroll the sidewalks and step aside for you.

## [2026-10-04] — Robotaxis, radio, rides and a fresh start

### Added
- Fresh start: everyone's funding was reset to $0 for the new five-star funding ladder. Climb from Bootstrapping to Unicorn by driving through events.
- Press H for a robotaxi: pick "Where to?", watch the city fade, and step out at your destination. Your first three rides are free.
- Event names float above every event. Click a title or ring to open the event's page.
- Ride anything: hop into moving traffic, catch a bus or cable car, or pull out your own scooter with G.
- The radio plays everywhere: six parody stations with DJs and startup ads. Switch with [ and ].
- Angel investors roam the city. Find one and pitch for a cheque.
- Grab one of the real cars parked outside the Ferry Building and drive straight off.
- Faster cars, more traffic, and a clean HUD: just the clock, cash, stars and radar, with everything else in the ☰ menu.

### Changed
- The first tutorial step now clears as soon as you reach the gold marker.
- Money drops and the Outbid crown have been retired for now.
- With your consent, anonymous play statistics help us improve the game.

### Fixed
- Robotaxi rides are sturdier: fares load reliably, errors show inside the menu, and a dropped connection refunds your fare.
- Spot a bug? Send feedback from the top of the ☰ menu; it remembers where you were, even mid-ride.
- Replaying the tutorial starts fresh, and first-time tips clear after a few seconds.
- Chat explains connection problems beside your draft, and Escape closes it cleanly.
- Phones keep the radar, GPS, notices and touch controls clear on short screens.
- Cars keep their paint colours at a distance and on Low graphics.
- Paved SoMa and Mission blocks no longer look like lawns.

## [2026-10-04] — Scooters, maps and city polish

### Added
- Share a Hayes Valley arrival with `/go/hayes-valley`, landing on Hayes Street beside Octavia. [gtasf-f4cz]
- Pull out a scooter with G or Game options, then unlock a skateboard, e-bike, Onewheel and Segway parody as you raise funding. Other founders can see your ride. [gtasf-v21-personal-rides-5yfa]
- Walk straight to your coffee: nearby plaza stops now use safe walking directions instead of a lap around the traffic lanes. [gtasf-bo9q]
- Find your bearings on the map: the **Bay, Pacific shoreline and islands** now outline San Francisco.
  [gtasf-xj9z]
- Kerbs and crossings now follow selected main streets across the outer neighbourhoods,
  from the **Marina and Presidio** to the **Sunset and Bayview**. [gtasf-2wq4]
- Community events stand out: parties you and other players submit now wear a **COMMUNITY** tag in the
  V-panel list, on the map's event card and on the floating world label, so they read apart from the
  official Tech Week feed. [gtasf-community-event-visual-flag-x99q]
- Explore a more colourful west side: Richmond and Sunset street-front homes, greener Golden Gate
  Park, sandy Ocean Beach and the scrub-covered Twin Peaks. [gtasf-7iks]
- **SoMa, Moscone, FiDi, Mission and Dogpatch** gain distinct street colours and building palettes,
  with smaller street-front shops and houses preserved on their main streets. [gtasf-75f7]
- **Bernal Heights, Potrero Hill, Bayview, Excelsior, Glen Park, Noe Valley and Castro** gain distinct
  street colours, smaller neighbourhood buildings and greener parks. [gtasf-npnq]
- More northwest neighbourhood character: **Marina, Pacific Heights, Cow Hollow, Japantown and
  Western Addition** get their own building colours and smaller street-front buildings, while
  **Presidio and the Golden Gate approach** pick up green parks and coastal ground tones. [gtasf-2wq4]
- **Painted ladies**: Victorian clapboard walls now wear sage, dusty blue, ochre, rose and mauve
  pastels in both looks, with cream window surrounds and cornices preserved in the classic look.
  [gtasf-painted-lady-colour-variety-mv1y]
- **Founder Orientation**, your first mission: walk to the gold marker, sprint, hop on your scooter, then
  take the parked car through the gold ring by the Ferry Building for a one-time cheque that reads
  **PRE-SEED CLOSED**. The HUD opens up as you learn each part. [gtasf-n34i]
- Streets that look like SF: **stop lines** at every junction, **red kerbs** at corners, yellow and white
  loading zones, concrete gutters and iron **manhole covers** dotted down the lanes. [gtasf-street-detail-paint-ss3d]
- Zebra **crosswalks** now paint every marked junction in the city, not just the ones on the map data. [gtasf-junction-crosswalks-iv7p]
- Sidewalks come alive: **cobra-head street lamps**, blue **mailboxes**, **bike racks** and a lot more
  **street trees** line the city's streets. [gtasf-street-furniture-realistic-bkc0]
- Downtown feels downtown: the **Financial District** and **SoMa** now get the full street-dressing
  treatment on every block — poles, wires, lamps, signals, trees and furniture — not just the Ferry→Lombard
  run. [gtasf-0rt5]
- Right trees, right places: **palms** line the **Embarcadero** waterfront while leafy **plane trees**
  shade downtown and North Beach — so the streets read like real SF. [gtasf-0hyt]
- Pick your sky: **Game options → Time of day** now lets you roam San Francisco in **Live**, **Day**,
  **Golden hour** or **Night** — bask in a golden-hour glow or bright daylight instead of whatever the
  real SF clock says. (Add `?time=golden` to the URL for the same.) [gtasf-time-of-day-toggle-hnky]
- Show your colours: other founders now see your outfit, and it syncs live — press **O** to change your
  outfit and everyone nearby sees it instantly. (Full wardrobe, founder archetypes and stage-by-stage
  looks are on the way.) [gtasf-hrmk]
- Spot the big fish anywhere: the city's top-10 raisers now wear a gold 👑 crown and their rank on their
  nameplate, matching their gold dots on the radar. [gtasf-nameplate-top10-crown-3094]
- Buildings now read as peak San Andreas at every distance: rooftops bristle with AC units, wooden
  water tanks, antennas and stair housings; rooflines wear proper cornices in varied painted-lady trim
  colours; shopfronts get striped
  awnings; and tall street walls grow zig-zag fire escapes. The skyline and the sidewalk both come
  alive, from the Ferry Building to the Lombard hills. [gtasf-v2-1-building-detail-7pd5]
- **Bay windows**: SF mid-rise blocks now push out proper glazed **bay windows** up their street fronts —
  the classic Victorian/Edwardian look — painted to match each building's trim. [gtasf-sf-bay-windows-building-detail-87ak]
- The radar can read at a glance now: every event shows its **type** — investor $, demo 🎤, hackathon 💻,
  party 🍸, talk 🎙, networking 🤝 — in its own colour, with a full legend on the big map. VC drops are a
  pulsing 💼 briefcase with a live N/50 counter, busy spots glow with a crowd count, places you've already
  collected go dim, friends show green and top-10 raisers gold, and the minimap zooms out as you speed up.
  [gtasf-radar-overhaul-v21-wivr]
- The event rings out in the city now glow in their type's colour too — green for investor meetups, pink
  for parties, blue for hackathons and so on — so you can read what's happening from the street, not just
  the radar. [gtasf-event-marker-kind-colors-66ct]
- Chat is out in the open: recent messages now scroll bottom-left in classic outlined SA text and
  fade when it goes quiet, with a persistent "Press T to chat" prompt (Enter still works too).
  [gtasf-osfm]
- Chat without breaking stride: press Enter to type right there in the on-screen chat log and send —
  no pop-up window, and your keys never move you mid-sentence — then Esc to close. Every founder's
  name shows in its own colour so you can tell who's talking at a glance. [gtasf-6ofg]
- Your own startup now floats above your head too — your name, funding stage and total raised on your
  own nameplate, and you can click it to open your cap table. [gtasf-azlg]
- Save your startup: Game options → **Save your startup** gives you a `GTASF-XXXX-XXXX` recovery code
  (with a QR to scan) so you can load your founder — startup name, funding, cap table, referral link
  and look — onto a new phone or browser. New here? Tap **I already have a startup** to restore it,
  and your original device keeps playing too. [gtasf-17df]
- Cars now bump off each other, GTA-style: nudge another founder's car (or a parked one) and you
  both get shoved apart with a little spin — no damage, just chaos. [gtasf-loose-arcade-physics-sw46]
- Traffic feels it now too: clip an NPC car and it lurches aside with a little spin, then calmly
  pulls back into its lane — barge through a jam without the street ever locking up.
  [gtasf-arcade-npc-react-spwu]
- Look up: a blimp now drifts over the Bay and FiDi while banner planes buzz the
  Embarcadero and SoMa, trailing (parody) ads — and every one is a sellable sky-ad
  slot. [gtasf-more-billboards-sky-ads-hyvs]
- The city is plastered with far more billboards: rooftop boards, Union Square and
  Moscone digital screens and Financial District rooftops, with many more on screen
  as you drive. Unsold ones run parody ads; tap one to buy the slot (soon).
  [gtasf-more-billboards-sky-ads-hyvs]
- A "Buy this billboard" badge now pops up on nearby boards — click it to open the
  slot page with the board's size and starting price. Checkout opens once the founder
  flips it on. [gtasf-buy-ad-slot-page-yxua]
- New: a "What's new" card now greets you after each update, and the full history
  lives at [gtasf.com/changelog](/changelog). [gtasf-q1no]
- Found a party we missed? Paste its lu.ma, Partiful or Eventbrite link in-game — once
  it passes a quick spam check it drops onto the map as a **community** event within
  minutes. [gtasf-v2-event-submission-tbzo] [gtasf-v2-submit-eventbrite-qf0a]
- The event calendar now refreshes itself every few hours, so the map keeps up with
  Tech Week all week long. [gtasf-v2-event-submission-tbzo]
- Press **M** for a redrawn city map: hand-drawn parchment, labelled neighbourhoods
  and a blip for every venue. Spin the wheel or pinch to zoom, drag to pan.
  [gtasf-v2-sa-map-ah1l]
- Click anywhere on the map to drop a waypoint — we snap it to the nearest street and
  draw the gold GPS line straight to it. [gtasf-v2-sa-map-ah1l]
- Tap a venue to see every party it's hosting this week in one card, then set your
  destination. [gtasf-v2-sa-map-ah1l]
- Every cheque now lands on your cap table — drive-through events, VC fund drops,
  celebrity angels and warm intros are all tracked as the backers of your startup.
  [gtasf-v2-captable-model-55qd]
- **Invite friends, raise faster.** When a friend joins via your link and actually plays,
  you bank a **$5M warm intro** on your cap table and they get a **$1M welcome cheque** —
  plus bonus rounds at 5 and 10 friends. All in-game funding, no cash. [gtasf-kk0]
- New: **VC fund drops** — every so often a fund announces a new round and a glowing
  gold checkpoint appears in the city. Drive or walk through it before 50 other founders
  do and a $250k cheque lands in your account. Watch the N/50 counter and the clock.
  [gtasf-v2-vc-fund-drops-27v2]
- **Sponsor a fund drop** (advertisers; coming soon): real VCs and startups can buy an
  upcoming drop and have it announced under their own name — their name leads the banner,
  the N/50 counter and the radar blip for that window. Paid, parody by default otherwise,
  and off until our card checkout goes live. [gtasf-v2-drop-sponsor-checkout-c41g]
- Got a thought? Press **F** anywhere to send feedback — it grabs a screenshot and
  your spot in the city so we know exactly what you mean. [gtasf-10kp]
- Every founder nearby now wears a nameplate: their startup, nickname, funding stage
  and total raised float above their head, GTA style, with chat bubbles above that.
  Now it fills in for everyone around you, not just the top-50 leaderboard — a founder
  you've never heard of still shows their startup and stage. [gtasf-5dlu]
  [gtasf-nameplate-funding-beyond-top50-zqnk]
- Click any founder to open their cap table — every event, VC drop, celebrity angel
  and warm intro that backed them, grouped with running totals. [gtasf-2r5r]

### Changed
- Street setup does less work while keeping the same lamps, trees and wires. [gtasf-c8sj.2]
- Fund notices update only when their text or status changes, keeping their per-frame work lighter. [gtasf-c8sj.3]
- Road loading does less repeated work before you enter the city. [gtasf-c8sj.1]
- Low graphics spends less work on hidden car detail and sky covered by buildings. [gtasf-c8sj]
- City street furniture takes fewer startup steps while keeping every prop and wire. [gtasf-c8sj]
- Event details now use the San Andreas panel style, with clearer controls on phones. [gtasf-v2-sa-restyle-tracker-ni5k.1]
- Phone street details load in smaller steps as you explore. [gtasf-d4zx]
- Ferry crowds pause their hidden rendering work on Low and return in full when you approach. [gtasf-joys]
- The pause-menu map reads cleanly across the whole city: district names no longer pile up on top of
  each other when you're zoomed out — the big neighbourhoods show first, and more names fade in as you
  zoom in. [gtasf-i801]
- The map now names the whole city, not just downtown: the Mission, Castro, Haight, Mission Bay, the
  Richmond and Sunset, Golden Gate Park, the Presidio, Twin Peaks, Noe Valley and more are all labelled
  as you explore out from the Embarcadero. [gtasf-z756]
- "You are here" on the map: your current neighbourhood's name now glows gold on the pause map (and
  never hides behind a busier label), so you can see at a glance where in the city you are. [gtasf-9x8a]
- Driving is far less twitchy: the steering now eases in and back over ~0.2s instead of snapping (on
  keyboard and phone), and the car is much calmer at speed while still turning tight when you're parking.
  [gtasf-car-handling-air-steer-6a92]
- San Francisco in full colour: the grey wash is gone and the city pops — painted-lady pastels,
  red-brick SoMa, white-and-blue FiDi glass, a deep-blue bay and a proper San Andreas sky.
  The fog sits back so you can see the skyline and the hills, and building facades now stay crisp
  and detailed far off into the distance instead of smearing into a blur. [gtasf-v21-vivid-colour-xv68]
- The city feels smaller on foot: walking is brisker and holding **Shift** (or pushing the stick all
  the way) now sprints — no stamina bar, sprint as long as you like. [gtasf-v21-walk-sprint-e1pc]
- Early birds get paid: drive through an event before Tech Week even kicks off and it now pays the
  full "upcoming" rate, not the "you missed it" rate — a preview is a head start, not a backmarker.
  [gtasf-v2-preview-funding-rate-4l0m]
- The HUD is going full San Andreas: blocky text with thick black outlines, SA money green,
  gold mission-style titles and flat pause-menu panels — no more soft rounded cards. The VC
  fund-drop banner and "cheque secured" toast lead the new look. [gtasf-v2-sa-hud-theme-7bwb]
- Driving is smoother and faster: the car no longer judders or lurches to a stop on
  bumps, kerbs and hills, it now tops out around 130 km/h with quicker acceleration and
  punchier steering, and your own car is never yanked around by the network. [gtasf-car-judder-speed-atpj]
- Getting funded is now drive-through, GTA checkpoint style: roll through an event
  marker — on foot or in a car — and the cheque lands on the spot. No more standing
  still for 20 seconds, and each event pays you once, ever. [gtasf-v2-drive-through-cdha]
- The funding ladder now runs the whole week: Pre-seed → Seed → Series A all the way
  to Series Z, then Unicorn, Pre-IPO, Decacorn and Hectocorn — reach Unicorn mid-week,
  and only the true grinders go beyond. [gtasf-v2-stage-ladder-bx2i]
- The SF sky now tints the whole city, San Andreas style: mornings settle into Karl
  the Fog's cool grey, and golden hour sets everything glowing amber.
  [gtasf-sa-daytime-grade-yaut]
- Roads look sharper as they stretch away: the worn asphalt and double-yellow lines
  stay crisp at the low angle you drive at instead of smearing into a blur.
  [gtasf-v2-render-cheap-wins-yjjz]
- The map is far less crowded: instead of a thousand pins it now shows one marker per
  venue for the next 24 hours, with a "+N" badge where a place has more parties later in
  the week. [gtasf-v2-radar-venues-sflu]
- The San Andreas look now runs start to finish: the invite screen, the loading poster, Game
  Options (radio and audio included), the "What's new" panel and the public changelog page all
  wear the same flat black pause-menu panels and gold outlined titles as the HUD — no stray
  rounded cream boxes left on the way in. [gtasf-4b6o] [gtasf-d5sn] [gtasf-ubz0] [gtasf-ia4y]
  [gtasf-xtcu] [gtasf-fben] [gtasf-jq1l]

### Fixed
- The top-right action buttons stay in two tidy rows again — the new Ride button had pushed them to a cramped third row. [gtasf-toolbar-two-rows]
- Save and restore panels keep their titles clear of the Close button on small phones. [gtasf-xupf]
- Tutorial objectives now sit above the phone HUD, keeping the connection status, clock and Game options readable. [gtasf-j97z]
- Robotaxi stops keep the road level at bridges and tunnels. [gtasf-1cd6]
- Your car brakes while you inspect a founder’s cap table or an ad slot, and closing the panel returns control cleanly. [gtasf-eln9]
- Replay tutorial closes Game options so you can jump straight back into the intro. [gtasf-onboarding-smoke-enable-24i2]
- Finishing your first Founder ID now offers Save your startup when recovery is enabled. [gtasf-onboarding-smoke-enable-24i2.1]
- Top-left HUD reads cleanly again on shorter screens: the neighbourhood and street name no longer
  pile onto the SAN FRANCISCO title or hide the place label — it's title, then area, then street. [gtasf-dymp]
- Your overhead nameplate no longer sits on top of the "E to get in / T to chat" prompt — the plate
  lifts clear of it. [gtasf-dymp]
- On phones, Map, Hail and GPS directions now appear when Founder Orientation teaches them, keeping your first steps clear. [gtasf-onboarding-smoke-enable-24i2]
- Angel and warm-intro cheques keep their source heading when they also close a round. [gtasf-v2-funding-browser-accept-b4wh]
- Small phones get more thumb room: movement and action buttons no longer overlap. [gtasf-4xdl]
- Phone tutorial directions name the buttons on your screen, and your car brakes while you create your founder. [gtasf-onboarding-smoke-enable-24i2]
- Click a nearby founder to see their cap table even when they are outside the top-50 leaderboard. [gtasf-2r5r.1]
- Nearby hints clear when you move on; phone prompts name touch controls and the movement tip stays above the stick. [gtasf-fn0s]
- Event cheques now show the same timing/preview bonus used in their actual payout. [gtasf-v2-funding-browser-accept-b4wh]
- Your radar remembers events you already collected, while venues with another cheque available stay bright. [gtasf-1h6o]
- Fund notices and quick hints stay clear of the title, buttons and clock on smaller desktops. [gtasf-dymp.1]
- The VC fund-drop banner is readable again: the first-drop tip no longer prints on top of the
  "<Fund> announces a new fund — come pitch!" banner, since the banner already says it. [gtasf-dymp]
- New founders now see the introduction even when the game has already created their profile. [gtasf-ye1r]
- Funding updates now retry calmly after a slow connection, without losing your displayed total. [gtasf-v2-funding-browser-accept-b4wh]
- Tap a venue on the radar to browse its events; open venue cards now keep up with calendar changes and updated destinations. [gtasf-80a0]
- First-fund hints stay below the fund banner and leave room for your phone controls. [gtasf-dymp]
- Founder setup marks your local name as ready while Friends is unavailable, without failed background requests. [gtasf-saeb]
- Street lamps and trees stay out of hillside junctions. [gtasf-6pf6]
- Tidier top-right HUD on desktop: the action buttons now pack into a compact couple of rows instead
  of a tall stack, so the San Andreas clock, FUNDING total and stars sit clean up top again and the
  Invite button no longer crowds the clock. [gtasf-hl9z]
- District search keeps your selection while you browse with the keyboard or mouse. [gtasf-9tjd]
- Map drags and cancelled touches no longer drop accidental waypoints. [gtasf-mdjn]
- The clock stays clear of desktop invite buttons, and phone Chat sits below live fund notices. [gtasf-e0el]
- The loading screen now recovers when a delayed city connection arrives, with **Reload city**
  available while you wait. [gtasf-osbg]
- Low graphics keeps the city colour while skipping expensive glow passes, leaving more room for smooth play. [gtasf-me27]
- Phone controls now make room for live fund drops. Find Add event under Game options → Tech Week. [gtasf-q2z9]
- The expanded map and its Close button now stay above the city sponsor banner. [gtasf-9evz]
- Search the map for districts such as Sunset, Ocean Beach and Twin Peaks, then set
  directions or hail a robotaxi. [gtasf-yp3j]
- Neighbourhood links now recognise all 24 district names and find a nearby street before loading,
  so sharing a point beside an empty map tile no longer strands the arrival. [gtasf-2lrv]
- **Spawn into any district without the camera stuck in a wall**: deep links and shared locations out in
  the wider city (Painted Ladies, the Mission, SoMa…) no longer leave the chase camera buried inside a
  grey block — it now keeps its distance from the outer city's low-detail buildings. [gtasf-q3r6]
- **GPS and robotaxis go anywhere in SF**: set a waypoint in the Mission, Dogpatch, Hayes Valley or out at Ocean
  Beach and the GPS line and your robotaxi now take you there, not just Ferry Building to Lombard. [gtasf-citywide-routing-graph-u4al]
<!-- integrator code-review fixes land here; see docs/review/2026-10-03.md -->
- The What's new card and the gtasf.com/changelog page now show **bold** words and links properly
  instead of printing the raw markdown. [gtasf-hpaj]
- Chat bubbles now float cleanly above the overhead nameplate instead of clipping into it — the
  speech sits over your startup and stage no matter how far away the founder is. [gtasf-chat-bubble-nameplate-stack-uegg]
- The "What's new" card now pops once for every update — even when we ship two in the same day, you'll
  see each one, and you won't see the same card twice. [gtasf-u59c]
- Getting funded no longer stops you: event payouts, VC fund-drop cheques and angel pitches now
  pop up as a quick on-screen card (event name + amount) that fades on its own and never grabs the
  wheel or the mouse — keep driving straight through. [gtasf-96rj]
- **The overhead wires are back**: the sagging power and Muni cables strung between poles — the most
  San-Andreas detail on the street — were silently dropping out of the render. They now draw crisply
  at every distance again. [gtasf-kpq1]
- No more rare black buildings: a wall-tint shader could divide by zero on a pure-black base colour and
  blank the whole facade; it's now guarded. Floating NPC name labels also render in the right colour
  space, so their gold reads as gold instead of a washed-out cream. [gtasf-b2hp]
- Crisper street signage: the floating **event names** you drive through and the **VC fund-drop** name
  tags now render in the correct colour space, so their gold and cream read true instead of washed-out. [gtasf-zibv]

## [2026-10-04] — Go-anywhere GPS, add-an-event & HUD polish

### Added
- **Add your own event**: paste a lu.ma, Partiful or Eventbrite link and — once it checks out as a
  real public SF event — it joins the map as a **community** event within minutes, tagged
  **COMMUNITY** on the map, the events list and its floating world label so it stands apart from the
  official Tech Week feed.
- **GPS and robotaxis now go anywhere in SF**: set a waypoint in the Mission, Hayes Valley or out at
  Ocean Beach and your GPS line and self-driving ride take you there — not just Ferry Building to
  Lombard.
- The signature San Francisco look is back: **overhead power and Muni wires** sag across the main
  streets again, from the Embarcadero to the Lombard hills.

### Changed
- Cleaner HUD: the invite/share button no longer overlaps the clock, and crowded panels no longer
  collide.

### Fixed
- Floating **event names** and **VC fund-drop** labels now read in true gold instead of washed-out
  cream.

## [2026-10-03] — First playtest build

### Added
- Spawn at the Ferry Building, walk the Embarcadero, hop in a car and drive the real
  Lombard Street switchbacks.
- Hail a self-driving robotaxi with **H** — it drives you across the city on its own.
- Ride the Powell–Hyde, Powell–Mason and California cable cars.
- Raise money across San Francisco: around 1,600 real Tech Week events show on your
  radar, and closing a round lights up your funding stage.
- A San Andreas look for the city: time-of-day sky and Karl the Fog, textured
  facades, palm trees, telephone wires, radio stations and street traffic.
- See other founders in the same city, with nearby chat and a live leaderboard.
