# Lombard multiplayer and robotaxi integration

D04 (`gtasf-85g`) uses the playable client and actual WorldDO through two independent browser contexts. The check starts at `/go/lombard`, saves each identity through the normal onboarding dialog, moves both players with physical keyboard input, and verifies received player snapshots against rendered avatars in the other browser.

The rider presses H for the default Lombard downhill destination. The check waits for automatic boarding, holds W/A/Space as a passenger, and closes only the observer's native socket during the trip. It records the server's hail, seat, destination, reconnect and arrival messages, the rendered taxi/road height, switchback reversals, camera coordinates, and MISSION PASSED arrival text. Authentication fields are excluded from the report. It does not inject game state, packets, poses or a simulation clock.

A source review found that the remote interpolation caller supplied an unchanged origin pose instead of the current player's position. Commit `69c66f1` updates that argument in centimetres each frame, so nearby players at Ferry or Lombard use the intended 120 ms interpolation tier instead of the far tier's 650 ms.

## Recorded acceptance — 2026-10-03 07:28 UTC

Harness commit `ab3fa87` passed against the real local Worker and the reviewed frontend frozen at 07:18:38 in `artifacts/funding-identity/app`. That snapshot includes `69c66f1` (nearby interpolation), `214c7d4` and `9d66750` (identity repair), the Ferry apron, shopfronts, and the road/grounding changes subsequently committed as `3759195` and `edadee3`. No new bundle or simulated clock was used for this run.

| Check | Recorded result |
| --- | --- |
| Two independent players | Both physical keyboard movements appeared in received snapshots and rendered avatars in the other browser. |
| Native hail and boarding | H sent request 1 to the selected Lombard downhill destination; vehicle 1000 boarded player 65 as a passenger. |
| Real downhill route | 89,632 ms; 32.837 m descent; eight switchback reversals across 251 passenger samples. |
| Rendered road contact | Maximum vertical difference 0.2222 m; maximum horizontal centreline offset 0.0108 m. Passenger position followed the taxi throughout. |
| Passenger controls | Holding W/A/Space sent zero `VEHICLE_MOVE` messages. |
| Observer reconnect | The actual socket reconnected as player 66 with `WELCOME.resumed = true`; the rider continued uninterrupted. |
| Destination and arrival | Final server pose exactly matched destination `(-89714, 5312, -199998)` in centimetres with request 1 and ETA zero. Rider returned on foot with vehicle ID zero; MISSION PASSED was visible. |
| Runtime errors | Zero browser console, page, HTTP or map errors. Camera coordinates remained finite. |

Evidence: `artifacts/lombard-ride/2026-10-03T0725/report.json` and the reviewed `two-players.png`, `riding.png`, and `arrived.png` beside it. Both browser contexts and the preview closed after exit 0; the shared development Worker remained running. Vite printed an EPIPE on proxy teardown after the completed run, with no browser error or failed assertion.

The earlier `2026-10-03T0720` attempt is preserved as a failed harness attempt: its 60-second limit expired while the server still reported 30 seconds remaining. The corrected harness uses the actual riding ETA plus 35 seconds. Only the completed second attempt establishes arrival acceptance.

## Reproduce

Use the already-running `npm run dev` stack:

```sh
node --import tsx tools/lombard-ride-smoke.mjs
```

To reuse a reviewed frozen frontend while other panes edit sources, set `GTASF_LOMBARD_APP` to its built app directory. The script opens a short-lived Vite preview, proxies `/api` to the existing Worker on port 8787, and closes its browser and preview on completion. It never starts or stops that shared Worker. Set `GTASF_LOMBARD_OUT` to keep separate attempts. `GTASF_SMOKE_URL` can target another origin; `GTASF_INVITE_FILE` authenticates an invite-only origin without exposing its code in URLs or reports.

Coordinate the browser/GPU slot and a brief Worker runtime hold before running. The source map must already exist at `tools/map/out/lombard`. This integration check does not establish the separate staging-resource, staging-map, performance or real-device gates.

C05 (`gtasf-lcj`) additionally requires arrival at a real event marker, its card and visit hook on staging. Those remain separate from this downhill endpoint check; E05 and the explicit G1 staging prerequisites remain open.
