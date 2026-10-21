# Event-card opening position — gtasf-sp2d

A fresh event-card opening starts at the heading and visible focused Close
button. An already-open card keeps its current scroll and focused action when
the same event's content updates. Existing `hud` enablement and the main modal
callback continue to apply; no new integration is required.

The October 3, 2026 13:58 UTC baseline used the actual HUD, Input and CSS with
the committed Stockholm/KTH public Tech Week event. Keyboard Shift+Tab reached
Share, Escape closed the card, and Enter reopened it. At 1100×400 the old card
retained 67 px of scroll, placing its focused Close at y=-41; at 320×568 it
retained 121 px, clipping Close above the card. Both failing screenshots were
reviewed. The two larger phone cases retained visible controls. Baseline code,
bundle, report and PNGs remain in `artifacts/event-card-scroll-prep/baseline/`
(the baseline script is in its parent directory).

`nice -n 10 node tools/event-card-scroll-smoke.mjs` passes five viewports:
1100×400, 1100×720, 390×568, 320×568 and 390×844. It uses two unchanged public
events from `worker/src/events/data/sf-tech-week.json`, actual DOM/Input modules,
physical keyboard actions and GPU-disabled Chromium. No world or API is loaded.

The final check verifies heading/Close visibility and zero scroll on first and
subsequent openings, preserved action focus and scroll on a same-event refresh,
reachable RSVP/Share controls, Escape focus restoration, blocked gameplay input
inside the modal, restored movement/camera afterward, and disposal. All five
screenshots were reviewed; browser/page/HTTP errors are empty. Report and PNGs:
`artifacts/event-card-scroll/`. Web strict types and the fixture bundle pass.
The complete shared web bundle also passed on October 3 at 14:10 UTC, using
committed source `12a149948c39592652930253d0f9fc9c65fb154a`, which includes
repair `95d00bd`. Its receipt is
`artifacts/founder-path/2026-10-03T1410/source.json`. This is DOM behavior and
bundle evidence, not native world, real-device, performance or deployment
acceptance.
