# Contextual hint placement — gtasf-dymp

The first-fund explanation previously used a fixed 74px top offset and covered
the live fund banner. The notice grows when its name or upcoming-fund teaser
wraps, especially on phones.

`createDropBanner` now publishes its rendered height using `ResizeObserver`.
The nudge sits below that notice and the existing sponsor bar, and its text wraps
within the viewport. `SaHintChips` reserves the visible nudge height so the phone
clock, connection status and controls move below it. Prompt/touch variants keep
their existing positions. Measurements happen on size/visibility changes rather
than per game frame. Hiding or destroying the components clears their space and
observers. The existing `fundDrops`, `onboarding`, `hud` and `mobile` entry flags
continue to control the relevant components.

Validation command:

```
tools/heavy.sh nice -n 15 sh -c 'node tools/onboarding-drop-layout-smoke.mjs && npx vitest run web/src/theme/saMission.test.ts --maxWorkers=1 && npx tsc --noEmit -p web/tsconfig.json'
```

The focused smoke mounts the actual banner, hint, HUD and phone-layout modules
with isolated fund data. It exercises desktop-to-phone resizing, a wrapped
upcoming-fund teaser, a 320x568 phone, return to desktop, hiding the notice and
hint, a shorter hint, and destruction. It checks that the hint fits and clears
the notice/clock/connection/actions. This is DOM layout evidence, not a real
device or full-game performance gate. The production #5.3 screenshot in
`artifacts/production/deploy53/live-v2/ferry-desktop.png` is the original report.

Result: PASS at 2026-10-04T10:20:45.506Z. All five responsive views, hide/resize/destroy
recovery, nine existing `saMission` tests, and web strict typecheck passed.
`artifacts/onboarding-drop-layout/report.json` records no browser/HTTP errors.
Desktop and 320px phone screenshots were reviewed: banner, nudge, connection,
clock and actions are distinct and readable. The small-phone case has an 8px
notice-to-hint gap and a 12px hint-to-HUD gap. This repairs the source; a live
deploy confirmation remained with the release/browser lane at that point.

The later native full-game run in `docs/perf/phone-ux-first-visit/report.json`
finished at 2026-10-04T11:02:27.270Z with all eight phone/desktop UX steps passing,
fresh intro/identity saved in both views, and no browser/HTTP errors. Its frozen
app is `artifacts/phone-d6/phone-c8sj-receipt/app`, before the desktop follow-up
below. The 390x844 `phone-ferry-layout.png` was personally reviewed: fund notice
y=66–131.59, nudge y=140–185, connection/clock starting y=197, and action controls
below. This confirms the original phone notice/nudge clearance in the game.
It does not approve the whole scene: a separate unanchored touch hint is clipped
at the bottom left and is tracked by `gtasf-fn0s`; the phone performance gate also
remains separate.

## Full desktop toolbar follow-up — gtasf-dymp.1

The current native Mission screenshot at
`docs/perf/phone-c8sj-receipt/mission.png` exposed a remaining overlap at
1080x2400: the hint cleared the fund notice but covered the title and the first
action row. The original DOM smoke mounted only one toolbar button, so its
desktop result did not cover the live toolbar's wrapping.

The layout now observes the lower edge of both the actual title and action
toolbar. Desktop header/actions move below the measured fund notice; nudges
start below the action rows and the clock reserves the visible hint's height.
Between 701 and 1024px, the title uses a compact size and hides its secondary
location line so it clears the action rows. The existing phone offsets remain
unchanged. This uses the existing resize observers, with no frame-loop reads.

The smoke now imports the header and complete base toolbar from `web/index.html`,
shows Ride, adds the live event/invite action labels, loads the actual theme,
and keeps the options menu closed. It includes 1080x2400, 1024x768, 768x1024 and
the 701px desktop breakpoint. It checks that fund notices, hints and action rows
clear the title, alongside the original clock/connection checks.

The first eight-case follow-up passed its hint assertions, but visual inspection
found an exposed fixture menu, missing UTF-8 metadata, and a real fund/title
overlap at the narrow desktop breakpoint. Those findings prompted the fixture
corrections, desktop notice reservation and stronger assertions above. That
earlier report/images are preserved in
`artifacts/onboarding-drop-layout/first-full-toolbar-review/`.

Final result: PASS at 2026-10-04T11:23:41.573Z. All nine views and desktop/phone
notice-hide, hint-hide, resize and destroy recovery passed, followed by web
strict typechecking in the same serialized command. The report records no
browser/HTTP errors. The 1080px portrait desktop, 701px breakpoint and 320px phone
screenshots were personally reviewed: the title, notice, hint, actions and clock
are distinct and readable. At 1080px, actions end at y=319, the hint occupies
y=331–360 and the clock starts at y=368. At 701px those positions are 328,
340–369 and 377 respectively. The new desktop source still awaits full-game
confirmation in a later frozen build or deploy; this is scoped DOM acceptance,
not a scene/device or performance gate.
