import { CLOCK_RTT_MAX_MS, CLOCK_SLEW_MS_PER_S, CLOCK_SNAP_THRESHOLD_MS } from '@gtasf/shared/constants';
import { systemClock } from '@gtasf/shared/clock';
import type { Clock } from '@gtasf/shared/clock';
import { unwrapT32 } from '@gtasf/shared/protocol/time';
import type { NetworkClock } from './provisionalClock';

/**
 * M6.11b synchronised world time (§4.7, R3-056). Every duration uses the monotonic clock; wall time is read
 * once, only to label PINGs. `serverNow() = mono() + applied`, where `applied` targets the offset of the
 * minimum-RTT sample among the last 8 PONGs: the first sample after a resync snaps, later moves slew at
 * ≤ 5 ms/s (so `serverNow()` never runs backwards), and a target more than 250 ms away is a discontinuity.
 * Minimum RTT reduces jitter but does not prove symmetric delay, so `uncertaintyMs()` reports minRTT/2 and
 * is never assumed smaller.
 */
export type DiscontinuityReason = 'jump' | 'reconnect' | 'foreground' | 'suspend';
export interface Discontinuity {
  readonly deltaMs: number;
  readonly reason: DiscontinuityReason;
}
/** `nonce` and `echo` are detected by the socket (M6.11a); `rtt` and `epoch` here. */
export type PongReject = 'nonce' | 'echo' | 'rtt' | 'epoch';
export interface SyncedClock extends NetworkClock {
  isSynced(): boolean;
  uncertaintyMs(): number;
  /** Median of the available accepted samples, retaining at most the most recent eight RTTs. */
  medianRttMs(): number | undefined;
  toServerT(t32: number): number;
  onDiscontinuity(listener: (event: Discontinuity) => void): () => void;
  /** Called at least once per rendered frame: detects suspends (a > 5 s gap while visible) and slews. */
  observe(): void;
  rejectPong(reason: PongReject): void;
  /** `net.clock_rejects` by reason. */
  readonly rejects: Readonly<Record<PongReject, number>>;
  /** Perf overlay and tests: offsets relate the monotonic clock to server epoch ms. */
  diagnostics(): { applied: number | undefined; target: number; samples: { rtt: number; offset: number }[] };
  dispose(): void;
}

const SAMPLES = 8;
const SUSPEND_GAP_MS = 5_000;

