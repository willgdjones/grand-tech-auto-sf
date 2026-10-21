# Award toast placement — gtasf-thaa

Status: toast placement accepted by the nine-view DOM smoke and scoped image
review. The shared workspace TypeScript failure below remains separately tracked.

The native founder journey captured a real overlap in
`docs/perf/onboarding-journey/phone-2026-10-04T12-21-11.444Z/15-mission-complete.png`:
the routine event award at `top:84px` covered the live fund notice and upper HUD.
This is separate from duplicate award panels and modal/input handling.

`toastLayout.ts` reads the visible notice, status, action, radar, touch, location,
navigation and funding bounds when an award or layout changes. It finds space
inside the viewport with an eight-pixel gap. Resize/mutation observers and window
resize trigger the work; the game loop does not read DOM bounds for this feature.
The existing notice measurements on `body.style` trigger placement after a fund
banner or onboarding hint wraps, appears or disappears.

Wide screens retain the original stacked cards when they fit. Phones, short
windows and crowded layouts use a compact latest-award row; the event title may
ellipsize while its full text remains in the live region. Older notifications
keep their existing data and dismissal timers. If a modal/map occupies every
available rectangle, the live announcement remains without painting over its
controls. Placement retries when the HUD changes. The component disposes its
observers and resize listener with the toast stack.

All notifications remain pointer-transparent. There is no focus, cursor,
pointer-lock, movement, networking, award or funding change. This repairs the
existing HUD entry points and does not introduce a new feature flag.

## Verification scope

`tools/award-toast-layout-smoke.mjs` builds the actual toast, fund banner, phone
HUD, status, street, event button, chat, radar, funding room and touch modules,
using the game's actual header, toolbar and footer. Drop and award data are
explicit isolated fixtures, without a backend or WebGL renderer. It checks long
and four queued awards at desktop, tablet, 390px, 320px and landscape sizes,
viewport fit, control/notice overlap, pointer transparency, resize/notice-hide
recovery, disposal and browser errors. These checks do not establish a complete
in-game, real-device, performance or production gate.

On 2026-10-04, the nine cases passed with zero browser/HTTP errors. The final
report is `artifacts/award-toast-layout/report.json`; the same run explicitly
checks that hiding the fund notice moves the award back into its vacated space.
The first attempt found that a 32px row did not fit the 320×568 screen with the
long fund teaser; reducing compact vertical padding gives a 30px row that fits
with the existing eight-pixel clearance. No content, timers or input behavior
were changed to make that case pass.

Personally reviewed `phone-stack.png`, `small-phone-teaser.png`, `landscape.png`
and `desktop-stack.png` from that directory. The award is clear of all measured
controls. On the smallest and landscape layouts, the title is abbreviated and
the complete text remains in the live region. The fixture also exposes separate
radar/event/chat/footer collisions between persistent HUD elements on short
screens; DarkMoose owns that follow-up. This receipt accepts toast placement,
not the overall short-screen HUD layout.

The final DOM run was at **2026-10-04 13:52:49 UTC**. Its notice-hide recovery
returned to `top:272px` from `327px`. The accompanying `tsc --noEmit -p
web/tsconfig.json` checked the changed modules without toast errors, but exited
with the in-progress `emailPrompts` errors in shared onboarding state and its
tutorial-driver fixture. That unrelated edit is tracked in `gtasf-1aon.1`; this
receipt does not claim a clean full-workspace TypeScript check.
