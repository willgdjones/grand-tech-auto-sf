import { spawn } from 'node:child_process';

/** Keep Vite alive through bounded local Worker failures; never treat a lost trip as recovered. */
export function supervise(services, {
  cwd, env = process.env, log = console.error, restartDelays = [500, 1000, 2000],
  stableMs = 60_000, shutdownMs = 2000,
} = {}) {
  const children = new Map(), groups = new Set(), timers = new Set(), failures = new Map();
  let stopping = false, finished = false, stopCode = 0, finish;
  const done = new Promise(resolve => { finish = resolve; });
  const signal = (pid, name) => {
    try { process.kill(process.platform === 'win32' ? pid : -pid, name); }
    catch (error) { if (error.code !== 'ESRCH') log(`GTASF: could not stop child ${pid}: ${error.message}`); }
  };
  function complete() {
    if (finished) return;
    finished = true; finish(stopCode);
  }
  function stop(code = 0) {
    if (stopping) return;
    stopping = true; stopCode = code;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const pid of groups) signal(pid, 'SIGTERM');
    // npm may exit before its descendants. Always finish cleaning the entire owned group.
    const cleanup = setTimeout(() => { for (const pid of groups) signal(pid, 'SIGKILL'); complete(); }, shutdownMs);
    cleanup.unref();
    if (!children.size) { clearTimeout(cleanup); for (const pid of groups) signal(pid, 'SIGKILL'); complete(); }
    else for (const child of children.values()) child.once('close', () => {
      if (!children.size) { clearTimeout(cleanup); for (const pid of groups) signal(pid, 'SIGKILL'); complete(); }
    });
  }
  function launch(service) {
    if (stopping) return;
    const started = Date.now();
    const child = spawn(service.command, service.args ?? [], { cwd, env, stdio: 'inherit', detached: process.platform !== 'win32' });
    children.set(service.name, child);
    if (child.pid) groups.add(child.pid);
    child.once('error', error => { log(`GTASF: ${service.name} could not start: ${error.message}`); stop(1); });
    child.once('exit', (code, exitSignal) => {
      if (child.pid) signal(child.pid, 'SIGTERM');
      if (stopping) return;
      if (!service.restart || exitSignal) {
        log(`GTASF: ${service.name} stopped (${exitSignal ?? code}); stopping local dev.`);
        stop(code || 1); return;
      }
      const count = Date.now() - started >= stableMs ? 0 : failures.get(service.name) ?? 0;
      if (count >= restartDelays.length) {
        log(`GTASF: ${service.name} failed repeatedly; stopping after ${restartDelays.length} restart attempts. Fix the error above and run npm run dev again.`);
        stop(code || 1); return;
      }
      failures.set(service.name, count + 1);
      const delay = restartDelays[count];
      log(`GTASF: ${service.name} exited (${code}); restart ${count + 1}/${restartDelays.length} in ${delay}ms. The web page stays open; any interrupted trip must be started again.`);
      const timer = setTimeout(() => {
        timers.delete(timer);
        // Clear any orphaned descendants before reusing the Worker port.
        if (child.pid) { signal(child.pid, 'SIGKILL'); groups.delete(child.pid); }
        launch(service);
      }, delay);
      timers.add(timer);
    });
    child.once('close', () => { if (children.get(service.name) === child) children.delete(service.name); });
  }
  for (const service of services) launch(service);
  return { stop, done };
}
