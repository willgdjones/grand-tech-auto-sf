# Google Photorealistic 3D Tiles preview

`gtasf-eltv` is a separately gated visual prototype. It does not replace GTASF's
road graph, heightfield, collision, events, vehicles, player poses or server.
`googleTiles` defaults to **false** and is absent from the production allowlist.
It also requires `graphicsV2`. No deployment is authorized by this document.

## Enabling the preview

The founder supplies a browser API key for an enabled Google Maps **Map Tiles API**
project with billing. Restrict that key to the allowed preview/localhost HTTP
referrers and the Map Tiles API. A `VITE_` value is necessarily embedded in the
browser bundle; it is not a server secret. Never commit it or put it in command
history, a bead, a screenshot, or logs.

For local Vite, put `VITE_GOOGLE_MAPS_KEY` in ignored `web/.env.local` and enable
`googleTiles` in a local build. Restart Vite after supplying the value. The checked-in
flag remains false. For the orchestrator's isolated preview build, export the
variable securely in its environment and use:

```sh
npm run deploy -- --preview --flags graphicsV2,googleTiles --commit HEAD
```

`--dry-run` builds only, with no remote calls. The preview tool forwards only this
Google browser key when `googleTiles` is selected; it still excludes other
`VITE_*` values and never copies `.env` or `.dev.vars`. It never deploys a Worker,
runs migrations, uploads to R2, or uploads secrets. The preview uses the existing
live game backend, so playing it is not a separate economy sandbox.

Ferry demo: default spawn. Lombard demo: `?at=37.8021,-122.4187&gfx=hd`.
The same path also works in the cinematic view. Test both approaches after the
key arrives; missing-key checks do not establish live Google coverage or quality.

## Runtime and fallback

- `createGoogleTiles` checks both flags and the key before importing the renderer,
  allocating its textures/decoder, or making any Google request. An enabled build
  without a key shows a small fallback notice and retains the complete authored map.
- `3d-tiles-renderer` **0.5.3**, Apache-2.0, uses `GoogleCloudAuthPlugin` for root/session
  requests and provider attribution. Draco comes from our pinned Three.js dependency
  and is bundled locally, rather than a third-party CDN. No sample artwork is copied.
- Tiles load around the active game camera. Own queues cap downloads at 4 on HD / 2
  on Low and parsing at 1. Decoded tile caches are bounded at 96 / 48 MiB. These are
  prototype cache caps, not evidence that the normal production payload/frame gates pass.
- WGS84 ECEF is transformed to ENU at the **loaded map manifest's origin**, then its
  grid rotation and GTASF's `+X east, +Y up, -Z north` convention. No Ferry-specific
  horizontal offset is hard-coded, so deep links use the same coordinate frame.
- Google ellipsoid heights and our terrain's sea-level datum differ. Before showing
  any tiles, three nearby independently sourced road points must agree on a vertical
  render offset within 1.5 m (and within an 80 m plausibility limit). The median is
  applied once to the visual tiles only. A roof/bridge mismatch or missing surface
  leaves the authored fallback visible. Nothing is written to the map or collision.
- Only currently visible tile content with geometric error at most 8 m and bounded
  local extent contributes coverage. A 64×64 mask of complete 16 m cells suppresses
  authored map/landmark fragments under that coverage. Tile content bounds are a
  conservative prototype approximation, not a claim of exact per-triangle occupancy;
  tile edges/holes must be checked in the live demo. Existing collision meshes and
  landmark visibility/ground contacts are unchanged. Eviction refreshes the mask.
- Coarse global startup tiles are hidden. Root/load failures or 45 seconds without
  a usable aligned surface restore the authored map and show an unavailable notice.
  No key or credential-bearing error URL is intentionally printed by application code.
  Reload to retry after fixing key restrictions or network access.
- Disposal restores authored material shaders, removes the overlay, aborts/disposes
  the tile renderer and disposes decoder, mask and owned materials.

## Attribution and assets

The small HUD attribution names **Google Maps** as the basemap and **GTASF** as
independent game overlays, with the complete provider strings reported for visible
tiles. Text attribution is used in the space-constrained game HUD. It is never
hidden while Google tiles are shown. The content is streamed directly from Google;
we do not save, rebake, mirror, generate textures from, or make offline assets from it.

Google imagery is the explicit exception approved for this spike; it is not CC0.
All other art remains our generated/CC0 sources. See `PROVENANCE.md` and:

- Renderer and Apache-2.0 licence: https://github.com/NASA-AMMOS/3DTilesRendererJS
- Google tiles setup: https://developers.google.com/maps/documentation/tile/3d-tiles
- Google attribution/content rules: https://developers.google.com/maps/documentation/tile/policies
