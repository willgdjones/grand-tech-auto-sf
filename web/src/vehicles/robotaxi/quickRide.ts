import { flags } from '@gtasf/shared/flags';
import type { S2CMessage } from '@gtasf/shared/protocol/types';
import './quickRide.css';

/** The server owns relocation. This overlay only preloads and conceals the cut. */
export function createQuickRide(options: { load(point: { x: number; z: number }): Promise<void>; ready(): boolean; onCut(): void }) {
  const root = document.createElement('section'); root.className = 'gt-quick-ride'; root.hidden = true;
  root.setAttribute('role', 'status'); root.setAttribute('aria-live', 'polite');
  const title = document.createElement('h1'), status = document.createElement('p'), skip = document.createElement('button');
  skip.textContent = 'Skip ride'; skip.type = 'button'; root.append(title, status, skip); document.body.append(root);
  let generation = 0, loaded = false, arrived = false, sent = false, started = 0, duration = 4000;
  let skipRequested = false, nextReadyAttempt = 0;
  let point: { x: number; z: number } | undefined;
  let seen = false; try { seen = localStorage.getItem('gtasf.quickRideSeen') === '1'; } catch { /* session fallback */ }
  function finish() {
    if (!arrived || !loaded || (!sent && performance.now() - started < duration)) return;
    point = undefined; seen = true; document.body.classList.remove('gt-jumping');
    try { localStorage.setItem('gtasf.quickRideSeen', '1'); } catch { /* session fallback */ }
    options.onCut();
    // eventRideArrival (critic N19): fade up from black at the drop instead of cutting straight to it.
    if (flags.eventRideArrival) {
      root.classList.add('gt-quick-black', 'gt-quick-fadein'); const fading = generation;
      setTimeout(() => { if (generation === fading) { root.hidden = true; root.classList.remove('gt-quick-fadein'); } }, 650);
    } else root.hidden = true;
  }
  function advance(skipping = false) {
    if (root.hidden || root.classList.contains('gt-quick-fadein')) return; // the arrival fade owns the overlay until it ends
    const elapsed = performance.now() - started;
    // eventRideArrival (critic N19): once the relocation is requested, stay black so the cut happens under black and the
    // arrival fade reveals the drop (robotaxiJump otherwise stripped the black every tick and the cut showed).
    root.classList.toggle('gt-quick-black', (!flags.robotaxiJump && (elapsed >= 1000 || sent)) || (flags.eventRideArrival && sent));
    skip.hidden = !seen; skip.disabled = !loaded;
    status.textContent = !loaded && elapsed >= 1000 ? 'Loading your destination…' : seen ? 'Press any key to skip once loaded' : 'Sit back. On your next ride, you can skip.';
    if (skipping && seen && loaded) skipRequested = true;
    if (loaded && !arrived && !sent && elapsed >= nextReadyAttempt && (elapsed >= duration || skipRequested)) {
      root.classList.add('gt-quick-black'); sent = options.ready(); nextReadyAttempt = elapsed + (flags.robotaxiJump ? 150 : 500);
    }
    finish();
  }
  function key(event: KeyboardEvent) {
    if (root.hidden || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) advance(true);
  }
  window.addEventListener('keydown', key, true); skip.onclick = () => advance(true);
  const timer = setInterval(() => advance(), 50);
  return {
    get active() { return !root.hidden; },
    get destination() { return performance.now() - started >= 1000 ? point : undefined; },
    start(message: Extract<S2CMessage, { type: 'ROBOTAXI_STATE' }>) {
      if (!flags.quickRobotaxi || !message.quick) return;
      const current = ++generation; loaded = arrived = sent = false; started = performance.now(); root.classList.remove('gt-quick-fadein');
      // robotaxiJump (gtasf-stc2): a 1.2 s lift-and-blur jump instead of the 4 s ride card; preload starts at once.
      // eventRideDrive (critic N19c): ~2.6 s of driving in the robotaxi replaces the lift-and-blur before the black cut.
      const jump = flags.robotaxiJump, drive = jump && flags.eventRideDrive; duration = drive ? 2600 : jump ? 1200 : message.quick.durationMs || 4000;
      root.classList.toggle('gt-quick-jump', jump); document.body.classList.toggle('gt-jumping', jump && !drive);
      skipRequested = false; nextReadyAttempt = 0;
      point = { x: message.destination.x / 100, z: message.destination.z / 100 };
      title.textContent = message.quick.title.toUpperCase(); root.classList.remove('gt-quick-black'); root.hidden = false;
      advance();
      const destination = point;
      const load = () => options.load(destination).then(() => { if (generation === current) { loaded = true; advance(); } }).catch(() => {
        if (generation === current && !root.hidden) setTimeout(() => { if (generation === current) void load(); }, 1000);
      });
      setTimeout(() => { if (generation === current) void load(); }, jump ? 0 : 1000);
    },
    end(success: boolean) {
      if (root.hidden) return;
      if (success) { arrived = true; advance(); }
      else { generation++; root.hidden = true; point = undefined; document.body.classList.remove('gt-jumping'); }
    },
    destroy() { generation++; clearInterval(timer); window.removeEventListener('keydown', key, true); root.remove(); },
  };
}
