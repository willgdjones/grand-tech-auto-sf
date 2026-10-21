# City chat

`chat` enables moderated proximity text and overhead bubbles; `eventChat` adds
event rooms. Open Chat from the game controls or press Enter. Nearby messages
reach players within 40 metres of the server's accepted pose. Bubbles last seven
seconds; the panel retains at most 80 received messages for this browser session.

The event channel unlocks only after the server confirms membership. Players must
be on foot within the same source-lane anchor and room bounds used by funding.
Moving away, entering a vehicle or disconnecting leaves the room. A client cannot
select a remote event ID and listen. Canonical event IDs map to nonzero uint32
keys; ambiguous hash collisions are rejected. Chat does not award funding.

## Moderation and limits

No TypeSafe key is required. The server normalizes Unicode, rejects empty or
overlong messages (160 graphemes, 320 UTF-8 bytes), and runs a token-boundary
wordlist with confusable, leetspeak and separated-letter matching. A small threat
phrase list also runs locally. This is a limited word filter, not semantic
moderation. User text and names are rendered with textContent, never HTML.

When `TYPESAFE_API_KEY` is configured, locally accepted text must also pass Jev
(`jev-1.13.0`, probability at least 0.95). Requests have a four-second timeout,
no retries, and failures drop the message. Missing keys cause zero provider
requests. Toxic messages are silently dropped, as specified in PLAN.md. A sent
indicator confirms transport, not moderation approval.

### Founder provisioning (production Jev)

To turn on semantic moderation in production, set the key as a Wrangler secret:

```sh
wrangler secret put TYPESAFE_API_KEY --config worker/wrangler.production.jsonc
```

Or put it in the git-ignored `worker/.dev.vars` and run `node tools/deploy/production/secrets.mjs`,
which uploads it (and other optional secrets) without printing any value. The key is optional:
with it unset, chat keeps running on the local word filter alone and makes zero provider requests.
No value is ever written to code, beads, logs or commits. Live provider approval is only proven by
an actual production run with the key set — it is never inferred from fixtures.

The server allows a burst of three actions and replenishes one every two seconds.
The accepted device identity shares that budget across tabs; otherwise the server
player identity owns it. Rates, ten-minute client-message deduplication and event
membership persist in WorldDO SQLite across hibernation. Message text is never
stored there. Async moderation and room lookups recheck the socket generation and
current accepted location. All database/provider work stays out of the frame loop.

## Provenance

The Unicode display normalizer, confusable tables and wordlist matcher were copied
and adapted from `~/Documents/million-dollar-times-square/shared/chat/` and
`worker/src/world/chat/blocklist.ts`. Unicode 16.0 generated data retains its
licence at `shared/chat/UNICODE-LICENSE.txt`. The source blocklist is reviewed local
policy; GTASF adds token-boundary English profanity rules. WorldChat delivery,
event authority and the DOM panel/bubbles are original GTASF code. No BDTS
credentials, deployment resources, NYC data or message history were copied.

`worker/src/world/chat/blocklist.txt` is the editable source. Regenerate its ESM
literal after changes with:

```sh
python3 - <<'PY'
from pathlib import Path
import json
p = Path('worker/src/world/chat')
(p / 'blocklist.generated.ts').write_text(
    '// Generated from blocklist.txt; do not edit by hand.\nexport const BLOCKLIST_SOURCE = '
    + json.dumps((p / 'blocklist.txt').read_text(), ensure_ascii=False) + ';\n')
PY
```

## Evidence

`nice -n 10 node tools/chat-smoke.mjs` runs one disposable native workerd/D1/SQLite
scenario. It checks benign Unicode and word boundaries, obfuscation, no-key and
optional-provider behavior, nearby/far recipients, authoritative room joins and
leaves, restart persistence, replay/rate limits and stale socket fencing. Provider
responses in that scenario are explicit fixtures. Its report is
`artifacts/chat/server-report.json`; it does not establish live Jev or a device gate.

The clean actual two-client run at `artifacts/chat/game-1128/report.json` used
immutable client `37cb3e5`, native Worker `1d0a63b` and the sourced SF map. Desktop
and 390-pixel phone clients physically entered the canonical Investor Happy Hour
room on Steuart Street. Both nearby directions, saved nicknames, local wordlist
rejection, event messages, modal input suppression and Close/Escape passed. The
phone walked 17 metres from the anchor; the server confirmed departure, and it
received no subsequent room message. Console and HTTP errors were empty.

