# Shared-place startup recovery

An event link can fail before the game starts: `resolveSpawn()` first reads
the calendar, then checks the office registry. A transient calendar failure
followed by an ordinary office 404 previously stopped boot, even if the
calendar recovered immediately. This is separate from `gtasf-f166`, which
preserves GPS selection when the later shared calendar feed recovers.

`lookupPlace()` now retries a transient GET once after 750 ms. Its original
four-second total deadline covers both attempts, response bodies and the
delay. Deadline expiry aborts the request and cancels any pending delay before
the next source is tried. Failed HTTP bodies are cancelled. HTTP 408, 429 and
5xx, native network failures and interrupted bodies qualify; malformed JSON,
invalid place data and permanent HTTP errors do not.

Landmark and coordinate links still bypass lookups. Canonical event IDs keep
priority over event URL aliases and registered offices. A valid office can
still be used when the calendar is unavailable; missing and unavailable
destinations retain distinct errors. The existing `deepLinkSpawns` entry in
main controls this path. No Worker, map, flag or game-loop changes are needed.

The retained initial baseline is `artifacts/spawn-recovery/baseline.json`,
recorded at 2026-10-03T14:08:04.555Z against source SHA-256
`db3f8e5178719b988e438dcb21338dc2e4ac9ca028d2a38586e605850656807c`:
ordinary link passes, initial calendar 503 fails after falling through to an
office 404. The source copy and original bundled fixture are retained beside
the report.

Run `node tools/spawn-recovery-smoke.mjs` for the actual resolver over a local
HTTP server with controlled failures. It uses an unchanged public snapshot
event and an explicitly labelled office fixture. `GTASF_SPAWN_SOURCE` selects
a saved source for the before comparison; `GTASF_SPAWN_OUT` selects the report
directory. Focused regressions in `web/src/spawn/locations.test.ts` also cover
source priority, retry classification and exact timeout/backoff boundaries.

All six focused location regressions pass (run 75804, 640 ms). The HTTP smoke
against the saved original source reports five of nine passing: event 503,
interrupted event body and office 503 cannot recover, and the retry-timeout
case never reaches a second request. The updated resolver passes all nine
cases (run 47605). Both HTTP 200 headers are recorded in the interrupted-body
case, confirming recovery after the first body fails. A stalled second body
is aborted and the office fallback completes in 4010.986 ms; the fake-clock
regression separately checks the exact four-second boundary and cancellation
of a late retry delay.

Reports are `artifacts/spawn-recovery/before/report.json` (14:21:35 UTC) and
`after/report.json` (14:21:56 UTC), using the unchanged public event
`tech-week:a9e9ca45-9197-4d27-908f-26a41791dbee` (Who Hosts the Hosts?).
The accepted resolver source SHA-256 is
`78f224a14b3d0bc24f1ccaf4041a116f0117575fb7ae68d5030aa8113318d0b8`.

The shared strict web TypeScript check passes after the response fixture
correction (LavenderOwl run 8403). Source commit `be6ace0` is included unchanged
in shared build `3ee1b48a384ff531afb6aa808da331a5dd025955`, which passed at
2026-10-03T14:30:36.817Z (pane 1 run 71872, 177 modules, 817 ms). The exact
archive source and immutable app are recorded under
`artifacts/founder-path/2026-10-03T1430/`. Source ancestry and unchanged tested
resolver/test/helper files were verified before closure.

These checks concern controlled lookup behavior; they do not establish
native world, device or performance acceptance.
