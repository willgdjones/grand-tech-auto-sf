# Funding round perks acceptance

Passed on **2026-10-03 at 07:23 UTC**. The final report records `passed: true`,
`errors: []`, and `httpErrors: []`. All five final desktop/phone images were
reviewed. The run reused `artifacts/funding-identity/app`, frozen at 07:18:38 UTC
with the latest integrated scenery, Ferry contact and nickname corrections.

## Scope

The actual local and deployed funding runs earned $500k from a real twenty-second
event visit. They enabled only the VC coupe; HQ and party controls remained locked.
See [the integrated game evidence](../web/src/funding/INTEGRATION-EVIDENCE.md) and
[the deployment record](../DEPLOY.md). This establishes the earned unlock without
injecting balances or server time.

`tools/funding-perks-smoke.mjs` separately inspects all three appearances. Its
desktop browser saves a real zero-balance identity, then intercepts profile and
leaderboard responses to display Series A and intercepts party snapshots. It
never inserts fabricated funding into D1. The fixture is visual evidence for the
later rounds; it is not evidence that those funds were earned or that its party
response came from WorldDO.

## Checks

| Feature | Evidence |
| --- | --- |
| Perks panel | Opening the native dialog holds movement; Escape closes it. |
| VC coupe | Normal keyboard walking and E enter a real server-owned parked car; its local model becomes the coupe while retaining the existing seat and camera. |
| Startup HQ | Normal walking reaches the city facade. The action raycasts a real loaded building face and mounts the legible Fog Computing sign on it. |
| Founder party | A snapshot renders the startup label and a ground-following purple ring. The outgoing request contains only `hosting`. |
| New phone profile | Real identity API, no interception. At 390 × 844 all three perks remain disabled and the complete dialog fits in the viewport. |

The party authority has a separate scoped smoke in
`worker/src/funding/parties.test.ts`: Series A and an on-foot connected peer are
required, the server supplies the position, other players can see the snapshot,
expiry and disconnect remove the marker, and funding is unchanged. The actual
local route also returned 200 for reading, 400 for supplied coordinates and 400
for an unearned hosting attempt. Appearance never changes handling, collisions,
paid ad ownership, Outbid or earned funding.

## Reproduction and artifacts

With the local Worker available and the shared browser slot coordinated:

```sh
GTASF_PERKS_APP=artifacts/funding-identity/app nice -n 10 node tools/funding-perks-smoke.mjs
```

The optional app path reuses a frozen bundle. Without it the script creates one.
The browser and short-lived preview close in `finally`, including on failure.
`artifacts/funding-perks/report.json` records every check and all console/page and
HTTP errors. Screenshots are `perks-desktop.png`, `vc-coupe.png`, `startup-hq.png`,
`party-marker.png`, and `perks-mobile.png` in the same ignored artifact directory.
This is not a performance or real-device claim.

## Defects distinguished from acceptance

The first HQ attempt was outside the 90-metre wall range. The direct walk toward
the wall then exposed a real Ferry plaza edge discontinuity: a 0.668-metre drop
that the movement controller correctly rejected as a cliff. `gtasf-8yj` repaired
the visible apron and matching surface in `645a6c4`, with bidirectional movement
and desktop/phone evidence. This check takes the nearby southwest
exit, whose source terrain meets the plaza within 0.014 metres; its route was also
verified with the actual movement, terrain, road and collision functions.

A later run reached every cosmetic checkpoint but recorded one HTTP 409. Its
fixture had supplied names only to the browser, while walking could automatically
start a real event against an unnamed server profile. The corrected fixture saves
the real identity first and records failing HTTP paths and response bodies; its
complete rerun passed without ignoring errors. The failed report and images are
preserved in `artifacts/funding-perks/attempt-2026-10-03T0713/`.

The complete funding acceptance also includes
[native crowd and sequential streak persistence](funding-native-streak.md),
which uses two real twenty-second WorldDO awards and a restart between them.

## Recovery after a stalled connection — gtasf-0fms

Round-perks requests now have an eight-second deadline covering both headers
and response body. Disconnecting or disposing the view cancels pending work;
reconnecting starts one fresh read. The last valid party markers remain until a
new confirmed snapshot arrives, and late responses from cancelled requests are
ignored. An unconfirmed hosting POST is never replayed. A subsequent read tells
the player whether their party is active before they choose another action.

`tools/funding-perks-recovery-smoke.mjs` runs the actual perks module with isolated
stalled transport. It passed header/body stalls, serialized polling, retained
markers, late-response rejection, disconnect/reconnect, one unconfirmed POST
followed only by GET, and immediate disposal. Strict web TypeScript passed.
`artifacts/funding-perks-recovery/report.json` and the reviewed phone screenshot
record the check. The fixture changes only its own browser clock and transport;
it does not write game funding or establish that the separate local Wrangler
proxy failure has been fixed.
