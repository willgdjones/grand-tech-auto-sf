# A living map: individual events, real SF places, angels and VCs to pitch

## Context
On the full map and minimap, Tech Week shows up as mysterious numbered circles. Each circle is a count of events at a venue over the next 24 h, so it never says what is actually happening. The 3D world reads better. The founder wants:
- individual events visible;
- the minimap "busy with interesting things": angels to pitch, company offices, events;
- the real SF tech landscape on the map: AI labs, big tech HQs, hacker houses, VCs, startups;
- an instant-feeling robotaxi.

The player's job is **ambient awareness**: feel how alive the city is, and spot something worth driving to.

Founder decisions, from the grilling:
- **Events:** show live now + next 2 h, each as its own pin with a type icon. **Titles appear as you zoom in** on the full map.
- **Map layout (B):** real **places are the base layer** and are always there. A place hosting something live glows and shows the event. Events at non-place venues (bars, galleries) get their own pins.
- **Places:** AI labs and big tech HQs, hacker houses and coworking, VCs and accelerators, and the startup long tail.
  - Sources: a hand-curated ~150 key places, plus **Apollo top ~500 SF companies (≤200 credits)**.
- **Branding:** **real names + logos now, removed on request.** The founder accepts the trademark risk. We add a visible "Report / request removal" path.
- **In-world:** a logo + name sign on the real building.
- **Gameplay:**
  - **check-in stamps** at places;
  - a **place card** with live info;
  - **spoken pitches** at VC offices and to **wandering angel NPCs** (👼). Hold 🎙 and pitch for up to 15 s. An AI partner scores it and pays a cheque.
  - **All pitch payouts are modest**, about the size of an event payout.
- **Judge AI:** a cheap fast model via OpenRouter (key already provisioned), with a **$10/day cap** and a simple fallback score over the cap.
- **Minimap:** busy with type icons (🏢 HQ, 🏠 hacker house, 💰 VC, 👼 angel, 🎤🍾🛠🤝 events) plus a nearest-live ticker.
- **Robotaxi:** a **quick cinematic jump**. Hail, then a 1–2 s swoosh: the camera lifts, the city blurs, and you drop at the venue. Fare charged, no waiting for a car.

## What exists (reuse)
- **Radar/minimap and full map:** `web/src/radar/radar.ts`.
  - `drawVenueBlips` :625-662 is the numbered circles; the count is `group.focus.length` over a 24 h window.
  - Also: `paintEventBlip` :584, `openVenue` venue card :349, `select` event card :465, zoom 1–8× and pan :233-247.
  - Kinds and glyphs come from `classifyEventKind` (`shared/content/eventKinds.ts`); legend at :79-89.
- **Grouping and focus window:** `shared/eventVisibility.ts`. The ~100 m venue key is at :59-86. The 24 h focus window, minimum 30 events, is at :12,25-38.
- **In-world:** `web/src/events/markers.ts` (rings, `markerLabel`), `worldLabels.ts` (60 labels on HD / 6 on phone, de-overlap), `worldEventLinks.ts`.
- **Events panel:** `web/src/events/upcoming.ts` (J; Live/Today tabs, search, nearest sort).
- **Data:** `RadarEvent` model (radar.ts :18-25). There's no RSVP count. The feed comes from `/api/events` via `web/src/events/feed.ts` (busiest day 411 events).
- **Navigation:** `selectEvent` (`main.ts:803`), robotaxi `web/src/hud/robotaxiPicker.ts` with choices at `main.ts:636-659`.
- **Speech:** `web/src/voice/caption.ts`, plus WorldDO `handleCaption` (Workers AI Whisper, jev moderation, spend meter in `voice_caption_spend`).
- **Money:**
  - funding credits: `recordCredit` / `funding_credits`, sources `event` etc.;
  - the existing `becomeAnAngel` and `celebNpcs` flags and NPC code.
- **Apollo:** `tools/gtm/apollo.ts`, a reviewed plan digest with a `maxCredits` gate.
- **Buildings:** DataSF footprints in the map bake (`tools/map/src/pipeline/buildings.ts`), used to snap a place to its real building.

## Approach (three phases, each behind flags, shipped continuously after look/phone checks)

### Phase 1: map clarity + robotaxi (day work)
1. **Event pins v2** (flag `eventPinsV2`).
   - Replace the numbered venue circles with **one pin per live / next-2 h event**, carrying its kind icon. Live pins pulse; starting-soon pins are dimmer and show "7pm". Ended events are hidden.
   - On the full map, **titles fade in from zoom ≥ 3**, collision-free. This reuses the worldLabels de-overlap idea in screen space.
   - Several events at one venue: the pin shows the live (or next) one plus a small "+N today" badge. Tapping opens the existing venue card.
   - Change `eventVisibility` so the radar uses a "now + 2 h" window, while the J panel keeps its tabs.
