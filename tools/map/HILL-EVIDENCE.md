# Lombard terrain fidelity checkpoint

Source and rendered-road alignment passed on the expanded Ferry–Lombard bake on
October 2, 2026 PT. The full autonomous downhill ride and complete uphill walk
passed. This closes the local `gtasf-b5z` terrain fidelity checkpoint; no deployed,
visual-look or device gate is claimed.

## Measured profile

`src/terrain/hill-profile.ts` reads the shipped quantized GLBs at both LODs,
GTHF contact fields, source Terrarium tiles and lane graph. It vertically samples
the actual rendered road triangles at each route point, including the chunk
boundary between `-5_-8` and `-4_-8`. All 263 points found road triangles in both
LODs; it does not replace missing geometry with a synthetic plane.

| Measurement | Uphill taxi approach | Full downhill switchbacks |
| --- | ---: | ---: |
| Sampled route points | 78 | 185 |
| First / last road elevation | 74.687 / 85.954 m | 85.954 / 53.117 m |
| Elevation change | +11.267 m | −32.837 m |
| Maximum lane / DEM difference | 0.1994 m | 0.1451 m |
| Maximum lane / GTHF difference | 0.1544 m | 0.2227 m |
| Maximum lane / LOD0 road difference | 0.0122 m | 0.0310 m |
| Maximum lane / LOD1 road difference | 0.0113 m | 0.0310 m |

The raw original 157-vertex OSM way 402111597 descends from 85.853713 m to
53.017408 m across 197.462333 horizontal metres (mean −16.63%, consistent with
its −16% incline tag). See `src/terrain/README.md` for the independent raw-RGB
comparison. Road surfaces deliberately sit 0.1 m above the carved ground and use
a dense smoothed profile. Runtime road contact samples that profile directly;
the surrounding ground is a 4 m grid.

The frame is WGS84 projected horizontally to local ENU at Powell/Market, with
east +x and south +z. Elevation remains the source DEM's metre value; no ECEF
tangent-plane height or synthetic flattening is substituted. Cached source
metadata identifies the San Francisco 2010 NED topobathy raster. The zoom-15
source pixel spacing is approximately 3.8 m at this latitude. The 0.25 m contact
comparison envelope and 0.05 m mesh quantization comparison envelope test
implementation alignment, not the accuracy of a new elevation survey.

The bake's adjacent GTHF rows agree exactly in integer centimetres. Terrain
sampling interpolates decoded elevations across PNG tile edges at pixel centres.
Missing tiles, alpha/no-data, the −32768 sentinel, malformed arrays and non-finite
samples fail the build explicitly; there is no flat-height fallback. Those cases
retain existing scoped coverage; no new property or performance suite was run.

## Running-game evidence

The isolated static browser smoke used the actual local Worker, real variable
wall-clock updates, ordinary H hail input and the normal streamed map. It boarded
and completed the entire switchback trip, recording 90 samples from 85.954 m to
53.117 m. Maximum taxi model-root versus runtime road-contact offset was
0.03268 m. Browser and chunk-error lists were empty. Screenshots visibly show the
hill grade, switchbacks and the taxi pitching with the slope.

The complete uphill check selected the exposed tank-control setting and used the
public virtual-input interface through the ordinary foot controller, with normal
variable wall-clock frames. It followed all 176 reverse route points, recording
74 samples from 53.117 m to 85.943 m in 37.2 seconds. The final point tolerance is
0.8 m horizontally; the sampled endpoint is within 0.012 m of the route summit.
Maximum player-root versus runtime road-contact offset was 0.000559 m. There were
no browser or chunk errors. The guide reads pose to steer, but never writes player
pose, camera state, terrain, or the simulation clock during the walk. This checks
terrain travel through the normal controller, not physical-keyboard acceptance.

A real approximate Russian Hill event marker opened its event card en route; the
helper dismissed it using ordinary Escape and continued. An earlier attempt had
stopped at that modal, correctly pausing movement. The original SwiftShader run
also hit its wall timeout; both incomplete attempts remain archived. The passing
run used Chromium's native AMD Radeon Pro 5300M Metal path at 640x480, preset low.
These samples establish travel/contact only, not device performance.

Generated evidence stays under ignored `out/`:

- `lombard/hill-profile.json`: source/render profile and pinned source hashes.
- `hill-smoke/report.json`, `hilltop.png`, `downhill-1.png`, `arrival.png`: successful live descent.
- `hill-smoke/uphill/report.json`, `foot-of-hill.png`, `arrival.png`: complete uphill walk.
- `hill-smoke/uphill-event-modal/` and `uphill-incomplete-swiftshader/`: archived incomplete attempts.

Reproduce the profile with `tools/map/node_modules/.bin/tsx tools/map/src/terrain/hill-profile.ts`.
The live helper is `node tools/map/hill-smoke.mjs` (or `--uphill --virtual-input`); set
`GTASF_SMOKE_URL` to an isolated static preview while other panes edit the app.
