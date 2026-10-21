# Reviewed deployment web build

MistyHawk owns the production deployment and generates
`worker/.wrangler/production/flags.ts`. Review that module before building, and
use the same absolute module path for the Worker bundler alias.

From the repository root:

```sh
GTASF_FLAGS_FILE=worker/.wrangler/production/flags.ts nice -n 10 npx vite build --config web/vite.staging.config.ts
```

The dedicated config writes `web/dist-production`, leaving local `web/dist`
untouched. It includes the game entry and public assets; map/media serving stays
with the deployment owner's R2 and same-origin routes. It excludes local Vite's
filesystem map middleware. The deployment command must upload
`web/dist-production`, not a prior local build.

Without `GTASF_FLAGS_FILE`, the config uses the existing staging generator's
`worker/.wrangler/staging/flags.ts`. Both relative (repository-root) and absolute
paths work; a missing file fails the build. There is no fallback to enabled local
flags. The presence of a flags file does not approve the selected features or
establish deployment acceptance.

`nice -n 10 npx tsx tools/deploy/web-config-smoke.ts` checks missing-file rejection,
the actual Vite alias resolution, isolated output, and absence of the local map
middleware. It uses a temporary fixture only; it starts no browser and builds no
game bundle. The deployment owner runs the real web dry run after generation.
