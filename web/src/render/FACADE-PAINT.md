# Victorian wall paint

Source implementation for `gtasf-painted-lady-colour-variety-mv1y`.

The PS2 facade shader now uses the existing seven `paintedLadyPalette.ts` body
colours after source land-use, district and ground-floor storefront classification.
The original vertex colours still select office, industrial and retail uses;
repainting no longer needs a separate baked attribute or a map rebuild. Only the
Victorian clapboard atlas cell (slot 0) receives paint. Roofs, other atlas styles,
storefronts and the realistic renderer are unchanged by this patch.

The selection uses the existing stable whole-building colour hash, scrambled so
district style ranges can draw from all seven colours. Adjacent buildings can
share a colour; there is no adjacency guarantee. `THREE.Color` converts the
authored sRGB hex palette to linear values. The reviewed atlas's crop is recorded
in `web/public/art/manifest.json`: the shader protects its central decorated
window/sill and top cornice, retaining luminance variation on the clapboards.
Window-emission detection runs on the original sampled art before painting.

The existing `buildingFacades` flag controls the entry point. No flag flip,
texture, geometry, per-frame JavaScript work or map download was added. Both the
normal and half-resolution atlas use the same normalized mask and palette.

Validation on 2026-10-04: the existing palette and district-source checks passed
(6 checks total) and web strict TypeScript passed, serialized through
`tools/heavy.sh`. These do not compile GLSL or establish visual acceptance.

The later normal-renderer Noe Valley desktop (1440x900) and phone Low
(390x844, DPR 2.75) capture reached READY and connected with zero recorded
runtime, console or HTTP errors. Evidence:
`artifacts/coastline-look/2026-10-04T06-47-59.552Z/report.json`,
`noe-desktop.png` and `noe-phone.png`. DarkMarsh reviewed both images. The nearby
wall uses the stone/storefront treatment and the old coarse bake omits most
neighbouring houses, so these views do **not** establish the Victorian paint,
colour variety or preserved trim. No visual gate is closed from this capture.

The subsequent frozen candidate district capture supplies useful clapboard
views. DarkMarsh reviewed `castro-desktop.png`, `castro-phone.png`,
`glen-park-desktop.png` and `glen-park-phone.png` in
`artifacts/district-static/2026-10-04T07-49-16.026Z/views/`. Their `report.json`
records normal, non-capture PS2 rendering at noon: desktop 1440x900 and phone
390x844, DPR 2.75, preset Low. All four reached READY and connected, with no
recorded runtime/console errors, HTTP errors or network failures, and no source
drift during capture.

Glen Park shows tan and dusty-blue clapboard buildings with the same cream
cornice and teal vertical glazing; Castro adds a muted mauve-grey frontage.
The authored central windows, sills and cornices remain recognizable, as do the
green/gold storefronts and grey roofs. Adjacent brick and stone treatments keep
their distinct appearance. These views establish local PS2 wall-paint variety
and retained detail on desktop and phone; they do not show every palette colour
or establish any adjacency guarantee.

The frozen app is `/tmp/gtasf-d5-after-dist`, source SHA-256
`868757736ebf135f9e9611f776be8cb97079a50d2819e55f391f80895a378dba`, with candidate
map manifest SHA-256
`ed862ff9f052223d427e30eebd163f409ee7299fe9fda7ef2c9fd484996e9522`.
Its `assets/game-Cv6Yz2_V.js` includes the `uFacadeBodyPaint` shader uniform.
The local PS2 visual smoke is accepted and this bead is complete. The broader
district bake/payload/device gates remain in `gtasf-tm7m`; the realistic renderer
has separate acceptance and is not covered by this review.
