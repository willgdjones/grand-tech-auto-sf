# Funding depth — gtasf-dgx9

The existing funding and event-view flags gate this UI. Funding board separates
weekly and daily totals, rank and next-round progress. Today's standings reset
at midnight in America/Los_Angeles; weekly earned funding and round unlocks
persist. The board suppresses yesterday's rows while obtaining the new day.

Promotion toasts lead with the actual round CLOSED and parody headline, followed
by the canonical amount, event, timing, crowd bonus and streak. The existing
events button shows a real physical live-event count and ×3 payout, otherwise
the next actual event. Clicking the callout opens Live now when applicable.
The Tech Week tab covers all October 5–11 even before the week begins.

## Calendar freshness

`eventsRefresh` enables the public official MCP feed independently of the
provider-backed enrichment flag `events`. The reader requests up to 32 pages
of 75 at 1.1-second spacing, limits each response to 2 MB and 20 seconds, and
rejects incomplete or changing totals before writes. Only a completed import
retires older official rows. Other event sources are retained. Only public
coarse venues are used; hidden addresses are never inferred.

`npm run dev` seeds the bundled snapshot, then starts a local scheduler after
15 seconds and every three hours. It invokes Wrangler's native local scheduled
handler; the Worker queues and acknowledges refresh jobs only after D1 success.
Network failures retain the previous calendar. The explicit snapshot refresh
command uses the same reader and atomically replaces the bundled file.
Production cron configuration remains part of the separately reviewed deploy.
The [Cloudflare Cron documentation](https://developers.cloudflare.com/workers/configuration/cron-triggers/#test-cron-triggers-locally)
documents the native local handler used here.

## Checks

- Strict-TLS source refresh: 2026-10-03 08:27 UTC, 22 complete pages, 1,596 events,
  1,535 physical markers, all seven Tech Week dates present.
- Targeted funding/schedule rules and complete/partial feed persistence pass.
- Native disposable workerd/D1 check: immediately before and at SF midnight,
  today changes from two ranked players to empty/$0/unranked; weekly totals and
  ranks persist. This boundary check uses an isolated test clock and ledger.
- Web and Worker TypeScript plus Worker dry-run pass.
- Native Wrangler scheduled → Queue → D1 refresh passed: 1,596 rows with
  `updated_at=2026-10-03T08:39:00.318Z`, replacing the previous 1,599-row seed.
  Workerd requires manual redirects; non-2xx responses are rejected.
- Native two-player browser run, 2026-10-03 09:12–09:13 UTC: separate anonymous
  identities physically walked into the real Investor Happy Hour room. Both saw
  two players, remained for at least 20 real server seconds, and received
  55,000,000 cents each: investor base $1M × off-window 0.5 × crowd 1.1 = $550k.
  Both persisted Today leaderboard rows and the PRE-SEED CLOSED parody toast
  were verified. No native console or HTTP errors. Desktop/phone Funding board
  and all-seven-day event-list screenshots were reviewed in
  `artifacts/funding-depth/2026-10-03T0913/`.
- That combined report preserves a later isolated-UI failure: the phone toast
  touched the startup buttons. The mobile toast now leaves space for the full
  status HUD plus radio ticker and adds the outbid bar offset. The isolated
  browser check passed at 09:15 UTC after this fix, including phone bounds,
  SERIES A CLOSED, the actual parody headline, live-event callout, and the
  SF-midnight daily reset with weekly funding retained. Reviewed screenshots
  and the passing report are in `artifacts/funding-hud/preview/`. No native
  ledger or server behavior changed after its successful two-player check.
