# Exact mesh reuse experiment — gtasf-8lvf

**Decision: retain the existing encoder.** On five western LOD1 chunks, exact
post-quantization vertex welding increases gzip size by 180 bytes (0.11%).
Meshopt triangle/vertex reordering saves only 2,264 bytes (1.32%) and regresses
Twin Peaks. Combining both saves less than reordering alone. This does not
justify changing the standard GLB pipeline during the broader `gtasf-zzpr`
representation work. No geometry, runtime, flags, manifest, candidate assets or
active map changed. No new dependency was installed.

## Receipt

Run: `2026-10-04T07:45:58.225Z`, Node 24.21.0, meshoptimizer 1.3.0,
@gltf-transform/core 4.5.1. Candidate: `tools/map/out/district-tm7m`.
Manifest SHA-256:
`ed862ff9f052223d427e30eebd163f409ee7299fe9fda7ef2c9fd484996e9522`.

Local detailed receipt (ignored artifact):
`artifacts/mesh-reuse/2026-10-04T07-45-58.225Z/report.json`.
The reproducible inputs, method and measurements are retained below.

Gzip level 9 bytes; all values are actual encodings, not estimates:

| District / chunk | Source | Unmodified roundtrip | Exact weld | Reorder | Weld + reorder |
| --- | ---: | ---: | ---: | ---: | ---: |
| Richmond / -20_0 | 28,957 | 28,969 | 29,017 | 28,461 | 28,557 |
| Sunset / -24_8 | 44,679 | 44,689 | 44,669 | 43,829 | 43,748 |
| Golden Gate Park / -21_7 | 38,964 | 38,970 | 38,976 | 38,611 | 38,563 |
| Ocean Beach / -36_5 | 33,100 | 33,108 | 33,248 | 32,496 | 32,792 |
| Twin Peaks / -14_13 | 25,189 | 25,199 | 25,205 | 25,274 | 25,297 |
| **Total** | **170,889** | **170,935** | **171,115** | **168,671** | **168,957** |

The 46-byte source/roundtrip gzip difference is writer overhead and is excluded
from the optimization comparison. Raw GLB totals are respectively 255,260;
255,320; 257,232; 251,196; and 252,740 bytes. Welding changes 33,466 vertices to
33,423; every variant retains all 15,649 triangles across the same 18 primitives.
Maximum per-primitive position/index upload remains at or below its input size
(largest source primitive: 65,514 bytes, within the existing 64 KiB partition).

Each file below is `chunks/<chunk>/lod1.glb` within the pinned candidate:

| Chunk | Input SHA-256 |
| --- | --- |
| -20_0 | `641133ba58b8dbec6a0e1eac85f717a00cf5bf12cf22d98df83a213ae5d321b3` |
| -24_8 | `92ba6e7ef3a4cd0eb2c22865c929ceb6791c3f4b7ae8abe7581d7cdd0cfa907d` |
| -21_7 | `b861048ace930af15ec9f717aeedb49a7122cc49af837652f4b7fbe5abe05a6a` |
| -36_5 | `06d759ba0ec74e33605f14454330d0db097753c344dd70ec89c08bedc0df3616` |
| -14_13 | `0fd4109b9e392c463a6755ffd76f2f66db77f2be4ad6465c07642b25e00019d1` |

## Method and bounded verification

`mesh-reuse-probe.mts` independently decodes each original for each variant.
It operates within existing primitive partitions. Welding keys include the raw
bytes of **every** vertex attribute, including quantized positions, transformed
normals and colours. Reordering calls the already-installed meshoptimizer's
`reorderMesh(indices, true, true)` and applies its vertex remap to every
attribute. Neither operation changes a quantizer or removes triangles.

Before encoding and after decoding, it verifies:

- Exact oriented triangle/attribute multisets per primitive. Cyclic corner
  rotation is permitted; winding reversal is not. Degenerate and duplicate
  triangles retain their multiplicity.
- Complete material, node, scene and primitive metadata, including transforms
  and attribute component types/normalization. Only buffer layout and accessor
  references/counts may change.
- Position/index upload partitions do not grow.

One adversarial fixture includes an exact duplicate vertex, same-position
vertices with different normals or colours, duplicate triangles and a degenerate
triangle. It verifies the weld merges only the exact duplicate and explicitly
detects reversed winding. All four variants pass through the actual GLB writer
and decoder. Unsupported non-triangle, skinned, animated, morph-target or
shared-accessor input fails explicitly.

Reproduction (serialized by the shared heavy-work lock):

```sh
tools/heavy.sh npx tsx tools/map/mesh-reuse-probe.mts tools/map/out/district-tm7m
```

The probe writes only a JSON report outside the candidate directory. It passed
along with strict standalone TypeScript for the `.mts` script and
`npx tsc --noEmit -p tools/map/tsconfig.json` (combined check exit 0). No full
build or bake was run.

## Remaining work

`gtasf-zzpr` owns the broader compact mesh/graph/terrain representation. It may
reuse this exactness oracle or test reordering within its new index stream.
This five-chunk sample is not citywide payload evidence, a visual/raster parity
claim, cold-load evidence, or deployment acceptance. In particular, triangle
reordering can affect coincident-surface draw order even when the exact triangle
multiset is retained; a shipped reordering change would need its own review.
The isolated full candidate's measured 90.28 MB gzip inventory still fails the
25 MB whole-city target and 80 MB production-payload limit; `zzpr` and `tm7m`
remain open.
