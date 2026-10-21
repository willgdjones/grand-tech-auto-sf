# Local packed-map transfer

`npx tsx tools/map/src/pipeline/cli.ts transfer --area sf` writes an optional
`roadgraph.bin.br` and its hash receipt beside an existing packed graph. It verifies
the raw graph against the manifest and verifies the Brotli round trip. Packing a
new runtime graph also produces this sidecar. The transfer command does not
rewrite the raw graph, gzip file, manifest, geometry or publication inventory.

The Vite dev/preview middleware negotiates Brotli, gzip and identity using
Accept-Encoding weights and exclusions. Before serving Brotli it checks the raw
and encoded sizes and SHA-256 values against the receipt. That result is cached
by file inode, size, modification and change times. Replacing any of the three
files invalidates the check; missing, corrupt or stale sidecars fall back to an
acceptable encoding. HEAD, Vary and encoded Content-Length are preserved.

This is local transport support, not a change to production upload/budget rules.
The whole-city publication blocker remains open. A cold browser trace through
READY is required to establish the 15 MB first-load limit; compressed file sizes
alone cannot establish it.

Verification: `npx vitest run tools/map/test/localTransfer.test.ts` exercises the
actual middleware over HTTP, including round trips, HEAD, preferences, q=0,
wildcard, identity, stale/corrupt/missing sidecars, manifest mismatch and paths.

Measured SF sidecar on 2026-10-03: 23,079,905 raw bytes, 10,994,998 gzip bytes,
8,770,134 Brotli bytes (2,224,864 fewer transferred bytes). Raw SHA-256 remains
`5763c53debed013a7f5403a467bd829f45dacfdfb83dc9c5c19e5555fe91651f`;
Brotli SHA-256 is `9f048aee05fa7e5aeefee5169e3ebeb6e81e14ecf1429b9eb7536c3f8d38c949`.
`artifacts/map-transfer/sidecar.json` records identical before/after hashes for
the raw/gzip graph, raw/gzip manifest, runtime inventory and road-detail art.
All five HTTP groups and map/web strict checks passed.

The normal-browser cold trace in `artifacts/columbus-stream/2026-10-03T1348/`
passed on exact common `2026-10-03T1337`, commit
`a3d08877ca8a792def95bd7783315d67267a6f3e`, including source `39f8b0e`.
CDP measured **13,589,513 transferred bytes through READY at 9.586 seconds**,
including response headers, below the decimal 15,000,000-byte limit. The graph
returned HTTP 200 with `Content-Encoding: br`: 8,770,134 encoded body bytes,
8,770,372 bytes in the CDP transfer record, and 23,079,905 decoded bytes. No disk
or service-worker cache was used. All five asset hashes matched the common
receipt, and the completed drive recorded no browser, HTTP, stream or map errors.
The prior 15,804,589-byte cold failure remains recorded.

Only the transfer child `gtasf-o0cb.3` passes. The same run failed the separate
frame gate: 20 of 6,375 Columbus frames exceeded 50 ms (maximum 100.3 ms),
including nine streaming frames. All 10,900 wall frames remain in the evidence;
the frame parent, whole-city publication budget and real-device gates stay open.
