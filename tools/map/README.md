# GTASF map pipeline

Standalone TypeScript package. The default `lombard` slice covers the Ferry Building,
Embarcadero, North Beach and Russian Hill/Lombard; all
downloads, generated assets and screenshots stay in ignored `out/`.

```sh
cd tools/map
npm ci --workspaces=false --ignore-scripts --legacy-peer-deps
npm run fetch -- --area lombard
nice -n 10 npm run build -- --area lombard
npm run validate -- --area lombard
npm run preview -- --area lombard --port 4177
```

`build` is offline unless `--fetch` is supplied. `--refresh` explicitly replaces
cached downloads. Cache entries are content-hash checked before use. The preview
is a static server without a watcher; stop it after inspection.

The build writes two meshopt-compressed GLB LODs, carved GTHF heightfields,
building collision polygons, a directed lane graph and a versioned manifest.
Consumers should follow [CONTRACT.md](CONTRACT.md) for units, chunk placement,
decoding, source attribution and bridge/tunnel contact heights.

Targeted verification on the shared laptop:

```sh
npm test -- test/contracts.test.ts test/pipeline.test.ts
npm run typecheck
```

The first playable 78-chunk corridor is about 19.25 MB compressed for both LODs and gameplay
assets. This does not establish the 25 MB whole-city budget. No build command
uploads assets or enables a runtime feature. Citywide source acquisition and
staging publication have separate acceptance work.

## Whole-city OSM input

Areas above 16 km² require a local PBF; giant Overpass requests are rejected.
Install `osmium-tool`, download the [Geofabrik Northern California extract](https://download.geofabrik.de/north-america/us/california/norcal.html)
into `out/`, then use `--osm-pbf` on both fetch and build:

```sh
brew install osmium-tool
curl --fail --location --continue-at - --output out/norcal-latest.osm.pbf \
  https://download.geofabrik.de/north-america/us/california/norcal-latest.osm.pbf
nice -n 10 npm run fetch -- --area sf --osm-pbf out/norcal-latest.osm.pbf
nice -n 10 npm run build -- --area sf --osm-pbf out/norcal-latest.osm.pbf
```

The importer hashes the local input and caches a padded geographic extract using
Osmium's `smart` strategy with complete multipolygon and restriction members.
It converts via [OPL](https://osmcode.org/opl-file-format/) to keep node references,
controls and relation roles, and rejects missing way nodes. The original file
and converted extract hashes are recorded separately. Downloads and full-city
baking should be scheduled when the shared machine has capacity.
