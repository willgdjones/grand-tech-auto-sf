# GTM routes and office claim preparation

`handleGtmRequest(request, env)` is wired in Worker `index.ts`, returning `Response`
for GTM paths or `null` for other routes. It needs only `DB` and `ENVIRONMENT`.

| Route | Behavior / switch |
|---|---|
| GET `/api/gtm/catalogue` | Six presell products, integer cents, `gtmCatalogue` |
| GET `/api/gtm/spawns/<slug>` | Public heading/coordinates/building only, `gtmSpawns` |
| GET `/claim/<token>` | Company/building preselection, `officeClaims` |
| POST `/claim/<token>/verify` | Exact domain email, bounded verification **draft** |
| GET/POST `/claim/verify/<token>` | GET shows confirmation; POST consumes single-use token |
| POST `/claim/<token>/checkout` | Verified-session check, then explicit 503 integration stub |
| GET/POST `/unsubscribe/<token>` | Immediate idempotent suppression, independent of sales flags |

`officeClaims=false` and `officeClaimDelivery=false` remain off in shared flags.
To enable claims: apply migrations 0003/0004, confirm company-owned domains and
current office occupancy, issue reviewed offer snapshots, review local HTTP behavior,
and configure an approved delivery adapter. Merely flipping delivery true returns
503; no mail provider is implemented here. No send, upload, Stripe or publication
side effect exists. The local unit smoke uses a mocked feature switch and SQLite;
it is not a deployment or delivery acceptance claim.

Offer preparation (private files, no remote write):

```sh
npx tsx tools/gtm/issue-offer-cli.ts --slug COMPANY-SLUG --reviewed tools/gtm/private/reviewed-offices.json
```

Input defaults to `out/matched-leads.csv`. It refuses missing/unmatched offices,
missing occupancy source and consumer email domains. Optional `--email` must match
the company domain to generate the recipient's unsubscribe link. Issuance does not
prove ownership; domain-email verification is still required. Apply generated SQL
to local D1 only after review. Never commit/export the private token files publicly.

Offer token hashes bind an immutable company/domain/building snapshot, expiring in
seven days. Magic links use 256 random bits, are stored hashed, expire after 15 min,
and are consumed with an atomic conditional update. Confirmation GET does not consume
the token (link scanners cannot verify). A one-hour HttpOnly/Secure/SameSite=Strict
session remains scoped to that offer; cross-origin POST is rejected. Draft bodies are
private in D1, cleared after use; purge expired bodies during approved future upkeep.
No raw link is returned to the requester. Rate limits are atomic per offer: once per
minute, five/day. Secrets never enter logs.

The booking table has a `(building_id, week)` primary key. Verification creates no
hold; the payment/moderation integration in `gtasf-39n` must authorize the session,
atomically reserve the single slot, charge only the shared price, and publish only
after payment plus moderation. Other products are open to anyone subject to moderation.
Private source logos do not enter public responses or game assets.

Unsubscribe token hashes persist without expiry. A click or RFC 8058-style POST
adds an email to `gtm_suppressions`; already-suppressed addresses still succeed.
Future exports and inbound triage must use that table across every domain/provider.
No fee, sign-in, second click or additional data is required to opt out.

One smoke exercises catalogue/spawn projection, wrong-domain rejection, private draft,
rate limit, GET confirmation, single-use POST, secure cookie, duplicate building/week
booking rejection and durable unsubscribe. Live email/payment acceptance remains open.
