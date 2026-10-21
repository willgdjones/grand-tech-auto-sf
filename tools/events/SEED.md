# Canonical Tech Week D1 seed (gtasf-e3r)

This is an **offline artifact generator**, not a crawler or a deployment command. It reads the checked-in public source snapshot, validates its event contract, and writes deterministic SQL plus a provenance manifest. The deploy owner executes the remote import separately against the reviewed GTASF D1 binding.

```sh
npx tsx tools/events/export-seed.ts
```

Outputs, ignored by Git:

- `artifacts/events-seed/sf-tech-week.sql`
- `artifacts/events-seed/manifest.json`

Optional `--out-dir DIRECTORY` changes only the artifact directory. No credentials or network calls are used. The local `npm run dev` seed now uses the same exporter with a temporary directory and explicitly local Wrangler commands.

## Reviewed snapshot

| Field | Value |
|---|---|
| Source | `https://www.tech-week.com/api/mcp` |
| Captured at | `2026-10-03T03:56:52.352Z` |
| Source/canonical rows | **1,599** |
| Located rows | **1,538** |
| Approximate rows | **1,599** (including 61 without a map coordinate) |
| Source SHA-256 | `9b5882df013a12f1d2b8b64a248adfbf0d0bfa93318afc443d6490697b28ebb8` |
| SQL SHA-256 | `cfeddace076cab89c0d7da9db569d9fc7c62cd09ac30f7b896e7fca8445f4467` |
| SQL bytes | **1,567,652** |

Keep the source snapshot and generated manifest together in deploy evidence. If the snapshot changes, regenerate and review the new counts/hashes. No private venue address is invented; the approximate marker field remains explicit. Events with no physical location remain available to the events list without a driving destination.

## Import handoff — deploy owner only

First choose the reviewed generated Worker config for the target environment. **Do not use `worker/wrangler.toml` for a remote import**: it is the local config with a placeholder database ID. The commands below use the target's existing `DB` binding, avoiding a guessed database name or any creation of resources. Replace the config path with the exact config already selected by the deploy owner.

```sh
GTASF_TARGET_CONFIG=/absolute/path/to/reviewed/gtasf-target.jsonc
npx wrangler d1 migrations apply DB --remote --config "$GTASF_TARGET_CONFIG"
npx wrangler d1 execute DB --remote --config "$GTASF_TARGET_CONFIG" --file artifacts/events-seed/sf-tech-week.sql
npx wrangler d1 execute DB --remote --config "$GTASF_TARGET_CONFIG" --command "SELECT COUNT(*) AS total, SUM(lat IS NOT NULL AND lon IS NOT NULL) AS located, SUM(approximate != 0) AS approximate FROM events;"
```

The seed requires the `events` table from `0001_initial.sql` plus columns added by `0002_events.sql`. Apply the target's reviewed migration set before importing. Each statement upserts by event ID; importing the same artifact twice does not add duplicates. A row with a later `updated_at` is retained. There is no deletion or replacement of the database, and interrupted imports can safely be retried.

On a fresh target, expect 1,599 total, 1,538 located, 1,599 approximate. An existing target can contain additional/newer events; do not delete them to force those counts. Verify a sample ID and the canonical source timestamp as well as the totals.

## API and flags

The production API must serve `GET /api/events` as `{ events, enabled: true, dataSource: 'd1' }`. Event fields stay `start`, `end`, `approx` and `lat`/`lon` (not the SQL column names). The local snapshot fallback only works when `ENVIRONMENT=local` and must not be enabled by falsifying production's environment.

At this handoff, `flags.events` gates both the API and the scheduled refresh producer. Serving seeded rows needs a dedicated read-API switch or an equivalent coordinated split; **do not turn on the crawler just to serve the imported feed**. Pane 1/Bronze own this narrow split; Misty owns deploying it. Neither this exporter nor the smoke changes flags, starts a crawler or performs remote D1 operations.

One smoke in `worker/src/events/seed.test.ts` applies the actual migrations, imports the complete artifact twice, calls the production `eventsResponse` path, checks all rows/shape, and confirms an older seed cannot overwrite a newer correction. It is local schema/API evidence, not proof that the remote database was seeded.
