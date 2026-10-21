#!/usr/bin/env bash
# LANE E: one post-deploy QA pass against prod, heavy steps one at a time under cpu-guard. Prints a PASS/FAIL line per
# check and leaves details in docs/qa/<PT day>/. Usage: tools/qa-post-deploy.sh [quick]   (quick = no browsers)
# Every browser step goes through tools/heavy.sh (machine-wide serial lock) wrapping cpu-guard (load gate).
set -u
cd "$(dirname "$0")/.."
day=$(TZ=America/Los_Angeles date +%F); out="docs/qa/$day/post-deploy-$(TZ=America/Los_Angeles date +%H%M)"; mkdir -p "$out"
ok() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; }
run() { local name=$1; shift; if "$@" > "$out/$name.log" 2>&1; then ok "$name"; else bad "$name: $(grep -h "^BAD" "$out/$name.log" | tr "\n" ";" | cut -c1-200) (see $out/$name.log)"; fi; }

echo "post-deploy QA → $(curl -s https://gtasf.com/api/health | grep -o '"ok":[a-z]*') · $out"
tools/qa-cf-incidents.sh  # tag failures during a Cloudflare incident
run journey   node tools/prod-journey-check.mjs
run chunks    node tools/qa-prod-chunks.mjs
[ "${1:-}" = quick ] && exit 0
run reconnect-while-wanted env WANTED=1 tools/heavy.sh cpu-guard run -- node tools/_qa-ws-probe.mjs
grep -q "reload-while-wanted: READY+connected=true" "$out/reconnect-while-wanted.log" || bad "reconnect-while-wanted: no READY after reload"
run taxi-fares tools/heavy.sh cpu-guard run -- node tools/_qa-taxi-quote-probe.mjs
grep -q "FREE\|\\$" "$out/taxi-fares.log" || bad "taxi-fares: no fare in the picker"
checks="cars shoot robotaxi pit crash policedeath"
curl -s https://gtasf.com/api/health | grep -q '"personalCar":true' && checks="$checks personalcar" || echo "SKIP  founder-personalcar (personalCar off in prod)"
for c in $checks; do run "founder-$c" env OUT="$out/founder-$c" tools/heavy.sh cpu-guard run -- node tools/qa-founder-repro.mjs "$c"; done  # one short hold each
# Flag-gated money/opening paths: lane C's verifiers against prod (is_bot), only once the flag is live in /api/health.
flagon() { curl -s https://gtasf.com/api/health | grep -q "\"$1\":true"; }
gated() { local flag=$1 name=$2 script=$3; if ! flagon "$flag"; then echo "SKIP  $name ($flag off in prod)"; return; fi
  env GTASF_VERIFY_URL=https://gtasf.com OUT="$out/$name" tools/heavy.sh cpu-guard run -- node "$script" > "$out/$name.log" 2>&1
  if grep -q "^RESULT: .*PASS" "$out/$name.log"; then ok "$name"; else bad "$name: $(grep -h '^RESULT' "$out/$name.log" | cut -c1-200) (see $out/$name.log)"; fi; }
gated taxiFareJob taxi-fare tools/taxi-fare-verify.mjs
gated openingDrive opening-drive tools/opening-drive-verify.mjs
run playtest tools/qa-playtest-sliced.sh both "$out/playtest"  # ~3-min heavy.sh slices
grep -E "^(PASS|FAIL)" "$out/playtest.log" | sed 's/^/      /'
