# Input frame sampling

The unified input loop keeps two physical frames so action edges retain the previous poll, one gamepad output frame, and borrowed movement/look event payloads. Keyboard, mouse, touch, and gamepad values are combined before the virtual-input override. A modal, text field, focus loss, or explicit release still clears physical controls.

`readGamepads(pads, dt, output)` clears and fills the supplied frame, preserving its vector and action-set identities. Omit `output` when an independent snapshot is needed. `resolveFrame` keeps its existing independent virtual-frame behavior. Action listeners consume borrowed movement/look payloads synchronously; listeners retaining a value must copy it.

This is an allocation reduction inside the existing `unifiedInput` feature switch. It changes no controls, production switches, or external integrations. Allocation counts establish the removed churn, not a frame-rate or device acceptance result.

## Focused verification

The `tools/input-frame-smoke.mjs` DOM fixture imports the actual `Input` module and drives physical keyboard events. It holds movement, running, camera look, and a horn through 2,400 polls, then checks completed interaction taps, modal release, text ownership, native keypad activation, virtual replacement/resume, explicit release, and gamepad snapshot behavior. Browser errors fail the run. The separate adjacent-tap diagnostic reports any existing repeated-tap loss without changing its acceptance during this allocation refactor.

The existing `tools/input-sampling-smoke.mjs` covers phone gestures, simultaneous controls, passenger look, cancellation, and touch snapshots. These fixtures use no game renderer or server; overall frame performance still requires the shared unfiltered driving check.

On 2026-10-03, the baseline at `artifacts/input-frames/2026-10-03T1315-before/report.json` retained 2,400 movement payloads, 2,400 look payloads, and 2,400 physical action Sets over 2,400 polls. Direct gamepad sampling produced 2,400 output frames and Sets. The matching candidate at `2026-10-03T1317-candidate/report.json` retained one movement payload, one look payload, two alternating physical Sets, and one gamepad output/Set. All four behavioral groups passed with no browser errors. The candidate fixture rewrote only import paths; the applied implementation was checked byte-for-byte against that candidate's source.

The live implementation then passed the desktop/phone touch fixture at `2026-10-03T1320-touch/report.json` (eight groups, no errors), four affected input unit tests, and strict web TypeScript. Both baseline and candidate report adjacent F tap deltas `[1, 0]`; the separate keyboard defect was fixed by `gtasf-ydyq`, as recorded below.

Commands, run from the repository root with Node 24 and fresh output directories:

```sh
GTASF_INPUT_FRAMES_OUT=artifacts/input-frames/check node tools/input-frame-smoke.mjs
GTASF_INPUT_SAMPLING_OUT=artifacts/input-frames/touch node tools/input-sampling-smoke.mjs
npx vitest run web/src/input/input.test.ts --maxWorkers=1
npx tsc --noEmit -p web/tsconfig.json
```

The shared common1337 build passed at `2026-10-03T13:37:19.662Z` from exact commit `a3d08877ca8a792def95bd7783315d67267a6f3e`, including allocation commit `039d2cc` and keyboard fix `3aaddf5`. Its receipt is `artifacts/founder-path/2026-10-03T1337/source.json`. This completes the scoped integration acceptance for `gtasf-b6pc` and `gtasf-ydyq`; driving-frame and device gates remain separate.


## Consecutive keyboard taps

An explicit keyboard press now survives when the preceding poll already contained the same action. A reused tap Set records accepted non-repeat keydowns separately from held actions. It is cleared on each poll and on release; virtual input suppresses these physical edges. Held gamepad buttons still use their normal rising edge, and repeated keyboard events do not synthesize new presses.

`tools/keyboard-taps-smoke.mjs` uses actual keyboard events through `Input`. The baseline `artifacts/keyboard-taps/2026-10-03T1322-before/report.json` failed on the second adjacent press for E, H, M and F, plus repress and Map-close cases. The fixed `2026-10-03T1325-after/report.json` passed all eight groups with no browser errors: each adjacent pair fires `[1, 1]`, held/autorepeat and gamepad controls fire once, and modal/release/text/virtual behavior remains correct. This fixture always asserts the desired behavior, so the retained baseline exits unsuccessfully.

The full input-frame fixture at `artifacts/input-frames/2026-10-03T1325-taps/report.json` still reports one movement payload, one look payload, two physical Sets, and one gamepad output across 2,400 polls, now with adjacent F taps `[1, 1]`. Four affected input unit tests and strict web TypeScript passed. Run the focused keyboard fixture with `GTASF_KEY_TAPS_OUT=artifacts/keyboard-taps/check node tools/keyboard-taps-smoke.mjs`.

## Consecutive phone taps

Touch samples distinguish newly pressed discrete actions from held buttons. The caller-owned `TouchFrame` keeps a reusable `pressed` array alongside `actions`. `Input` merges these touch press edges with accepted keyboard presses, while virtual input suppresses physical edges. Enter/exit, Hail, Map and Horn can therefore be pressed on adjacent polls without an intervening neutral sample.

Holding an action or placing another finger on the same held button keeps one action. Cancellation, release, hiding controls, and seat-mode changes discard pending taps. Driving pedals remain held controls; an entire pedal tap between polls does not latch. Calling `touch.read()` without an output still returns an independent snapshot.

The existing `unifiedInput` and `mobile` switches govern the same entry points. This is a control correction, with no extra feature switch or external integration. `tools/touch-taps-smoke.mjs` drives physical phone touches through the actual Input and TouchControls modules; it does not use the game renderer or establish device/frame-rate acceptance.

The actual baseline `artifacts/touch-taps/2026-10-03T1359-before/report.json` reproduced `[1, 0]` for all four adjacent tap pairs; its other five groups passed. The fixed `2026-10-03T1400-after/report.json` passes all nine groups, with `[1, 1]` pairs and no browser errors. Four affected input tests and strict web TypeScript pass. Run with `GTASF_TOUCH_TAPS_OUT=artifacts/touch-taps/check node tools/touch-taps-smoke.mjs`.
