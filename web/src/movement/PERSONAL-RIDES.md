# Personal rides

`flags.personalRides` gates the local and remote ride systems, controls and the
server movement cap. `characterLooks` is independently disabled: the existing
appearance message carries the funding-stage metadata needed by rides when
either feature is enabled. The wire layout and pose bit (`0x02`) are unchanged.

The server grants a mounted speed cap only when MOVE carries that ride bit.
Its tier comes from the authenticated connection's funding profile, never from
the client-supplied appearance id. Walking retains the 11 m/s validation cap at
every stage. Funding awards refresh the cached tier immediately; after
hibernation or an external balance change, MOVE schedules one bounded profile
refresh per five seconds. An unknown profile gets the starting scooter cap.

Use **G**, gamepad **R3**, or **Game options → Getting around → Ride** on a phone.
The same action stows the ride. Driving or becoming a passenger stows it too.
Game options lists the stage required by all five rides, using the shared
cosmetics tier contract. The fastest unlocked ride is selected automatically.

The shipped meshes are scooter, skateboard, e-bike, Onewheel and Segway parody.
They use local procedural geometry and materials with no extra network asset.
Wheel rotation follows distance travelled. Funding-stage changes switch the
mounted mesh and speed together without moving or dismounting the player; remote
players use the same synchronization path.

Mounted avatars use dedicated poses derived from the shipped Quaternius rig:
sideways balance on the skateboard/Onewheel, a seated forward lean on the e-bike,
and hands reaching the scooter/Segway bars. Feet are placed above the decks and
hold their stance while wheels turn; dismounting resumes the normal walk/run
clips. Pose solving happens once at template load. Each avatar binds extra
animation tracks only when it first uses them, so idle crowd instances do not
prepare the ride clips. Local and remote players select the same stage pose.
Normal keyboard/touch and remote visibility checks pass. Desktop and phone
initial/side-view screenshots of all five tiers were reviewed on 2026-10-04;
`personalRides` is enabled locally. The distinct ride silhouettes and mounted
stances are present in-game. This does not establish a deployment, whole-scene
visual, real-device or performance gate.

## Verification

- `tools/heavy.sh sh -c 'npx vitest run web/src/movement/rideSystem.test.ts --maxWorkers=1 && npx tsc --noEmit -p web/tsconfig.json'`
  passed 2026-10-04: five checks, including local/remote mounted upgrades and down
  rounds, one visible model, preserved pose, dismount and cleanup.
- Network metadata: six WebSocket checks and Worker strict passed. Final web
  strict passed after the phone control and required-stage list changes.
- Authoritative tier lookup: four funding checks and Worker strict passed at
  10:21 UTC, including immediate server-award upgrades, coalesced hibernation
  reload and an external balance reduction. Native replay uses this Worker.
- Mounted poses: three actual-GLB avatar checks and web strict passed at
  10:08 UTC. All five rides keep soles above the road at deck height, reach both
  handlebars where present, hold their leg stance and leave other avatars
  independent. Dismount restores normal orientation. These are geometry/rig
  checks; the seventh native run below supplies desktop/phone screenshot review.
- The first native attempt (08:28 UTC) reached READY and connected two players
  with zero browser/HTTP errors, then correctly blocked G while the new-profile
  What’s new dialog was open. Its retained report/screenshots are in
  `artifacts/personal-rides-look/2026-10-04T08-28-01.628Z`. The check now clicks
  the real Let’s go control before native input. This is not ride acceptance.
- Normal desktop/phone native keyboard/touch/multiplayer checks passed at
  10:33 UTC (`artifacts/personal-rides-look/2026-10-04T10-23-29.204Z`). Every
  tier mounted and dismounted through G and the actual phone control, travelled
  at its ride speed with zero corrections, appeared on the other tab and hid
  on dismount. Browser console/HTTP errors: zero. The phone unlock list was
  readable with all required stages. Distances (keyboard / touch): scooter
  20.30 / 9.56 m; skateboard 18.00 / 21.50 m; e-bike 20.80 / 20.80 m;
  Onewheel 11.90 / 20.40 m; Segway 13.31 / 22.10 m. The later side-view run below completes the ride appearance review.
