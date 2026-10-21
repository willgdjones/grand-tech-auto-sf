# Hillside furniture clearance — gtasf-6pf6

`createStreetPropLayout` creates companion furniture several metres along a
street from a utility pole. Those candidates retain the pole's reference height;
the mounted renderer later samples their actual ground height. Previously,
placement passed the old height to the road sampler, whose five-metre vertical
filter could ignore a nearby ground lane. The renderer permits a seven-metre
height adjustment, so some of these candidates could be drawn in the road.

A read-only audit of `tools/map/out/lombard/roadgraph.json` found four such
candidates among 3,983 sites. Their source pole-to-road height differences were:

| Street | Furniture | Old reference height | Nearby ground-road height |
|---|---|---:|---:|
| Vallejo | Street lamp | 40.300 m | 47.054 m |
| Vallejo | Street lamp | 57.081 m | 50.352 m |
| Broadway | Plane tree | 53.456 m | 58.713 m |
| Lombard | Fence | 77.972 m | 71.954 m |

The audited source graph SHA-256 is
`cd3ed7ac9ae44b5198339c71cc1d5a4f80b58d4fad1b323b25da3a516180e7ad`.

The placement guard now queries ground lanes at the candidate's actual x/z
without applying the stale reference height. The shared sampler's existing
ground-only behavior excludes separate bridge, tunnel and other layered decks.
This retains the existing 3.5 m lane clearance and building/terrain checks. The
existing `streetProps` flag still controls the renderer, and `streetDetail`
controls its extra furniture; no flag or density limit is changed.

The focused smoke uses a steep street crossing another ground lane. A lamp
shifted 22 m uphill would retain y=3.5 m at a crossing whose road is at y=9 m.
The layout must reject that position while retaining two valid poles beneath a
separate bridge. The real-graph placement smoke now checks ground clearance
without the same stale-height filter that previously concealed the defect.

Five focused street-furniture/district checks and web strict types passed on
2026-10-04 at approximately 09:08 UTC. The first real-source smoke passed its
road-clearance and signal/stop/Muni assertions, then exposed an older synthetic
density assumption: extra detail companions can suppress later poles, so pole
counts alone no longer represent total dressing density. The smoke now requires
both fewer outer-city poles and at least 30% fewer outer-city props overall.
The final serialized run passed at 09:39:43 UTC. Its evidence is
`artifacts/street-clearance-6pf6/layout-smoke.json`: 3,982 sites checked against
8,284 nodes and 12,731 source edges, with 443 source-linked signals, 635 stop signs,
and 161 Muni wire spans retained. The synthetic dense/sparse streets contain
24/22 poles and 128/60 total props per kilometre respectively. Every generated
site passes the ground-road clearance assertion.

This source clearance fix does not establish fresh browser,
phone performance, production or whole-city visual acceptance; those remain in
`gtasf-street-detail-look-review-7924` and the district integration gates.
