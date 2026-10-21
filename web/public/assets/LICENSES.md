# GTASF 3D asset licences

All models in this directory are **CC0 1.0 Universal**, except `avatars/meshy-*.glb`: Meshy-6 generations on GTASF's paid
Meshy plan (owned by GTASF under Meshy's paid-plan terms; not CC0) — see PROVENANCE.md and `tools/art/meshy-ledger.json`. Source pages and download
hashes were checked on 2026-10-03. Licence: https://creativecommons.org/publicdomain/zero/1.0/

| File | Creator / original | GTASF adaptation |
|---|---|---|
| `vehicles/prius.glb` | Kenney Car Kit 3.1, `hatchback-sports.glb` | Silver hybrid hatchback silhouette and proportions inspired by Prius |
| `vehicles/model3.glb` | Kenney Car Kit 3.1, `sedan.glb` | White compact electric sedan proportions inspired by Model 3 |
| `vehicles/outback.glb` | Kenney Car Kit 3.1, `suv-luxury.glb` | Green long-roof wagon, roof rails, Outback-like proportions |
| `vehicles/muni-bus.glb` | Kenney Car Kit 3.1, `van.glb` running gear | New flat-front city-bus body, doors, windows, HVAC and red/white SF transit livery |
| `vehicles/robotaxi.glb` | Kenney Car Kit 3.1, `suv-luxury.glb` | White body, roof sensors and separate named `lidar` rotor; no Waymo logo |
| `vehicles/vc-supercar.glb` | Kenney Car Kit 3.1, `race-future.glb` | Magenta body and an excessive rear wing |
| `vehicles/powell-cable-car.glb` | Kenney Train Kit 1.1, `train-tram-classic.glb` running gear | New timber body with open benches, running boards, brass posts and clerestory roof; trolley collector removed |
| `avatars/hoodie.glb` | Quaternius Ultimate Modular Men Pack, Hoodie Character | Rig retained; idle/walk/run clips retained and renamed; GTASF-authored seated breathing loop added; unrelated clips removed |
| `avatars/business-man.glb` | Quaternius Ultimate Modular Men Pack, [Business Man](https://poly.pizza/m/JFrLIKqvCH) | Same rig as the hoodie; idle/walk/run retained and renamed; GTASF-authored seated loop added; other clips removed; uniform metre frame (1.78 m) |
| `avatars/casual-man.glb` | Quaternius Ultimate Modular Men Pack, [Casual Character](https://poly.pizza/m/kZ3DmIoGip) | Same rig as the hoodie; idle/walk/run retained and renamed; GTASF-authored seated loop added; other clips removed; uniform metre frame (1.76 m) |
| `avatars/beach-man.glb` | Quaternius Ultimate Modular Men Pack, [Beach Character](https://poly.pizza/m/DojKLcO34E) | Same rig as the hoodie; idle/walk/run retained and renamed; GTASF-authored seated loop added; other clips removed; uniform metre frame (1.75 m) |
| `avatars/worker-man.glb` | Quaternius Ultimate Modular Men Pack, [Worker](https://poly.pizza/m/Yg2bQZO6Hj) | Same rig as the hoodie; idle/walk/run retained and renamed; GTASF-authored seated loop added; other clips removed; uniform metre frame (1.77 m) |
| `avatars/punk-man.glb` | Quaternius Ultimate Modular Men Pack, [Punk](https://poly.pizza/m/BTALZymknF) | Same rig as the hoodie; idle/walk/run retained and renamed; GTASF-authored seated loop added; other clips removed; uniform metre frame (1.76 m) |
| `avatars/casual-woman.glb` | Quaternius Ultimate Modular Women Pack, [Animated Woman](https://poly.pizza/m/qJ2gsTUBHL) | Same rig as the hoodie; idle/walk/run retained and renamed; GTASF-authored seated loop added; other clips removed; uniform metre frame (1.66 m) |
| `avatars/formal-woman.glb` | Quaternius Ultimate Modular Women Pack, [Animated Woman](https://poly.pizza/m/nIItLV9nxS) | Same rig as the hoodie; idle/walk/run retained and renamed; GTASF-authored seated loop added; other clips removed; uniform metre frame (1.67 m) |
| `avatars/punk-woman.glb` | Quaternius Ultimate Modular Women Pack, [Punk](https://poly.pizza/m/djXoqejw6w) | Same rig as the hoodie; idle/walk/run retained and renamed; GTASF-authored seated loop added; other clips removed; uniform metre frame (1.65 m) |

These are stylised, logo-free adaptations, not manufacturer-authored or exact
vehicle replicas. Kenney and Quaternius do not endorse GTASF. Brand names in the
manifest describe visual references only.

## Source records

- [Kenney Car Kit](https://kenney.nl/assets/car-kit), version 3.1. Its bundled
  `License.txt` identifies Kenney and Creative Commons Zero (CC0).
- [Kenney Train Kit](https://kenney.nl/assets/train-kit), version 1.1. Its bundled
  `License.txt` identifies Kenney, with additional credits to Guus Vermeulen and
  Tony Schaer, under Creative Commons Zero (CC0).
- [Quaternius Ultimate Modular Men](https://quaternius.com/packs/ultimatemodularcharacters.html),
  February 2022. The creator's page identifies CC0. The original public Drive
  distribution was quota-limited, so the file was downloaded from
  [Quaternius's Hoodie Character listing on Poly Pizza](https://poly.pizza/m/gKLBoRsyKe),
  also marked CC0 1.0. The [pack listing](https://poly.pizza/bundle/Ultimate-Modular-Men-Pack-ZiH8muWqwQ)
  attributes its rig and animations to Quaternius.
- CC0 pedestrian bodies (gtasf-laned-cc0-characters-km1i6, checked 2026-10-14): eight more Quaternius Ultimate
  Modular Men / [Women](https://quaternius.com/packs/ultimatemodularwomen.html) characters, each downloaded from its
  own Poly Pizza listing, every one of which reads "Public Domain (CC0)". Poly Pizza marks some other uploads from the
  Women pack (Suit, Worker, Sci-Fi, Soldier, Witch) as CC BY 3.0, so those are deliberately NOT used even though the
  creator's pack page says CC0. Source URLs and SHA-256 hashes are pinned in `tools/assets/build-people.mjs`; output
  hashes are in `tools/assets/report-people.json`.

GTASF-authored geometry, colour changes and the sitting clip are also dedicated
under CC0 1.0. No Mixamo animations, manufacturer marks, or additional texture
licences are included. All palette images are baked into linear vertex colours;
the delivered GLBs have no external resources or images.

Exact download URLs, source hashes, output hashes, sizes and original filenames
are recorded in `tools/assets/sources.json` and `tools/assets/report.json` in the
repository. Optimisation uses glTF Transform deduplication, resampling,
quantization and meshopt compression. These tools' software licences do not
replace the content licences above.

## Realistic vehicles (`vehicles-pbr/`, Meshy-generated, not CC0)

The files under `vehicles-pbr/` (`<asset>.glb` HD and `<asset>.low.glb` phone LOD)
are **GTASF-commissioned AI-generated models** made with [Meshy](https://www.meshy.ai)
(Meshy 6 text-to-3D with PBR textures) on GTASF's **paid Meshy plan**, whose terms
assign output ownership to the subscriber and permit **commercial use**. They are
not CC0 and are not redistributed as a separate asset pack. Generated 2026-10-03
(gtasf-u9n0); founder approved the Meshy spend.

- Prompts describe generic vehicle types only and require **no logos, badges, text or
  plates**. The robotaxi is a parody electric crossover with a roof sensor pod; it
  carries no Waymo or Jaguar marks. Other cars are generic sedan, hatchback,
  wagon/SUV, delivery van, yellow cab, city bus, Powell-style cable car, supercar,
  food truck and e-scooter shapes; brand names in labels describe visual references only.
- Every prompt, Meshy task id, credit cost and output hash is recorded in
  `tools/art/meshy-ledger.json`; conversion (re-orientation to Y-up/+Z forward,
  metre scale, ground origin, simplification to HD <=30k / Low ~5k triangles, WebP
  texture resizing under 1 MP decoded, meshopt quantization) is in
  `tools/assets/build-meshy.mjs`, with sizes and hashes in `tools/assets/report-meshy.json`.
- These models load only behind the `realisticRender` flag; the CC0 kit above
  remains the default fleet.

## Realistic facade 3D pieces (`assets/facades-pbr/`, Meshy-generated, not CC0)

The GLBs under `web/public/assets/facades-pbr/` (`<piece>.glb` HD and `<piece>.low.glb`)
are **GTASF-commissioned AI-generated models** made with [Meshy](https://www.meshy.ai)
(Meshy 6 text-to-3D with PBR textures) on GTASF's **paid Meshy plan** (commercial use;
output owned by the subscriber). Not CC0. Generated 2026-10-04
(gtasf-realistic-facade-meshy-pieces-xyrw); shares the cars pane's approved Meshy spend.

- Generic reusable architectural pieces only — SF bay window, iron fire escape, cornice,
  awning, storefront, ornate stone entrance, wrought-iron balcony — to be instanced procedurally
  onto building footprints. Prompts require **no logos, badges, text or signage lettering**;
  the storefront's sign band is blank.
- Every prompt, Meshy task id, credit and output hash is in `tools/art/meshy-ledger.json`
  (`facade-*` entries); conversion (centre, base on Y=0, scale to real height, HD <=14k /
  Low ~3k triangles, <=1 MP WebP PBR, meshopt) is `tools/assets/build-facade-pieces.mjs`,
  with sizes/hashes in `tools/assets/report-facade-pieces.json`.
- They load only behind `realisticRender` + `realisticFacades`; distinct from the
  Scenario facade texture atlas below (`art/facades-pbr/`).

## Realistic facade PBR atlas (`art/facades-pbr/`, Scenario-generated, not CC0)

The packed atlases under `web/public/art/facades-pbr/` (`albedo.jpg`, `normal.jpg`,
`arm.jpg`) drive the realistic procedural facades (gtasf-2rup), applied per
district/building type by `web/src/render/realisticFacades.ts` behind the
`realisticRender` + `realisticFacades` flags. The **shipped atlas is
Scenario-generated** (founder 2026-10-04 BUILDINGS direction): twelve realistic
albedo texture modules (SoMa brick, FiDi stone, stucco, Victorian clapboard, Mission
mural, glass curtain wall, concrete, storefront, painted brick, plus 2nd variants —
civic granite, Marina stucco, Pacific-Heights clapboard) made with Scenario's hosted
**FLUX.1 Dev** 2D model from text prompts only. Prompts describe generic SF building
types with **no logos, no text, no real storefront signage, no real people**. The
normal and ARM (AO/roughness/metalness) maps are **derived deterministically** from
each albedo by `tools/art/pack-facades-pbr.mjs` (no extra generation). This generated
artwork is **not represented as CC0**; every prompt, generation id, seed, output hash
and credit cost is recorded in `tools/art/ledger.json` and the atlas manifest. See
PROVENANCE.md.

A CC0 **alternate base** also exists for this atlas (optional extra, not the shipped
art): `tools/art/realistic-facades.mjs` packs four [Poly Haven](https://polyhaven.com)
scans under **CC0 1.0** — `brick_wall_001` (Rob Tuytel, Dimitrios Savva),
`sandstone_blocks_08` (Rob Tuytel), `painted_plaster_wall` (Amal Kumar),
`concrete_wall_008` (Dario Barresi, Charlotte Baglioni) — verified against Poly
Haven's API md5. Those scans are genuinely CC0; run that tool to regenerate the
atlas from them instead.
