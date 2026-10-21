# Referral programme

RF01 (`gtasf-kk0.1`) supplies an authenticated device/account identity, public
96-bit referrer codes, D1 last-click attribution, and a same-origin share helper.
`flags.referrals` and `flags.referralWarmIntro` are enabled in the local build after RF07 acceptance; email claims, checkout credit and cash-out remain off.
Apply migrations 0010–0016 before enabling (0014 is the funding bonus adapter). No external provider is invoked
by the attribution routes.

The existing random 256-bit HttpOnly `gtasf_device` cookie authenticates a device;
only its SHA-256 hash is stored. A public referral code cannot read a balance.
Bootstrap `/api/referrals/profile` before funding bootstrap so first-time requests
do not race to replace the device cookie. Then POST the incoming `ref` to
`/api/referrals/visit`. POST requires the exact same origin. The attribution stays
in D1 for 30 days from the last eligible click; browser storage cannot edit it.
The buyer's earning window starts on their first authenticated referral-system
visit, not each click or purchase. Existing players therefore cannot restart the
30-day earning window with a fresh share link. A checkout freezes attribution.

One visit UUID deduplicates request retries. A later distinct click replaces the
referrer. Same account/device or equal verified email is rejected; payment-time
email/card checks and clawbacks belong to RF02. `recordReferralPlayer` is called
only after accepted server gameplay, and counts a distinct friend once. Clicks
are diagnostic, not a source of money or fictional funding.

`initReferrals()` initializes attribution. `referralShareUrl(url)` preserves the
destination, query and fragment, replaces a prior `ref` with the sharer's own
code, and never adds it to an external event or payment site. Consumers must use
game event links instead of appending referral codes to external ticket links.
`handleReferralRequest(request, env)` returns null outside its API namespace.

## Confirmed payment ledger (RF02)

Outbid stores an immutable server-resolved referral identity on its checkout order
and freezes it in D1 before opening Stripe Checkout. The order's settled cash,
less refunded cash, earns `floor(netCashCents / 5)` cents. Redeemed credit does not
earn another commission. Payment must settle before the first-visit 30-day window
ends; opening a checkout just before expiry does not extend the earning period.
The first captured charge timestamp starts the seven-day hold.

A verified webhook retrieves current Stripe state under the LedgerDO settlement
queue. Its bid update, processed-event marker and referral outbox entry commit
together in SQLite. An alarm applies the outbox to D1 and retries after outages;
replaying after a crash cannot duplicate the D1 credit. Refunds and unresolved
disputes append negative corrections. A dispute win restores only unrefunded
earnings, with the original availability date. Existing financial corrections
continue even if new referral acquisition is disabled.

The ledger keeps billing-email and card-fingerprint hashes, never raw values.
Matching device/account, verified email or a known card blocks self-referrals.
Learning a shared identity on a later purchase or email claim also claws back
earlier commissions. Card checks can only compare fingerprints Stripe supplies;
they do not prove that two different fingerprints represent different people.
Spent-credit clawbacks leave debt and zero spendable balance; future earnings
repay it. No attempt is made to charge a referrer's card for that debt.

Future ad/billboard checkout owners call `referralBuyer` when creating the order,
`freezeReferralOrder` before payment, and `applyReferralPayment` only from their
verified settlement outbox. These are server-only hooks; those products do not
yet have an active checkout consumer. All balance sums remain integer cents and
are converted to decimal strings before crossing D1's JavaScript boundary.

## Checkout credit (RF03)

`flags.referralCredit` exposes the Outbid toggle and authenticated quote. Email
ownership must be claimed before spending. A fixed quote states gross bid,
credit and cash; a changed balance rejects checkout and requires a fresh quote.
The same D1 transaction conditionally reserves the quoted amount and appends its
debit. Parallel orders cannot spend the same balance. Later retries use today's
balance, never an old order's historical timestamp.

