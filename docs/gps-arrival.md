# Landmark GPS arrival

`gtasf-cwb` fixes the guidance left on screen after reaching an ordinary landmark.
The real Lombard ride finished with `MISSION PASSED`, but
`artifacts/lombard-ride/2026-10-03T0725/arrived.png` still showed its destination
beam and a zero-metre GPS status. Arrival detection had required an event record.

All accepted destinations now complete under the existing loaded-ground,
eight-metre horizontal distance, four-metre height and `canArrive` conditions.
Completion hides the beam, route ribbon and GPS status. Only an event destination
invokes the event callback. Selecting another destination resets completion.
Travel-mode behavior, routing, server arrival messages and funding are unchanged.

The focused check uses the real guidance module in a browser DOM with GPU
disabled; it does not start a Worker or render another city scene:

```sh
nice -n 10 node tools/gps-arrival-smoke.mjs
```

On 2026-10-03, the baseline failed at landmark arrival with the stale status and
marker, matching the real-game image. After the fix, all nine states passed with
zero browser errors: approach, modal hold, unloaded ground, another elevation,
landmark arrival, moving away afterward, a new selection, event arrival, and a
later route update. Event arrival fired once, while landmark arrival fired no
event callback. Teardown removed both scene and DOM resources. The existing two
guidance tests and strict web TypeScript also passed.

Reports are `artifacts/gps-arrival-before/report.json` and
`artifacts/gps-arrival/report.json`. `GTASF_GPS_ARRIVAL_OUT` selects another output
directory. This is a guidance behavior regression check; the separate D04 ride
evidence remains unchanged, and staging, C05 and device gates remain separate.
