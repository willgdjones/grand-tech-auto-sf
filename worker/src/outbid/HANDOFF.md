# Outbid ledger and test Checkout — gtasf-wqd.2

`handleOutbidRequest` forwards only the public Outbid API paths to the dedicated
SQLite LedgerDO named `outbid:test`. No new binding or database migration is needed.
`GET /api/outbid` returns the canonical top 50 and the authenticated viewer total.
Anonymous ownership uses a random HttpOnly, SameSite=Lax cookie; a display name or
public bidder ID cannot edit or add to another bidder. Losing the cookie creates
a separate identity; account recovery is not implemented.

`POST /api/outbid/checkout` requires a same-origin request, minimum 100 integer
cents, an idempotency key, and a Jev-approved name/message/public HTTPS link. The
server screens A/AAAA DNS answers and every redirect for reserved addresses, reads
at most a short page prefix, and sends untrusted content to Jev 1.13.0. It approves
only an acceptable probability of at least 0.99. DNS screening cannot pin the IP
used by Workers fetch, so it is not a complete DNS-rebinding defense. Public X and
LinkedIn pages that deny automated reads are still checked by URL and user text.

Checkout uses Stripe's existing SDK and the BDTS metadata/idempotency pattern,
with automatic capture **after text/link approval**. A signed webhook and current
provider payment state are required for credit. Returning from Checkout never
credits a bid. Each order/intent/event is unique; totals are decimal strings summed
as bigint. Earlier time reaching an equal total wins, followed by bidder ID.
Refunded cents are monotonic; an unresolved/lost dispute removes credit, while a
confirmed won dispute can restore the remaining unrefunded credit. Older orders
cannot overwrite a newer paid profile. Settlement is atomic and provider reads
are serialized per LedgerDO.

An atomic notification outbox and durable alarm POST `{revision}` to WorldDO's
private `/internal/outbid/changed` endpoint. Failed broadcasts retry without
undoing a confirmed payment. Misty owns the WorldDO receiver and protocol; the
browser refreshes canonical state from GET on each change. Webhook accounting
continues when display/new-checkout flags are disabled.

## Enabling and remaining external evidence

Display: root owns `outbidBanner`/`outbidCrown`. Checkout remains off until
`outbidCheckout` is enabled with GTASF-only `sk_test_…`, `whsec_…`, and
`TYPESAFE_API_KEY`, in a non-production environment. Stripe live keys/events are
rejected. H02 owns provisioning. The local presence-only check found none of those
three secrets; no real provider payment or Jev request has been claimed.

Logos: raw uploads are private `outbid/quarantine/<id>` objects, capped at 2 MB and
1 MP by header inspection. Header inspection is **not** decoded normalization.
The existing ad Queue/codec/Haiku/human-review flow must be completed before
`moderation` and `admin` enable this path. The internal `applyOutbidLogoReview`
RPC accepts only the normalized `outbid/approved/<id>.webp` key, <=1 MP dimensions
and an existing R2 object. Only approved media is served publicly. No public
approval route or fallback approval exists; pending logos never appear. Text-only
Checkout can be enabled independently. This integrates the shared media boundary;
the unfinished ad consumer/admin workflow remains an explicit prerequisite.

## Local verification

One SQLite-backed smoke (`worker/src/outbid/outbid.test.ts`) passed: anonymous
authentication, minimum bid, real SDK transport-shaped Jev allow/reject responses,
private DNS rejection, stable Checkout request identity, signed/tampered webhook,
unpaid/wrong-currency rejection, cumulative repeat bids, deterministic ties,
duplicate-event/intent idempotency, partial refund, stale refund event, dispute
removal/restoration, immutable profile ordering, and unapproved-logo withholding.
All provider transport data in that test is an isolated fixture; the running app
contains no fake paid winners. Worker TypeScript passes. Misty coordinates the
single Worker dry run with admission integration.

Provenance: `reservedIp.ts` copies BDTS `shared/net/reservedIp.ts`;
`linkcheck.ts` adapts its bounded-reader/DNS/manual-redirect pattern;
`stripe.ts` adapts Checkout metadata/idempotency parameters. New cumulative
ledger, moderation, public routes and UI contracts are GTASF code. No BDTS keys,
accounts, bidder data or Cloudflare resources are reused.
