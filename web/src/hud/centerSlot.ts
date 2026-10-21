/**
 * One centre-screen slot for the big moments (critic N34, flag centerSlotQueue): MISSION PASSED, the JOB DONE / cheque payout
 * card and RANK UP all fired on the same frame at a mission's end and overprinted into one unreadable block. Each now takes a
 * turn: an item alone keeps its natural duration; with something waiting behind it, it is cut to MIN_MS so the queue moves on.
 * `front` items (the mission band) jump the queue. `pause()` holds the slot (e.g. until the taxi fare has stepped out) and
 * returns a release; held items keep their order. Pure timing — no DOM of its own.
 */
export interface CenterSlotItem {
  show(): void;
  hide(): void;
  /** How long the item stays up when nothing is waiting behind it. */
  naturalMs: number;
  /** Jump the queue (shown next). */
  front?: boolean;
  /** Among waiting items, lower goes first (default 1). The rank-up splash is 2 so the payout card it races (the award
   *  and the rank fetch arrive in either order) still reads first — critic N34 v3: 'card before rank'. */
  order?: number;
}
export interface CenterSlot {
  enqueue(item: CenterSlotItem): void;
  /** Hold the slot; call the returned release (idempotent) to let it continue. */
  pause(): () => void;
  /** Something is on screen in the slot right now. */
  readonly busy: boolean;
}

/** Shortest turn once something is waiting: long enough to read a title and finish a 1.3 s cash count-up. */
export const CENTER_SLOT_MIN_MS = 1400;

export function createCenterSlot(now: () => number = () => performance.now(),
  timers: { set(fn: () => void, ms: number): unknown; clear(id: unknown): void } = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id as ReturnType<typeof setTimeout>) }): CenterSlot {
  const queue: CenterSlotItem[] = [];
  let current: { item: CenterSlotItem; start: number; end: number; timer: unknown } | null = null, paused = 0, kick: unknown = null;
  // Starting from idle waits one tick, so items enqueued together (the payout card and the band arrive in the same handler)
  // are ordered first — the front band then really goes first.
  const kickSoon = () => { if (kick === null) kick = timers.set(() => { kick = null; next(); }, 0); };

  function finish(): void {
    if (!current) return;
    timers.clear(current.timer); const done = current.item; current = null;
    done.hide();
    next();
  }
  function schedule(end: number): void {
    if (!current) return;
    timers.clear(current.timer); current.end = end;
    current.timer = timers.set(finish, Math.max(0, end - now()));
  }
  function next(): void {
    if (current || paused > 0 || queue.length === 0) return;
    const item = queue.shift()!, start = now();
    current = { item, start, end: start, timer: null };
    item.show();
    schedule(start + (queue.length ? Math.min(item.naturalMs, CENTER_SLOT_MIN_MS) : item.naturalMs));
  }
  return {
    enqueue(item) {
      const rank = (i: CenterSlotItem) => i.front ? -Infinity : (i.order ?? 1);
      const at = queue.findIndex(waiting => rank(waiting) > rank(item));
      if (at < 0) queue.push(item); else queue.splice(at, 0, item); // front = -Infinity: still shown next
      if (current) { const cut = current.start + Math.min(current.item.naturalMs, CENTER_SLOT_MIN_MS); if (cut < current.end) schedule(cut); }
      else kickSoon();
    },
    get busy() { return current !== null; },
    pause() {
      paused++; let released = false;
      return () => { if (released) return; released = true; paused--; next(); };
    },
  };
}

/** The game's one slot (shared by the mission band, the funding payout card and the rank-up splash). */
export const centerSlot = createCenterSlot();

/** plazaLabelFade (critic 20f): a 0..1 multiplier for world-space NPC sprite labels — eases to LOW while the slot shows
 *  something (so a centre moment never prints over a plaza label) and back to 1 after. Call once per label per frame. */
const LABEL_FADE_LOW = 0.12, LABEL_FADE_RATE = 8; // per second
let labelFade = 1, labelFadeAt = 0;
export function centerSlotLabelFade(now: number = performance.now()): number {
  const dt = Math.min(0.25, Math.max(0, (now - labelFadeAt) / 1000)); labelFadeAt = now;
  const target = centerSlot.busy ? LABEL_FADE_LOW : 1;
  labelFade += (target - labelFade) * Math.min(1, dt * LABEL_FADE_RATE);
  return labelFade;
}
