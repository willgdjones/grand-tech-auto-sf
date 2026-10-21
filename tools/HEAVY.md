# Serial heavy checks

`tools/heavy.sh command [arguments...]` runs one GTASF check at a time on this
machine, at `nice -n 15`. Use it for TypeScript, Vitest, builds and map bakes.

The wrapper resolves `heavy-lock.py` beside itself without changing the caller's
working directory, then uses Python 3's Unix `fcntl.flock`.
The persistent `/tmp/gtasf-heavy-v2.lock` file is not an expiring lease. Its age
does not make a live command stale, and no process deletes it on exit. The
kernel releases the lock when the last owning descriptor closes. The child
inherits that descriptor, so killing the helper alone cannot admit a second
check while the first command is still running. SIGINT, SIGTERM and SIGHUP are
forwarded to the command's process group; its exit status is returned.

The file contains diagnostic helper/child PIDs, never command arguments. Do not
remove it to unblock a queue: that would create a second inode and bypass the
kernel lock. If a command really hangs, investigate and stop that owned job.

The `GTASF_HEAVY_LOCK_FILE` override exists for isolated helper checks. Ordinary
project checks must use the default, shared path. Run the process smoke with
`nice -n 15 python3 tools/heavy-lock-smoke.py`; it uses an automatically removed
private temporary directory, two tiny sleeping commands, and no real check lock.

## Migration boundary

The old mkdir-based wrapper can expire a live job after ten minutes and remove
a newer job's lock in its EXIT trap. It does not cooperate with the kernel lock.
Before switching `tools/heavy.sh`, wait for **all legacy wrappers and their
commands** to finish, including queued wrappers. Do not delete any active legacy
lock. Older checkouts must use this current wrapper too; the two versions must
not run heavy work simultaneously.

For `gtasf-vrbo`, helper source and its isolated smoke landed first in `fe4569c`.
The district bake exited at 07:03:57 UTC on 2026-10-04 (Agent Mail 6124).
The remaining legacy route, facade and build wrappers drained before a fresh
process check found no legacy wrappers or map commands. The shared wrapper was
switched at 07:07 UTC without removing either lock. Subsequent cold-load and
phone checks acquired the new kernel lock; other checks waited behind them.

The isolated process smoke passed on 2026-10-04. It aged a live lock by one
hour, killed only its helper while leaving the command alive, verified the
queued command still waited for that child to exit, and checked nice priority,
literal arguments, signal forwarding and the resulting exit status. It did not
touch the active bake/browser locks. Shell syntax validation also passed. The
live-wrapper smoke passed through the default shared kernel lock at 07:23 UTC:
a tiny Python command ran from a temporary caller directory, retained its
literal argument and nice priority, and returned its exact exit status of 23.
The first attempt hit a 60-second queue deadline before its command ran; the
successful attempt waited for the existing browser checks to release the lock.
No compiler, full build or map bake was added for this tooling change.
