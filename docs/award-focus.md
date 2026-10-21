# Funding awards preserve the active panel

`gtasf-qxnz` addresses the native chat observation in `artifacts/chat/game-1029`: completing a 20-second raise opened event details over the player's chat. The event-card callback hid chat and released movement, interrupting the current interaction.

The `main.ts` award callback still updates the funding HUD, round effects and TERM SHEET SIGNED notification. It opens the event card only when no game modal is active. This uses the same `hasModal()` predicate as gameplay input, covering chat, map, event details, event list, sponsor, funding, perks, referrals, Game options and admission state.

The original unobstructed award path is retained. An existing panel keeps its own focus and draft; no server award, balance, event membership or funding timing is changed.

Web TypeScript strict checking and the immutable app build passed. `GTASF_CHAT_AWARD_CHECK=1` in `tools/chat-game-smoke.mjs` passed against the actual game and Worker in `artifacts/chat/game-1128/report.json`. A fresh identity earned the real 20-second event award: its balance rose from `0` to `50000000` cents and the displayed counter settled at `$00500000`. Chat stayed open, its unsent draft and keyboard focus were retained, and event details remained closed. The reviewed `desktop-award-chat.png` also shows the TERM SHEET SIGNED feedback and updated round/star behind the active chat.

The same run passed real desktop/390px peer chat, canonical nicknames, nearby and event messages, local filtering, physical departure/server acknowledgement and room exclusion. Page, console and HTTP errors were empty. It used immutable frontend `37cb3e5b88158c6305a4e3d97f07bae43a77c0fe`, Worker source `1d0a63b`, SF manifest `dc90ea7c…` and graph `5763c53d…`. This completes the local focus repair; production, performance and real-device acceptance remain separate.
