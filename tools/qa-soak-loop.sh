#!/usr/bin/env bash
# LANE E: N armed 3-min soak slices; after each, send every ws close (wall-clock stamped) to pane 0.2.
cd /Users/USER/Documents/GTASF
S=${OUTDIR:-docs/qa/$(TZ=America/Los_Angeles date +%F)/soak}; mkdir -p "$S"
run=$(date +%H%M); tools/qa-cf-incidents.sh
for i in $(seq 1 "${N:-6}"); do
  log="$S/soakloop-$run-$i.log"
  if [ $((i % 2)) -eq 0 ] && [ -z "${UNARMED:-}" ] && [ -z "${VIA_ALT:-}" ]; then extra="RESPAWN=stay"; else extra="NONE=1"; fi
  [ -n "${VIA_RESPAWN:-}" ] && extra="RESPAWN=stay"  # VIA_ALT + every slice fights SFPD to a real server respawn
  # VIA_ALT=1 (gtasf-j7wvv proxy A/B): odd slices pipe the world socket back through gtasf.com (Pages), even ones
  # straight to the worker on workers.dev; both via the same Node pipe in _qa-ws-soak.mjs.
  # H2_ALT=1: odd slices run Chromium with --disable-http2 (NOH2), even ones default (HTTP/2 allowed).
  if [ -n "${H2_ALT:-}" ]; then if [ $((i % 2)) -eq 1 ]; then export NOH2=1; else unset NOH2; fi; fi
  if [ -n "${VIA_ALT:-}" ]; then if [ $((i % 2)) -eq 1 ]; then export WS_VIA=pages; else export WS_VIA=direct; fi; fi
  if [ "$extra" = "RESPAWN=stay" ]; then set -- AT=37.796823,-122.398323,90; else set -- NOAT=1; fi
  combat="COMBAT=1"; [ -n "${UNARMED:-}" ] && combat="COMBAT=0"  # UNARMED=1: control run (no shots, no stars)
  env "$combat" MINUTES=3 "$extra" "$@" tools/heavy.sh cpu-guard run -- node tools/_qa-ws-soak.mjs >> "$log" 2>&1
  closes=$(grep "ws closed" "$log" | sed -E 's/.*code=([0-9]+).* at ([0-9T:.-]+Z).*/\1@\2/' | tr '\n' ' ')
  died=$(grep -c "respawn detected" "$log")
  fin=$(date +%H:%M:%S)
  mode="armed"; [ -n "${UNARMED:-}" ] && mode="UNARMED"; [ "$extra" = "RESPAWN=stay" ] && mode="armed, RESPAWN=stay"
  [ -n "${WS_VIA:-}" ] && mode="$mode, via $WS_VIA"
  [ -n "${NOH2:-}" ] && mode="$mode, NOH2"
  if [ -n "$closes" ]; then msg="Lane E soak $i ($mode) ended $fin PT: CLOSES code@UTC: $closes (respawns $died). Log: $log"
  else msg="Lane E soak $i ($mode) ended $fin PT: 0 closes (respawns $died)."; fi
  echo "$msg"
  tmux send-keys -t GTASF:0.2 "$msg" Enter
done