export function createSyncedClock(
  options: { clock?: Clock; visibility?: { target: EventTarget; visible(): boolean } } = {},
): SyncedClock {
  const clock = options.clock ?? systemClock;
  const mono = () => clock.monotonicMs();
  // Wall time only anchors the provisional estimate and PING labels; it is never used for durations.
  const localEpochOffset = clock.now() - mono();
  const offsets = new Float64Array(SAMPLES);
  const rtts = new Float64Array(SAMPLES);
  const sortedRtts = new Float64Array(SAMPLES);
  let count = 0;
  let head = 0;
  let provisional: number | undefined;
  // applied = anchor + adjust: the anchor is set when the estimate snaps; the slew accumulates in the
  // small `adjust`, so the ≤ 5 ms/s bound holds exactly instead of drifting at epoch-scale float precision.
  let anchor: number | undefined;
  let adjust = 0;
  const applied = () => (anchor === undefined ? undefined : anchor + adjust);
  const snap = (value: number) => {
    anchor = value;
    adjust = 0;
  };
  let target = 0;
  let synced = false;
  let lastUpdate = mono();
  let lastObserved: number | undefined;
  const rejects: Record<PongReject, number> = { nonce: 0, echo: 0, rtt: 0, epoch: 0 };
  const listeners = new Set<(event: Discontinuity) => void>();
  const visibility =
    options.visibility ??
    (typeof document === 'undefined'
      ? undefined
      : { target: document, visible: () => document.visibilityState === 'visible' });

  const emit = (event: Discontinuity) => {
    for (const listener of [...listeners]) listener(event);
  };
  /** Treat the next accepted PONG as a first sample (snap), drop old samples, notify consumers. */
  function resync(reason: DiscontinuityReason): void {
    synced = false;
    count = head = 0;
    emit({ deltaMs: 0, reason });
  }
  function slew(now: number): void {
    if (synced && anchor !== undefined) {
      const step = (CLOCK_SLEW_MS_PER_S * Math.max(0, now - lastUpdate)) / 1000;
      adjust += Math.max(-step, Math.min(step, target - anchor - adjust));
    }
    lastUpdate = now;
  }
  function observeAt(now: number): void {
    if (lastObserved !== undefined && now - lastObserved > SUSPEND_GAP_MS && (visibility?.visible() ?? true))
      resync('suspend');
    lastObserved = now;
    slew(now);
  }
  const offset = () => applied() ?? provisional ?? localEpochOffset;
  /** Discontinuity: snap to the triggering sample and keep only it (older samples are another timeline). */
  function jump(sample: number, rtt: number): void {
    const deltaMs = sample - applied()!;
    offsets[0] = sample;
    rtts[0] = rtt;
    count = 1;
    head = 1 % SAMPLES;
    target = sample;
    snap(sample);
    lastUpdate = mono();
    emit({ deltaMs, reason: 'jump' });
  }
  const onVisibility = () => {
    if (visibility?.visible()) resync('foreground');
  };
  visibility?.target.addEventListener('visibilitychange', onVisibility);

  const api: SyncedClock = {
    rejects,
    monotonicMs: mono,
    localMonotonicEpochMs: () => localEpochOffset + mono(),
    serverNow() {
      const now = mono();
      observeAt(now);
      return now + offset();
    },
    observe: () => observeAt(mono()),
    isSynced: () => synced,
    uncertaintyMs() {
      if (!synced || count === 0) return Number.POSITIVE_INFINITY;
      let minRtt = Number.POSITIVE_INFINITY;
      for (let i = 0; i < count; i++) minRtt = Math.min(minRtt, rtts[i]!);
      return minRtt / 2;
    },
    medianRttMs() {
      if (count === 0) return undefined;
      for (let i = 0; i < count; i++) {
        const value = rtts[i]!;
        let at = i;
        while (at > 0 && sortedRtts[at - 1]! > value) {
          sortedRtts[at] = sortedRtts[at - 1]!;
          at--;
        }
        sortedRtts[at] = value;
      }
      const middle = Math.floor(count / 2);
      return count % 2 ? sortedRtts[middle]! : (sortedRtts[middle - 1]! + sortedRtts[middle]!) / 2;
    },
    toServerT: (t32) => unwrapT32(t32, Math.round(api.serverNow())),
    onDiscontinuity(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    rejectPong(reason) {
      rejects[reason]++;
    },
    welcome(serverEpochMs) {
      // Provisional until the first PONG: the one-way delay is unknown. After the socket's reconnect
      // `reset()` the old estimate may belong to another timeline, so WELCOME replaces it.
      if (!Number.isSafeInteger(serverEpochMs)) return;
      provisional = serverEpochMs - mono();
      if (!synced) anchor = undefined;
    },
    pong(serverEpochMs, sentAtMono, receivedAtMono) {
      if (!Number.isSafeInteger(serverEpochMs)) {
        rejects.epoch++;
        return;
      }
      const rtt = receivedAtMono - sentAtMono;
      if (!Number.isFinite(rtt) || rtt < 0 || rtt > CLOCK_RTT_MAX_MS) {
        rejects.rtt++;
        return;
      }
      const sample = serverEpochMs + rtt / 2 - receivedAtMono;
      const now = mono();
      if (synced) {
        // Slew under the old target up to now, before this sample can move it.
        slew(now);
        // A sample outside the current estimate by more than 250 ms plus both uncertainties proves the
        // timeline moved (for example a 60 s suspend with a frozen monotonic clock), even when older
        // samples still win on RTT.
        if (Math.abs(sample - applied()!) > CLOCK_SNAP_THRESHOLD_MS + rtt / 2 + api.uncertaintyMs()) {
          jump(sample, rtt);
          return;
        }
      }
      offsets[head] = sample;
      rtts[head] = rtt;
      head = (head + 1) % SAMPLES;
      count = Math.min(SAMPLES, count + 1);
      let best = 0;
      for (let i = 1; i < count; i++) if (rtts[i]! < rtts[best]!) best = i;
      target = offsets[best]!;
      if (!synced) {
        snap(target);
        synced = true;
        lastUpdate = now;
        return;
      }
      if (Math.abs(target - applied()!) > CLOCK_SNAP_THRESHOLD_MS) jump(sample, rtt);
    },
    // The socket calls this on WELCOME and on a resumed identity change: a reconnect resync.
    reset: () => resync('reconnect'),
    diagnostics: () => ({
      applied: applied(),
      target,
      samples: Array.from({ length: count }, (_, i) => ({ rtt: rtts[i]!, offset: offsets[i]! })),
    }),
    dispose() {
      visibility?.target.removeEventListener('visibilitychange', onVisibility);
      listeners.clear();
    },
  };
  return api;
}
