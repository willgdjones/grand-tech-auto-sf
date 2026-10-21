# Outbid leaderboard reopening

`gtasf-2dns` makes a fresh Outbid dialog opening start at the heading and
top-ranked bidder. Selecting OUTBID THEM still scrolls to the bid form and
focuses the name field. The reset runs only when opening a closed dialog;
live leaderboard updates retain their existing focus and scroll behavior.

The original panel retained the previous form position when the player
pressed Escape and selected Top 50. The actual DOM baseline on 2026-10-03
at 14:19:56 UTC reproduced this on desktop and phone with 40 approved local
snapshot entries:

| Viewport | Reopened scroll, before → after | First bidder top, before → after |
| --- | ---: | ---: |
| 1100 × 720 | 2,954 → 0 px | −2,749.47 → 204.53 px |
| 390 × 844 | 2,921 → 0 px | −2,692.38 → 228.63 px |

The isolated candidate passed at 14:29:48 UTC. Its applied production source
is byte-identical, with SHA-256
`b61bff159fd13d3fc7c6091fc9e6da38090e63efb7c653a3f8d4f67333b6d1ae`.
The check verifies fresh heading/leader visibility, Close focus and physical
Tab to rank 1, then a live update at rank 16 with exact focus/scroll retention.
It also covers preserved name/message drafts, visible focused name on the bid
form, Escape restoring each launcher, repeated reopening, disabled Checkout
and disposal. Both failing baseline images and three changed screenshots were
reviewed. Page/console errors and actual API/map traffic were empty; the local
fetch stub permits only GET `/api/outbid`. Web TypeScript strict passes.

The source change adds one scroll reset to the existing fresh-open branch.
These are isolated DOM checks with disabled GPU/WebGL and local snapshots;
they do not establish a payment, native-world or device gate. Shared game
bundle `2026-10-03T1442` passed at 14:42:29 UTC from exact commit
`2395aa28ec0515a3ea18d812508805844cabc2df`, including source `319f0cd`.
The integration owner reported 177 modules in 956 ms with exit 0; the source
receipt and source-commit ancestry were checked before closing the bead.

Reproduce with Node 24:

```sh
GTASF_OUTBID_SCROLL_STAGE=before node tools/outbid-board-scroll-smoke.mjs
GTASF_OUTBID_SCROLL_STAGE=after node tools/outbid-board-scroll-smoke.mjs
node node_modules/typescript/bin/tsc --noEmit -p web/tsconfig.json
```

The baseline preserves existing frozen files or reads the original panel and
CSS from `ded1d24`. `--build-only` and `--run-only` support coordinated browser
windows. `GTASF_OUTBID_SCROLL_SOURCE` can select an isolated candidate for the
after run; the report records its path and SHA. Evidence remains in ignored
`artifacts/outbid-board-scroll/{before,after}/`.
