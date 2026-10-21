# Outbid local integration — gtasf-wqd

Founder scope: a persistent top banner for the cumulative paid #1 bidder, top-50
leaderboard, test Stripe Checkout, WorldDO updates, and the same approved winner
on the Salesforce Tower crown. Second-place plane placement is retained for later.
Reference interaction: https://outbid.lol/ (rank, amount to beat, direct claim CTA).
All GTASF content and styling are authored here; reference bidders are not fixtures.

Children: `.1` Lavender UI/contracts, `.2` Lavender ledger/Stripe/moderation,
`.3` MistyHawk broadcast, `.4` RusticBear crown, `.5` later plane. Root TopazRaven
owns main/flags. Pending integrations remain explicit; no fabricated paid entries.

## Creator links ready

Call `createCreatorLinks()` from `web/src/hud/creator.ts` before awaiting map load.
It mounts one bottom-corner HUD link and one link in `.loading-card`; both say
**Made by @willgdjones** and link to **https://x.com/willgdjones**, per the latest
founder correction. Both open safely in a new tab. `destroy()` removes them.
The existing HUD flag guards creation. This attribution is not a paid bid.

## Shared contract and integration

`shared/outbid.ts` owns the public snapshot and validation. Amounts are integer
cents; cumulative totals serialize as decimal strings and are added with bigint.
Public snapshots carry version/revision/currency/mode, checkout readiness, minimum
bid and at most 50 approved paid entries. Only the canonical backend assigns rank.
UI and crown never turn a Checkout redirect or client-supplied bid into a winner.

`GET /api/outbid` returns current public state. `POST /api/outbid/checkout` receives
the moderated profile and amount in cents, returning a Stripe-hosted Checkout URL.
Payment owner supplies authenticated repeat-bid identity; a name alone cannot
authorize editing or aggregating another bidder. Checkout success returns to the
game and refreshes canonical state; signed webhook settlement is authoritative.
WorldDO broadcasts a compact `OUTBID_CHANGED` revision on change and on join.
Call the panel's coalesced `refresh()` to retrieve the canonical snapshot; no frame
polling or second WebSocket is necessary. `setSnapshot(snapshot)` validates the
bounded contract and rejects older revisions. HTTP viewer identity is private.

Create `createOutbidPanel({onModalChange, onSnapshot})` once. Pause movement/look
and release pointer lock while `modalOpen`; `onSnapshot` feeds the crown's
`setSnapshot(snapshot)`. `destroy()` removes DOM/listeners. `outbidBanner` gates
creation; `outbidCheckout` plus server readiness gates purchase. The panel keeps
the same idempotency key for retries of an unchanged bid. It accepts redirects
only to `https://checkout.stripe.com`, without credentials or alternate ports.

The form clearly shows test mode, minimum $1, cumulative paid ranking and the
current target. A stale target never promises a guaranteed rank while other
payments settle. Unavailable keys/moderation produce an honest unavailable state.
Any logo must be an approved asset from the ad moderation path, never an arbitrary
unreviewed URL. Live-mode rollout and external account evidence are separate.

## Local visual evidence — 2026-10-02

`tools/outbid-smoke.mjs` builds an isolated static copy of the real app and uses
one headed browser for desktop, a true 390×844 touch-phone context, and the
separate crown render fixture. The initial actual-game check passed canonical
empty GET/test mode, disabled Checkout, modal movement hold, direct creator X
link, and a clearly isolated 50-row render fixture with exact amount-to-lead and
stale-revision rejection. No fixture is sent to a payment API.

Visual review found the old phone quick-action row overlapped the street label.
Root's compact phone action layout fixed it. The focused `--phone-only` retry
passed with seven visible touch controls, no street/header/button overlap,
Upcoming/creator clear of the touch bank, and the actual capacity-enabled game
reaching Connected/READY. Crown winner/update/stale/empty checks also passed after
its preview's missing favicon was fixed. The crown texture is 524,288 pixels.
Both phone screenshots were inspected; the street and district remain legible.

Evidence is in ignored `artifacts/outbid/{evidence,phone-evidence}.json`, desktop,
phone and modal PNGs, plus `artifacts/outbid-crown/preview/`. The first report
retains the isolated preview's original favicon failure; the focused retry
records the correction with zero game/crown console errors on AMD Metal. This is
local UI/fixture evidence, not a real Stripe payment or a deployed/device gate.
Scoped web types and the frozen production bundle pass. Actual two-peer revision
broadcast is independently covered by Misty's/Rustic's native WorldDO smoke.

