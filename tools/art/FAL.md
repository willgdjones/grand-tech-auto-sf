# fal queue helper

Run with Node 24 (Node 22.18+ also supports the shared TypeScript ledger import):

```sh
node tools/art/fal.mjs budget
node tools/art/fal.mjs run tools/art/my-recipe.json
node tools/art/fal.mjs resume <ledger-id>
```

The ignored `tools/art/.env` supplies `FAL_KEY` and `FAL_MAX_USD`. The USD cap is
the lowest of the file cap, an optional process cap, and the founder's $50 hard
ceiling. Process settings can lower the cap, never raise it. Do not print the key,
include it in recipes, or pass it on the command line.

A recipe runs one model request and downloads one selected result:

```json
{
  "model": "fal-ai/flux/dev",
  "input": {
    "prompt": "Seamless worn San Francisco concrete pavement albedo, orthographic, even diffuse lighting, no objects, words or logos",
    "image_size": { "width": 512, "height": 512 },
    "num_images": 1,
    "seed": 80401,
    "output_format": "png"
  },
  "estimatedUsd": 0.05,
  "output": "tools/assets/cache/fal/pavement.png"
}
```

Read the model's current schema and pricing before setting `estimatedUsd`; include
all images/megapixels/seconds and conservative headroom. It must be a positive,
finite USD estimate. This is an estimate guard, not a fal invoice or an account
spending limit. External calls that bypass this helper cannot be counted.

`resultPath` optionally selects a dotted result field, for example `images.0.url`
or `model_mesh.url`. By default it selects the first `images` URL, `image.url`,
`video.url`, or `audio.url`. Outputs must be under `web/public/art/` or the ignored
`tools/assets/cache/`. Keep generated masters/composites at most 1 MP; use explicit
model dimensions. The generic downloader bounds files to 25 MB; the consuming
asset pipeline must enforce decoded dimensions and compression before shipping.

The shared `ledger.json.lock` serializes the cap check and reservation before POST.
`provider: "fal"` rows use USD-denominated ledger units (`usdPerCredit: 1`), record
the prompt/input, estimate, request ID, queue URLs, output hash and byte size.
Existing Scenario records are preserved. Failed/ambiguous and completed calls all
retain their full estimate in the cap; `actualCredits` stays absent because no bill
was received. Shared ledger totals therefore label these as reservations.

Re-running an identical model/input reuses the ledger job and completed file.
An interrupted poll/download resumes without another POST. An ambiguous POST has
no automatic retry and blocks new paid work until reconciled with fal. Do not
delete its ledger row or reset the ledger to regain budget. A timed-out poll leaves
the server job running. No raw provider bodies, logs, signed download URLs or
credentials are printed. Only queue.fal.run receives authorization; CDN fetches
receive none. TLS verification is forced on by the CLI.

References checked October 4, 2026:
- [fal queue REST API](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [Flux dev input schema](https://fal.ai/models/fal-ai/flux/dev/api)
- [Flux dev pricing](https://fal.ai/models/fal-ai/flux/dev): $0.025 per rounded-up megapixel at review time; verify again for later batches.

One regression file (`tools/art/fal.test.ts`) exercises shared-budget races,
pending reservations, cache reuse, secret-free ledger/error handling and resume
after download failure using unpaid fetch fixtures.
