#!/usr/bin/env bash
# Lane B (combat & police) regression pass on a local combat stack built from HEAD: one stack with a flag set that covers
# every lane-B check, then each check in turn (browser runs serialized through tools/heavy.sh), a one-line verdict each,
# and the stack torn down. Run before a deploy that carries combat changes:
#   tools/_laneb-regress.sh            (≈25 min; writes to $OUT, default the scratch dir below)
# Checks with a RESULT line pass/fail on their own; look captures (pickups, melee, wanted messages) only save frames —
# open them. Never run the stack itself under heavy.sh (AGENTS.md); only the browser checks.
set -u
REAL="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REAL"
export SNAP="${SNAP:-/tmp/gtasf-laneb-regress}" WEB_PORT="${WEB_PORT:-5391}" WORKER_PORT="${WORKER_PORT:-8991}" # not 5319/8988: other agents tear those down
OUT="${OUT:-/tmp/gtasf-laneb-regress-out}"; mkdir -p "$OUT"
URL="http://localhost:$WEB_PORT"
FLAGS="combat gore weapons serverHits openPvp wanted gunShop storeRobberies policePresence streetCrimeWanted policeFire sfpdOnFoot policeBust sfpdLook combatVfx shootingFeel sampledAudio vitalsPickups weaponPoses pedMelee"
summary="$OUT/SUMMARY.txt"; : > "$summary"
log() { echo "$*" | tee -a "$summary"; }

rm -rf "$SNAP"
COMBAT_FLAGS="$FLAGS" cpu-guard run -- tools/combat-stack.sh up > "$OUT/stack.log" 2>&1 || { log "stack: FAILED to come up (see $OUT/stack.log)"; exit 1; }
trap 'tools/combat-stack.sh down >/dev/null 2>&1; pkill -f "wrangler.js dev --local --port $WORKER_PORT" 2>/dev/null' EXIT
log "lane B regression @ $(git rev-parse --short HEAD) $(date '+%F %H:%M %Z')"

run() { # name, command...
  local name="$1"; shift
  local file="$OUT/$name.log"
  GTASF_URL="$URL" GTASF_QA_URL="$URL" GTASF_GATES_URL="$URL" tools/heavy.sh cpu-guard run -- "$@" > "$file" 2>&1
  local verdict; verdict="$(grep -E '^RESULT|^OK |^FAIL |perf\[firefight\]' "$file" | tail -2 | tr '\n' ' ' | cut -c1-220)"
  [ -z "$verdict" ] && grep -qE '^DONE|page errors 0' "$file" && verdict="captured (look check: open the frames)"
  log "$(printf '%-16s' "$name") ${verdict:-(no verdict line; see $file)}"
}

log "$(printf '%-16s' audio-silence) $(node tools/_audio-silence-audit.mjs | tail -1)"
run twinstick     env OUT="$OUT/twinstick" node tools/_laneb-twinstick-check.mjs
run livery        env OUT="$OUT/livery" node tools/_laneb-livery-check.mjs
run phone-msgs    env OUT="$OUT/phone-msgs" node tools/_laneb-phone-msgs.mjs
run grunts        node tools/_laneb-grunt-check.mjs
run barks         node tools/_laneb-bark-audio-check.mjs
run death-hold    env OUT="$OUT/death-hold" node tools/_laneb-deathhold-check.mjs
run remote-melee  node tools/_laneb-remote-melee-check.mjs
run wake          env OUT="$OUT/wake" node tools/_laneb-wake-check.mjs
run melee-look    env OUT="$OUT/melee-look" node tools/_laneb-melee-look.mjs
run pickup-look   env OUT="$OUT/pickups" node tools/_laneb-pickup-look.mjs
run wanted-look   env OUT="$OUT/wanted-look" node tools/_laneb-wanted-look.mjs
run shoot         env OUT="$OUT/shoot" node tools/qa-founder-repro.mjs shoot
run gate3-18plus  env GATES=3 GTASF_PERF_OUT="$OUT/gate3" node tools/_combat-gates.mjs
run firefight     env GATES=1 GTASF_GATE1_MODE=firefight GTASF_PERF_OUT="$OUT/firefight" node tools/_combat-gates.mjs
run firefight-aim env GATES=1 GTASF_GATE1_MODE=firefight GTASF_GATE1_AIMSWEEP=1 GTASF_PERF_OUT="$OUT/firefight-aim" node tools/_combat-gates.mjs
log "frames: $OUT/{pickups,melee-look,wanted-look,death-hold,twinstick}/*.jpg"
git -C "$REAL" checkout -- docs/sf-data/combat/enable-18gate.png docs/sf-data/combat/enable-18decline.png 2>/dev/null # gate 3 rewrites its tracked evidence
cat "$summary"
