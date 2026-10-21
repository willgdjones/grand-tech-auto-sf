#!/bin/bash
# Stand up (or tear down) an isolated, COMBAT-FLAGS-ON production stack for perf / in-game evidence work.
#
# Why: combat ships flag-OFF (not in tools/deploy/production/prepare.ts), and tools/phone-perf.mjs's local pool
# worker also reads shared/flags.ts combat-off, so neither renders the combat HUD / spawns SFPD. This builds a
# throwaway git-archive snapshot, flips the combat flags true in the SNAPSHOT's shared/flags.ts ONLY (never
# touches your checkout), remaps ports, applies local D1 migrations, prod-builds, and serves:
#   • wrangler dev --local on $WORKER_PORT (combat-on worker: server hits, SFPD, robbery money paths)
#   • vite preview on $WEB_PORT  (prod bundle; /api proxied to the worker)
# Then point tools/_combat-gates.mjs (or any Playwright harness) at http://localhost:$WEB_PORT.
#
# Usage:
#   tools/combat-stack.sh up      # create snapshot, migrate, build, start worker + preview, wait for health
#   tools/combat-stack.sh down    # kill this stack's worker + preview, remove the snapshot
#   tools/combat-stack.sh build   # rebuild the prod bundle in an existing snapshot (after editing it)
#
# Env (defaults): WEB_PORT=5374  WORKER_PORT=8987  SNAP=/tmp/gtasf-combat-gates
#   COMBAT_FLAGS="combat gore weapons serverHits openPvp wanted gunShop carjacking storeRobberies ragdollAudio economyV3"
# To test a flag-off attribution variant, edit $SNAP/shared/flags.ts then re-run `build`.
#
# NOTE: this serves a snapshot of HEAD — commit your changes first, or `cp` edited files into $SNAP/<ws>/ then
# `build`. Always `down` when finished (the worker + preview + workerd keep running otherwise). Only kills its
# OWN processes (by the ports it owns); other agents' local stacks on other ports are left alone.
set -uo pipefail
REAL="$(cd "$(dirname "$0")/.." && pwd)"
SNAP="${SNAP:-/tmp/gtasf-combat-gates}"
WEB_PORT="${WEB_PORT:-5374}"
WORKER_PORT="${WORKER_PORT:-8987}"
COMBAT_FLAGS="${COMBAT_FLAGS:-combat gore weapons serverHits openPvp wanted gunShop carjacking storeRobberies ragdollAudio economyV3}"
VITE="$REAL/node_modules/vite/bin/vite.js"
WRANGLER="$REAL/node_modules/wrangler/bin/wrangler.js"

die() { echo "combat-stack: $*" >&2; exit 1; }

cmd_build() {
  [ -d "$SNAP/web" ] || die "no snapshot at $SNAP — run 'up' first"
  echo "== prod build =="
  cpu-guard run -- node "$VITE" build "$SNAP/web" --config "$SNAP/web/vite.config.ts" || die "vite build failed (dist is stale)"
  [ -f "$SNAP/web/dist/index.html" ] || die "build produced no dist"
  echo "build OK"
}

