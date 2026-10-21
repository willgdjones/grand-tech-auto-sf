# GTASF asset-purchase proposals (PLAN-v2.1 decision 4)

Agents propose specific asset purchases here; the **orchestrator gets founder approval and the
founder buys** — agents never buy anything. **Total cap: $150**, shared between pane 11 (building
detail) and pane 12 (cars). AI 3D generation needs a **founder-provided key** (e.g. Meshy or Tripo).

Each proposal must list: the pack/service, URL, price, and a **web-use licence check** (the GLBs are
served publicly to every player's browser, so the licence must permit distributing the asset inside a
shipped/web game). Prices below were checked on 2026-10-03 and should be re-confirmed at purchase.

---

## FOUNDER DECISION — 2026-10-03: CC0 only (no paid packs, no AI 3D)

The founder decided: **CC0-only for now.** No paid packs, and no AI 3D (no Meshy/Tripo key).
The $150 shared cap and the AI-3D paths below are **shelved** — leave them recorded for history,
but do not act on them. Allowed sources for both panes: **procedural detail + Scenario 2D textures
(within the 10k-credit cap) + CC0 assets only.**

- **Pane 12 (cars):** proceed with **option C** — the chunkier retro / PSX-style CC0 car packs:
  Quaternius Low Poly Cars, rgsdev Free Low Poly Vehicles, ggbot PSX Style Cars (all CC0). Plus
  **Scenario paint, chrome and decal textures** within the credit cap to get closer to "textured,"
  and **3 LODs**. Ask **pane 6** for a visual check. Keep LICENSES.md accurate for each CC0 pack.
- **Pane 11 (building detail):** same rule — **procedural detail + Scenario textures + CC0 only.**
  The shipped building-detail geometry (rooftop clutter, cornices, awnings, fire escapes in
  `web/src/render/buildingDetail.ts`) is **100% procedural, no assets purchased — already compliant.**
  Any further "textured" push (e.g. roof textures) uses Scenario 2D or CC0 only, coordinated with
  pane 9 (facade/roof atlas). No proposal/purchase is pending for pane 11.

---

## Cars (pane 12) — gtasf-v21-sa-cars-uoon

### The gap
The current fleet (prius, model3, outback, robotaxi, vc-supercar, muni-bus, powell-cable-car) is
22–36 KB **low-poly Kenney Car Kit** GLBs with **baked linear vertex colours and no textures**
(`tools/assets/build.mjs`). The founder wants *properly modelled, textured, SA-style* cars: chunky
70s–2000s silhouettes, chrome, decals, readable at chase-cam distance, with 3 LODs.

**Free low-poly CC0 packs won't close this gap** — they're the same tier as the Kenney cars we
already ship (flat/vertex-coloured, modern or generic shapes). Reaching "textured SA-style with chrome
and decals" realistically needs **AI 3D generation** (cheap, controllable) or a **paid stylised pack**.

### Hard requirements for any source
- Output usable as **GLB**, Y-up, metre-scale, re-centred to ground origin (our `build.mjs` pipeline
  can convert/normalise/quantize; FBX/OBJ are fine as inputs).
- **≤ 300 KB per car** after meshopt + quantization (textures, if any, as one small shared atlas ≤ 1 MP).
- **Licence must permit public web distribution** of the asset embedded in a shipped game.
- 7 vehicle silhouettes: compact hybrid, sedan, trail wagon/SUV, absurd supercar, autonomous taxi
  (sedan/SUV base + our procedural lidar), city bus, and a Powell cable car (kept procedural).

### Options

**A. AI 3D generation — RECOMMENDED (best quality-for-price, needs a founder key).**
- **Meshy** — Plus plan **$15/mo** (commercial licence; text/image-to-3D + retexture), or pay-as-you-go
  ~**$0.40/model**. https://www.meshy.ai/
- **Tripo** — Pro plan **$19.90/mo** (commercial licence), or pay-as-you-go ~**$0.30/model**.
  https://www.tripo3d.ai/
