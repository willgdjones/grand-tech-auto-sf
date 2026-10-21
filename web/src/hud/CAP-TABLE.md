# Click-a-player cap table — integration contract

The read-only panel in `capTable.ts` lists a player's public funding sources
(PLAN-v2 decision 5, `gtasf-2r5r`). `createCapTable` returns `null` when
`flags.capTable` is off. The overhead click entry point also requires
`flags.nameplates`.

```ts
const capTable = createCapTable({
  parent: gameOptions.content, // optional "My cap table" launcher
  onModalChange: open => setInputPaused(open),
});

capTable?.open(); // authenticated player's table
capTable?.open({ deviceId: leader.deviceId, startup: leader.startupName, nick: leader.nickname });
capTable?.open({ nick: peerNickname }); // works outside the top-50 leaderboard
```

The return value exposes `element`, `button`, `isOpen`, `open`, `close` and
`destroy`. The default endpoint is `/api/funding/captable`; `endpoint` can override
it. A known device ID uses `?device=`, otherwise a nonempty nickname uses `?nick=`.
Values are URL-encoded. Explicit `self: true` overrides both selectors.

`main.ts` resolves an overhead click through the current peer nickname. A matching
leader supplies its known ID; other peers use the nickname endpoint immediately,
including before the nameplate summary cache loads. Self clicks retain the own
table behavior. The server's existing nickname lookup chooses the best-funded
holder of a duplicate nickname, matching the funding-summary lookup. This is the
existing identity contract; no new session-to-device mapping is introduced.

The WorldDO route is implemented in `worker/src/funding/world.ts`, with the model
in `shared/captable.ts`. It returns `{ deviceId, startupName, nickname, round,
totalCents, groups, serverNow }`. The panel renders those authoritative public
fields only, with source groups, subtotals, capped entries and a `+N more` label.
It does not fabricate awards or expose email/payment fields. Integer-cent totals
use `formatCapTableTotal`.

Opening shows a loading state and the Close button receives focus. A missing
founder or an empty table has a distinct empty message; HTTP and network failures
have error messages. Close and Escape abort the request and release the modal
state. Switching targets aborts the previous request, and late JSON cannot replace
the new player's table or mutate a closed/destroyed panel.

`capTable.test.ts` exercises the real panel with a minimal DOM and mocked public
responses: grouped rows, known-ID/nickname/self requests, encoded selectors,
delayed bodies across target changes and close, empty/error states, modal
callbacks, the self launcher and the disabled flag. These are component checks.
Native multiplayer/touch acceptance remains tracked by `gtasf-2r5r` and
`gtasf-v2-funding-browser-accept-b4wh`.

Receipt (`gtasf-2r5r.1`, October 4): all 18 cap-table/nameplate checks passed at
12:00:51 UTC, followed by a clean strict web TypeScript check. Both ran through
`tools/heavy.sh`, with one Vitest worker. The tested source hashes were unchanged
at final review. This records the nickname integration and response-lifecycle
fix; it does not close the parent native multiplayer/touch acceptance.
