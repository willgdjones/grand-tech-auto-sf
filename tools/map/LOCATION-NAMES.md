# Current street and neighbourhood

`loadLombardWorld()` exposes `world.locationNameAt(x, z, maxDistance = 80)` in
global map metres. It returns `{ street, neighbourhood, osmWay, distanceM }`;
each field is nullable. Street names come from the nearest named OSM lane within
the radius. Neighbourhood names require polygon containment, with courtyard
holes respected. An outside point stays unnamed. Older manifests still support
street names and return a null neighbourhood.

The road segments are indexed in 64 m cells and the polygon bounds in 256 m cells.
Build each index once with the map. A HUD update around four times per second is
sufficient; there are no per-frame fetches or full-city scans. Use DOM textContent.

The source-backed smoke returned:

| Position | Street | Neighbourhood |
| --- | --- | --- |
| Ferry plaza `[1196.869, -1224.309]` | The Embarcadero | Financial District/South Beach |
| Lombard bend `[-970.837, -1982.055]` | Lombard Street | Russian Hill |
| Outside the city `[1000000, 1000000]` | null | null |

The published `neighbourhoods.json` contains all 41 DataSF
[Analysis Neighborhoods](https://data.sf.gov/d/j2bu-swwd), projected into the same
Powell/Market frame as roads. These are the City's analysis polygons, not legal
or uniquely authoritative definitions of neighbourhoods. The source's PDDL
licence, URL and SHA-256 are embedded. The asset is 777,351 bytes decoded and
251,756 bytes gzip; its hash and sizes are referenced by `manifest.neighbourhoods`.

Normal map fetch/build commands now include this small source. To add or refresh
labels on an existing bake without rebuilding meshes:

```sh
tools/map/node_modules/.bin/tsx tools/map/src/pipeline/neighbourhoods.ts --fetch
```

Omit `--fetch` to use the verified cache offline. `--refresh --fetch` deliberately
downloads new source bytes. Outputs remain under ignored `tools/map/out/`.
