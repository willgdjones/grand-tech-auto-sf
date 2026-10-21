#!/usr/bin/env python3
"""Serialize GTASF checks with a kernel lock retained by the running command."""
import fcntl
import os
import signal
import subprocess
import sys


def main():
    if len(sys.argv) < 2:
        print("Usage: tools/heavy.sh command [arguments...]", file=sys.stderr)
        return 2

    # A separate inode avoids the old wrapper's unconditional directory removal.
    # The override is for isolated lock checks, never for bypassing the shared queue.
    path = os.environ.get("GTASF_HEAVY_LOCK_FILE", "/tmp/gtasf-heavy-v2.lock")
    child = None
    starting = False
    pending_signal = None

    def forward(signum, _frame):
        nonlocal pending_signal
        if child is not None:
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass
        elif starting:
            pending_signal = signum
        else:
            raise SystemExit(128 + signum)

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, forward)

    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+b", buffering=0) as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        # Diagnostic PIDs only: do not write command arguments, which may be secrets.
        lock.seek(0)
        lock.truncate()
        lock.write(f"helper={os.getpid()}\n".encode())
        starting = True
        try:
            child = subprocess.Popen(
                ["nice", "-n", "15", *sys.argv[1:]],
                pass_fds=(descriptor,), start_new_session=True,
            )
        finally:
            starting = False
        lock.write(f"child={child.pid}\n".encode())
        if pending_signal is not None:
            forward(pending_signal, None)
        result = child.wait()
        # Do not unlink or explicitly LOCK_UN. An inherited descriptor must keep
        # the lock held if the helper dies before its command (or child) finishes.
        return result if result >= 0 else 128 - result


if __name__ == "__main__":
    try:
        sys.exit(main())
    except OSError as error:
        print(f"GTASF heavy lock: {error}", file=sys.stderr)
        sys.exit(1)
