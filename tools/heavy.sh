#!/bin/sh
# Serialises heavy checks across the agent swarm so a dozen agents don't run tsc/vitest/builds at once.
#   tools/heavy.sh npx tsc --noEmit -p web/tsconfig.json
#   tools/heavy.sh npx vitest run path/to/file.test.ts
# The kernel lock has no age expiry and remains owned by the running command.
set -eu
heavy_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$heavy_dir/heavy-lock.py" "$@"
