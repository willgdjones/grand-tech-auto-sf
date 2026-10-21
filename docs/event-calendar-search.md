# Full-calendar keyboard search — gtasf-u5my

The event list previously parsed and converted the same event dates on every
search keystroke, across four date-tab counts and the selected results. A local
probe against the committed 1,596-event public calendar at October 5, 10am SF
time measured 96ms for an empty query, 82ms for `investor` and 79ms for
`north beach`, before any DOM work. These are local diagnostics, not frame or
device performance acceptance.

`schedule.ts` now retains each event's parsed start/end and SF calendar-day
window in a WeakMap. A new feed object or changed start/end string recalculates
that window, and old feed objects can be garbage-collected. Current time is
still compared on every live/date query. The current SF-day conversion only
reuses an exact timestamp; it does not assume a UTC day equals an SF day.
An event with no valid end remains in its start-day calendar without being
advertised as live. SF date windows are calculated only when the date list needs
them; closed-view live callouts only need parsed timestamps. Existing
`eventsView` and funding entry switches apply.

Both targeted schedule tests and strict web types passed. The added schedule
regression covers live end, exact SF midnight, a 25-hour DST day,
mutable and replacement feed records, missing/invalid ends and invalid starts.
`tools/event-calendar-search-smoke.mjs` exercises the real event-view module
with the complete committed calendar and physical keyboard typing, date counts,
pagination and input focus in a GPU-disabled browser. It records synchronous
input-handler time separately from layout and native game rendering. Its
October 3, 10:35 UTC run passed with zero browser errors; the desktop and 390px
phone screenshots were reviewed.

The same Node probe before and after the change returned identical counts:
35 live, 189 today, 379 tomorrow, 1,596 in Tech Week. Query results were 1,596,
77 and 19 respectively.

| Query | Before | After |
| --- | ---: | ---: |
| Empty, cold date windows | 96 ms | 71 ms |
| `investor`, repeated calendar | 82 ms | 4 ms |
| `north beach`, repeated calendar | 79 ms | 5 ms |

The browser recorded 22.9ms for its initial schedule calculation and 2.2/2.1ms
for the two subsequent queries. Physical keystrokes took 3–10.9ms in the
synchronous input handler, including the module's DOM update. First-open date
work remains; these isolated timings exclude browser layout, native rendering
and whole-game/device performance gates. The small fixture build includes the
entire calendar and emits a bundle-size advisory; it is not a production bundle.

Evidence: `artifacts/event-calendar-search/{baseline,after}.jsonl`, `report.json`,
`full-calendar-phone.png` and `full-calendar-desktop.png`. All check processes,
the isolated preview and Chromium closed after the run.
