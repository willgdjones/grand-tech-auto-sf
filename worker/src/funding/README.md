# Authoritative event markers

Funding and event chat resolve the same source event against WorldDO's active
road map. When the immutable city graph key/hash is configured, both use its
indexed lane lookup after the blocking R2 load. Without a city graph they retain
the local corridor. An event must have finite coordinates and a road strictly
less than 150 m away. Marker height comes from that road; approximate venue
labels remain attached to the original event.

The resolver is the fifth optional constructor argument of WorldFunding and
WorldChat. It preserves the funding identity callback and chat moderation
arguments. Both consumers keep their existing event/anchor caches, on-foot
requirement, 8 m room radius and 4 m height check. Existing fundingLoop, chat
and eventChat flags still gate the entry points. This fixes map selection and
does not enable an integration or change reward values.

The original local audit is recorded in
`artifacts/city-funding-anchor/audit.json`: the cached TokenTechWalk event in
Golden Gate Park returned no corridor anchor, while active city graph
`5763c53debed013a7f5403a467bd829f45dacfdfb83dc9c5c19e5555fe91651f`
has Middle Drive West lane `lane:aza` 33.403 m away at 58.03 m elevation.

Scoped checks:

```sh
nice -n 10 npx vitest run worker/src/funding/anchors.test.ts --maxWorkers=1
nice -n 10 npx vitest run --config worker/src/funding/city-anchors.config.ts --maxWorkers=1
nice -n 10 npx tsc --noEmit -p worker/tsconfig.json
```

The native Worker scenario uses disposable D1/SQLite/R2 with the cached real
event and a bounded source-road specimen. It exercises the configured R2 graph
load, public funding event/start routes, WebSocket event-chat membership and
outside/upper-floor rejection. It does not mutate the running city, advance
time or establish deployment/device acceptance.

On 2026-10-03 at 11:15–11:17 UTC, the original Worker reproduced HTTP 400 for
the Golden Gate Park event despite loading the configured road specimen. The
fixed scenario passed in 585 ms: HTTP 200, the 58.03 m road height, approximate
label, funding start and event chat, with both horizontal and upper-floor
outsiders excluded. Both anchor unit cases and strict Worker types passed.
Receipts are in `artifacts/city-funding-anchor/2026-10-03T1115/`.

The existing native local Worker on port 8787 also reproduced HTTP 400 before
the patch and returned HTTP 200 with that exact anchor afterward at 11:21 UTC.
`native-before.json` and `native-after.json` retain the public event responses;
no credentials, player poses or clock overrides were recorded. Strict Worker
types passed again in the shared checkout after applying the patch.
