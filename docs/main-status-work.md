# Main-loop status DOM writes

`gtasf-yifr` makes the main loop write status text and canvas data attributes
only when their values change. It still evaluates current movement, counts, connection state,
taxi state and notices every frame. When a taxi is waiting at the curb, the loop
writes the final pickup message directly, avoiding an intermediate destination
message. The existing startup flag and all displayed copy stay unchanged.

The actual main-update status statements were selected with the TypeScript AST
and executed in a GPU-disabled browser DOM with controlled game state. The
original source was verified byte-for-byte against `aad993e:web/src/main.ts`.
For 120 updates of unchanged state, the original produced 2,160 DOM mutations:
480 text-node replacements and 1,680 attribute writes. Curb pickup produced
2,280 mutations because it also overwrote the destination message; an active
notice produced 2,040. The final source produces zero mutations in every case.

All 13 cases retain exactly the same final DOM values as the original: walking,
nearby cars and cable cars, driving, both passenger modes, distant and adjacent
taxi pickup, pickup during a notice, active and expired notices, changing live
counts and an unavailable calendar. Mode changes, coordinates, speed, vehicle
identity, mounted chunks, connection and event counts remain current. Browser
errors are empty. Web TypeScript strict passes.

The evidence measures avoided DOM work; it does not establish a native frame
rate improvement, the cause of previous long frames or a device gate. The
whole-city driving gate remains open. The shared `2026-10-03T1430` bundle passed
at exact source `3ee1b48a384ff531afb6aa808da331a5dd025955`, with all five map/art
pins unchanged. This completes this bead's bounded integration acceptance.

Reproduce the comparison from the repository:

```sh
GTASF_STATUS_STAGE=before nice -n 10 node tools/main-status-smoke.mjs
nice -n 10 node tools/main-status-smoke.mjs
```

Reports, the exact source and the extracted statements are written to
`artifacts/main-status/{before,after}/`. The initial diagnostic and off-tree
candidate are retained in `artifacts/main-status-prep/`. No world, API, payment,
clock fixture in the running game or native renderer is involved.
