#!/usr/bin/env bash
# Interleaved A/B of the phone firefight gate (tools/_combat-gates.mjs GATES=1, firefight mode) for perf attribution on
# this shared laptop: two local combat stacks from HEAD, side by side — A as built, B with $B_OFF flags turned off (and
# $B_ON turned on) — then the gate in ABBA order, $ROUNDS times, so load drift hits both arms alike. Sequential single
# runs an hour apart are not comparable here (lane B bisect, 2026-10-17). Prints every run and the per-arm means.
#   B_OFF="trafficDrivers twinStick" tools/_laneb-firefight-abba.sh       (≈10 min per run; ROUNDS=1 → 4 runs)
# Both arms share $BASE_OFF/$BASE_ON (default: lane C's prod-off router/minimap flags off, i.e. prod's cadence).
set -u
REAL="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REAL"
B_OFF="${B_OFF:-}" B_ON="${B_ON:-}" ROUNDS="${ROUNDS:-1}" AIMSWEEP="${AIMSWEEP:-0}" MODE="${MODE:-firefight}" # MODE=idle|firefight|stars
BASE_OFF="${BASE_OFF-routerHeadroomBursts minimapTileSwap}" BASE_ON="${BASE_ON-}" # unset = default; set-but-empty = none
OUT="${OUT:-/tmp/gtasf-laneb-abba}"; mkdir -p "$OUT"
FLAGS="${COMBAT_FLAGS:-combat gore weapons serverHits openPvp wanted policePresence sfpdOnFoot policeFire policeBust sfpdLook combatVfx shootingFeel sampledAudio vitalsPickups weaponPoses streetCrimeWanted policeAir}"
[ -z "$B_OFF$B_ON${REF_A:-}${REF_B:-}" ] && { echo "set B_OFF/B_ON (flags arm B differs by) or REF_A/REF_B (commits)"; exit 2; }