Mixed orders leave at least $0.50 cash. Fully covered orders use Stripe's zero-cost
Checkout and require a verified completed session with no payment required,
matching the stored session and credit hold before ranking changes. A redirect
never confirms payment. See [Stripe's minimum charges](https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts)
and [zero-cost Checkout](https://docs.stripe.com/payments/checkout/no-cost-orders).

Ordinary held sessions expire after 30 minutes. The server retrieves Stripe's
session before releasing credit; clicking Cancel leaves the hold until verified
expiry. Recovery inventories the checkout's bounded creation interval if a crash
lost the returned session ID. It releases an unbound hold only after a complete
provider inventory finds no matching session and a five-minute buffer passes.
Incomplete provider reads retain the hold for retry. Completed sessions await
their verified webhook, including after a restart.

Cash refunds restore the corresponding proportion of used credit, rounded down
to whole cents, and full refunds restore all used credit. An unresolved dispute
restores credit while removing the entire bid; a win reuses the applicable credit
and may leave debt if it was spent in the meantime. Cumulative refunds never
decrease on old events. Each correction is appended to the USD ledger.

Ad/billboard checkout owners reuse `quoteReferralCredit`, `reserveReferralCredit`,
`bindReferralCredit`, `settleReferralCredit` and verified-only
`releaseReferralCredit`; those products still need their planned payment entry
points. No public route accepts an arbitrary account, release or balance.

Outbid also keeps a server-created conversion UUID and bounded permitted
analytics context with the order. The first confirmed positive gross purchase
queues one best-effort purchase delivery; its value is actual cash paid. An
authenticated receipt returns the same UUID for browser deduplication. Analytics
delivery acknowledgement records an attempt, not provider acceptance.

## Sharing and verified claims (RF04)

The gated `createReferralPanel` supplies the launch button, link, click/player
counts, pending/available/debt amounts and email form. The parent coordinates its
modal with gameplay input. Location, office, event and crown shares all use
`referralShareUrl`; claim-proof fragments are removed from shared URLs.
Only the canonical current Outbid leader gets the crown-share button.

Anonymous balances remain saved on the authenticated device. Claiming requires
both `referralClaims` and a GTASF-only `REFERRAL_MAILER` service binding. With no
binding the form reports that email delivery is unavailable; it never claims an
email was sent. There is no provider/account provisioned by this change.

The adapter accepts an internal POST `/send` with JSON `{to, subject, text}` and
an `Idempotency-Key` UUID, and returns 2xx only when delivery is accepted. It must
not log recipient addresses, message bodies or tokens. The founder must approve
the exact message below and configure the sender/service before enabling it
(`gtasf-kk0.8`). No real email was sent during implementation or testing.

> Subject: Verify your GTASF referral earnings
>
> You requested to claim your GTASF referral earnings. Open this link in the same browser that requested it within 30 minutes: {verification link}
>
> This verifies your email and may restore your existing referral balance. It does not buy anything or enable cash-out. If you did not request this, ignore this email.

Only a hash of the random 256-bit proof is stored; the secret travels in the URL
fragment and is removed before verification. Proofs expire after 30 minutes,
are consumed atomically once, and are bound to the initiating device cookie to
prevent a forwarded link from claiming another browser's account. Requests are
limited to three per hour per device and normalized email. No raw email is kept
in D1. Verified Stripe billing information does not prove mailbox ownership.

Recovery combines an anonymous account with the existing verified owner using
one-hop aliases. Historical ledger entries, active holds, refund debt and old
public codes remain intact. Financial queries resolve the canonical group; the
oldest first visit keeps the original earning-window deadline. The same claim
transaction rechecks prior commissions for self-referrals and appends any
clawbacks. Fictional fundraising balances are separate and are not merged.

## Warm introductions (RF05)

WorldDO records referred players only after accepting their authenticated game
connection. The first eligible referrer for that friend remains the beneficiary
of the once-per-friend gameplay bonus; payment attribution still uses last-click.
With `referralWarmIntro` and `fundingLoop` enabled, five minutes of observed play
earns that referrer $100k in fictional funding. It grants no USD, credit or cash-out.

The observer deduplicates simultaneous tabs by the authenticated device ID and
uses the server clock. Disconnected time, five-minute input-idle sessions and
tick gaps over two seconds do not count. SQLite checkpoints once a second;
restart recovery conservatively loses at most the unfinished second, never
counts offline time. The absolute monotonic total flushes to D1 about every ten
seconds. A durable pending row plus the WorldDO alarm retries failures even if
the player leaves. Replaying after D1 success cannot double-count play or awards.

The funding adapter independently checks 300,000 observed milliseconds and at
least five minutes since joining, canonical account/email/card self-matches,
and the global once-per-friend constraint. Account recovery never changes the
original fictional-funding beneficiary. Existing funding HUD/profile polling
receives the bonus in canonical totals and round/leaderboard calculations;
event streaks and attendance remain separate.

RF06–RF07 supply disabled cash-out and integrated acceptance. Financial provider
setup and first real payment acceptance remain separate founder tasks.

## Recorded integration evidence (RF07)

`nice -n 10 node tools/referrals-native-smoke.mjs` runs a disposable workerd with
the actual Worker entry, WorldDO and LedgerDO, real D1 migrations and SQLite.
Its generated fixture bundle enables the referral flags, uses a controlled server
clock and intercepts every email/Stripe/Jev/DNS transport. It contains no real
credentials and never calls an external provider. Fixture-only clock/alarm routes
exist solely in the generated test entry, never in the application entry.

The check passed on Oct 3: three independent authenticated devices; last-click
attribution and foreign-origin rejection; one-use email claim bound to its device;
normal websocket HELLO/activity and WorldDO tick path giving one $100k funding
bonus at five minutes; HTTP moderation/Checkout; rejected invalid signature;
verified webhook replay giving exactly 20% commission once; seven-day maturity;
fully covered zero-cash Checkout; and refund clawback leaving debt after that
credit was spent. Report: `artifacts/referrals-native/report.json` (ignored).

This caught and fixed a missing referral handler in the Worker entry and a
Worker-only TypeSafe fetch receiver error. The SDK now receives an arrow wrapper
around fetch, retaining native Worker semantics and all moderation checks.

`tools/referrals-ui-smoke.mjs` separately builds the real panel modules against
an isolated API fixture. Desktop and 390px phone screenshots were reviewed for
fit/readability; modal callbacks, own-link copy, company/event/location URLs,
claim availability, crown sharing and the exact credit/cash quote pass. Root's
`artifacts/event-share/report.json` records the real event clipboard round-trip
through `resolveSpawn`, with the outbound RSVP URL unchanged. Financial smokes
also cover concurrent holds, recovery aliases, expiry, disputes and restarts.
These are scoped implementation checks, not deployment/device/payment gates.

| Remaining external acceptance | Owner / requirement |
| --- | --- |
| GTASF Stripe test and TypeSafe credentials | Founder `gtasf-e5m`; no provider keys evidenced by Oct 3 audit in `docs/deployment.md` |
| Real Stripe test Checkout + webhook | Run against configured GTASF test account; the isolated transport is not provider acceptance |
| Email delivery | Founder `gtasf-kk0.8` approves exact message above and provisions GTASF mailer; then verify actual delivery |
| Ad/billboard checkout consumers | Planned product owners must wire the documented commission/credit adapter hooks when their checkout exists |
| Cash-out | [Connect design](referral-cashout.md); disabled, earliest Oct 12 PT, $50 minimum, separate implementation/activation |
| Live payments and launch gates | Existing financial and device/deployment beads; no live payment or gate acceptance inferred here |

Local activation on Oct 3 applied migrations 0015/0016 to the actual Wrangler D1,
enabled only referrals and warm introductions, and verified the local health
flags. `GTASF_REFERRAL_WORKER=http://127.0.0.1:8787 node
tools/referrals-game-smoke.mjs --skip-build` then passed against the actual local
Worker and its canonical API with zero browser/HTTP errors. Desktop and 390px
touch screenshots were reviewed: actual onboarding/Connected, visible launch
button, own-ref copy, real zero balances, honest disabled email delivery, modal
movement suppression, Escape and Outbid coexistence. Evidence is under
`artifacts/referrals-game/`. The existing phone driving hint overlaps the radar;
that independent HUD defect was reported to pane 1 with coordinates/screenshots.
No production deployment or provider activation occurred.

The referral dialog now announces `hide()` synchronously and once per opening.
Queued native close events cannot release a reopened panel or steal focus from
a subsequent HUD view. Browser-native dialog focus restoration still returns to
the launcher on Escape, and email drafts survive close/reopen. Opening also
reconciles a prior native close before announcing the next modal.

`GTASF_REFERRAL_STAGE=before|after node tools/referral-lifecycle-smoke.mjs
--build-only` freezes the real panel bundle; `--run-only` checks that saved
version. The October 3 desktop 1100×720 and phone 390×844 baselines reproduce
focus theft and stale close callbacks after both programmatic and native
close/reopen. Both corrected views pass those cases, physical Escape, draft
preservation, duplicate hide, browser close and disposal; screenshots were
reviewed and web strict types passed. Ignored receipts are in
`artifacts/referral-lifecycle/{before,after}/report.json`, with no browser errors
or API requests. The fixture replaces profile functions with inert local values;
it cannot send verification messages or establish referral/provider acceptance.
