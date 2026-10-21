# Delayed city connection

`gtasf-osbg` fixes a permanent startup failure after a temporary server outage.
The walking smoke at `artifacts/walking-look/2026-10-04T07-28-25.030Z/`
recorded admission HTTP 502 responses followed by the old 12-second boot error.
The admission and World clients kept retrying, but a later welcome could not
resume the rejected boot function.

`waitForCityConnection(ready, loadingDetail)` waits for the same World readiness
promise. After 12 seconds it explains the delay and adds a **Reload city**
button. Reload preserves the current URL, including a shared destination.
A later welcome lets the existing boot continue and removes the temporary
control. Early success adds no control. A rejected readiness promise still
propagates to the existing startup error handler. The helper does not change
admission, open a second socket, retry boot, or report an offline city as ready.
The existing bootstrap and multiplayer entry points govern it.

The focused smoke uses the actual `connectWorld` client and binary welcome
codec with a controlled transport, clock and small DOM fixture. It times out
the first handshake, exercises reconnect, delivers a welcome after 15 seconds,
and checks completion, visible status, reload activation and cleanup. It also
checks early success and real promise rejection. This is source-level recovery
evidence, not native-browser, backend stability, performance or device acceptance.

On 2026-10-04 the recovery smoke plus existing WebSocket checks passed (six
checks), followed by strict web TypeScript, serialized through `tools/heavy.sh`.
`main.ts` now calls the helper at its existing multiplayer readiness wait. The
integration was applied after the active walking capture exited; no flag or
startup asset sequencing changed. The final integrated strict web TypeScript
check also passed. Shared-backend reload failures remain a separate concern.