setflag() { # snapshot, flag, true|false — fails loudly when the flag line isn't there
  local f="$1/shared/flags.ts"
  grep -qE "^  $2: (true|false)," "$f" || { echo "flag $2 not found in $f"; exit 2; }
  sed -i '' -E "s/^  $2: (true|false),/  $2: $3,/" "$f"
}
stack() { # arm, snapshot, web port, worker port
  local arm="$1" snap="$2" ref="HEAD"
  [ "$arm" = A ] && ref="${REF_A:-HEAD}"; [ "$arm" = B ] && ref="${REF_B:-HEAD}" # REF_A/REF_B: compare two commits (bisects)
  rm -rf "$snap"
  REF="$ref" SNAP="$snap" WEB_PORT="$3" WORKER_PORT="$4" COMBAT_FLAGS="$FLAGS" cpu-guard run -- tools/combat-stack.sh up > "$OUT/stack-$arm.log" 2>&1 \
    || { echo "stack $arm failed (see $OUT/stack-$arm.log)"; exit 1; }
  # PROD_FLAGS=1: every flag = membership in the CURRENT checkout's prepare.ts reviewed set (both arms, so REF_A=<prod
  # sha> runs old code under today's production set, as lane D's #6.42 gate), before BASE/B overrides; B_ON adds the
  # candidate deploy's flags. Source-level rewrite of shared/flags.ts, so workers get the flags too (#6.42 last leg).
  if [ "${PROD_FLAGS:-}" = 1 ]; then python3 - "$snap" "$REAL" <<'PY'
import re, sys
snap, real = sys.argv[1], sys.argv[2]
src = open(f'{real}/tools/deploy/production/prepare.ts').read()
start = src.index('const reviewed = new Set(['); blk = src[start:src.index(']);', start)]
reviewed = set(re.findall(r"'([A-Za-z0-9]+)'", re.sub(r'//[^\n]*', '', blk)))
path = f'{snap}/shared/flags.ts'; out = []
for line in open(path).read().split('\n'):
    out.append(line if re.match(r'^\s*//', line) else re.sub(r'\b([A-Za-z0-9]+):\s*(?:true|false)\b', lambda m: f'{m.group(1)}: {str(m.group(1) in reviewed).lower()}', line))
open(path, 'w').write('\n'.join(out))
print(f'prod flags: {len(reviewed)} reviewed (from {real}) applied to {snap}')
PY
  fi
  for f in $BASE_OFF; do setflag "$snap" "$f" false; done
  for f in $BASE_ON; do setflag "$snap" "$f" true; done
  if [ "$arm" = B ]; then for f in $B_OFF; do setflag "$snap" "$f" false; done; for f in $B_ON; do setflag "$snap" "$f" true; done; fi
  SNAP="$snap" WEB_PORT="$3" WORKER_PORT="$4" tools/combat-stack.sh build >> "$OUT/stack-$arm.log" 2>&1 || { echo "build $arm failed"; exit 1; }
}
down() {
  SNAP=/tmp/gtasf-abba-a WEB_PORT=5391 WORKER_PORT=8991 tools/combat-stack.sh down >/dev/null 2>&1
  SNAP=/tmp/gtasf-abba-b WEB_PORT=5392 WORKER_PORT=8992 tools/combat-stack.sh down >/dev/null 2>&1
}
# Never under tools/heavy.sh: each gate run takes the heavy lock itself, so an outer heavy lock self-deadlocks the
# whole machine's browser lane (2026-10-18 08:00-08:30). heavy-lock.py records its pids in the lock file; refuse if
# one of them is our ancestor.
heavy_pids="$(grep -oE '(helper|child)=[0-9]+' /tmp/gtasf-heavy-v2.lock 2>/dev/null | cut -d= -f2)"
p=$$; while [ -n "$p" ] && [ "$p" -gt 1 ]; do
  for h in $heavy_pids; do [ "$p" = "$h" ] && { echo "Don't run this under tools/heavy.sh — it takes the heavy lock per gate run (self-deadlock). Run it directly."; exit 4; }; done
  p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