- The second native run (`2026-10-04T09-03-50.873Z`) connected both players and
  dismissed the dialog, with zero browser/HTTP errors, but G did not mount the
  scooter. The next diagnostic clicks the actual canvas, waits for normal
  frames after dialog close, and records focus/input state before and after G.
  This failure is retained; the fifth and seventh runs subsequently pass the actual controls.
- The third native run (`2026-10-04T09-33-08.173Z`) verified G after canvas focus.
  Scooter keyboard and touch each travelled 6.30 m with zero server corrections,
  with remote mount/dismount visibility. Skateboard keyboard travelled 3.75 m
  with zero corrections, but phone movement received one real correction and
  failed acceptance. Its screenshots also exposed a capture problem: the nearby
  parked car obscured the rider. The check now captures mounted models before
  travel and retains both outgoing MOVE poses and correction poses on failure.
  It uses native camera input to keep the observer active between stages.
- Source inspection found a reproducible ride-speed jitter problem: a fixed
  75 cm credit ceiling rejects two legitimate 10 Hz ride packets that arrive
  together. The candidate keeps one send interval of elapsed-time credit at
  ride caps, while preserving the 75 cm walking allowance and rejection of
  sustained bursts/teleports. All six movement checks and Worker strict passed
  at 09:50 UTC. The fifth native run above passes with the fix; it does not prove
  the exact cause of the third run's correction, whose report lacked MOVE traces.
- The fourth native run (`2026-10-04T10-10-21.441Z`) built the new avatar poses
  and reached connected READY, then failed while walking the observer clear
  of the arrival point. No ride acceptance was recorded. The retained image
  shows the observer beside the parked car; held lateral input produced no
  further travel. The retry uses forward input and retains the observer pose.

The reproducible native check is `tools/heavy.sh node tools/personal-rides-look.mjs`
using Node from `.nvmrc`. It builds the current shared source into an ignored
artifact directory, starts a disposable real Worker/SQLite pool, then drives
isolated Chrome contexts through native keyboard and touch input. It reads the
mounted world and WebSocket correction frames without setting game state or
using fixed steps. Higher-tier funding accounts are explicitly seeded only in
that disposable database to inspect the actual shipped models. This is not
funding-progression, real-device or performance evidence. Screenshots require
visual review in addition to the automated results.

## Activation receipt — 2026-10-04 10:58 UTC

The seventh run, `artifacts/personal-rides-look/2026-10-04T10-46-43.377Z`,
passed all five tiers on desktop and 390 × 844 phone layout. Every tier mounted,
moved and dismounted with real keyboard/touch input; the second tab displayed
the matching ride and removed it on dismount. All ten movement cases recorded
zero server corrections. Console errors and HTTP errors: zero. Required stages
were readable in the phone Game options list.

| Ride | Keyboard distance | Touch distance |
| --- | ---: | ---: |
| Scooter | 21.00 m | 13.53 m |
| Skateboard | 18.00 m | 16.50 m |
| E-bike | 24.00 m | 16.53 m |
| Onewheel | 12.75 m | 21.25 m |
| Segway parody | 8.50 m | 26.07 m |

Reviewed all `*-desktop.png` and `*-phone.png` side views, initial mounted
views, and the unlock list, together with remote-player captures. Feet stay
on the decks/pedals, the bike has its seated forward lean and wheel pair,
and board riders hold their balance stance. The local and remote renderers
use the same meshes and pose selector. Existing HUD prompts obscure parts of
some frames; the paired initial and side views expose the ride variants.

This uses the frozen 10:10 app containing `f8af09b` poses and a fresh Worker
with `d4d4f70` authenticated stage caps. The sixth attempt (`10:35:55.048Z`)
failed only its screenshot setup: an interactive nameplate covered the canvas
centre. The seventh uses exposed canvas points and native camera keys held
through capture. No game state or clock is set through browser evaluation.

The frozen app predates `98cab25`, so several images retain the old raw
funding AbortError notice. That transport notice is fixed separately and is
not presented as a new runtime error or as verified in these frozen images.
Higher stages were seeded for appearance/control review, not earned through
this harness. Gamepad mapping has source checks, not a physical-pad receipt.
