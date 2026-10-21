#!/usr/bin/env python3
"""One isolated two-command smoke; never touches the machine's real heavy lock."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time


def wait_for(predicate, message, timeout=10):
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError(message)
        time.sleep(0.02)


CHILD = r"""
import json, os, signal, sys, time
from pathlib import Path
root, name, argument = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
def stop(signum, _frame):
    (root / 'signal').write_text(str(signum))
    sys.exit(23)
signal.signal(signal.SIGTERM, stop)
(root / (name + '.start')).write_text(json.dumps({
    'pid': os.getpid(), 'nice': os.getpriority(os.PRIO_PROCESS, 0),
    'argument': argument, 'at': time.monotonic_ns(),
}))
while not (root / 'release').exists() or name == 'second':
    time.sleep(0.02)
(root / 'first.end').write_text(str(time.monotonic_ns()))
"""


def main():
    helper = Path(__file__).with_name("heavy-lock.py")
    processes = []
    children = []
    with tempfile.TemporaryDirectory(prefix="gtasf-heavy-smoke-") as directory:
        root = Path(directory)
        lock = root / "isolated.lock"
        environment = {**os.environ, "GTASF_HEAVY_LOCK_FILE": str(lock)}
        argument = "literal space $() ' argument"
        try:
            def start(name):
                process = subprocess.Popen(
                    [sys.executable, str(helper), sys.executable, "-c", CHILD,
                     str(root), name, argument], env=environment,
                )
                processes.append(process)
                return process

            first = start("first")
            wait_for((root / "first.start").exists, "first command did not start")
            initial = json.loads((root / "first.start").read_text())
            children.append(initial["pid"])
            assert initial["nice"] >= 15 and initial["argument"] == argument
            old = time.time() - 3600
            os.utime(lock, (old, old))
            second = start("second")
            time.sleep(0.25)
            assert not (root / "second.start").exists(), "old live lock was bypassed"

            # The command must retain its inherited lock after the helper dies.
            first.kill()
            first.wait(timeout=5)
            time.sleep(0.25)
            assert not (root / "second.start").exists(), "helper death released a live command"
            (root / "release").touch()
            wait_for((root / "second.start").exists, "second command stayed blocked")
            following = json.loads((root / "second.start").read_text())
            children.append(following["pid"])
            assert following["at"] > int((root / "first.end").read_text())
            assert following["nice"] >= 15 and following["argument"] == argument

            # SIGTERM reaches the command, and its explicit status is preserved.
            second.terminate()
            assert second.wait(timeout=5) == 23
            assert (root / "signal").read_text() == str(signal.SIGTERM)
            assert lock.is_file(), "the persistent lock inode must never be unlinked"
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
            for pid in children:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
    print("PASS: old/live lock, queued order, inherited lock, nice15, literal args, signal and exit status")


if __name__ == "__main__":
    main()
