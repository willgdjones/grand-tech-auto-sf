# Client routing evidence

`tools/radar-route-smoke.ts` reads the active local map manifest (the same
`GTASF_MAP_AREA` / `tools/map/out/active-map.json` choice as `web/mapLocalPlugin.ts`),
or an explicit manifest path/URL. It validates the graph size and SHA, restores
its declared transport behind `compactMapAssets`, decodes the packed graph, and
filters its routable edges exactly as the client loader does. Coordinates use
the manifest's frame.

The source-backed deep-link check first snaps to the full contact graph, then
passes that arrival's actual height to GPS. Reports distinguish a missing start
snap, missing destination snap, and missing directed path. They also include
the planar start snap, so height filtering is observable. This is not a browser
spawn, collision, driveability, performance or deployment check.

## 2026-10-04 local result — gtasf-5nyf

One run passed all eight cases on the active SF map, with 2,501 chunks, 155,510
nodes, 244,460 edges and 229,921 routable edges. Every start snapped at zero
horizontal distance. The Ferry destination is 19.47 m from the road; the other
destinations in this check are on their source roads.

| Route | Road distance |
| --- | ---: |
| Ferry → Lombard | 2,859.7 m |
| Mission → Lombard | 5,172.8 m |
| Mission → Ferry | 5,083.9 m |
| Painted Ladies → Ferry | 4,703.5 m |
| Ferry → Moscone | 1,950.3 m |
| Ferry → FiDi | 1,173.9 m |
| Ferry → Dogpatch | 4,536.8 m |
| Ferry → SoMa | 2,979.3 m |

- Manifest SHA256: `bbd1612302cd09bb67eb89d33dd2b99b79983d1ffd4fd9d977cf103f4a416e57`
- Packed graph SHA256: `5763c53debed013a7f5403a467bd829f45dacfdfb83dc9c5c19e5555fe91651f`
- Detailed report: `artifacts/radar-routing/2026-10-04-local/report.json` (ignored local artifact).
- Targeted strict TypeScript and `tools/heavy.sh npx tsx tools/radar-route-smoke.ts` passed.

The earlier citywide connectivity check supplied `y: 0` for every start. Mission's
source arrival is at 9.766 m and Painted Ladies' at 64.338 m. GPS deliberately
rejects a road more than 3 m from the player's height, so that invented height
produced false failures. The connectivity-only check now omits height and reports
endpoint failures separately. Its script also passes `node --check`.

The local `/map/lombard/` URL is a stable alias and already serves the SF manifest;
its spelling does not establish a Lombard-only graph. The old
`roadgraph-playable.json` is a corridor-clipped audit artifact, not this client's
loaded graph. District terrain repair leaves the graph bytes unchanged.

## 2026-10-04 production artifact diagnosis — gtasf-vcaj

A read-only HTTPS fetch at 09:22 UTC identified the production alias manifest
and downloaded its exact packed graph. Its size and SHA256 match the manifest.
The public alias still resolves to release
`a4da5b9e56820a49efb4ee1594ee5f592565adb36a375d3c85ec1c2a5fd9f4f6`.

| Artifact | Production | Active local SF |
| --- | --- | --- |
| Chunks | 2,501 | 2,501 |
| Graph nodes / edges | 155,510 / 244,460 | 155,510 / 244,460 |
| Decoded graph bytes | 23,079,905 | 23,079,905 |
| Routable edges | 21,406 | 229,921 |

- Production alias manifest SHA256: `5e61d914f76e3f107c7ae2a8286fc539c5dbab0fa53827e24acc9eef34588dbd`
- Production graph SHA256: `cc37ca6fa438e07fa82aeaf1feb2821fcc53ce8dfa57de9e6ad1e34e1de60b7d`
- Retained byte copies: `artifacts/radar-routing/2026-10-04-production/` (ignored).

A column-by-column byte comparison found that **every byte outside edge flags is
identical**. The 208,515 changed flags all add the routable bit (`0x20`) in the
local graph. Production therefore has whole-city geometry and topology with a
stale corridor-only routing mask. The client and packed Worker road loader both
filter by that mask. The alias spelling, a coordinate-frame mismatch, terrain
rebaking and disconnected source topology do not explain this artifact mismatch.

The recorded deployments used `--skip-map`, leaving this older R2 artifact in
place. The deployment owner needs to publish a coherent, validated graph and
manifest and then check the failed production journeys. No production artifact
was changed by this diagnostic.

The completed replay against that immutable production manifest reproduces six
of eight failures, all before A*: Mission → Lombard, Mission → Ferry and Painted
Ladies → Ferry have no routable start; Ferry → Moscone, Dogpatch and SoMa have no
routable destination. Ferry → Lombard and Ferry → FiDi pass. The complete report
is `artifacts/radar-routing/2026-10-04-local/production-report.json`; its manifest
and graph hashes match the byte copies above. The same tool and exact eight
geographic cases pass against the active local SF map.

The newer `wholeCityMap` switch changes an asset alias. It does not repair the
contents of the published graph. Similarly, the legacy `route-coverage-check.mjs`
default examines `roadgraph-playable.json`, not the packed graph loaded by the
client. Use manifest-aware checks when deciding which artifact needs publication.
The live browser check after publication remains open. This evidence does not
close `gtasf-vcaj` or waive map/payload budgets.
