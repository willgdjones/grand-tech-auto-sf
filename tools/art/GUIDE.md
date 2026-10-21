# Scenario 2D art

Founder authorization: maximum **10,000 CU / $100 total and 3,000 generations** for GTASF.
USD/count guards are required in ignored `tools/art/.env`; `maxCredits` is required
in `budget.json`. All three are read before every paid submission. Environment
`SCENARIO_MAX_CREDITS` can lower the credit cap. Hard-coded maxima also enforce
10,000 CU / $100 / 3,000 calls even if a config is accidentally raised.
Credentials remain in that file; no credentials or signed CDN URLs enter outputs.
No auto-refill, purchase, model training, 3D, real people or real logos.

Run with Node 24 from the repository root:

```sh
node --import tsx tools/art/cli.ts quote tools/art/recipes/facades.json victorian-a
node --import tsx tools/art/cli.ts generate tools/art/recipes/facades.json victorian-a
node --import tsx tools/art/cli.ts status
```

`quote` is Scenario's free `dryRun=true` request. Each paid call reserves a ledger
entry atomically before submission and includes cost headroom. One image per
generation, <=1 MP, only the explicitly allowed FLUX.1 Schnell, FLUX.1 Dev or
FLUX.1.1 Pro 2D models. Select `model` in a recipe; always quote first. Dev uses
28 steps/guidance 3.5. Pro is square-only here because its documented API chooses
aspect ratio, not exact pixels. No reference-image input is accepted. Model IDs
and parameter contract: [official BFL API guide](https://docs.scenario.com/get-started/generation/third-party-model-generation/third-party-model-generation-bfl).
Identical
model/prompt/settings resume the old job or use its SHA-verified local PNG. Failed
downloads never regenerate. No paid POST retries. A request without a confirmed
job ID freezes further paid submissions until reconciled with the provider.
Concurrent processes share a directory lock; a crash leaves the lock in place
rather than guessing that its reservation can be discarded.

## Credit accounting

[Scenario plans](https://www.scenario.com/pricing) checked 2026-10-03:
Starter $15/1500 CU, Pro $45/5000 CU, Max $75/10000 CU. The budget uses the
highest published rate, **$0.01/CU**, also confirmed against USD prepaid packs
from [`GET /oscu/prices`](https://docs.scenario.com/api/resources/oscu/methods/retrieve_prices)
before each new submission. This is a conservative dollar equivalent, **not an
account invoice**; discounts/free credits never increase the allowance. The
account usage endpoint showed zero consumption in the prior hour before the first
test. The API does not expose the account's subscription balance in its published
reference, so this tool does not invent an account-specific plan or balance.

`ledger.json` stores each prompt/model/settings/output, quoted credits, reserved
credits, job ID and actual `job.billing.cuCost` plus any add-on fees. Unknown costs
remain reserved; failed jobs are conservatively counted before refunds. Running
`totals.actualCredits`, `pendingReservedCredits`, `budgetCountedCredits`,
`actualUsd`, `pendingReservedUsd`, `budgetCountedUsd` and
generation count are recomputed from entries, never trusted from stored totals.
Malformed pricing/cost data fails closed. The dry-run headroom is retained for
unfinished jobs; provider final actual charges replace it. A provider overcharge
cannot be undone by this client; any budget overspend refuses all later requests.

Generated assets are reviewed before being selected into `web/public/art/manifest.json`.
The first priorities are facade textures and SF loading artwork. Atlas packing,
quantization and compression are deterministic local work and consume no credits.
Recipe seeds distinguish candidates; use two candidates only where review needs
an alternative. Do not pay for repeated cache hits.

The implementation ports budget/resume ideas from the founder's
`factory-core/scripts/assets/provider.py`; no art was copied from that project.
