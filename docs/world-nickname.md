# Canonical startup nicknames in the city — gtasf-812m

The initial World connection can precede first-run onboarding. Previously,
saving the funding profile changed D1 but left the connected World session
named `Founder`. A resumed session also kept that original name. Separately,
WorldFunding could return an earlier profile for five seconds after a successful
save. The native chat review in `artifacts/chat/game-1029/` exposed the first
problem; the isolated actual Worker reproduction observed all three values:
`saved: Sky founder`, `status: ""`, `chat: Founder`.

Profile POST now goes through the existing WorldFunding request boundary. It
validates the same device cookie and canonical names, saves them, refreshes the
profile cache and updates every live session bound to that verified device
before returning success. Older in-flight profile/award reads preserve a newer
saved identity while retaining their independently calculated funding totals.

Session rename writes only the name, fenced by ID and generation. It leaves
accepted movement, vehicle occupancy, event-room membership and funding work
intact. Other peers receive the existing PLAYER_JOIN record with the current
name. Pending handshakes receive the new name too. Initial and resumed
connections load the saved profile, so a stale HELLO label cannot undo a saved
nickname, including after an offline edit and Worker restart. Legacy anonymous
sessions without a verified saved profile retain their original behavior.

No client or binary protocol changes are required. Existing fundingLoop,
multiplayer and chat switches still govern the relevant entry points. A lost
World connection produces the existing safe 503 response; profile mutations
are not retried automatically.

The dedicated actual workerd/D1 HTTP/WebSocket test first failed on the old
cached status and recorded the old chat name. The corrected test passed in
614ms (5.27s including pool startup), verifying canonical live chat, immediate
status, both same-device peers, unrelated-device isolation, pending HELLO,
unchanged ID/generation/pose/sequence/room, invalid and foreign rejection,
repeated edits, and offline-save/restart/resume. Both forwarding tests pass.
The isolated strict check initially found a fixture-only type narrowing error
and missing copied test imports; those were corrected and strict Worker types
passed. Test sockets and disposable Worker pools were closed.

Reproduce with Node 24:

```
npx vitest run --config worker/src/funding/identity.config.ts
npx vitest run worker/src/funding/routes.test.ts --maxWorkers=1 --no-file-parallelism
npx tsc --noEmit -p worker/tsconfig.json
```

The checked patch was applied at the explicit backend handoff after the active
native checks stopped. Shared Worker strict types passed; local Worker health
on 8787 and the Vite application on 5173 both returned HTTP 200. The actual
two-client game check in `artifacts/chat/game-1100/report.json` then verified
`Chat Desktop` and `Chat Phone` in nearby and event-room CHAT_BROADCAST records,
with player IDs 101/102 and room 2794794989. It also verified physical departure,
the server leave acknowledgement and exclusion of the departed recipient.
Neither peer received a movement correction or an HTTP error.

The overall chat run remains failed because it recorded a separate
`Invalid funding cents` page/console error after a funding award. That error is
being investigated separately; the nickname proof does not waive it or close
the whole-chat acceptance task.
This isolated regression does not establish production, device or whole-game
rendering acceptance.

The follow-up actual game run `artifacts/chat/game-1128/report.json` passed on
the immutable 1125 client (37cb3e5) and Worker 1d0a63b. Both canonical names were
present for player IDs 116/117, nearby and event chat worked, and the physical
departure was acknowledged and excluded from subsequent room messages. A real
twenty-second award reached 50,000,000 cents and the visible `$00500000` counter
while preserving the open chat draft and focus. Page and HTTP errors were empty.
