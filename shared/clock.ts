/** Inject into deadline logic. Provider timers derive deadlines from this clock;
 * alarms must re-check those deadlines, rather than relying on elapsed wall time. */
export interface Clock {
  /** Integer epoch milliseconds; wall time may be adjusted. */
  now(): number;
  /** Never decreases within this clock's lifetime; use for durations. */
  monotonicMs(): number;
}
let lastSystemMonotonic = 0;
export const systemClock: Clock = Object.freeze({
  now: () => Date.now(),
  monotonicMs: () => {
    lastSystemMonotonic = Math.max(lastSystemMonotonic, performance.now());
    return lastSystemMonotonic;
  },
});
export function requireClockInteger(value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError('Clock time must be a safe integer');
  return value;
}
export class FakeClock implements Clock {
  private epochMs: number;
  private elapsedMs = 0;
  constructor(
    startEpochMs: number,
    private readonly options: { allowBackwards?: boolean } = {},
  ) {
    this.epochMs = requireClockInteger(startEpochMs);
  }
  now(): number {
    return this.epochMs;
  }
  monotonicMs(): number {
    return this.elapsedMs;
  }
  set(epochMs: number): void {
    requireClockInteger(epochMs);
    if (epochMs < this.epochMs && !this.options.allowBackwards)
      throw new RangeError('Clock cannot move backwards');
    const elapsed = this.elapsedMs + Math.max(0, epochMs - this.epochMs);
    requireClockInteger(elapsed);
    this.elapsedMs = elapsed;
    this.epochMs = epochMs;
  }
  advance(ms: number): void {
    requireClockInteger(ms);
    if (ms < 0) throw new RangeError('Clock advance must be nonnegative');
    this.set(requireClockInteger(this.epochMs + ms));
  }
}
