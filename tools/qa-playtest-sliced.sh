#!/usr/bin/env bash
# LANE E: the prod playtest in short slices, each its own tools/heavy.sh hold (~<=3 min, orchestrator rule 2026-10-14)
# so deploys and other panes' jobs interleave. Every slice is a fresh is_bot device; slices that need a funded/founded
# device repeat load+found (cheap). Usage: tools/qa-playtest-sliced.sh [desktop|phone|both] [outdir]
set -u
cd "$(dirname "$0")/.."
which=${1:-both}; day=$(TZ=America/Los_Angeles date +%F)
out=${2:-docs/qa/$day/run-$(TZ=America/Los_Angeles date +%H%M)-sliced}
SLICES=(
  "ladder:load,found,pitch,seed,job"
  "trial:load,found,weapon,timetrial"
  "crime:load,found,weapon,crime,escape"
  "shop:load,found,pitch,seed,chequereload,gunshop,loadoutreload"
  "pilgrim:load,found,pilgrimage"
)
cf0=$(tools/qa-cf-incidents.sh)
profiles=(desktop phone); [ "$which" = desktop ] && profiles=(desktop); [ "$which" = phone ] && profiles=(phone)
fails=0
for p in "${profiles[@]}"; do
  for slice in "${SLICES[@]}"; do
    name=${slice%%:*}; steps=${slice#*:}
    log="$out/$p-$name.log"; mkdir -p "$out"
    PROFILES=$p STEPS=$steps OUT="$out/$p-$name" tools/heavy.sh cpu-guard run -- node tools/qa-prod-playtest.mjs >"$log" 2>&1
    res=$(grep -E "^\[$p\] (PASS|FAIL)" "$log" | grep -v " load \| found " | sed "s/^\[$p\] //" | tr '\n' ';')
    if grep -q "^\[$p\] FAIL" "$log"; then fails=$((fails + 1)); echo "FAIL  $p/$name: $res"; else echo "PASS  $p/$name: $res"; fi
    grep -h "world socket closes" "$log" | sed 's/^/      /'
  done
done
echo "sliced playtest → $out ($fails failing slices) · start $cf0 · end $(tools/qa-cf-incidents.sh)"
exit $((fails > 0))
