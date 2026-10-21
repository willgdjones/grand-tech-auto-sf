# Phone camera gesture ownership

The active touch controller reserves browser gesture handling only on its game canvas with `touch-action: none`. Without that declaration, a browser may cancel a Pointer Events drag to pan or zoom even when pointer handlers call `preventDefault()`. Other elements, including Game options, keep their existing touch scrolling and page zoom behavior.

The controller saves the canvas inline declaration and priority when shown, retains that original value across repeated `show(true)` calls, and restores it when hidden or disposed. Showing the controller again records the current prior setting. The existing `mobile` and `unifiedInput` switches continue to govern the mounted controls; no new camera math, input action, or global viewport restriction is introduced.

Actual baseline `artifacts/phone-camera/2026-10-03T1411-before/report.json` uses production Input, ThirdPersonCamera and style.css with physical phone events. A six-step horizontal drag produced look `0.12` only on the first step, followed by five zero samples after a browser `pointercancel`. Spreading two fingers changed `visualViewport.scale` from 1 to 1.8214, issued two cancellations and left the camera boom at 8.5 metres. Browser/page errors were empty. The original diagnostic also recorded that pinch camera zoom is not wired; that feature is separate from this drag repair.

`tools/touch-camera-smoke.mjs` checks sustained drag, browser viewport stability, simultaneous joystick/look, cancellation, actual Game options scrolling, hidden controls and restoration of a prior `pan-y !important` declaration. It creates no renderer or server world and establishes no native visual, physical-device or frame-rate acceptance.

The fixed `artifacts/touch-camera/2026-10-03T1423-after/report.json` passes all six groups. Every 20px drag step supplies `0.12` radians of input look; simultaneous stick/look retains movement `0.893` and the same look delta. Browser scale stays at 1 and no browser cancellation occurs during owned canvas gestures. Explicit cancellation clears both channels. Game options scrolls from 0 to 267px with its original `touch-action: auto`. Hide/dispose restore `pan-y !important`; initially hidden controls leave the canvas at `auto`. Four affected input tests and strict web TypeScript pass.

The retained first after runs exposed fixture cleanup and timing defects: CDP rejects cancellation when no touch is active, and it may acknowledge a move before Chromium dispatches a coalesced pointer event. The final helper tracks active touches and samples after browser animation frames, as the game does. Product code was unchanged across those fixture corrections. This is functional input evidence, not a wall-frame performance measurement.

Run `GTASF_PHONE_CAMERA_OUT=artifacts/touch-camera/check node tools/touch-camera-smoke.mjs`.
