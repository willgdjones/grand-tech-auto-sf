# Knockable street props

`flags.propKnockover` is enabled locally for the playtest and controls the
cosmetic overlay in `streetProps.ts`.
The main loop passes the actual driver position as the fourth argument of
`streetProps.update`; walking and robotaxi passengers do not trigger it.
The existing instanced hydrants, newspaper boxes, signs, meters, cones and bins
fall away from the car around their ground contact, then reset. Hydrants also
start the pooled water spray. This adds no network messages or gameplay damage.

## Native acceptance record

The first native run is
`artifacts/prop-knockover-native/2026-10-04T13-16-22.898Z/report.json`.
It uses the frozen 12:49 funding app, the real full-city road graph and an
isolated local Worker. Only named, zero-balance identities are pre-created;
normal public deep links, walking, entering a parked Prius and actual keyboard
or two-finger touch driving produce the contact. No pose, clock, input-state or
knock-over state is injected.

Both desktop (1440 × 900) and phone (390 × 844, low) drove into a real newspaper
box at the Ferry Building. Its instance up-vector changed from 1 to effectively
0, then returned to at least 0.9997 after the car left the contact area. Real
elapsed time recorded around contact, clearing and reset was 5.261 seconds on
desktop and 3.850 seconds on phone. Browser console errors and HTTP failures
were empty. The seven existing knock-over tests and shared/web strict checks
also passed at 13:20 UTC.

The car hid the fallen prop in the first screenshots. That run establishes the
contact/reset behavior, but the visual acceptance is pending a normal camera
gesture and a clear fallen-prop screenshot. The native run exercised newspaper
boxes; it does not separately establish hydrant-spray or every prop-kind look,
production deployment, real-device acceptance or frame-rate performance.

The follow-up `2026-10-04T13-35-16.057Z` clearly shows the desktop box flat
behind the car in `props-desktop-fallen.png`, then upright in
`props-desktop-reset.png`. Actual arrow-key camera input supplies the higher
view. The phone repeat overshot the check's unnecessary 30 cm parking target
after leaving the prop, so its original overall failed report is retained.
The phone-only `2026-10-04T13-44-27.612Z` run passes contact/reset again with
zero browser/HTTP errors; upY is 1 → effectively 0 → 0.99976 over 5.906 seconds.
Its rear-side camera view still places the prop behind the radar. The final
`2026-10-04T13-57-27.614Z` front-side gesture clearly shows the upright prop,
but finishes after it resets; its strict fallen-photo assertion fails and the
original report is retained. These are camera-capture limitations, not a
contact/reset pass from a failed check.

Local acceptance uses the clear desktop fallen/upright comparison and the
passing real-touch contact/reset receipts. Phone controls and the upright
in-game appearance were reviewed; a clear phone fallen-state photo is not
claimed. All kinds use the same overlay, but only the real newspaper-box loop
was exercised. Production allowlisting, phone FPS and real devices remain
separate gates. The helper now names a late screenshot `reset-before-photo`
and records `capturedWhileFallen` separately from functional pass status.

```sh
tools/heavy.sh node --import tsx tools/prop-knockover-native.mjs
```

`GTASF_PROP_APP` reuses a frozen app with the candidate flag compiled on.
`GTASF_PROP_ONLY=desktop` or `phone` limits a follow-up to that control surface.
