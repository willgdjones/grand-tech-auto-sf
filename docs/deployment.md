# Local runtime and deferred staging

The original E13 scope deferred staging until after the 06:00 PT local playtest. The founder has since assigned a production friends playtest to MistyHawk under `gtasf-isn`; that bead owns its timing, prerequisites and rollout. The staging runbook below remains a separate reference, not deployment evidence. No BDTS resource or credential is used.

The dedicated web build now uses reviewed deployment flags. See [the exact production/staging web command](../tools/deploy/WEB.md). It writes `web/dist-production`; local `web/dist` is not a deployable substitute. The production owner generates its flags and runs the actual build/deployment.

## Local play and disposable pool

Use Node 24.21 or newer. `npm run dev` starts local Wrangler on 8787 and Vite on 5173. The integrator owns the launcher; `node tools/events/seed-local.mjs` applies all local D1 migrations and seeds 1,599 real Tech Week events without a network call. Startup and D1 use `worker/.wrangler/state`, never remote storage. `/api` and `/api/world` share the Vite origin; the claim route also needs the `/claim` proxy once F03 is wired.

`nice -n 10 node tools/local-pool/smoke.mjs` makes one dry-run Worker bundle, starts a disposable workerd/SQLite pool, applies every numbered SQL migration, seeds the snapshot, and checks health, event reads, WebSocket upgrade, and R2. It disposes its runtime on success or failure and never changes persistent dev state. This is a single integration smoke, not a property/performance suite. `tools/preview.mjs` uses the same pool for existing static browser checks, with same-origin `/api`, WebSocket and `/claim` proxying. Static preview still requires a current `web/dist` and `worker/.wrangler/bootstrap-worker/index.js` bundle.

The event snapshot is a local feature guarded by both `flags.localEventSnapshot` and `ENVIRONMENT=local`. All map coordinates are public neighborhood approximations; 1,538 events have physical markers and 61 are virtual. The API returns normalized event fields, never private leads or SQL internals. Production ingestion, Jev, billing, image review and claim email delivery remain disabled until their own acceptance.

## Provider prerequisites — audited 2026-10-03 07:08 UTC

H02 (`gtasf-e5m`) is still incomplete. The audit read only whether the named
values exist in GTASF's ignored `worker/.dev.vars` and the secret names returned
by `wrangler secret list --config worker/wrangler.production.jsonc`. No secret
value was printed and no provider was called.

| Required name | Local GTASF file | Deployed `gtasf-production` |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Absent | Absent |
| `ANTHROPIC_API_KEY` | Absent | Absent |
| `STRIPE_SECRET_KEY` (test mode first) | Absent | Absent |
| `STRIPE_WEBHOOK_SECRET` (matching test endpoint) | Absent | Absent |

The deployed secret list contains only `INVITE_CODE`, `POSTHOG_SECRET_KEY` and
`X_PIXEL_TOKEN`; these do not satisfy the TypeSafe/Anthropic/Stripe prerequisite.
No separately stored live Stripe credential is evidenced in this project. Keep
H02 assigned to the founder until GTASF-specific provisioning is recorded.

The current Outbid adapter accepts `sk_test_` keys and test webhook events only,
requires TypeSafe for checkout, and refuses production payment execution.
Provisioning alone does not enable payment or moderation flags or establish a
provider smoke. Production milestone 2 keeps those flags off; its working
funding game uses fictional earned funding and requires none of these keys.
The separate staging resources below remain unprovisioned.

## Staging inventory

The founder confirmed account **Will**, `YOUR_CLOUDFLARE_ACCOUNT_ID`, and ownership of `gtasf.com`. This account ID is an identifier, not a secret. The source and planned names are in `tools/deploy/staging-resources.json`; `d1.id` remains null until the actual resource exists.

| Component | Planned staging resource |
| --- | --- |
| Static web | Pages project `gtasf-staging`, custom domain `staging.gtasf.com` |
| API / WebSocket | Worker `gtasf-staging`, `/api/*` and `/claim/*` on that same hostname |
| Stateful game / billing | SQLite Durable Objects `WorldDO` / `LedgerDO`, Worker migration `v1` |
| Database | D1 `gtasf-staging` (actual UUID still pending) |
| Map / media | R2 `gtasf-assets-staging` |
| Jobs | Queue `gtasf-jobs-staging` |
| Future schedules | `0 */3 * * *` refresh and `0 8 * * *` pricing, after consumers are ready |