# The worker's road graph comes from R2 (map/lombard/manifest.json -> map/releases/<sha>/roadgraph.bin). A local stack's R2
# is empty, so WorldDO keeps its EMBEDDED Ferry-corridor graph: police park at its edge, kerb thefts / garage deliveries /
# road-snap spawns off the corridor fail 'no-road' (10-20: chase gates at the Vallejo garage and the SoMa heist were invalid
# until lane E seeded the city graph). Seed it before the worker starts when a local roadpack-v1 build is present.
# CITY_ROADS=0 keeps the corridor; CITY_ROADGRAPH=<file> picks another build.
seed_city_roads() {
  local bin="${CITY_ROADGRAPH:-$REAL/tools/map/out/local-city-roadgraph/roadgraph.bin}"
  if [ "${CITY_ROADS:-1}" = 0 ] || [ ! -f "$bin" ]; then echo "== road graph: embedded Ferry corridor (no city graph seeded) =="; return; fi
  local sha bytes manifest
  sha=$(shasum -a 256 "$bin" | cut -d' ' -f1); bytes=$(stat -f %z "$bin" 2>/dev/null || stat -c %s "$bin")
  manifest="$SNAP/worker/.city-manifest.json"
  printf '{"version":1,"roadGraph":{"path":"/map/releases/%s/roadgraph.bin","encoding":"roadpack-v1","bytes":%s,"sha256":"%s"}}' "$sha" "$bytes" "$sha" > "$manifest"
  echo "== road graph: seeding the city graph into local R2 ($sha) =="
  ( cd "$SNAP/worker" && CI=1 node "$WRANGLER" r2 object put "gtasf-assets-local/map/releases/$sha/roadgraph.bin" --file "$bin" --local --persist-to .wrangler/state </dev/null >/tmp/combat-stack-seed.log 2>&1 \
    && CI=1 node "$WRANGLER" r2 object put "gtasf-assets-local/map/lombard/manifest.json" --file "$manifest" --content-type application/json --local --persist-to .wrangler/state </dev/null >>/tmp/combat-stack-seed.log 2>&1 ) \
    || echo "   (seed failed, see /tmp/combat-stack-seed.log: the stack runs on the corridor graph)"
}

