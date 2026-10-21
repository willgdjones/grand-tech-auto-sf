# Native dialog input lifecycle — gtasf-eln9

The cap table, Friends, ad-slot and account-recovery dialogs must block the local
movement/camera loop while open. Driving uses the same existing modal handbrake
as the other game panels. The world and other players continue to update.

`main.ts` reads the cap table/ad-slot `isOpen` properties and Friends' native
`element.open` state. Recovery exports `isRecoveryDialogOpen()` because its
existing save/restore entry points return no handle. Its change subscription
releases held input and coordinates the game panels. The recovery module owns
one free-cursor lease per open dialog and exports `closeRecoveryDialogs()` for
Escape/teardown; closing one dialog cannot release another dialog's lease.

Cap-table/ad-slot close callbacks settle synchronously. Their queued native
`close` events ignore an already-reopened dialog, and destruction settles an
open panel before removing it. Friends follows the same lifecycle: native
Escape and destruction stop both polling loops, repeated `open()` is a no-op,
and a DM reply from a closed or superseded thread cannot restart polling or
populate a different conversation. Recovery's delayed status/focus work ignores
a dialog that has already closed.

Friends also scopes its header positioning and pointer events so the global HUD
header rule cannot pull Close outside the dialog. Its hidden roster, DM and
username-claim sections override their flex layouts, and Close/Back have 44 px
touch targets.

All existing feature flags remain unchanged. The work changes no funding,
friendship, recovery or payment endpoint/data contract. The ad-slot checkout
remains gated. The recovery save/restore signatures remain compatible with the
onboarding pane's offer-ordering work.

## Focused verification

`dialogLifecycle.test.ts` bundles the actual panel modules, cursor leases and
driving controller into a native Chromium component smoke. Explicit API, flag
and flat-ground fixtures isolate dialog behavior without a city/Worker build.
Desktop checks cover open/close, close-plus-immediate-reopen, synchronous state,
Escape, handbraking, and resuming movement after close. Friends checks include a
single roster poll after repeated open and no continued poll after a late DM
reply to a closed panel. Phone checks use native taps. Recovery checks cover
both panels and overlapping cursor ownership. Destruction is idempotent and
does not leave a modal or cursor lease behind. No fixture API write is allowed.

Reports and phone screenshots are emitted under `artifacts/dialog-lifecycle-eln9/`.
The existing cap-table and ad-slot checks are included in the targeted run.
This is component/input-contract evidence; it does not establish a full-city
driving or two-tab journey, real-device performance, payment or deployment gate.

The initial native run (`2026-10-04T13-27-43.117Z`) exposed the Friends CSS
conflict: the phone Close tap timed out, with both roster and DM visible. Its
failure report/screenshot remain intact. The other 11 targeted checks passed.

The corrected native run passed on 2026-10-04 at 13:42 UTC (1 smoke, 15.13 s):
`artifacts/dialog-lifecycle-eln9/2026-10-04T13-42-21.960Z/report.json` records
zero browser errors. Reviewed all five phone screenshots; Friends now has its
header/Close inside the dialog and only the active view is visible. Save/Restore
Close taps also passed. The Restore heading still crowded its separate Close
button at 390 px in that receipt; the separate `gtasf-xupf` follow-up below
addresses this layout issue. No whole-game visual acceptance is claimed.

`npx tsc --noEmit -p web/tsconfig.json` passed. The final web-only Vite bundle
passed (317 modules, 1.55 s), emitted to `/tmp/gtasf-eln9-web-20261004-final`.
Checks used `tools/heavy.sh` and single-worker Vitest; no full-repository suite.
Main source SHA-256: `791aef48445d23ba62b28d420468582df7ed89150feeb586e00fb3a2f582fec0`.

## Recovery heading layout — gtasf-xupf

The recovery body reserves a row above its title for the 44 px Close button.
Long content can scroll within the viewport. The same native smoke now checks
Save and Restore at 320×568 and 390×844: heading/Close rectangles do not overlap,
the heading stays on screen, Close is at least 44 px tall, and a real tap closes
the panel and releases the cursor. API fixtures remain read-only; no recovery
code is generated or used.

Passed on 2026-10-04 at 14:04:52 UTC (one smoke, 16.87 s), with zero browser
errors, in `artifacts/dialog-lifecycle-eln9/2026-10-04T14-04-52.993Z/report.json`.
Reviewed all four Save/Restore phone images: the titles wrap cleanly and stay
below Close at both widths. The final web-only Vite build passed (319 modules,
1.81 s, `/tmp/gtasf-ground-recovery-20261004`), followed by clean current web
strict TypeScript after the separate onboarding fixture repair. These are
native component/layout checks, not full-game or real-device acceptance.
