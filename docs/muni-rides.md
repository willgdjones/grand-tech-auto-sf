# Muni 39 Coit rides

`gtasf-4hsj` fills the local Muni riding gap in PLAN.md. The existing `muni`
flag remains **false** during source preparation. Server/main integration,
local activation and actual desktop/phone riding acceptance are still pending.
This work does not change the deployed release or close the parent transit gates.

## Streets and stops

The source is OpenStreetMap bus route relations
[2005406 outbound](https://www.openstreetmap.org/relation/2005406) and
[2007467 inbound](https://www.openstreetmap.org/relation/2007467), retrieved
on 2026-10-03. Their stop sequence agrees with SFMTA's
[39 Coit route description](https://www.sfmta.com/routes/39-coit): 17 stops
toward Coit Tower, 22 toward Fisherman's Wharf, including the Union Street
out-and-back. No SFMTA logos or live arrival feed are used.

| Direction | Distance | Stops | Profile points | Maximum grade | Elevation range |
|---|---:|---:|---:|---:|---:|
| Coit Tower | 3,004.285 m | 17 | 1,311 | 14.1% | 83.611 m |
| Fisherman's Wharf | 2,908.916 m | 22 | 1,265 | 21.9% | 82.900 m |

The baker joins exact road endpoints, including a split North Point way whose
relation members were out of order. At Union Street, paired sidewalk platforms
distinguish opposite-direction visits to shared road-center stop nodes. Stops
retain their OSM identities and route order. Two-way street paths use the right
side of the road; one-way paths retain their sourced carriageway. Directional
paths end at the actual terminal stops, with endpoint gaps below 6 mm.

The existing city road deck and carved terrain supply every height. The baker
hash-verifies its graph and heightfields, rejects discontinuous roads, misplaced
stops and excessive grade, and changes no map object. Source SHA-256:
`4b3a3a35c849c6292deec846b0528d83d9c732fb995330ea39a163b4c9f6a2dc`.
Full map/source hashes and attribution are embedded in `muniRouteProvenance`.
Data attribution: **© OpenStreetMap contributors — ODbL**; terrain provenance
is retained from the existing map bake.

```sh
nice -n 10 npx tsx tools/transit/prepare-muni-routes.ts --map tools/map/out/sf --fetch
```

The command reuses `artifacts/muni/source/route-osm.json`; `--fetch` permits
retrieval only when that cache is absent. It emits `shared/transit/muniRoutes.ts`
and `artifacts/muni/route-bake.json`. Keep the recorded source/map snapshots to
reproduce the same geometry. A changed upstream stop count requires review.

## Runtime contract

Six buses use IDs 3,000,000–3,000,005, the existing `bus` wire kind and authored
`muni-bus` model. Absolute server time determines their positions: 6 m/s with
10-second stops on an accelerated **game** timetable. These are not real Muni
arrival predictions. The client and server share the sampler; positional bus
snapshots are unnecessary. Timetable initialization is lazy, and render callers
reuse a pose object and its entry.

The fleet preserves these buses across ordinary vehicle snapshots, keeps them
visible in Cruise mode, and offers boarding only during a stop. An ordinary
parked bus remains a distinct driveable vehicle. Getting around gains one GPS
stop row for each direction; its distance and wait refer to the in-game fleet.

## Source checks

- The route-only bake passed on the existing city surface.
- The shared smoke covers 50 minutes of wall-time inputs: every one of the 39
  directional stops in order, continuous movement/height, reuse of the pose,
  late-join agreement and GPS arrival predictions matching an actual stopped bus.
- The actual shipped bus GLB is decoded in the fleet smoke. Six buses survive
  snapshot replacement and Cruise mode; stopped/moving boarding selection,
  current camera transforms, a separate parked bus and disposal all pass.
- The existing fleet hierarchy/camera regression and shared/web strict checks
  pass. These source checks do not establish in-game visual or riding acceptance.

```sh
nice -n 10 npx vitest run shared/transit/muni.test.ts web/src/game/muni.test.ts web/src/game/fleet.test.ts --maxWorkers=1
```
