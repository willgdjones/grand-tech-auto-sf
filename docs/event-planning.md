# Event calendar route planning

The V/touch event list offers earliest, nearest and highest-current-raise ordering.
Search and San Francisco date filters still apply before sorting. Nearest uses
straight-line distance from the player's current position; the GPS callback still
validates the actual road route. Events without a public map location sort last
for distance and funding, retain their event-page link, and cannot be selected
as a driving destination.

Physical event cards use the same `quoteFunding` and integer-cent formatting as
the server, with zero other attendees and the first streak step. Estimates show
the current timing multiplier and the 20-second marker requirement. The view
explains crowd/streak bonuses, timing changes during travel and the daily limit.
These are estimates, not a promise of another award for an event already visited.
The server still decides eligibility, arrival timing and the actual award.

The existing `eventsView` gate controls the calendar. `fundingLoop` additionally
controls funding text and its sort option; nearest ordering remains available
when funding is disabled. This change adds no network requests or main-loop API.
Sorting keeps the existing stable chronological tie order. Background updates
retain the user's search, sort and focused/hovered row; selecting a retained row
uses the latest feed record. Clock updates refresh quotes and ordering when the
list is not being pointed at or keyboard-focused.

## Local verification — 2026-10-03

`nice -n 19 node tools/event-planning-smoke.mjs` passed against the actual DOM
module in an isolated Vite bundle, with Chromium GPU disabled and no Worker/API
requests. It covers:

- Live investor $3M, upcoming demo $750k, past investor $500k and live community
  $600k estimates; online-only events show no funding estimate.
- Distance and raise ordering through neighbourhood search and date filters.
- A fixture clock crossing an event boundary updates the demo estimate to $1.5M
  and reorders the list while keeping the sort control focused.
- Feed refresh preserves a focused row and sends the updated coordinates/title
  through both GPS and hail callbacks.
- The funding flag removes quotes, explanatory copy and the funding sort option;
  normal date/distance browsing remains usable.
- Desktop and 390px phone layouts, a 44px sort control, keyboard traversal and
  zero console/page errors.

The screenshots `artifacts/event-planning/calendar-planning-desktop.png` and
`calendar-planning-phone.png` were visually reviewed. The complete report is
`artifacts/event-planning/report.json`. The initial run caught an optional-tuple
TypeScript error and then a harness-only attempt to mutate frozen production
flags. The tuple is now explicit; flag-off evidence uses a mutable fixture copy
without modifying production configuration. The final smoke and
`nice -n 19 npx tsc --noEmit -p web/tsconfig.json` both passed.

This verifies the local calendar behavior. It does not establish native runtime
stability, earned ledger payouts, full founder-path, deployment or G1 acceptance.