With `GTASF_CHAT_AWARD_CHECK=1`, that run also waited for the real 20-second room
award: canonical funding rose from zero to 50,000,000 cents and the settled HUD
showed $00500000. The unsent draft, focused composer and open chat survived the
award, with the event card closed. The reviewed desktop and phone composers fit
their viewports. The phone bubble in that run intersected the funding notice and
radar; the placement repair and final review below resolve that defect.

The failed `game-1100` report preserves the earlier `Invalid funding cents` error;
the repaired counter and clean `game-1128` rerun supersede it. The `game-1029`
departure failure did not establish a server leak: an award card held movement,
and a transient room refresh was mistaken for departure. The current check records
actual positions, server membership acknowledgements and message recipients.
Production activation remains a separate reviewed deployment process.

`node tools/chat-bubble-smoke.mjs` is a separate small DOM/projection fixture.
It reproduced a phone-edge bubble shrinking to 37 pixels wide and over 1,400
pixels tall. Bubbles now retain a readable width and stay eight pixels inside
the viewport, using ResizeObserver measurements instead of a layout read every
frame. The passing desktop/390-pixel edge images in `artifacts/chat/bubbles/`
were reviewed; the original failed report is in `artifacts/chat/bubbles-before/`.
This verifies edge layout only; it does not replace two-client game acceptance.

The HUD regression in `artifacts/chat/bubbles-hud-before/report.json` reproduces
phone bubbles intersecting the footer, room progress, radar and touch buttons.
The repair caches visible HUD rectangles after resize/visibility/layout changes;
projection checks those cached rectangles and raises intersecting bubbles with
an eight-pixel gap. It does not read DOM geometry during each camera frame.
Observers and pending layout work are removed on disposal. Ten explicit DOM cases
at desktop and phone widths pass in `artifacts/chat/bubbles-hud-after/`, including
a growing room notice and returning to normal projection when the HUD hides.
Those fixture screenshots are reviewed. The final actual two-client check in
`artifacts/chat/game-1207/report.json` passes on immutable client `fbecd8c` and
native Worker `c8a7bdc`, with the same SF map. Both nearby directions, local filter,
authoritative event chat and the real 17-metre departure/leave exclusion pass;
console and HTTP errors are empty. The phone bubble spans y=448.8–498, with the
radar starting at y=506 and funding progress at y=511.6. Its recorded overlap list
is empty. The phone bubble and both desktop/phone composers are readable in the
reviewed screenshots. This completes gtasf-8kbq.1 local acceptance together with
the server fixture and prior real-time award proof. Production, live Jev and
physical-device acceptance remain separate.

## Keyboard focus and modal lifecycle

Both main Enter and numeric keypad Enter open chat from gameplay. In the
composer, Enter sends and Shift+Enter inserts a newline; a disconnected send
keeps the draft. Native controls retain their own activation keys.

Closing chat synchronously releases its input/cursor ownership. A browser close
event queued by an earlier opening cannot release a reopened chat or pull focus
away from the event-map search. Native dialog closure restores focus immediately;
chat does not repeat that restoration when the delayed event arrives. Repeated
hide/disposal calls publish only one close transition. The existing chat flag
and message/event-room behavior are unchanged.

Run `nice -n 10 node tools/chat-lifecycle-smoke.mjs` for the bounded actual-module
DOM check; set `GTASF_CHAT_LIFECYCLE_STAGE=before` only against the original
implementation to reproduce the regression. `GTASF_CHAT_LIFECYCLE_OUT` selects
a fresh evidence folder. The browser disables GPU/WebGL, uses fixture roads,
and makes no game-server/provider requests.

The 2026-10-03 baseline in
`artifacts/chat-lifecycle/2026-10-03T1146-before/report.json` reproduces all three
failures at desktop and 390-pixel phone sizes: event-map focus theft, queued
hide/reopen releasing the new chat hold, and native close/reopen doing the same.
The prepared patch passes six behavior groups per viewport in
`artifacts/chat-lifecycle/2026-10-03T1147-offtree/report.json`, with no browser
errors. It also covers keypad sending, multiline drafts, disconnected drafts,
Escape focus, duplicate hides, native closure and disposal. This is DOM/input
evidence, separate from the native two-client and device-performance gates.

`gtasf-7lpk` applies the exact module exercised by that passing fixture. Strict
web types pass on the shared checkout; the affected-test query reports no
existing related unit tests. The browser check above supplies the behavioral
regression coverage. This repair follows the immutable `d780be9` release pin.
