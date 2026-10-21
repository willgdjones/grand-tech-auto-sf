# Disposable local preview

`startLocalPool()` builds the current Worker with Wrangler's local dry run in a
unique ignored `worker/.wrangler/preview-worker-*` directory. It starts fresh
World, Lobby and Ledger Durable Objects, applies the D1 migrations and seeds the
checked-in event snapshot. Closing the pool removes only its own temporary
bundle and disposable state. Passing `bundlePath` explicitly uses that caller's
bundle and leaves it in place on close.

`startPreview()` serves the existing web build through the project's Vite
configuration, including the local map middleware. The map comes from the
selected source bake (`GTASF_MAP_AREA`, then `tools/map/out/active-map.json`, then
`lombard`), while API calls go to the disposable Worker. An empty disposable R2
bucket does not require fake map responses or copied city assets. A missing
local bake produces the map middleware's explicit 404.

Use the Node version in `.nvmrc` and run checks through the shared heavy wrapper:

```sh
tools/heavy.sh node tools/local-pool/smoke.mjs
```

This single native/HTTP check builds the Worker, exercises the real admission
queue and WebSocket upgrade, verifies seeded events and R2, and checks the map
manifest plus graph, mesh, terrain and collision response sizes. It uses an
ephemeral preview port and closes both servers and the owned Worker bundle.
It needs an existing `web/dist` and local map bake; it does not rebuild the web,
launch a browser, restart `npm run dev`, or establish a visual/performance gate.

For a browser smoke, first use the separately coordinated web build and then
the same preview helper. The default preview port remains 4173; callers can use
`startPreview({ port: 0 })` for an isolated ephemeral port.

`gtasf-local-dev-stack-stale-hfo8`: the old hardcoded
`worker/.wrangler/bootstrap-worker/index.js` default could run stale server code,
and the pool omitted the Lobby binding required by current admission. Both are
repaired. The shared live dev stack was separately checked via its normal
admission flow and protocol HELLO/WELCOME without restarting it.

Verification on 2026-10-04 passed with 23 migrations and 1,596 seeded events:
health 200, real admission admitted, WebSocket 101, R2 read/write, active `sf`
map and Ferry chunk `4_-5` assets with exact manifest byte sizes. Fresh Worker
bundle SHA-256:
`f71555fd07ed5c521cf84b35232cd76d0d1c3cc3691ec244b0da9602435f31ba`.
The smoke also confirmed that close removed its temporary bundle. The shared
dev stack at port 5173 independently admitted a client and returned WELCOME.
