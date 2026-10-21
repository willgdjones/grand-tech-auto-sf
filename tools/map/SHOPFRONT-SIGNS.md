# Reviewed shopfront signs

The existing four-row `shopfront-signs.png` artwork is placed on selected exterior
walls through the streamed map renderer. Its source and generation ledger remain
in `web/public/art/props/signs-manifest.json`; this integration generates no art.
One 512x512 sRGB image and one Lambert material belong to each city scene. The
loader validates its SHA-256, dimensions, local path and all four named row
rectangles. Failed or aborted loading leaves signs absent and the normal facade
material intact.

Placement borrows existing collision footprints, the 65x65 source heightfield
and the road snapper. It chooses a wall at least 6 m wide whose exterior normal
faces a mapped road within 22 m; adjoining-building, steep-ground and insufficient
wall-height candidates are rejected. Sign width is at most 4.8 m, with its full
label upright and oriented to the viewer outside the wall. Its centre is 3 m
above the sampled ground; a 0.28 m wall offset clears both source LODs. This is
fictional shop dressing, not real business or event-venue attribution.

The selection is deterministic and sparse, capped at 18 signs per chunk, with
one merged mesh/draw call per populated chunk and no per-frame placement scans.
Whole footprints duplicated across collision chunks are assigned a canonical
wall and deduplicated within the scene. The authored Ferry Building is excluded.
Building geometry, collider footprints, road/terrain contact, landmarks and ads
retain their existing behavior.

`ps2Render` and `buildingFacades` guard scene entry. `loadLombardWorld` supplies
borrowed placement context before mounting geometry; the foundation owns mount
and release callbacks. Chunk release removes and disposes only its sign geometry.
Scene disposal aborts pending loads, disposes the shared material/texture and
closes the bitmap. Late completions cannot recreate disposed signs.

The focused check is `node tools/map/shopfront-signs-smoke.mjs`. Use
`--prepare-only` to build its small frozen renderer before a GPU slot and
`--run-only` to run that prepared fixture. It exercises the actual chunk streamer
on the source map, one shared image request, per-cell bounds and unique building
IDs, then chunk/scene disposal. Desktop and touch screenshots are material and
placement evidence; this is not a real-device or performance gate.

Verified 2026-10-03: strict web TypeScript and the fixture bundle pass. The native
Metal Chromium check passed at Ferry (1280x800) and Lombard (390x844 touch), with
zero console or map errors. Reviewed screenshots show upright, complete labels
on the textured walls. The source scenes contained 24 and 125 signs respectively,
with at most 18 per batch, no duplicate building IDs and one 110,692-byte image
request per scene. Both teardowns removed every sign/batch and disposed the scene
resource. Evidence: `tools/map/out/shopfront-signs-smoke/report.json`,
`ferry-desktop.png` and `lombard-phone.png`. The portrait inspection camera is
12 m from its selected wall so the full label fits; gameplay camera is unchanged.
