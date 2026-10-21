# District kerb source coverage

Owner: LilacBay, `gtasf-2wq4`. Source check: 2026-10-04 05:45 UTC.

`tools/art/prepare-district-roads.ts` retains all existing eastern road-detail
cells and adds the surface streets selected by the district registry. New cells
include configured road fragments plus source tracks/crossings in those cells.
Bridges, tunnels, nonzero layers and motorway/trunk roads do not select new cells.
The existing Lombard corridor stays with its dedicated detail asset.

The selector splits at 256 m boundaries while preserving source heights,
arclength, paint phase and junction offsets. It does not truncate districts to
the nearest N cells. A result over a budget fails before generated assets are
written. `--check` performs the complete source conversion and budget validation
without writing generated assets.

## Read-only source check

These checks passed through the machine's serial heavy-check wrapper:

```sh
tools/heavy.sh npx vitest run --config tools/map/vitest.config.ts tools/map/test/district-road-cells.test.ts --maxWorkers=1
tools/heavy.sh npx tsc --noEmit -p tools/tsconfig.json
tools/heavy.sh npx tsx tools/art/prepare-district-roads.ts --check
```

The single smoke covers all 24 registry arrivals, configured surface streets,
legacy retention, freeway/bridge rejection and source continuity at negative
grid boundaries. The actual source conversion reports:

| Measurement | Result | Existing byte limit |
|---|---:|---:|
| Cells | 823 (all 329 legacy cells retained) | 1,024 metadata entries, paired reader change required |
| Road fragments / tracks / crossings | 10,239 / 171 / 8,514 | — |
| Cell JSON bytes | 9,569,825 | — |
| Cell JSON bytes after individual gzip | 2,720,367 | — |
| Total payload including index and provenance | 9,723,322 | <15,000,000 |
| Runtime index | 120,003 | <150,000 |
| Source provenance sidecar | 33,494 | <150,000 |
| Largest cell | 57,593 | ≤300,000 |

The gzip figure describes local compression, not a measured browser transfer.
The selection bounds are `[-9216, -3072, 2816, 8448]` in the shared SF frame.
Every registered district contributes selected cells; counts overlap when a
cell contains roads from more than one district:

| District | Cells | District | Cells |
|---|---:|---|---:|
| Bayview | 43 | Bernal Heights | 19 |
| Castro | 24 | Cow Hollow | 18 |
| Dogpatch | 29 | Excelsior | 45 |
| FiDi | 8 | Glen Park | 21 |
| Golden Gate approach | 9 | Golden Gate Park | 44 |
| Japantown | 8 | Marina | 22 |
| Mission | 44 | Moscone | 12 |
| Noe Valley | 15 | Ocean Beach | 29 |
| Pacific Heights | 29 | Potrero Hill | 21 |
| Presidio | 43 | Richmond | 57 |
| SoMa | 66 | Sunset | 64 |
| Twin Peaks | 25 | Western Addition | 31 |

## Runtime and bake handoff

The runtime index now references `provenance.json` with its size and SHA-256;
the sidecar contains the complete source digests and attribution. This keeps
the runtime index within its existing 150 KB bound. Its version, cell size,
coordinate frame and per-cell entries are unchanged. The renderer does not
need to fetch provenance to draw cells.

DarkMarsh owns the matching `web/src/render/roads.ts` metadata limit increase
from 512 to 1,024 under `gtasf-npnq`. Pair that change with this exporter before
publishing regenerated outputs. The 3×3 runtime cache, two concurrent requests,
150 KB index and 300 KB cell limits remain unchanged. This extends existing
flag-controlled road rendering; it adds no separate runtime feature.

WindyGate coordinates the bake/upload. The write command is the same exporter
without `--check`; do not run overlapping bakes. This evidence records source
checks only: no generated assets were written here, and no desktop/phone look,
cold-load network, real-device or deployment gate is established by these checks.
