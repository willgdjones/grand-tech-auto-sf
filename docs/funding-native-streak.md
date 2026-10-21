# Native sequential funding evidence

`gtasf-mj1.6.1` supplies the missing server streak evidence for R06. The existing
`authority.do.ts` check already proves a real twenty-second award, distinct-device
crowd counting, cancellation, daily uniqueness and persistence. The store smoke
calculates a second quote before inserting it; it does not establish that WorldDO
derives that second-event streak from the persisted first award.

Run only this isolated check:

```sh
nice -n 10 npx vitest run --config worker/src/funding/streak.config.ts --reporter=default --reporter=json --outputFile.json=artifacts/funding-native-streak/report.json
```

The fixture reuses the native authority Worker, actual WorldDO, binary WebSocket
protocol, D1 migrations and funding routes. Its database is disposable and separate
from `npm run dev`. It seeds two unchanged records from the checked-in public
Tech Week snapshot:

- **Rabbits on the Run**, CodeRabbit:
  `tech-week:22eb5208-ca3b-4daf-93e1-65b4689f038b`.
- **Psychological Burnout in the Age of AI**, The Workplace Psychologist PLLC:
  `tech-week:9dcd3aa0-94da-45a3-b0c5-43f9a04fb8cb`.

Both source locations are approximate. The check uses their normal authoritative
road anchors. After the first award, it closes both players' sockets and aborts the
Durable Object, then rejoins the same device at the second event's accepted spawn.
This tests server attendance and recovery; it does not claim a walking route
between the events or real-world venue attendance.

Each award requires at least 20,000 real server milliseconds. No fake timers,
direct award inserts, fabricated event times or production runtime changes are
used. The first event has another distinct connected device: crowd one, ×1.1,
streak one. The second has no other device: crowd zero, streak two, ×1.25. The
check compares the canonical amounts, reads both actual D1 award rows, retries
the second event without extra credit, and restarts again to verify totals,
streak and rank from persistence. It fails on malformed WebSocket messages.

The `FUNDING_NATIVE_STREAK` output records source IDs, real elapsed milliseconds,
amounts, crowd/streak counts and persisted row count. The JSON reporter records
the isolated test result. This evidence supplements the existing real-game
desktop/phone funding smoke; it does not close R05 visual acceptance, R06 as a
whole, or any deployment/device gate.

## Recorded run

Passed **2026-10-03 07:10:09 UTC** (00:10:09 PT). One test, 40.84 seconds of
test execution, 43.08 seconds including native fixture startup.

| Award | Real room duration | Crowd | Streak | Award, integer cents |
|---|---:|---:|---:|---:|
| First event | 20,073 ms | 1 / ×1.1 | 1 / ×1 | 11,000,000 |
| Second event, after restart | 20,015 ms | 0 / ×1 | 2 / ×1.25 | 12,500,000 |

Both events were outside their live/pre-start windows, so the actual time factor
was ×0.5. The persisted total was **23,500,000 cents of fictional funding**,
with exactly two award rows, streak two and rank one. The other device earned
zero. The replay attempt added no row. WebSocket decode errors: zero.

`nice -n 10 npx tsc --noEmit -p worker/tsconfig.json` also passed. Only the new
smoke/config and this evidence document changed; the shared dev server and GPU
were not used.