cmd_up() {
  echo "== fresh snapshot from HEAD -> $SNAP =="
  rm -rf "$SNAP"; mkdir -p "$SNAP/node_modules/@gtasf"
  git -C "$REAL" archive "${REF:-HEAD}" | tar -x -C "$SNAP"   # REF=<commit> builds an older tree (perf bisects, 2026-10-18)
  echo "== symlink node_modules (all except @gtasf) + @gtasf workspaces + map out =="
  for d in "$REAL"/node_modules/*; do n=$(basename "$d"); [ "$n" = "@gtasf" ] && continue; ln -sfn "$d" "$SNAP/node_modules/$n"; done
  for ws in shared web worker tools; do ln -sfn "$SNAP/$ws" "$SNAP/node_modules/@gtasf/$ws"; done
  rm -rf "$SNAP/tools/map/out"; ln -sfn "$REAL/tools/map/out" "$SNAP/tools/map/out"
  echo "== flip combat flags true in the snapshot ($COMBAT_FLAGS) =="
  COMBAT_FLAGS="$COMBAT_FLAGS" OFF_FLAGS="${OFF_FLAGS:-}" python3 - "$SNAP/shared/flags.ts" <<'PY'
import os,re,sys
p=sys.argv[1]; s=open(p).read()
for f in os.environ["COMBAT_FLAGS"].split():
    s=re.sub(rf'(\n  {f}:\s*)false,', rf'\g<1>true,', s, count=1)
for f in os.environ.get("OFF_FLAGS", "").split():  # OFF_FLAGS: flip these true -> false (the 'off' arm of an A/B)
    s=re.sub(rf'(\n  {f}:\s*)true,', rf'\g<1>false,', s, count=1)
open(p,'w').write(s)
PY
  echo "== remap ports (server->$WEB_PORT dev, preview $WEB_PORT, /api->$WORKER_PORT) =="
  WEB_PORT="$WEB_PORT" WORKER_PORT="$WORKER_PORT" python3 - "$SNAP/web/vite.config.ts" <<'PY'
import os,re,sys
p=sys.argv[1]; s=open(p).read(); w=os.environ["WEB_PORT"]; k=os.environ["WORKER_PORT"]
old="  server: { port: 5173, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },"
new=(f"  server: {{ port: {w}, strictPort: true, proxy: {{ '/api': {{ target: 'http://127.0.0.1:{k}', ws: true }} }} }},\n"
     f"  preview: {{ port: {w}, strictPort: true, proxy: {{ '/api': {{ target: 'http://127.0.0.1:{k}', ws: true }} }} }},")
assert old in s, "vite.config server line not found verbatim (did it change?)"
open(p,'w').write(s.replace(old,new))
PY
  echo "== D1 migrations (local) =="
  # CI=1 + no stdin: wrangler must never wait on its "Ok to proceed?" prompt (two runs hung here for 3 days, 10-17 -> 10-20).
  ( cd "$SNAP/worker" && CI=1 node "$WRANGLER" d1 migrations apply gtasf-local --local </dev/null >/tmp/combat-stack-migrate.log 2>&1 ) || die "migrations failed (see /tmp/combat-stack-migrate.log)"
  seed_city_roads
  cmd_build
  echo "== start worker (:$WORKER_PORT) =="
  # 3>&- / 9>&-: never hand an inherited lock fd (tools/heavy.sh flock on fd 3, other wrappers) to the long-lived daemons,
  # or they keep the machine-wide heavy lock after the run ends and stall every pane (lane D report, 2026-10-14).
  # Supervised: wrangler dev can die mid-run (ProxyController 'Error inside ProxyWorker', empty Error — lane D 10-18 22:04,
  # lane B 23:36), which silently killed every later run on that stack. Restart it until 'down' removes the pid file.
  ( cd "$SNAP/worker" || exit 1
    while :; do
      node "$WRANGLER" dev --local --port "$WORKER_PORT" >>"$SNAP/worker.log" 2>&1
      code=$?; [ -f "$SNAP/worker.supervisor.pid" ] || break
      echo "== $(date +%T) wrangler dev exited ($code); combat-stack restarting it" >>"$SNAP/worker.log"; sleep 2
    done ) 3>&- 9>&- &
  echo $! > "$SNAP/worker.supervisor.pid"
  echo "== start preview (:$WEB_PORT) =="
  node "$VITE" preview "$SNAP/web" --config "$SNAP/web/vite.config.ts" >"$SNAP/preview.log" 2>&1 3>&- 9>&- &
  echo "== wait for health =="
  for i in $(seq 1 40); do
    curl -s -o /dev/null "http://localhost:$WORKER_PORT" 2>/dev/null
    api=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$WEB_PORT/api/health" 2>/dev/null)
    web=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$WEB_PORT/" 2>/dev/null)
    [ "$web" = "200" ] && [ "$api" = "200" ] && break
    sleep 3
  done
  echo "combat-stack UP: web http://localhost:$WEB_PORT (api $api, web $web) | worker :$WORKER_PORT"
  echo "  run a harness:  GTASF_GATES_URL=http://localhost:$WEB_PORT node tools/_combat-gates.mjs"
  echo "  tear down:      tools/combat-stack.sh down"
}

cmd_down() {
  # Stop the worker supervisor first, or it would restart wrangler as soon as the port holder is killed.
  if [ -f "$SNAP/worker.supervisor.pid" ]; then sup=$(cat "$SNAP/worker.supervisor.pid"); rm -f "$SNAP/worker.supervisor.pid"; kill "$sup" 2>/dev/null; fi
  for port in "$WEB_PORT" "$WORKER_PORT"; do
    for pid in $(lsof -ti tcp:"$port" 2>/dev/null); do
      ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
      kill "$pid" 2>/dev/null && echo "killed :$port ($pid)"
      # wrangler's workerd child outlives the port-holder; take its parent too
      [ -n "$ppid" ] && kill "$ppid" 2>/dev/null
    done
  done
  sleep 2
  for port in "$WEB_PORT" "$WORKER_PORT"; do for pid in $(lsof -ti tcp:"$port" 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done; done
  rm -rf "$SNAP" && echo "removed snapshot $SNAP"
  echo "combat-stack DOWN"
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  build) cmd_build ;;
  *) echo "usage: tools/combat-stack.sh {up|down|build}"; exit 2 ;;
esac
