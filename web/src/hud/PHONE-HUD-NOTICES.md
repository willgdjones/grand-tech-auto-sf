# Phone notices and event actions — gtasf-q2z9

The October 4 native Noe Valley phone capture showed a live VC-drop notice over
the connection status, Game options and funding clock. The Add event launcher
also shared the events-button rectangle. The baseline is
`artifacts/coastline-look/2026-10-04T06-47-59.552Z/noe-phone.png`.

`createPhoneHud` now observes the existing drop banner's rendered size. While the
phone layout is active, the status, options, funding, events and street-name
offsets reserve that height plus the existing eight-pixel notice gap. A hidden
banner reserves zero space. Wrapping titles, the next-fund teaser and viewport
changes update the reservation through `ResizeObserver`; the game loop performs
no layout measurement. Desktop layout reserves no additional space. Destroy
disconnects the observer and removes the owned CSS property.

On phones, the original Add event button lives in **Game options → Tech Week**.
Its original handler opens the existing submission dialog, closes Game options,
and returns focus to a visible control when dismissed. Resizing to desktop or
destroying the phone HUD restores the same button at its original toolbar
anchor, as for the other existing phone actions.

No new main-loop wiring or feature switch is needed: the existing `hud`/`mobile`
entry point owns the phone layout, and `fundDrops`/`eventSubmission` still own
their modules. The change sends no event submissions and grants no rewards.

## Focused verification

Run `tools/heavy.sh node tools/phone-notice-layout-smoke.mjs`. It bundles only the
real DOM modules and their source CSS into an explicitly labelled local fixture,
then uses one temporary GPU-disabled Chrome through CDP. It checks 390- and
320-pixel phones, short and wrapping notices, removal, resizing, visible action
hit-testing, the original Add event dialog/focus, desktop restoration and
cleanup. Screenshots and a report go under `artifacts/phone-notice-layout/`.
It does not use Playwright, the world renderer, game API or a full build; it
cannot establish native gameplay, device or performance acceptance.

The October 4 run at 07:19 UTC passed all nine phases with zero console/runtime
or HTTP errors. Its receipt is
`artifacts/phone-notice-layout/2026-10-04T07-19-03.395Z/report.json`.
The short notice reserved 56 px, the wrapping title/teaser reserved 101 px, and
hidden/destroyed notices released the reservation. The 390 px and 320 px long
notice screenshots and the 320 px hidden-notice screenshot were reviewed:
all checked rectangles are separate and the actions remain legible. The same
Add event node opened its original dialog in both the phone menu and restored
desktop toolbar; closing on phone focused Game options. These are DOM/layout
results with explicit notice fixtures, not live funding or native game evidence.

Shared web strict TypeScript passed at 07:22 UTC in OliveSparrow's coordinated
check (session 88967, Agent Mail 6163), with this phone source already present.
The final queued web strict check also completed successfully (session 38165,
exit 0) before any cancellation signal was sent. No shared lock was touched.
