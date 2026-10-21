# Verified map publication

`src/pack/publication.ts` reads runtime manifest references plus the three known
gameplay JSON files (playable/compact road graphs and local spawn/routes), verifies decoded
SHA-256 and both byte counts, and verifies that each gzip sibling decodes to the
same bytes. Cache/source downloads and unrelated output files are excluded.
It rejects path escapes, unknown file types and files above 25 MB.
Verified gzip bytes are copied into a release-specific local snapshot so a new
map bake cannot alter an upload already in progress.

```sh
tools/map/node_modules/.bin/tsx tools/map/src/pack/publication.ts
```

The ignored `out/publication-lombard/publication.json` inventories exact encoded
and decoded bytes, MIME, encoding and cache metadata. All assets use the immutable
`map/releases/<release-sha256>/` prefix, hashing source manifest plus gameplay
artifact identities. The generated manifest points to
those absolute same-origin paths; its stable `map/lombard/manifest.json` alias is
the final upload. A partial upload leaves the previous release intact.

After actual GTASF resources exist, the explicit upload command is:

```sh
tools/map/node_modules/.bin/tsx tools/map/src/pack/publication.ts --upload --config=/absolute/path/to/worker/.wrangler/staging/wrangler.json
# Production uses an explicit target and its own reviewed JSONC config:
NODE_TLS_REJECT_UNAUTHORIZED=1 tools/map/node_modules/.bin/tsx tools/map/src/pack/publication.ts --upload --target=production --config=/absolute/path/to/worker/wrangler.production.jsonc
```

Omit `--upload` to validate the config and prepare files without remote writes.
It checks the configured account, environment and ASSETS bucket against the
confirmed GTASF account and staging/production bucket. The default uploader uses
one S3 HTTPS connection pool with 16 concurrent objects and an R2 Object Read &
Write token (`R2_S3_ACCESS_KEY_ID` / `R2_S3_SECRET_ACCESS_KEY`). It rechecks each
snapshot file hash, then sends a signed HEAD for immutable
`map/releases/<64-hex-release>/…` keys. An existing object is counted as already
uploaded; a 404 proceeds to PUT. Only content-addressed release keys can be
skipped. The stable manifest alias is always PUT after every release object has
succeeded, so rerunning an interrupted publication resumes that exact release.

HEAD and PUT each allow three attempts, with 500 ms then 1 s backoff, for transient
network errors, TLS bad-record-MAC failures, HTTP 5xx, 408 and 429. Each attempt has
a 30-second deadline. Other HTTP failures (including authentication/permissions)
and certificate errors fail immediately. Exhausted release-object failures stop
new work and drain in-flight requests without attempting the alias. The pool
closes on both success and failure, including a failed final alias PUT. No TLS
verification is disabled. The optional `--via-wrangler` fallback retains its
separate bounded child-process upload path; these resume/retry changes apply to
the default S3 uploader only.

No upload runs without `--upload`. Local inventory evidence is not
evidence of remote provisioning, availability or G1 acceptance.

The deploy/index owner must wire `serveMapAsset(request, env.ASSETS)` from
`worker/src/map/assets.ts` before the ordinary API/SPA fallback, returning its
non-null response, and route `/map/*` on the same staging hostname to that Worker.
Enable the reviewed `mapStreaming` switch in both staging flag aliases. The helper
allows only known public map paths, supports GET/HEAD and conditional responses,
and serves gzip or streams identity decoding according to Accept-Encoding.
Existing stable roadgraph/gameplay URLs redirect through the current manifest
to immutable release objects, keeping the radar's playable graph available.
It cannot serve ad uploads or arbitrary bucket keys. Public media needs its own
reviewed handler. Retain old immutable release prefixes for rollback.

The Ferry–Lombard publication prepared on October 2 PT contains 319 objects,
20,777,165 gzip bytes and 44,523,480 decoded bytes, including both graph variants
and both manifest objects. Its release is
`49589095a1db8864483051fa63e8922c70c47335c8177a56772e113e0294f188`.
`node tools/map/publication-smoke.mjs` passed on local workerd/R2: manifest gzip
and identity delivery, playable-graph alias, decoded GLB, HEAD, conditional 304,
invalid paths and method rejection. Evidence is under
`out/publication-lombard/smoke.json`. This is the corridor payload, not a complete
city budget or remote deployment claim.

After the manifest-last upload and Worker route deployment, run one public HTTP
check against the production origin:

```sh
NODE_TLS_REJECT_UNAUTHORIZED=1 node tools/map/publication-remote-smoke.mjs https://gtasf.com
```

It enforces HTTPS certificate verification and compares the served manifest to
the exact local publication. It checks gzip and identity delivery, all four
gameplay/neighbourhood aliases, Ferry and Lombard GLB/heightfield hashes and
headers, HEAD and conditional 304. Each response is bounded by the 25 MB file
limit and a 20-second timeout. Evidence is saved as
`out/publication-lombard/remote-<hostname>.json`, with encoded body-transfer bytes
separate from decoded bytes; HTTP headers are not counted in those byte totals.
This verifies public asset delivery, not a full browser cold-load trace or G1.

On October 2, 2026 PT (October 3 06:04 UTC), the explicit production upload
completed with exit 0 and all 319 objects acknowledged by Wrangler. The stable
manifest was the final object. TLS certificate verification was enabled.

The live Worker origin `https://gtasf-production.YOUR-SUBDOMAIN.workers.dev` passed all
18 public HTTP checks against this exact release: both manifest representations,
four stable aliases and their decoded JSON hashes, Ferry/Lombard GLB and terrain
hashes, and HEAD/304 semantics. Evidence is
`out/publication-lombard/remote-gtasf-production.YOUR-SUBDOMAIN.workers.dev.json`; the
upload log is `out/production-map-upload.log`. These results establish the
production R2 map delivery portion of `gtasf-isn.1`. Custom-domain DNS and the
complete invited browser playtest remain owned by the parent deployment bead.
