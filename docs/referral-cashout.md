# Referral cash-out: disabled implementation plan

RF06 (`gtasf-kk0.6`) is a design and explicit availability guard. No connected
account, onboarding link, transfer or payout is created. `referralCashout` remains
false; `/api/referrals/cashout` always returns 503 without contacting a provider.
The earliest possible opening is **Oct 12, 2026, 00:00 America/Los_Angeles**
(07:00 UTC), with a **$50 minimum**. A flag flip cannot bypass the missing provider
implementation. RF08 (`gtasf-kk0.8`, founder) tracks Connect application, supported
recipient countries and the transactional-email service. Opening after that date
still requires separate transfer implementation and recorded acceptance.

## Account and onboarding design

Preserve the requested Express Dashboard experience. Stripe now directs new
platforms toward Accounts v2; use its recipient/transfer configuration with an
Express dashboard if available for the GTASF account, or the supported v1
controller equivalent. Do not hard-code the legacy account-type API before
provisioning confirms the platform configuration. Stripe documents the dashboard
mapping in [connected-account configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration).

The authenticated, verified referral owner starts onboarding in the game. Create
one connected account per canonical owner; store only the account ID and bounded
status fields locally. Stripe collects identity and bank information. Generate a
single-use onboarding link for the current authenticated owner. Never email or
log it. Both refresh and return routes require the same owner. Returning to the
game is not proof of completed onboarding: retrieve current account capabilities,
requirements and payout status, and reconcile signed account events. These
constraints follow [Stripe's Express onboarding guide](https://docs.stripe.com/connect/express-accounts).

Freeze account recovery/merging while either account has unresolved cash-out
operations. A later merge requires reconciliation of connected-account ownership,
ledger balances and outstanding transfers before selecting a single owner; the
current email-recovery transaction must gain this guard before cash-out ships.

## Proposed persistent state (not applied migrations)

| Table | Required columns and constraints |
| --- | --- |
| referral_connect | canonical account PK; Stripe account UNIQUE; API/configuration version; onboarding status; transfers capability; payouts enabled; requirements summary; checked timestamp; disabled reason |
| referral_cashouts | UUID PK; owner; immutable USD cents; USD currency check; destination snapshot; state; unique owner/request key; unique Stripe transfer ID; timestamps; bounded failure code |
| referral_cashout_events | Stripe event ID PK; account ID; object ID; observed timestamp; processing status; bounded event type; no identity documents or bank data |
| referral_cashout_outbox | operation UUID PK; cash-out FK; operation type; permanent provider idempotency key; attempts; next retry; last bounded error |
| referral_cashout_allocations | cash-out/order pair UNIQUE; matured commission cents allocated; refunded/reversed cents; source charge reference for audit |

Ledger debits and corrections use the existing append-only USD ledger. A cash-out
reservation is a negative entry in the same available balance used by checkout
credit, so parallel credit redemptions cannot spend it. Reservation creation,
conditional sufficient-funds check, request idempotency and outbox insertion
commit in one D1 transaction. Resolve all account aliases and require the owner
to have a verified email, no debt, no pending risk review, an enabled destination
and at least $50 of unreserved mature earnings. The displayed amount is exact
USD cents; compute sums as bigint, never floating-point dollars.

Proposed limits: one unresolved operation per owner, one new cash-out per 24 hours,
three onboarding-link requests per hour and ten rejected cash-out requests per
hour. These are operational tuning choices for review, not a change to the 20%
rate. Check limits atomically. Identity and payout-destination changes require
fresh email verification and a review hold before another request.

## State transitions and crash recovery

`reserved → review → transfer_pending → transferred → bank_pending → paid`.
A definite pre-transfer rejection becomes `cancelled` with one compensating ledger
entry. A transport timeout becomes `reconcile_required`: retain the reservation.
Do not restore credit until provider retrieval proves that no transfer occurred.
The durable outbox reuses the same operation key and reconciles provider metadata
when a retry exceeds the provider's idempotency retention. Store the returned
transfer ID before advancing. Signed webhooks are deduplicated, then current
provider objects determine state rather than event arrival order.

A **transfer** moves platform funds into a connected account. A **payout** moves
that connected balance into its external bank account. Track these separately;
never label a transfer as money received by the bank. Use standard payouts,
not instant payouts for launch. If GTASF manages a manual schedule, verify its
country-specific holding limits before enabling it. See [manual payouts](https://docs.stripe.com/connect/manual-payouts).

GTASF's ledger establishes the obligation; the platform's available Stripe
balance funds the transfer. Keep enough platform cash to cover refunds, disputes
and fees; insufficient provider balance leaves the request reserved for retry,
not falsely paid. A request may allocate several mature commission lots; do not
pretend one source charge covers an aggregate from many buyers. The
[transfer API](https://docs.stripe.com/api/transfers/create) accepts integer amounts
and a destination; the implementation must reconcile each returned object.

## Refunds and operational review

Seven-day maturity is not a guarantee that future disputes cannot occur. Existing
commission corrections reduce earnings after refund/dispute. If cash-out is
reserved, cancel or reduce it before transfer where possible. After transfer,
append the USD clawback once and attempt the associated transfer reversal; if
funds cannot be recovered, keep debt, freeze future cash-out and direct future
earnings toward repayment. Never charge the referrer's card automatically.

Refunding the original platform charge does not reverse an associated transfer.
GTASF must explicitly reconcile/reverse it; available connected funds can constrain
recovery. See [separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)
and [transfer reversals](https://docs.stripe.com/api/transfer_reversals).

A bank-payout failure after successful transfer leaves funds in the connected
account until provider reconciliation resolves the failure. Do not also restore
spendable game credit, which would duplicate value. On a verified transfer
reversal, restore only the appropriate reservation amount, preserving any
commission clawbacks already applied.

Before enabling: founder records Connect approval and the supported configuration;
review the exact cash-out terms and risk process; prove test-mode onboarding,
expired links, requirement changes, duplicate/out-of-order events, simultaneous
credit/cash-out, transfer timeout, insufficient balance, partial reversal and bank
failure. Review daily the outstanding ledger liability, reserved/transferred
amounts, debt, provider balance and failed jobs. Keep an immediate acquisition/
cash-out kill switch while financial reconciliation continues. Real transfers
require the separately authorized activation; this design performs none.
