# Chat reader position — gtasf-bqa5

Incoming messages preserve the first visible message and its position when the
reader has scrolled away from the bottom. The anchor survives the existing
40-message display limit and 80-message retained-history limit. If that message
expires, the view starts at the oldest remaining message. Its original offset
is retained until the reader scrolls, avoiding cumulative integer-scroll rounding.

Opening chat, changing channel, losing the joined event room, and reading at the
bottom continue to follow the latest message. Existing `chat`/`eventChat` flags,
input masking, drafts, transport and moderation behavior remain in place.

The actual Chat/Input/CSS baseline at October 3, 2026 14:24:38 UTC used locally
supplied wire messages, physical wheel scrolling and GPU-disabled Chromium.
One incoming message jumped the desktop reader from 1239 to 1739 px and the
phone reader from 2019 to 2519 px. All four baseline images were reviewed:
`artifacts/chat-reader-prep/baseline/`. Chromium already keyboard-focuses the
scrollable log; the initial keyboard-inaccessibility hypothesis was disproved.
No tabindex or styling change was made.

`nice -n 10 node tools/chat-reader-smoke.mjs` passed at 14:36:50 UTC, with six
behavior groups each at 1100×720 and 390×844. Wheel and PageUp reading retain
the visible message within one CSS pixel through same/other-channel arrivals;
End follows new messages. Both history bounds, expired anchors, channel changes,
room loss, reopening, drafts, input masking and disposal pass. Channel choice
uses Playwright's DOM select operation; scrolling and close/reopen use physical
keyboard/wheel actions. No real chat is sent, and browser/page/HTTP errors are
empty. All four final PNGs were reviewed in `artifacts/chat-reader/`.

An initial candidate accumulated 1.21875 px drift across three rapid updates;
`rounding-failure.json` retains that result. The final product retains the anchor
offset across updates. Fixture failures also record a native-select key mismatch
and an omitted main Escape callback; the final fixture uses the real close-action
contract. Web strict types and the scoped fixture bundle pass. The full shared
web bundle also passed for common1442, built at 14:42:29 UTC from exact commit
`2395aa28ec0515a3ea18d812508805844cabc2df`, which includes source `c45ac22`.
Its receipt is `artifacts/founder-path/2026-10-03T1442/source.json`.
These are DOM and bundle checks, not native world, real-device, performance or
deployment acceptance.
