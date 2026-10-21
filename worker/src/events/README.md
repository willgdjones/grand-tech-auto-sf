# Standalone Tech Week crawler

## Local playable data and API

`GET /api/events` returns `{events, enabled, dataSource}` using the contract below, ordered by start/ID (up to 5,000 events). `dataSource` is `d1` or `local-snapshot`. `shared/flags.localEventSnapshot` is restricted to `ENVIRONMENT=local`; production reads use `flags.eventsApi` (or `flags.events`); `eventsApi` does not enable scheduled crawling. Local startup uses the bundled real snapshot without network requests or keys. If local D1 is empty/uninitialized the API serves that snapshot directly with its capture timestamp. A production D1 failure returns 503, never local fixture data.

`node tools/events/seed-local.mjs` applies local D1 migrations then idempotently upserts the snapshot. It is safe to run repeatedly and refuses to overwrite newer imports. The dev launcher owns calling this before Wrangler starts. Runtime ingestion uses `storeEvents(db, events, capturedAt)` (validated normalized events, batches of 50); `listEvents(db)` maps SQL fields back to the public contract. Partial refreshes never delete earlier rows. Migration `0002_events.sql` adds address/source/tags to the initial schema.

`data/sf-tech-week.json` was captured from the official, public, read-only MCP endpoint `https://www.tech-week.com/api/mcp` on **2026-10-02 PT** using `search_events`, `city:["sf"]`, 75 per page, all 22 pages. Its `capturedAt`, `sourceTotal`, and `complete` metadata record the capture. It contains **1,599 real events / 1,538 approximate physical markers**; virtual events have null coordinates (including an event explicitly titled `* Virtual *` despite a physical neighborhood in the feed). Only event fields are retained, not full descriptions, guest lists, or images. Times are the feed's published structured timestamps, not independently verified with hosts. Neighborhood positions are gameplay approximations, not 90%-precise-geocoding evidence. All snapshot addresses are null; registration still happens on the linked source page.

Refresh explicitly with `node_modules/.bin/tsx tools/events/refresh-snapshot.ts`. It makes sequential, bounded official API requests with a 1.1-second pause, retains the old snapshot on incomplete/failing responses, and uses the same normalization/fuzzing as the crawler. This officially exposed feed supplements HTML discovery; it does not fetch robots-blocked provider pages. The local snapshot has source category tags; Jev/production scheduled refresh remain separate E04/E05 work and stay off.

For `/go/<slug>` links, use the last pathname component of `event.url` (official name plus UUID). Event cards must label `approx:true` as **Approximate neighborhood location**. No exact destination is implied by those coordinates.

Smoke: `nice -n 10 node_modules/.bin/vitest run worker/src/events/store.test.ts --maxWorkers=1` uses actual SQLite migrations and upserts, repeat ingestion, stale-refresh protection, and the API's local/production boundary. No perf/property suite is required for the local playtest.

`crawlTechWeek` fetches the public SF calendar and its linked Luma/Partiful event pages. It returns normalized events and explicit diagnostics. The crawler itself does not write D1, install a cron handler, or call a moderation provider. Production entry defaults to `shared/flags.events`, currently off.

```ts
import { crawlTechWeek, createHaikuExtractor } from './events';

const result = await crawlTechWeek({
  geocode: lookupPublicVenue,
  tagEvent: classifyWithJev, // optional injected adapter; no SDK/key dependency here
  extractEvent: createHaikuExtractor({ apiKey: env.OPENROUTER_API_KEY }), // optional (Haiku via OpenRouter)
  maxExtractions: 25,
  fetchOptions: { userAgent: 'GTASFEvents/0.1 (+https://gtasf.com)' },
});
// Inspect result.issues and result.truncated before treating this as a full refresh.
// The caller owns persistent storage and must not delete old events after a partial crawl.
```

The `Geocoder` interface accepts `{venue, address, city: 'San Francisco'}` and returns `{lat, lon, precision}` or `null`. Precision is `address`, `venue`, `neighborhood`, or `city`. Supply your own provider or local venue index; no shared public geocoding service is enabled implicitly. The caller owns provider rate limits, attribution and a persistent query cache across scheduled runs. Identical queries are cached within a crawl. Lookups are sequential. Provider failure is reported and results remain explicitly approximate.