- Generate textured SA-style cars from prompts ("chunky 1970s American muscle sedan, GTA San Andreas
  low-poly, worn paint, chrome bumpers"). ~7 cars ≈ **$3 pay-as-you-go**, or one month of either plan.
  Far under the cap. **Licence:** paid tiers grant commercial rights incl. distribution; free tiers are
  CC BY 4.0 (non-commercial) so we must be on a **paid tier**. **Needs: a founder-provided API key**
  (Meshy or Tripo) — that's the only blocker. I'd then wire the outputs through `build.mjs` for
  scale/quantize/LOD and keep LICENSES.md updated.

**B. Paid stylised pack — Synty POLYGON.**
- e.g. **POLYGON Pro Racer ~$139.99** (sale) / $199.99, or vehicle-containing City/Town/Heist packs.
  https://syntystore.com/products/polygon-pro-racer
- Textured, game-ready, consistent style — **but** (1) ~$140 is nearly the whole shared $150 cap (pane 11
  also draws on it); (2) Synty's look is its own stylised aesthetic, not GTA-SA specifically;
  (3) ships FBX/OBJ → we convert to GLB; (4) **licence** permits use in shipped games (confirm no
  resale/standalone-asset restriction before purchase). Lower priority than AI gen on both cost and fit.

**C. Free CC0 retro swap — $0, immediate, partial (silhouette only, still untextured).**
- Chunkier retro/muscle/PSX-style CC0 packs exist and read more "SA" than the modern Kenney shapes:
  - Quaternius Low Poly Cars (CC0): https://quaternius.itch.io/lowpoly-cars
  - rgsdev "Free Low Poly Vehicles Pack" (CC0, incl. muscle cars + sedan): https://opengameart.org/content/free-low-poly-vehicles-pack
  - ggbot "PSX Style Cars" (CC0 1.0, retro PS2-era look): https://ggbot.itch.io/psx-style-cars
- **$0, no approval needed.** Caveat: each pack has a different node structure, so `build.mjs` needs
  per-pack rework (our adaptations key off Kenney node names), and it's still vertex-coloured, not
  textured. Good as an interim upgrade and a fallback if no money/key is approved. **Pane 6 must
  verify the look** (I can't render).

### Recommendation
1. **Primary:** founder provides a **Meshy or Tripo key** (or approves ~$15–20 for one month / ~$3
   pay-as-you-go). Best textured-SA result, well under cap. I wire outputs through `build.mjs` + LODs.
2. **Interim / fallback ($0):** I swap to a chunkier CC0 retro base (option C) so the fleet reads more
   SA for the playtest even without spend, pending pane-6 visual sign-off.
3. **Not recommended now:** Synty (~$140) — too much of the shared cap for the SA-specific gain.

### What I need from the founder / orchestrator
- A **Meshy or Tripo API key** (unblocks the recommended path), **or** approval of a specific paid pack,
  **or** "CC0-only for now" (I proceed with option C). Pinging the orchestrator with this.

---

## Realistic renderer (pane 9) — FOUNDER DIRECTION 2026-10-04 19:30 ($500 budget)

The renderer upgrade (realistic / teleoperator look, behind `realisticRender`) needs **HDRI skies for
image-based lighting** and **PBR material textures**. **Both are fully covered by CC0 sources → $0
spend needed for the look.** The $500 budget is available if we later want premium assets, but the
renderer upgrade does **not** require any purchase.

### HDRI skies + IBL — Poly Haven (CC0, free, web-distributable)
Licence: **CC0** (public domain) — explicitly permits bundling/serving in a shipped web game. Source:
https://polyhaven.com/hdris (filter: Skies). Download **2K `.hdr`** (ample for web IBL; a 4K master can
be downsized), one per SF time-of-day bucket so `sampleTimeGrade` can pick the matching environment:

| SF time bucket | Look | Candidate Poly Haven slug (confirm on site) | URL |
|---|---|---|---|
| Midday clear | bright blue | `kloppenheim_06_puresky` | https://polyhaven.com/a/kloppenheim_06_puresky |
| Partly cloudy (typical SF) | soft marine layer | `kloofendal_48d_partly_cloudy_puresky` | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky |
| Overcast (Karl fog) | flat grey | `overcast_soil_puresky` | https://polyhaven.com/a/overcast_soil_puresky |
| Golden hour | warm amber | `venice_sunset` | https://polyhaven.com/a/venice_sunset |
| Dusk / blue hour | magenta-blue | `belfast_sunset_puresky` | https://polyhaven.com/a/belfast_sunset_puresky |
| Night | deep blue, stars | `dikhololo_night` | https://polyhaven.com/a/dikhololo_night |

Price: **$0 (CC0)**. Served as `.hdr` (or pre-converted to `.ktx2`/compressed env) under
`web/public/art/hdri/`, ~1–4 MB each at 2K — well within budget; load order matched to time of day.

### PBR material textures — Poly Haven / ambientCG (CC0, free)
For MeshStandard roads/buildings: asphalt, worn asphalt, concrete/kerb, brick, stucco — all **CC0**
from https://polyhaven.com/textures and https://ambientcg.com (albedo + normal + roughness + AO, 1–2K).
Price **$0**. Coordinate the building/road texture choices with pane 11 (facade/roof) and the roads pane.

### What I need from the founder / orchestrator
- Just **approval to use these CC0 Poly Haven / ambientCG assets** (no spend). The orchestrator confirms
  the exact slugs exist and downloads them to `web/public/art/hdri/` + the texture dirs. No key needed,
  no purchase. If a premium HDRI/texture pack is ever wanted, the $500 budget covers it, but it is not
  required for the realistic look.
