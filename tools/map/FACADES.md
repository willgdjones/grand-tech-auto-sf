# Streamed building facade detail

The original facade shader in `web/src/render/facades.ts` adds recessed divided
windows, stone frames and sills, floor bands and subtle masonry courses to source
building walls. It uses metre-scaled world coordinates after the GLB's quantized
node transform, including the correct normal transform. The pattern continues
across chunk boundaries and both LODs. Roof faces retain their source colours.

`prepareWorldGeometry()` applies it only to the map's untextured material named
`buildings`, behind `buildingFacades` and the existing `ps2Render` entry point.
Roads, terrain, authored landmarks and ads retain their own materials. Source
footprints, heights, collision, geometry and draw-call counts are unchanged.
There are no external textures or per-frame updates. Derivative antialiasing fades
fine detail with distance. The ordinary chunk material disposal releases each
converted material and restores the borrowed source material.

This is original stylised facade art, not a reconstruction of each real building's
windows. The scoped browser check passed on October 2 PT: native AMD Metal,
1280x800 Ferry plaza looking inland and Lombard street views, plus a 390x844
Lombard viewport. Windows, sills and floor bands are visible on the source
buildings; the Ferry landmark retains its authored arches. Roofs retain their
source colours. All shader/browser/chunk error lists were empty, and strict web
TypeScript plus the isolated Vite bundle passed.

Evidence is under ignored `tools/map/out/hill-smoke/facades/`: `report.json`,
`ferry-facades.png`, `lombard-facades.png`, `lombard-facades-phone.png`. The separate
hill smoke also traversed the complete switchbacks with these materials mounted.
Reproduce the material views using `node tools/map/hill-smoke.mjs --facades-only`
against a frozen local preview. The helper triggers the camera manual-look hold
before the inspection angle so ordinary automatic chase does not undo it.

The frozen material snapshot predates the separately checked compact phone HUD;
the phone image is material evidence, not acceptance of the old overlapping HUD.
This closes `gtasf-o0f`, not the broader deployed look or device-performance gate.
Generated facade atlas integration is tracked separately by `gtasf-z0n`.
