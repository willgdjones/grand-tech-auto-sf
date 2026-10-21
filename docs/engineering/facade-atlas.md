# Facade atlas: citywide realistic buildings (founder-approved, Oct 4)

Technique (studied from public three.js SF projects; ALL assets are our own; never copy anyone's files):
whole-building FRONT images at true scale, assigned per building by style rules, plus tiling PBR materials and tree impostors.

1. **Facade atlas** (owner: Claude 0.2)
   - About 120 original front-elevation images generated with fal (tools/art/fal.mjs, ledger, at most $10), orthographic and evenly lit, in 6 SF residential styles × about 16: Victorian `vic`, Edwardian `edw`, mixed-use `mix`, brick `brk`, apartment `apt`, shopfront `shop`; plus about 16 `office` (downtown mid-rise), about 8 `tower` (glass high-rise).
   - Each cell gets metadata in `web/public/art/facades/atlas.json`: real width/height in metres, window rectangles (for night lighting), bay windows (`cant`), cornice height, base colour, and a tint mask so one Victorian can come in many painted-lady colours.
   - Store as WebP/KTX2 atlases of about 2–4 MB total, lazy-loaded per district.
2. **Style assignment** (owner: Codex codex2.6)
   - Per building, from our map data: height/levels, footprint, district, land use, distance to downtown, street frontage.
   - E.g. FiDi → office/tower; Mission/Castro/Haight/Western Addition 2–4 floors → vic/edw; ground floor on commercial streets → shop.
   - Deterministic seed per building ID, so variety is stable. Output per chunk (no map rebake if avoidable; compute at load or ship a small tag file).
3. **Mapping** (owner: codex2.6)
   - Apply the chosen front to the street-facing wall(s) at TRUE scale (crop or repeat horizontally for wide buildings, whole floors only).
   - Side and back walls use tiling materials. HD: simple extruded bay-window geometry for vic/edw; Low: the flat image.
4. **Tiling materials and trees** (owner: Codex codex2.4)
   - Materials: asphalt, sidewalk, pavers, roof, stucco, brick, siding, concrete, with normal maps. CC0 sources (ambientCG / Poly Haven) or fal; licences recorded in PROVENANCE.md.
   - Trees: an impostor atlas of SF species (palm, plane, cypress, eucalyptus, pine, ficus) at true size, plus front-yard greenery.

All behind `graphicsV2` (OFF in prod). The orchestrator publishes previews; prod only on the founder's go-ahead.
Targets: main route + downtown in 2–3 days; whole city in about 1 week.
