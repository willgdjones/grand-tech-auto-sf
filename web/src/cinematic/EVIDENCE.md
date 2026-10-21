# Cinematic capture acceptance — 2026-10-03

`gtasf-0ux` passed its scoped local capture smoke. All four rails produced
H.264 MP4 in portrait (1080×1920) and landscape (1920×1080), with hidden HUD.
The smoke compresses each rail to three seconds at 12 fps (36 frames); normal
recording defaults to 30 fps and the longer lengths in [GUIDE.md](GUIDE.md).

Ignored local evidence under `artifacts/cinematic/`:

| Rail | Reviewed output directory | Both MP4 framings |
| --- | --- | --- |
| Lombard robotaxi descent | `smoke` | Passed |
| Ferry Building flyover | `smoke` | Passed |
| Salesforce crown reveal | `smoke-coverage-fix` | Passed |
| GPS drive to an event | `smoke-surface-fix` | Passed |

Each directory contains the MP4 files, first/middle/last JPEG review frames,
the frozen web build, and `report.json`. The original `smoke` report retains
its later Salesforce failure honestly; its four completed Lombard/Ferry
clips passed before that failure. The coverage retry passed both Salesforce
framings. Its old event clips were superseded by the final surface retry.

The recorder checked every encoded size and frame count through `ffprobe`.
Sampled harness frames 0, 18 and 35 matched rail times 0, 1.5 and 2.916667
seconds; the camera moved between samples. Console, page and harness errors
failed recording. No cinematic opened a multiplayer World socket. Final
surface-retry report: `passed:true`, `errors:[]`, both `harnessErrors:[]`.

Review confirmed the robotaxi following the Lombard bends, the Ferry clock
tower flyover, Salesforce's rounded crown, and the Prius following the visible
GPS ribbon to the event beam. Portrait and landscape retained their subjects
and hid the UI. The real event is **Rabbits on the Run**; its approximate public
location remains labelled `approx:true` in the recording metadata.

Two visual/coverage issues found by the smoke were corrected:

- Salesforce lies beyond the current streamed ground corridor. Its rail keeps
  the real tower anchor, streams the nearest mapped neighbourhood and reports
  `groundAtSubject:false`. Driving rails cannot leave available ground.
- The Ferry's authored paving covered the source-height car/ribbon. Commit
  `8601cb4` composes landmark contact surfaces for the director, with main
  integration `5dacb11`. Final first/middle/last event frames show the car body
  and ribbon above the paving. The broader source-lane/plaza/kerb overlap
  remains a separate landmark geometry follow-up.

The final event snapshot also exercised the optional cloud clock and latched
atmosphere epoch from the render integration: screenshot wall time cannot
advance the directed scene. The local night grade and facade atlas were visible.

Validation: strict web TypeScript, the existing two harness core tests,
recorder syntax/diff checks, and the scoped frozen web builds passed. The
render owner separately passed seven scene/clock tests. This verifies capture
and export; it is not live performance, device, or full-city visual acceptance.
