# Lombard hydrangea gardens

`gtasf-t06j` replaces the former coloured icosahedra under the existing `landmarks`
flag. Original Canvas textures provide immediate broad veined leaves, individual
four-petal florets, clipped hedge leaves and mulch. `gtasf-sqi3` upgrades leaves
and florets asynchronously with two bundled 512×512 alpha cards generated through
fal.ai; a missing image retains the painted fallback.
Four maps total 606,208 decoded pixels (2,424,832 RGBA bytes before mipmaps).

## Generated botanical cards

`tools/art/prompts/lombard-fal.json` records the FLUX.1 dev prompts and seeds,
Bria background-removal jobs, runtime hashes and conservative ledger reservations.
Photographs below informed the design but were not supplied to the models.
The two lossless WebP files under `web/public/art/foliage/` total 372,454 bytes
(leaves 191,624; petals 180,830). Each is 512×512 with transparent outer margins.
Four wrapper jobs reserved $0.40 total, below the lane's $10 limit; this is a
budget reservation, not a provider invoice. Source PNGs remain in ignored cache.

The cards were inspected on a dark background for leaf veins, distinct florets
and clean alpha edges. The loader smoke check and web TypeScript check passed.
Native HD/Low acceptance remains open in `gtasf-jhtg`; these asset inspections
do not establish the in-game look. Lane paused by the founder on 2026-10-04.

The original OSM centreline and garden footprint remain authoritative. Flower-bed
centres remain at least 4.15 m from the road centreline; low hedge/kerb segments
follow its margins. The smallest visible-geometry clearance is checked against
the 2.65 m road half-width. Terrain updates move all instances in place and refresh
their bounds. Disposal releases owned textures and instance buffers.

The garden uses five draws: soil, pale kerb, hedge, foliage and florets. Low
(`gfx=low`, `preset=low`, auto-phone or explicit `detail: far`) uses three heads
per bed; HD uses five. Both keep textured leaves/petals. Beyond 100 m from the
garden centre, HD reduces foliage and flower instance counts to the Low density.
There is no wind animation, blending sort or per-frame allocation.

## Reference review before modelling

These photographs were viewed on 2026-10-04 as visual references only. No reference
photo is shipped. They show low, clipped dark hedges rather than round green
boulders; broad veined leaves beneath small domed flower heads; pale concrete
curbs and visible brown soil; pink, cream, lilac and pale blue blooms.

- [Uphill approach and terraced beds, Royal Pacific Motor Inn](https://royalpacificmotorinn.com/gallery):
  [photo](https://images.squarespace-cdn.com/content/v1/5d3b3c47fa024000019ca6f1/1578114939202-CFRRGIFTK5AWO30VTGAO/lombard.jpg).
  Continuous low hedge ribbons frame each turn; flowers occupy the interior.
- [Pedestrian stair approach, Bridge and Tunnel Club](https://www.bridgeandtunnelclub.com/bigmap/outoftown/california/sanfrancisco/russianhill/lombardstreet/):
  [photo](https://www.bridgeandtunnelclub.com/bigmap/outoftown/california/sanfrancisco/russianhill/lombardstreet/11lombardst.jpg).
  Hydrangea leaves carry most of the mass; the heads vary in size and elevation.
- [Oblique garden close-up, Refinery29](https://www.refinery29.com/en-us/2019/04/230441/san-francisco-lombard-street-tourists-pay-proposal):
  [photo](https://s1.r29static.com/bin/entry/a65/x,80/2166471/image.jpg).
  Distinct florets, clipped boxwood, restrained pale kerbs and mulch, rather than
  solid pink polygons or coloured paving slabs.

## Centralised visual acceptance

Per the founder check budget, lane 7 runs only the focused unit file and web
strict. Pane 6 owns the candidate's in-game look: `?at=37.8021,-122.4187,90&gfx=hd`
and the same view with `gfx=low` (phone and desktop); inspect uphill and downhill
for foliage density, non-faceted blooms, clear road edges and loaded terrain
contact. Also inspect the farther approach for LOD continuity and console errors.
Source checks alone do not close the visual acceptance or device/FPS gates.
