# Street-detail review — gtasf-street-detail-look-review-7924

Owner: DarkMarsh. Current result: **acceptance remains open**. `streetDetail` is
enabled for local review and is excluded from the production allowlist. This
review has not changed either setting.

## Reference and actual views

The local `tools/art/reference/teleop/teleop-1.png` and `teleop-3.png` frames were
reviewed by eye: light pavements with visible kerb edges, red-painted curb
sections, crosswalks and clear lane markings, trees and street lights outside the
carriageway. They are comparison references only, not copied assets or generation
inputs. The first frame has a strong wet-road sheen; matching that PBR response
is not established by the normal PS2 captures below.

Fourteen actual desktop/phone southern-district images were reviewed in
`artifacts/district-static/2026-10-04T07-49-16.026Z/views/`. Details and immutable
app/map hashes are recorded in `tools/map/DISTRICTS-SOUTH.md`. They use normal
PS2 gameplay at noon, 1440x900 desktop and 390x844 phone at DPR 2.75 with Low
selected. All fourteen reached READY and connected with no recorded runtime,
console, HTTP or network errors, and no source drift.

- Bernal/Cortland visibly has red kerb paint, crosswalks, stop signs, a manhole,
  overhead wires and street lamps.
- Noe/24th and Castro show a readable division between dark asphalt, light
  pavement, markings, storefronts and tree canopies. Excelsior has clear lamps,
  upper facade trim and shop fronts. Bayview's white lane markings remain visible.
- Potrero/18th **fails ground visibility**: a large grey patch covers the road
  under the player and interrupts the route strip. Sampled road/player contact
  still agrees numerically, demonstrating why the images must be reviewed.
  `gtasf-tm7m` owns the source terrain-cut repair and a fresh look.
- Some furniture sits close to visible road edges. These stills do not establish
  correct clearance for every lamp or tree, or drivability through every junction.

This partial district review does not replace the bead's specified Columbus and
Stockton junction views at desktop Medium and phone Low. Agent Mail 6227 requests
those at the existing browser team's next serialized capture boundary. Older
`artifacts/street-props/preview/` and `artifacts/power-wires/preview/` junction
captures predate the current detail bundle and are not acceptance for it.

The frozen app has known Chat/fund-notice and desktop clock/invite overlaps;
`gtasf-e0el` owns those. Their presence is retained in the evidence.

## Fresh Potrero ground review — 2026-10-04 10:05 UTC

The desktop and phone images in
`artifacts/district-static/2026-10-04T09-47-22.907Z/views/` were reviewed by eye.
The broad terrain patch previously covering 18th Street is gone: dark asphalt,
crosswalks, double-yellow markings, a manhole and the route strip are visible
under the player in both views. This resolves that specific occlusion observation.

Pale-blue strips remain across the junction and at nearby slab/sidewalk edges.
They are visible on both screens and are **not accepted** as finished ground.
`gtasf-hbyf` owns the source/render seam diagnosis; these images alone cannot
identify whether texture, height mismatch or missing geometry causes them.

Both records reached READY and connected with no runtime, console, HTTP or
network errors. Player and road Y are 31.175m; terrain Y is 31.0739m. The frozen
app hash is `c8ad3179ce1fcfe516ed77315046439a9e8ecdc9d11d2437759916c844af819c`
and repaired map manifest hash is
`7470d5b881c941aa0cc0e56dea3923d1a8f8ba3d75725d4f445e92bd0107a7fe`.
The app predates the later 6pf6 furniture-clearance and d4zx road-budget changes;
this is evidence for repaired source ground, not a look-check of those changes.
Columbus/Stockton looks and the phone performance gate remain outstanding.

## Potrero seam candidate review — 2026-10-04 11:50 UTC

The newer Potrero desktop and phone images in
`artifacts/district-static/2026-10-04T11-33-02.657Z/views/` were reviewed by eye.
The large diagonal opening across the junction and the near-left kerb strips are
now sealed. Asphalt, crossings, double-yellow lines and the manhole remain
readable. A short horizontal pale-blue strip just left of the avatar's head still
crosses the intersection in both views. Ground appearance therefore remains
**partially repaired, not accepted**; `gtasf-hbyf` owns that remaining diagnosis.

Both views reached READY and connected with nine chunks settled, no collision at
spawn, and empty runtime/console, HTTP and network-error arrays. Player/road Y
remains 31.175m and terrain Y 31.0739m. The app hash remains the same as above;
the candidate manifest is
`f356387321d934508279f4315478e4eeed897e67557f71e09f4500cfbbf10456`.
The two Potrero navigations used a warm cache: each recorded 12,547,328 transfer
bytes and 36,017,393 decoded bytes through READY. They are not cold-load budget
evidence. The raw seam candidate also exceeds the whole-city and total payload
budgets, tracked by `gtasf-hbyf.2`/`gtasf-zzpr`. These images do not establish current
HUD acceptance, device performance or production readiness, and no flag changed.

## Performance gate

Lane d6's native run in
`docs/perf/phone-d6-final-2026-10-04/report.json` uses Chromium 153 with AMD Radeon
Pro 5300M/Metal, 1080x2400 CSS pixels, DPR 2.75, 4x CPU throttle, `preset=low`, two
real seconds of warmup and 120 unfiltered wall-frame samples at each location.
It uses no capture fixed steps. Both scenarios are valid, have no browser or HTTP
errors, and **fail** the required mean >=60 fps and p95 <=25 ms:

| Location | Mean fps | p95 wall-frame interval |
|---|---:|---:|
| Ferry | 9.16 | 195 ms |
| Mission | 7.56 | 294 ms |

The report records `CPU_Speed_Limit = 40` before and after each scenario. This
limits causal comparisons but does not waive the gate. There is no isolated
streetDetail on/off timing comparison here, so these results cannot attribute
the failure to manhole density or tree extras. `gtasf-c8sj` owns the remaining
performance work. The 390x844 look captures are not performance evidence.

## Remaining acceptance

1. Review current normal Columbus and Stockton junction images on desktop
   Medium and phone Low against the local references.
2. Finish the candidate city-map acceptance under `tm7m`. Potrero's representative
   ground and seam views are now visually accepted (see the final repair review
   below); that does not establish city-wide acceptance.
3. Obtain passing, reproducible phone performance evidence without weakening the
   harness. If a measured detail regression remains, reduce Low-only manhole or
   canopy density and repeat the affected check.
4. Only then add `streetDetail` to the reviewed production allowlist. The
   realistic-path foliage fade and material sheen require their own enabled-path
   review and are not accepted by these PS2 images.
## Final Potrero boundary repair review — 2026-10-04 13:03 UTC

DarkMarsh personally reviewed the native desktop and phone originals at
`artifacts/district-static/2026-10-04T12-34-05.573Z/views/potrero-hill-{desktop,phone}.png`.
The short horizontal pale-blue opening left of the avatar's head is now sealed,
along with the previously repaired diagonal junction and near-left kerb. The
crosswalks, double-yellow lines, manhole, stop signs and overhead wires remain
visible across the hillside junction on both views.

The report records 1440×900 desktop and 390×844 at DPR 2.75 phone, both passed,
with empty browser/HTTP/network error arrays and no source drift. It uses the
same frozen app `c8ad3179` and map manifest `862f0346`; both Potrero loads are warm,
so these images do not establish cold-load or payload acceptance. `gtasf-hbyf`
is closed on its representative seam acceptance. The wider `7924` review remains
open for the `tm7m` and `c8sj` gates; there is no flag, deployment or FPS approval.
