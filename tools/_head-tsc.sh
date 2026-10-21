#!/usr/bin/env bash
# Typecheck exactly what a commit contains — a clean `git archive` of REF (default HEAD), not the shared working tree.
# On this checkout other panes' uncommitted edits make a working-tree tsc pass while HEAD is broken: three misplaced
# zero-context hunks reached main on 2026-10-17 (806b289d, bbcd3a7b, 6bb35fad), each green locally. Run after a
# partial-hunk commit:   tools/_head-tsc.sh [ref]     (~1-2 min; node_modules are symlinked, nothing is installed)
set -euo pipefail
REAL="$(cd "$(dirname "$0")/.." && pwd)"; REF="${1:-HEAD}"
T="$(mktemp -d /tmp/gtasf-head-tsc.XXXXXX)"; trap 'rm -rf "$T"' EXIT
git -C "$REAL" archive "$REF" | tar -x -C "$T"
for d in node_modules web/node_modules shared/node_modules worker/node_modules tools/map/node_modules; do
  [ -d "$REAL/$d" ] && ln -s "$REAL/$d" "$T/$d"
done
status=0
for ws in shared web worker; do
  if out="$(cd "$T" && nice -n 10 npx tsc --noEmit -p "$ws/tsconfig.json" 2>&1)"; then echo "$ws: OK"
  else echo "$ws: FAIL"; echo "$out" | head -10; status=1; fi
done
echo "$(git -C "$REAL" rev-parse --short "$REF"): $([ $status = 0 ] && echo 'typechecks clean' || echo 'BROKEN')"
exit $status
