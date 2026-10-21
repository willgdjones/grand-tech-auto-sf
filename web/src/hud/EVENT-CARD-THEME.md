# Event detail card SA theme — ni5k.1

`playableHud.css` now uses the shared flat black SA panel, outlined gold display
title, blue metadata, and square gold Close, RSVP and Share controls. Controls
have a 44px minimum height and a visible white focus outline. Existing HUD
rules, event behavior, desktop/phone anchors, overflow and hidden states remain.
This is a style update to the existing `hud` feature, not a new feature switch.

Validation on 2026-10-04:

```
tools/heavy.sh nice -n 15 sh -c 'node tools/event-card-scroll-smoke.mjs && npx tsc --noEmit -p web/tsconfig.json'
```

PASS: all five existing event-card DOM cases and web strict typecheck. The smoke
uses real committed public event records and the actual HUD, Input and CSS.
It checks fresh heading/Close visibility, focus return, preserved scroll during
updates, reachable actions after scrolling, blocked movement while open, and
restored movement after closing/destroying. Sizes: 1100x400, 1100x720, 390x568,
320x568 and 390x844. No browser or HTTP errors were recorded.

Evidence: `artifacts/event-card-scroll/report.json` and the matching PNGs,
recorded at 2026-10-04T10:04:31.463Z. Desktop and 320px phone images were reviewed
by eye: the long title wraps, the Close control is clear, and body text is
readable. On the short phone the lower actions require scrolling, which the
smoke exercised successfully.

This is isolated DOM evidence. It does not establish an in-game desktop/phone
look, real-device performance, or the parent whole-HUD acceptance. Those remain
open; Agent Mail 6363 requests the in-game view from the integration/browser lane.