The `EventTagger` interface returns `{spam: boolean, tags: string[]}`. It receives only normalized event fields. When supplied, spam is omitted; a failed/invalid classification is reported and the event is withheld. When absent, source tags are preserved and `taggingApplied` is false. Event content is untrusted text, never instructions for the adapter.

## Community submission and admin removal (PLAN-v2 decision 9)

Behind `shared/flags.eventSubmission`. Players paste a public **lu.ma** or **Partiful**
event link; the worker fetches that single page politely (robots-respecting), extracts it
via structured data (JSON-LD / `__NEXT_DATA__` / OG) with the optional bounded Haiku
fallback, geocodes it to SF (page coordinates when present, else a coarse neighbourhood
centroid), runs a Jev legitimacy/spam gate, and stores it flagged `community` within
minutes. `worker/src/events/submit.ts#ingestSubmittedLink` has no D1 side effects; the
route persists the result with `storeCommunityEvent`.

- `POST /api/events/submit` — body `{ "url": "https://luma.com/…" }`, same-origin only.
  - `201 { ok, status: 'stored'|'updated', event }` on success.
  - `422 { error }` when the link is unsupported, virtual/out-of-SF, unreadable, or fails
    the Jev check. `409` when the event already exists as an official row.
  - Tech Week calendar links are rejected (already on the map). Unknown hosts are rejected.
  - **Review gate:** when `TYPESAFE_API_KEY` is set the Jev reviewer (`jev.ts`) must pass
    (probability ≥ 0.85, fail-closed). In production/staging a submission is **withheld**
    when no key is configured (`reviewRequired`); locally a parsed public SF event is
    accepted so the feature is demonstrable without secrets. `OPENROUTER_API_KEY` enables
    the Haiku (via OpenRouter) extraction fallback.
- `GET /api/events/admin/community` and `POST /api/events/admin/remove` (`{ "id": "…" }`)
  manage community rows. They exist only when an `ADMIN_TOKEN` secret is configured and
  require `Authorization: Bearer <ADMIN_TOKEN>` (constant-time compared). Removal can only
  delete rows where `community = 1`, so an official feed event can never be deleted here.

Community events carry `community: true` in the `/api/events` contract and a reserved
`community` tag, so radar/map/world markers can badge them. Migration
`0017_community_events.sql` adds the `community` column (official rows default `0`). The
3-hourly official refresh only deletes stale `source='tech-week'` rows, so community
submissions survive refreshes.

**Production refresh cron is on.** `tools/deploy/production/prepare.ts` now emits
`triggers.crons = ['0 */3 * * *']` and includes `eventsRefresh` in the reviewed allowlist;
`scheduled()` enqueues a `refresh-events` job that `refreshOfficialEvents` consumes. It
takes effect at the next milestone deploy. `eventSubmission` stays out of the production
allowlist until `TYPESAFE_API_KEY` is provisioned (so Jev gates spam in production).

## Contract and location behavior

Events have exactly `{id,title,host,start,end,venue,address,lat,lon,approx,url,source,tags}`. Times are UTC ISO strings. Missing host/end/venue/address/coordinates are `null`. Source is `tech-week`, `luma` or `partiful`; IDs come from canonical provider URLs, or the official event UUID when available. Tracking parameters are removed. Deduplication prefers the record with more precise location data and merges tags; different dates or conflicting public addresses survive. IDs are deterministic for the same inputs; when a new provider mirror becomes available, consumers should retain canonical URL aliases if they need identity continuity across sources.

Hidden addresses are never sent to a geocoder. Visible hidden-location notices override structured address/coordinate fields. Those fields are discarded, the venue becomes its public neighborhood, and a repeatable 80–180 m offset is applied to the neighborhood's coarse center. Unknown neighborhoods use an explicitly approximate SF center. Centers are gameplay approximations, not authoritative boundaries. Virtual events and known out-of-SF coordinates have no physical marker. City/neighborhood matches remain `approx: true`.

## Fetch and parse policy

