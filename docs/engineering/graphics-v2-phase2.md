# Graphics v2, phase 2: lessons from jeantimex/tokyo (MIT) (founder-approved, Oct 4)

Reference: https://github.com/jeantimex/tokyo (MIT licence; code may be adapted WITH attribution in PROVENANCE.md and file headers). takram three-geospatial (MIT) for the atmosphere and clouds.
Queue AFTER the facade atlas lands. All behind `graphicsV2`; HD gets the heavy parts, Low stays fast; the orchestrator previews; prod only on the founder's go-ahead.

1. **Open-data buildings and ground** (biggest win)
   - DataSF building footprints with LiDAR roof heights (open data, check the licence/attribution).
   - USGS 3DEP 1 m DEM for terrain.
   - NAIP aerial orthophoto (public domain) draped under the ground, and as roof plus distant-wall colour.
   - Compile it into our tiles (tools/map pipeline), keep the 25 MB map budget in mind (use aerial tiles at a modest resolution, streamed per chunk), and log base-vs-terrain error at compile time like tokyo does.
2. **Aerial far / generated near:** blend the aerial-derived wall/roof colour at distance into the facade atlas up close.
3. **Terrain-draped road paint:** split road surfaces and markings along the terrain mesh's triangles (cf. tokyo `src/world/drape.js`), so paint never sinks or floats on SF hills; fixes the Columbus pinholes. Add a geometric clearance check (map-pipeline test; this is data correctness, so a test is OK).
4. **Lamp light map:** draw street lamps and headlights as flat quads into a top-down light map (max-blend, with lamp height stored); lit surfaces sample it (cf. `src/world/lamplight.js`). Cheap night lighting, Low-friendly.
5. **Water mirror:** the Bay, Embarcadero and Golden Gate Park lakes reflect the city and sky with ripples (cf. `src/world/mirror.js`); HD only.
6. **Sky:** adopt takram three-geospatial atmosphere (aerial perspective) plus optional volumetric clouds on HD; keep the SA grade on top.
7. **Extras:** GPU birds (cf. `src/world/birds.js`); lit windows switching at night; traffic signals that cycle and that traffic obeys.

Constraints: phones must stay playable (tokyo is desktop-only and about 650 MB for 7 areas; we are one city and phone-first). No Google Street View. Attribution for every data source and adapted code.
