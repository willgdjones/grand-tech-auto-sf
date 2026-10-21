# District source build-out

`gtasf-75f7` adds the shared profile contract, core district profiles and bake
hooks. The west, northwest and south agents supply independent modules through
the same registry in `src/districts/index.ts`. These are authored art regions,
not official administrative boundaries or surveyed building paint.

The core profiles cover SoMa, Moscone, the Financial District, Mission and
Dogpatch. They use concrete/stone street-ground colours, park greens, mixed
building palettes and explicit facade/tree preferences. Moscone wins its overlap
with SoMa. Source building tags override area zoning; source building heights
and footprints remain authoritative. Existing facade channel-ratio contracts
remain intact, including non-glass sage residential paint.

The bake retains small street-front buildings near each profile's named OSM
surface streets (core minimum 35–60 m², radius 30–35 m). Those buildings use
source-identical mesh footprints and collision, preserving road clearance.
Freeways, bridges and tunnels cannot promote a district street. Mapped closed
pavement faces are included on those streets, with buildings and natural land
excluded. Outside the original detail corridor the bake still emits one visual
LOD; the remaining city keeps its existing coarse retention policy. District
street chunks receive a finer terrain grid. Mapped water, beaches, scrub and
parks override urban ground, including holes in source multipolygons.

## Ownership and enablement

- `mapStreaming`, `terrain`, `buildingFacades`, `groundTextures`, `roadDetails`
  and `streetProps` remain the existing entry-point switches. This change
  refines their source data rather than introducing a separate runtime mode.
- **Map bake:** shared hooks are in `src/pipeline/{districts,buildings,build,meshes}.ts`.
  Run a consolidated source bake, not `--repair-tunnels`: a tunnel-only repair
  deliberately preserves unrelated old chunks. Never hand-edit baked outputs.
- **Facades:** TopazIsland owns the renderer. `districtAt(x,z)` and
  `DISTRICT_REGIONS` expose each profile's style mix without the old broad Mission
  rectangle catching the southern/western city. `realisticFacades` still requires
  its own renderer acceptance; this pass does not enable it.
- **Trees/props:** RubyWaterfall/JadeBadger own runtime layout. Profiles expose
  the exact street names and tree mix for their instanced placement rules.
- **Kerbs/paint:** the existing regional road-detail export covers the five arrival areas;
  LilacBay coordinates extending its source selection to outer districts while
  preserving the bounded cell cache and payload caps.
- **Spawn integration:** the registry's `spawn` values are sourced road arrival
  hints. The integrator needs to expose `/go/<district-id>` and snap explicit raw
  coordinates before initial chunk selection in `world.ts` and before
  `ensureAround(target)` in `snapSpawn`. The current ordering can fail on an
  omitted empty park/water chunk before finding a nearby road. Core `?at` links
  below already resolve to present source chunks.
- **Bake/upload and review:** WindyGate owns consolidation and publication.
  Record emitted-file inventory, cold transfer through READY, desktop/phone
  screenshots and device evidence separately. This source pass does not waive
  the 25 MB compressed city target, 15 MB first load, 80 MB total payload or
  25 MB individual-file limit.

## Checked evidence — October 3 local / October 4 UTC

Checks ran through `tools/heavy.sh`, which serializes work at `nice -n 15`:

```sh
tools/heavy.sh npx vitest run --config tools/map/vitest.config.ts tools/map/test/districts.test.ts tools/map/test/buildings.palette.test.ts tools/map/test/terrain-colour.test.ts --maxWorkers=1 --no-file-parallelism
tools/heavy.sh npx tsc --noEmit -p tools/map/tsconfig.json
tools/heavy.sh npx tsx tools/map/district-core-smoke.mts
```

The first command passed three files / six tests, including a complete temporary
single-chunk bake. It retains a 100 m² shop and its collision at coarse LOD,
preserves an explicit retail type inside residential zoning, and keeps source
park colour and source sidewalk/asphalt geometry. TypeScript passed for all
current district modules and map tests.

The read-only source audit used the existing packed SF bake. All 31 configured
core street entries exist. Every arrival is within 0.004 m of a surface lane,
agrees with the full client snapper, belongs to its intended profile and has a
present terrain chunk. No bridge/tunnel/connector was selected.

| District | Existing chunk | Checked source arrival |
| --- | --- | --- |
| Moscone | `2_0` | `/?at=37.7841202,-122.4014765,45` |
| FiDi | `1_-4` | `/?at=37.7933948,-122.4028417,180` |
| Mission | `-5_10` | `/?at=37.7598998,-122.4214024,0` |
| Dogpatch | `6_10` | `/?at=37.7602018,-122.3886700,0` |
| SoMa | `1_2` | `/?at=37.7784664,-122.4036573,45` |

Manifest SHA-256: `2991315a8f5496010bf31527b4b152aa0c63465d1d8492756c53c2310779f2c3`.
Packed graph SHA-256: `5763c53debed013a7f5403a467bd829f45dacfdfb83dc9c5c19e5555fe91651f`.
These hashes identify the arrival audit input, **not a new district bake**.
The existing coarse terrain differs from lane height by up to 0.31 m at these
five points; the runtime must preserve snapped road height. Visual, payload,
collision-in-game and device acceptance remain open until a new bake is reviewed.

## Source and runtime completion (2026-10-04)

The core source commits `7a2f52a` and `3ad2f26` are now consumed end to end:
`6b9cb95` connects all 24 district profiles to both facade paths and all tree
placement branches; `55b7656` selects sourced road-detail cells across the city;
`0af36a0` pairs the bounded 823-cell export with its runtime reader. The exporter
retains existing byte caps (9,723,322 bytes total; 120,003-byte index).
`6c4d2c0` and `0660e0f` connect `/go/<district-id>` and snap explicit links before
the initial chunk load, preserving the default Ferry plaza and sourced road Y.

Owners recorded 12 facade/prop checks, 10 road-reader checks, seven spawn checks
including the actual chunk-loader fixture, and final web strict typechecks through
`tools/heavy.sh`. These supplement the source smoke above; they do not establish
GPU compilation or in-game visual acceptance. `gtasf-75f7` is complete for its
source/runtime scope. The consolidated full bake, upload, payload inventory and
normal desktop/phone review remain open in `gtasf-tm7m`.