done
# One run at a time machine-wide: both arms use fixed snapshots + ports (lanes B and D share this tool, 2026-10-17).
LOCK=/tmp/gtasf-abba.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "ABBA stacks busy: $(cat "$LOCK/owner" 2>/dev/null || echo 'unknown owner') — wait, or remove $LOCK if that process is gone"; exit 3
fi
echo "pid $$ since $(date '+%H:%M') B_OFF='$B_OFF' B_ON='$B_ON'" > "$LOCK/owner"
trap 'down; rm -rf "$LOCK"' EXIT
trap 'exit 143' TERM INT # pkill/Ctrl-C still run the EXIT cleanup (stacks down, lock released), once the in-flight gate run ends
stack A /tmp/gtasf-abba-a 5391 8991
stack B /tmp/gtasf-abba-b 5392 8992
summary="$OUT/SUMMARY.txt"
echo "firefight ABBA @ $(git rev-parse --short HEAD) $(date '+%F %H:%M %Z') A=${REF_A:-HEAD} B=${REF_B:-HEAD} B_OFF='$B_OFF' B_ON='$B_ON' base_off='$BASE_OFF' aimsweep=$AIMSWEEP mode=$MODE time=${GTASF_GATES_TIME:-live}" | tee "$summary"
n=0
for round in $(seq "$ROUNDS"); do
  for arm in A B B A; do
    n=$((n + 1)); port=5391; [ "$arm" = B ] && port=5392
    # Liveness (lane D, 10-18 22:04): wrangler dev can die mid-run (ProxyController, empty Error); every later run of that
    # arm then times out at waitReady (fps=?) and the comparison is wasted. Probe both ports; rebuild the arm once, else abort.
    wport=8991; snapdir=/tmp/gtasf-abba-a; [ "$arm" = B ] && { wport=8992; snapdir=/tmp/gtasf-abba-b; }
    alive() { [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://$1/")" != 000 ]; } # the preview answers on localhost, the worker on 127.0.0.1
    if ! alive "localhost:$port" || ! alive "127.0.0.1:$wport"; then
      echo "arm $arm down before run$n (web $port / worker $wport) — rebuilding its stack" | tee -a "$summary"
      stack "$arm" "$snapdir" "$port" "$wport"
      if ! alive "localhost:$port" || ! alive "127.0.0.1:$wport"; then echo "ABORT: arm $arm still down after a rebuild — see $OUT/stack-$arm.log" | tee -a "$summary"; exit 1; fi
    fi
    load="$(cpu-guard status | sed -E 's/.*load=([0-9.]+).*/\1/')"
    if [ "$MODE" = coldready ]; then # lane C (critic 10-19 07:5x): cold phone READY per arm (9 Mbps / 60 ms / 4x CPU, cold cache)
      cr="$(MBPS=9 RTT=60 BASE="http://localhost:$port" tools/heavy.sh cpu-guard run -- node tools/_phone-cold-ready.mjs 2>&1)"
      echo "$cr" > "$OUT/run$n-$arm-coldready.txt"
      ready="$(echo "$cr" | sed -nE 's/^READY ([0-9.]+) s.*/\1/p')" hidden="$(echo "$cr" | sed -nE 's/^loading card hidden at ([0-9]+) ms.*/\1/p')"
      echo "run$n $arm load=$load ready_s=${ready:-?} card_hidden_ms=${hidden:-?}" | tee -a "$summary"
      continue
    fi
    line="$(GATES=1 GTASF_GATE1_MODE="$MODE" GTASF_GATE1_AIMSWEEP="$AIMSWEEP" GTASF_GATES_URL="http://localhost:$port" \
      GTASF_PERF_OUT="$OUT/run$n-$arm" tools/heavy.sh cpu-guard run -- node tools/_combat-gates.mjs 2>&1 | grep -E 'perf\[[a-z]+\]' | tail -1)"
    fps="$(echo "$line" | sed -nE 's/.*"meanFps":([0-9.]+).*/\1/p')" p95="$(echo "$line" | sed -nE 's/.*"p95Ms":([0-9.]+).*/\1/p')"
    esc="$(echo "$line" | sed -nE 's/.*escalation=(\{[^}]*\}).*/\1/p')"
    echo "run$n $arm load=$load fps=${fps:-?} p95=${p95:-?} $esc" | tee -a "$summary"
    # Both arms failing to produce a reading means HEAD itself doesn't boot (10-17: 'hd is not defined'): stop, say why.
    if [ "$n" -eq 2 ] && [ "$(grep -c 'fps=?' "$summary")" -eq 2 ]; then
      echo "ABORT: no reading from either arm — check $OUT/run1-A/log.txt (HEAD may not boot)" | tee -a "$summary"; exit 1
    fi
  done
done
if [ "$MODE" = coldready ]; then for arm in A B; do
  awk -v a="$arm" '$2==a { split($4,r,"="); split($5,h,"="); if (r[2]!="?") { s+=r[2]; c++ } if (h[2]!="?") { t+=h[2]; d++ } }
    END { if (c) printf "%s mean READY %.1f s  mean card hidden %.1f s  (%d runs)\n", a, s/c, (d ? t/d/1000 : 0), c }' "$summary" | tee -a "$summary.means"
done; exit 0; fi
for arm in A B; do
  awk -v a="$arm" '$2==a { split($4,f,"="); split($5,p,"="); if (f[2]!="?") { s+=f[2]; q+=p[2]; c++ } }
    END { if (c) printf "%s mean fps %.1f  mean p95 %.1f ms  (%d runs)\n", a, s/c, q/c, c }' "$summary" | tee -a "$summary.means"
done
cat "$summary.means" >> "$summary"; rm -f "$summary.means"