## Live-update keyboard focus — gtasf-h4f4

The panel keeps bidder rows and links keyed by canonical bidder ID. Content-only
updates preserve their DOM identity; rank changes move only necessary rows and
keep the focused bidder at the same viewport position. If that bidder leaves
the top 50, focus moves to the dialog's Close control. The banner reuses its
winner link, with Top 50 as the fallback when the board becomes empty. Other
controls retain their focus, and row references are released on destruction.
Rank validation, confirmed totals, Checkout and feature flags are unchanged.

The scoped strict web check passes. `tools/outbid-focus-smoke.mjs` has separate
frozen before/after builds under `artifacts/outbid-focus/`; the original build
was made before editing the panel. The October 3 10:10–10:11 UTC real-DOM run
reproduces the original loss on desktop and phone, then passes all eight fixed
cases on both viewports with zero browser errors. Physical Tab selects the
bidder and Escape closes the dialog. Content updates preserve scroll exactly;
moving that bidder from #10 to #16 keeps its visible position within 0.5px.
The check also covers removed-bidder fallback, stale revisions, draft/caret
preservation, banner focus, empty-board fallback and clean disposal. Both
reordered screenshots were reviewed with the selected link still visible.

Run with Node24 and `GTASF_FOCUS_STAGE=before|after`. `--build-only` freezes the
current module; `--run-only` runs the frozen artifact. These checks use disabled
GPU/WebGL and isolated approved test snapshots. They establish local DOM
behavior, not a real payment, native World update or deployed/device gate.

## Preserve a chosen bid amount — gtasf-3njb

An untouched amount follows the current amount needed to lead. Once the player
edits it, that draft survives focus changes, confirmed leaderboard updates and
closing/reopening the panel. The separate quote still shows the latest amount
needed to lead. Empty and invalid drafts stay editable and pass through the
existing validation when submitted; an update never silently chooses a new
amount for the player.

The strict web check passes. `tools/outbid-amount-smoke.mjs` has frozen before
and after bundles under `artifacts/outbid-amount/`. Run with Node24 and
`GTASF_AMOUNT_STAGE=before|after`; `--build-only` creates the snapshot and
`--run-only` exercises that snapshot with GPU and WebGL disabled. The fixture
uses approved test snapshots with Checkout unavailable and rejects payment
requests. The October 3 10:27 UTC run reproduces the old overwrite on both
1100×720 desktop and 390×844 phone, then passes both fixed views with zero
browser errors. A physically typed 7.25 survives blur and a 30.01 lead quote,
Escape/reopening and an HTTP refresh. Untouched defaults still track totals;
empty, nonnumeric and below-minimum drafts remain intact. Focus/caret, disabled
Checkout, GET-only requests and clean disposal also pass. Both after screenshots
were reviewed. Reports are `artifacts/outbid-amount/{before,after}/report.json`;
these establish isolated DOM behavior, not a real payment or native/device gate.

## Dialog handoff and reopening — gtasf-xtlp

`hide()` now reports the closed modal synchronously and only once. The native
dialog restores its own launcher focus. Its later `close` event does not steal
focus from a newly opened panel or mark a reopened Outbid dialog closed. A
browser-originated close and destruction use the same idempotent completion.
Existing `open`, `hide`, `modalOpen` and callback contracts require no main hook
changes; banner and Checkout flags retain their prior behaviour.

`nice -n 19 node tools/outbid-lifecycle-smoke.mjs <new-output-directory>` uses
the real Outbid module, a native HTML dialog and an isolated approved snapshot.
The frozen original source in `artifacts/outbid-lifecycle/before-xtlp-20261003/`
reproduces focus theft after a same-turn handoff. The final desktop 1100×760 and
phone 390×844 run in `artifacts/outbid-lifecycle/final-xtlp-20261003/` passed on
October 3 at 11:06 UTC. It verifies handoff focus, immediate hide/reopen callback
ordering, stale close events, repeated hide, native Escape/launcher restoration,
preserved name/message drafts, browser-originated close/reopen and destruction.
Both contexts had no console/page errors or actual API/map requests; Checkout
stayed disabled. Web strict types and the scoped module bundle passed. This is
DOM lifecycle evidence, not a payment or deployment acceptance.