## Post-playtest provisioning and deploy path

These commands are a runbook, not evidence of a deployment. First use `wrangler whoami` to confirm the founder's account, then select it explicitly for remote commands with `CLOUDFLARE_ACCOUNT_ID`. Use the installed `node_modules/.bin/wrangler` CLI. Do not run a bare deploy against `worker/wrangler.toml`: that config is local and contains a placeholder D1 UUID.

1. Create `gtasf-staging` D1 with `wrangler d1 create gtasf-staging --location wnam --update-config=false`, `gtasf-assets-staging` with `wrangler r2 bucket create gtasf-assets-staging`, `gtasf-jobs-staging` with `wrangler queues create gtasf-jobs-staging`, and Pages with `wrangler pages project create gtasf-staging --production-branch main`. Record returned IDs in the inventory/bead; do not invent them. Use existing same-name resources only after checking they belong to this GTASF account/project.
2. Generate the private working config with `node_modules/.bin/tsx tools/deploy/prepare-staging.ts --d1-id <actual UUID>`. It writes only ignored files under `worker/.wrangler/staging/`, pins the confirmed account, and generates an isolated flags module with every switch false. It never provisions, deploys, or copies secrets. Review and deliberately enable only the integrations that passed the playtest. The Worker uses a bundler alias for this flags module. Build the web from the repository root with `GTASF_FLAGS_FILE=worker/.wrangler/staging/flags.ts nice -n 10 npx vite build --config web/vite.staging.config.ts`; this aliases the same reviewed module and fails if it is missing.
3. Dry-run with `wrangler deploy --dry-run --config worker/.wrangler/staging/wrangler.json`. Apply reviewed migrations with `wrangler d1 migrations apply gtasf-staging --remote --config worker/.wrangler/staging/wrangler.json`. D1 schema changes are additive; export/backup before irreversible data migrations. Seed remote event data only through a reviewed import; the local-only snapshot fallback remains off there.
4. H02 remains founder-owned. Set required secrets with interactive `wrangler secret put <NAME> --config worker/.wrangler/staging/wrangler.json`; verify names/presence only using `secret list`. Never paste values into commands, docs, beads or screenshots. Stripe starts in test mode. Features stay off when their required keys or handlers are unavailable.
5. After map/render/assets and flag review, upload the Worker with the explicit staging config and deploy the reviewed `web/dist-production` to Pages via `wrangler pages deploy web/dist-production --project-name gtasf-staging --branch main`. Attach `staging.gtasf.com` to that Pages project in the same account, then verify Worker routes on `/api/*` and `/claim/*`. Root and `/go/<slug>` stay on the SPA; `/api/world` is a same-origin WebSocket upgrade. Do not redirect it cross-origin. Map assets and public resource serving must be configured before the deployment is playable; local Vite's filesystem map route is not a production asset service.
6. Run one deployed smoke: health reports `staging`, event API reports its intended enabled state, migration tables exist, two browser tabs see each other, and WebSocket returns 101. Verify both flags and callable routes, including disabled payment/moderation/claim delivery. Record the Worker version, Pages deployment ID, DB UUID, asset manifest digest and exact smoke evidence. Then turn on only the required schedules with implemented consumers; the generated config intentionally starts with no Cron triggers.

## Rollback

Record the previously healthy Worker version and Pages deployment before each release. Use `wrangler rollback <version-id> --config worker/.wrangler/staging/wrangler.json` for Worker code and restore the previous Pages deployment in the Pages deployment UI. Keep referenced R2 map/media versions so the previous manifest remains valid. Code rollback does not undo D1 migrations, Durable Object schema, data writes, or purchases. Prefer additive schema changes and disable the affected feature first; a destructive database rollback needs an explicit recovery plan and the saved backup. No remote resource is deleted by this local workflow.
