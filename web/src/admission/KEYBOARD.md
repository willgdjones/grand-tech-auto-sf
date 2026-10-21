# Admission keyboard behavior

The admission screen owns keyboard input while a player waits, sees the launch
screen, reconnects, or chooses to rejoin after inactivity. The primary idle
action is Rejoin the queue. Tab and Shift+Tab stay in the screen; Escape and
game shortcuts cannot dismiss it or open covered game controls. Queue refreshes
preserve the email draft and focus. Admission restores the preceding game
control or dialog and releases the cursor hold.

The admission client keeps the existing worldCapacity/waitlist feature gates,
queue polling, grant handling and explicit rejoin click. Keyboard checks use
isolated responses; they do not contact the live queue or save a real signup.

`nice -n 19 node tools/admission-keyboard-smoke.mjs` bundles the actual Admission,
Game options and Events modules. `GTASF_ADMISSION_KEYS_STAGE=before` selects the
baseline assertions and preserves the original admission source and CSS in
`before/source/` on its first build. `--build-only` and `--run-only` preserve a
bundle across a source edit. Receipts live in
`artifacts/admission-keyboard/{before,after}/`.
The check covers desktop and phone viewports and owns no WebGL context.

On October 3, 2026 at 12:14:32 UTC, the frozen original reproduced both covered
Game options activation and Events V activation in desktop 1100×720 and phone
390×844 viewports. The final 12:14:34 UTC run passed five groups at each size:
initial focus and forward/reverse Tab, shortcut and Escape isolation, keyboard
rejoin with normal polling and preserved email/caret, fixture-only signup,
cleanup, an existing native game dialog, and the launch-only screen. No console
or page errors or unstubbed API requests occurred. Both screenshots were
reviewed. Web strict types and all four affected tests passed at 12:15 UTC.

The native dialog now makes covered game controls inert and stays above any
existing game dialog. Its keyboard capture listener also blocks window-level
game shortcuts. When signup disables the last control, the dialog itself is
the focus fallback. Refreshing queue text leaves the current input alone.
Hiding the dialog removes the listener, restores native focus and releases the
cursor hold. This is isolated DOM evidence; live capacity, real-device behavior
and production acceptance are separate checks.
