# Western district source build-out — gtasf-7iks

`src/districts/west.ts` supplies the Richmond, Sunset, Golden Gate Park,
Ocean Beach and Twin Peaks profiles to the common district registry. The
profiles are authored art regions, not asserted administrative boundaries.
OSM polygons decide where parks, sand, scrub and water occur; a district box
does not turn a neighbourhood into a rectangular lawn or beach. DataSF/OSM
building footprints, heights and explicit uses remain authoritative.

| District | Ground and buildings | Selected street frontages | Trees |
|---|---|---|---|
| Richmond | Cool concrete; cream, sage, rose and terracotta housing; warm retail | Geary, Clement, Balboa, Arguello, 25th Avenue | Plane and cypress |
| Sunset | Pale concrete; varied pastel stucco; distinct shop floors | Irving, Judah, Noriega, Taraval, 9th and 19th Avenues | Plane and cypress |
| Golden Gate Park | Deep greens, separate lakes and scrub; stone/stucco civic stock | Named park roads and Stanyan | Cypress and plane |
| Ocean Beach | Source-mapped pale sand and dune scrub; coastal stucco/clapboard | Great Highway, La Playa Street, Fulton, Lincoln, Sloat | Cypress |
| Twin Peaks | Source scrub and grass; neutral residential surfaces | Twin Peaks Boulevard, Christmas Tree Point Road, Clarendon, Portola | Mostly cypress |

Only buildings within 30–35 metres of these source streets may use the
35–50 m² minimum footprint, replacing the coarse city's 400 m² cutoff there.
Their retained mesh and collision use the same footprint. Other western chunks
keep coarse LOD. Mapped paving is selected by the shared hooks; this config
does not draw roads, kerbs or store fronts by hand. The facade contract is
`facades`; the street-prop contract is `trees` plus exact source `streets`.

Colours are linear RGB. Commercial colours remain in the office classifier
band; retail keeps the storefront band; residential palettes avoid accidentally
selecting glass or industrial walls. Both runtime facade paths now use the
registry's priority-ordered metre-space bounds, so the old broad Mission shader
region no longer claims Sunset or Twin Peaks. The common helper maps all 24
profiles to each existing atlas: PS2 uses Edwardian for stucco and brick for
concrete, while the PBR atlas has literal style slots. Source office/industrial
classification and ground-ready shop floors retain precedence. Murals stay in
the configured regions' ground band. PBR brick variation, painted clapboard,
window details, IBL, night emission and distance fading remain in place.

Street props now use the same selected source street names for dense frontages
and the owning district's tree mix in every placement branch. Ocean Beach gets
cypress; the rest of the west gets its configured plane/cypress mix. Placement
still excludes source lanes, elevated roads, tunnels and connectors. Existing
downtown and Ferry–Lombard prop density remains intact.

## Source correction and provenance

The PBF parser previously retained only building/land-use multipolygons and
turn restrictions. It now also retains natural/leisure multipolygons, including
holes. Incomplete optional landcover is rejected with an `extractPolygons`
warning; it is never closed across a gap. Building/land-use/restriction imports
keep their strict completeness checks. Normalized PBF cache version 4 forces
the next bake to derive the corrected polygons from its pinned source PBF.

This is original GTASF configuration and importer code, with no new external
assets or downloads. Geometry attribution remains in `PROVENANCE.md` and the
generated source manifest: OSM contributors, DataSF and Terrain Tiles.
The cached DataSF Analysis Neighborhoods were inspected to bound the authored
regions. Local-only teleop frames 1, 2, 3 and 5 were reviewed for pale pavement,
kerb edges, facade/storefront contrast, overhead wires and tree spacing. Those
reference images are neither copied into the build nor committed.

## Verification and activation

Run all commands from the repository root; `heavy.sh` serializes and applies
nice 15:

```sh
tools/heavy.sh npx vitest run --config tools/map/vitest.config.ts tools/map/test/west-landcover.test.ts tools/map/test/sources.test.ts
tools/heavy.sh npx tsc --noEmit -p tools/map/tsconfig.json
tools/heavy.sh npx tsx tools/map/west-district-smoke.mts
tools/heavy.sh npx vitest run web/src/render/props/districtLayout.test.ts web/src/render/props/streetFurniture.test.ts web/src/render/realisticFacades.test.ts --maxWorkers=1
tools/heavy.sh npx tsc --noEmit -p web/tsconfig.json
```

The first command passed six source checks; map strict types passed. The
read-only arrival smoke hashes the actual city graph, verifies each profile's
arrival is in its own district, checks that full-graph snapping selects a
surface lane, and requires its streamed terrain chunk. It records missing
street-name spellings and lane/terrain height differences instead of treating
them as visual acceptance. It writes no baked artifacts.

Final source arrival smoke passed on the pinned city bake with manifest SHA-256
`2991315a8f5496010bf31527b4b152aa0c63465d1d8492756c53c2310779f2c3`
and graph SHA-256
`5763c53debed013a7f5403a467bd829f45dacfdfb83dc9c5c19e5555fe91651f`.
All 25 configured street names occur inside their owning art regions. All five
arrival hints project within 1 cm of a source surface lane and have a published
terrain chunk. The Sunset arrival remains south of the Golden Gate Park art
region; Ocean Beach includes the coast's eastward curve down to Sloat.

Runtime verification passed 12 focused checks, including a short road fixture
at all five west arrivals, actual prop layout, canopy selection, lane clearance,
existing street furniture and PBR shader/material wiring. Web strict types
passed. The shader check inspects injection and bindings; GPU compilation and
in-game appearance belong to the separate browser acceptance pass. No build or
browser was launched by this pane, following `tools/swarm/briefs/common.md`.

| District | Source-road arrival (`?at=lat,lon,heading`) | Chunk | Lane / old coarse terrain (m) |
|---|---|---|---|
| Richmond | `37.7827028,-122.4644383,270` | `-20_0` | 57.96 / 57.86 |
| Sunset | `37.7636222,-122.4769949,90` | `-24_8` | 68.11 / 68.34 |
| Golden Gate Park | `37.7659905,-122.4667922,0` | `-21_7` | 77.75 / 77.50 |
| Ocean Beach | `37.7724950,-122.5098072,270` | `-36_5` | 10.07 / 9.73 |
| Twin Peaks | `37.7539963,-122.4474328,90` | `-14_13` | 256.59 / 255.68 |

These measurements are from the existing bake, before district rebuild. In
particular the Twin Peaks 0.91 m lane/terrain difference still needs in-game
road-contact review after the new 4 m contact field is baked. The smoke does
not claim that the old coarse geometry was upgraded by changing configuration.

Existing `mapStreaming`, `terrain`, `buildingFacades`, `streetProps` and
`roadDetails` switches retain their entry gates. `realisticFacades` still needs
`realisticRender`; `streetDetail` production activation remains the street
owner's look/performance gate. A single consolidated source bake/upload belongs
to the deploy owner. Do not hand-edit `out/`, run a competing whole-city bake,
or copy the R2 credentials into logs or evidence.

Rollout acceptance is tracked separately in `gtasf-tm7m` (deploy owner WindyGate;
the parallel `gtasf-tyqc` was merged as a duplicate without accepting rollout):
consolidated bake with payload inventory and cold-load
trace; in-game desktop and
phone review of all five arrivals, road contact, pavements/kerbs, house variety
and natural ground. Unit/source checks do not establish those gates.

Named `/go/` registry integration and snap-before-chunk-load are committed in
`6c4d2c0` and `0660e0f` (`gtasf-2lrv`, DarkMarsh). The kerb exporter (`55b7656`)
and matching runtime reader (`0af36a0`) support the 823 selected source cells.
TopazIsland reviewed and approved the `6b9cb95` PBR consumer diff and confirmed
its existing atlas features are preserved; browser acceptance remains open.

Player-facing release note for the consolidated accepted bake: “Explore a more
colourful west side: Richmond and Sunset street-front homes, greener Golden
Gate Park, sandy Ocean Beach and the scrub-covered Twin Peaks.” [gtasf-7iks]
