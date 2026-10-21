# Reviewed SF facade atlas integration

The renderer consumes the reviewed `/art/manifest.json` and its eight named cells
from the 1024x512, 62,815-byte SF facade atlas. The manifest supplies each cell's
pixel rectangle and repeat dimensions in metres. The loader validates dimensions
(at most 1 MP), same-origin facade path, SHA-256, unique named cells, rectangles
and repeat sizes before exposing the texture to materials. Atlas selection and
generation provenance remain owned by `tools/art` and its shared budget ledger.

One texture and decoded bitmap belong to each city scene. Chunk materials share
that texture. Existing procedural windows remain visible while it loads or if
validation fails. The image uses sRGB decoding, nearest magnification, linear
minification, copied atlas gutters and no cross-cell mipmaps. Its bitmap is
flipped at decode because WebGL ignores `Texture.flipY` for ImageBitmap sources.
Fine texels fade with projected size before distant facades can shimmer.

Wall projection uses world metres after each quantized GLB node transform. Source
land-use colour ratios and a coarse city region select residential, downtown,
industrial and retail styles. This is stylized material assignment, not a claim
to reconstruct each real building. Roofs, authored landmarks, roads and ads keep
their own materials; source geometry, height and collision remain unchanged.

A darker ground-floor band follows the existing GTHF terrain. Each building
chunk borrows its decoded 65x65 field and owns one 16.9 KB float texture. The vertex
shader bilinearly samples it on wall vertices; there are no per-frame CPU scans,
new meshes or draw calls. Downtown/retail ground floors use the unbranded
storefront cell; residential bases receive a subtle darker band. Upper floor
patterns stay level in world height. Terrain interpolation along a long wall is
a visual approximation between its vertices, not a new contact surface.

Chunk unmount restores source materials and disposes converted materials and its
ground texture. Scene disposal releases the shared texture and closes its bitmap;
an aborted or late image load cannot recreate resources after scene disposal.
Everything enters through the existing `ps2Render` and `buildingFacades` flags.

The scoped check is `node tools/map/facade-atlas-smoke.mjs --app=<frozen-web-build>`.
It uses real map assets and the existing local API, waits for the atlas to be
ready (so procedural fallback alone cannot pass), records desktop and phone
screenshots, and exercises actual chunk teardown. It does not establish a
deployed look gate or device-performance acceptance.

The 2026-10-03 06:32 UTC smoke passed on native AMD Metal with zero shader,
runtime or chunk errors. Reviewed screenshots show correctly upright sash windows
and horizontal trim on Lombard, and stone/glass upper floors with storefront
bases facing the Ferry plaza. Desktop views are 1280x800; the Lombard touch view is
390x844. All three scenes requested the 62,815-byte atlas once, and chunk teardown
returned atlas material references and mounted ground fields to zero. Evidence is
in `out/facade-atlas-smoke/report.json` and its three PNGs. Strict web TypeScript
passes. This frozen 06:21 app is material evidence; later funding and phone HUD
changes have their own integration checks.