2. **Minimap clues** (flag `minimapClues`).
   - Type icons instead of circles, with live and soon events at a distance-limited density.
   - A one-line **ticker** under the minimap cycling the 2–3 nearest live things: "🎤 AI agents demo · South Park Commons · 120 m ↗".
   - Places and angels plug in during phases 2–3.
3. **Robotaxi jump** (flag `robotaxiJump`).
   - Hailing from the picker, J panel or event card skips the car's approach and drive.
   - A 1–2 s cinematic: camera lift, motion blur and fade, then a road-snapped drop at the destination, preloading the target chunk behind the blur.
   - The fare is charged as today (server-authoritative); money logic is unchanged.

### Phase 2: real SF places
4. **Places dataset** (`tools/places/` → `web/public/data/places.json`, flag `placesLayer`).
   - A curated ~150 entries: name, kind (`lab` | `bigtech` | `hackerhouse` | `vc` | `accelerator` | `startup`), address, website, one-line blurb.
   - Plus Apollo org search for the top ~500 SF-HQ companies by headcount/funding, at **≤200 credits** through the existing `apollo.ts` gate. Planned digest, not over the cap.
   - Geocode each place and snap it to its DataSF building footprint.
   - Long-tail startups only appear when zoomed in.
5. **Logos** (flag `placeLogos`).
   - For each place, fetch its own website's logo (apple-touch-icon / og:image / svg favicon). Normalise to a 128 px WebP atlas on R2 under ~1 MB, and fall back to a lettermark.
   - A **"Report / request removal"** link on every place card. It posts to the feedback route with `kind:'takedown'`; a denylist in D1 hides the logo immediately.
   - Record the takedown policy in `PROVENANCE.md`.
6. **Map and world display.**
   - Places are the base layer on the full map and minimap, with icon + name when zoomed in.
   - A place hosting a live event glows and shows the event line underneath.
   - In-world, a **logo + name sign** sits on the real building: a lobby sign for low-rise, a rooftop/crown sign for towers. Instanced from the atlas, HD-only beyond 150 m and capped count on Low.
7. **Place card + stamps** (flag `placeStamps`).
   - The card shows kind, blurb, website, events there today, players nearby and a GO button.
   - Entering a place's ring stamps it ("SF pilgrimage: 12/150"). Stamps are stored server-side per device in D1, with a shareable stamp card.

### Phase 3: pitching (money logic, server-authoritative + unit tests)
8. **Angel NPCs** (flag `angelNpcs`).
   - About 6–10 named angel characters roam busy areas and live events, shown as 👼 on the minimap.
   - They come from the existing NPC/celeb system. The server spawns them in WorldDO so everyone sees the same angels. They move on after a pitch, and new ones appear through the day.
9. **VC offices:** the places with kind `vc` / `accelerator` get a pitch ring at the door.
10. **The pitch** (flag `pitching`).
    - Within 4 m of an angel or VC ring, holding 🎙 records up to 15 s. This reuses `caption.ts` and the Whisper route.
    - The server then:
      1. moderates the transcript (jev);
      2. sends it to a cheap fast OpenRouter model for a 0–10 score and a one-line deadpan verdict;
      3. pays a **modest cheque** (about 0.5–1.5× an event payout, scaled by score) via `recordCredit` with source `pitch`;
      4. shows the verdict as the investor's spoken bubble.
    - Cooldowns: one pitch per angel per player, and one per VC per player per day. Per-device budget plus a daily cap.
    - The **$10/day judge spend meter** reuses the caption meter pattern. Over the cap, a fallback keyword/length score applies.
    - Unit tests cover payout bounds, cooldowns, cap and fallback, and moderation rejection paying nothing.

## Founder steps
- None blocking: the OpenRouter key and Apollo key exist.
- Optional: hand-check the curated 150 list. An agent drafts it, and the founder can skim it.

## Work breakdown (2 Claude agents)
- **Agent A:** phase 1, items 1–3 (day). Then phase 2 display, items 6–7.
- **Agent B:** places dataset + Apollo + logos (items 4–5). Then phase 3 pitching (items 8–10), with tests.
- Each phase ships when it's ready, after a photo + phone check, per the continuous-ship policy, with funnel monitoring.

## Verification
- **Unit tests** (money/server only): pitch payout bounds and cooldowns, judge cap and fallback, stamps idempotency, takedown denylist.
- **Headless phone + desktop:**
  - the full map at zoom 1, 3 and 6 shows individual live pins, then titles;
  - the minimap shows icons and a ticker at the Ferry and SoMa;
  - a robotaxi jump lands at the venue in ≤ 2.5 s without errors;
  - a place sign is visible on the building (Salesforce Tower, South Park Commons);
  - a pitch with a WAV clip at a VC ring pays a modest credit and shows the verdict bubble.
- **Live:** ship each flag batch with an hour of funnel monitoring (loading READY rate, landing→play) and roll back on a large drop.