- Cookie-free HTTPS GET only; exact source host/path allowlists apply to every redirect. No authentication, registration, guest-list collection, or private event extraction.
- One request at a time per client, at least one second between requests to an origin. Specific robots groups, wildcard fallback, longest matching Allow/Disallow, wildcard rules, query strings, percent encoding and Crawl-delay are supported.
- robots.txt is checked for every destination origin. 404/410 means no rules; 401/403/429/5xx, transport errors and HTML challenges defer that origin. This conservative policy intentionally does not interpret unavailable robots as permission.
- Bounded retries for 429/5xx use Retry-After or exponential backoff. A long Retry-After defers the origin instead of shortening the wait. Requests time out; redirects, response bytes, queue size and total request count are bounded. The fetcher caches successful pages and robots for 15 minutes in memory. The caller must serialize overlapping scheduled crawls across instances.
- Luma: Event JSON-LD, including `@graph`/ItemList. Partiful: Event JSON-LD or public `__NEXT_DATA__`, then OG metadata. OG start/end extensions and datetime microdata are accepted when present; title/description alone do not imply a date. Official structured detail-page metadata can fill provider gaps. No source JavaScript is executed.
- Cancelled and explicitly private/password-protected events are omitted. Missing/invalid times, inverted ranges, and ambiguous/nonexistent local DST times are rejected and reported. Explicitly zoned times and unambiguous SF local times are normalized.
- Optional Haiku fallback runs only for public Luma/Partiful detail pages missing a usable title/time after structured and inherited metadata are combined. It receives at most 16,000 characters of OG/visible text, never script state, and makes one fixed-endpoint request (15 s, 1,200 output tokens, 32 KiB response); the crawl defaults to at most 25 requests. All returned strings must occur in that text. Dates/times are copied as separate spans and converted in code; a year and clock time are required, absent timezone means SF, and unknown timezone abbreviations fail. Missing fields stay null. Existing structured fields take precedence. The model cannot provide URLs/coordinates or override location privacy. Refusal, truncation, malformed/ungrounded output and transport failure omit incomplete events. This conservative fallback intentionally declines dates outside its supported formats.
- Calendar pagination follows public links; this module does not execute a JavaScript-only “load more” action. A successful HTML crawl alone is not evidence of full city-calendar coverage. The local snapshot refresh uses the official MCP feed separately.

## Fixture provenance and checks

Fixtures are small, hand-authored public-schema examples informed by read-only inspection on **2026-10-02 PT** of:

- https://www.tech-week.com/calendar/sf (table links and `/go/event/` redirects)
- https://www.tech-week.com/calendar/sf/events/marketing-break-a-3pm-networking-event-for-marketers-c27825c2-6848-46f6-ad41-e0fde161fefe (official detail → provider links)
- https://partiful.com/e/jE4ag5QP7d77aS5GJdcc (OG, Event JSON-LD, `__NEXT_DATA__.props.pageProps.event`)
- https://luma.com/ya263roy and https://luma.com/techweekSF (public/hidden venue variants)
- https://luma.com/robots.txt (the fixture mirrors observed Googlebot rules)

Names, URLs, addresses and geocoder replies in fixtures are synthetic test data. `robots-tech-week.txt`, `robots-partiful.txt`, the Luma JSON-LD shape, and OG time extensions are parser test cases, not claimed live captures. Direct Tech Week HTML/robots returned 429 and direct Luma HTML returned 403 during research; raw Luma JSON-LD remains a live-source verification item. Partiful JSON-LD was directly verified. No fixture includes guest data beyond a sentinel used to prove it is not retained.

```sh
nice -n 10 node_modules/.bin/vitest run worker/src/events/crawler.test.ts --maxWorkers=1
nice -n 10 node_modules/.bin/vitest run worker/src/events/extract/haiku.test.ts --maxWorkers=1
nice -n 10 node_modules/.bin/tsc --noEmit -p worker/tsconfig.json
```

Crawler tests forbid live network calls and use a virtual clock. Production cron, a precise geocoding provider, and the Jev implementation remain integration tasks; no G1 or 300-event/90%-precise-geocoding gate is claimed here.
