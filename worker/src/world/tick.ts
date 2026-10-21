import { TICK_HZ } from '@gtasf/shared/constants';

/** The sole simulation timer. No peer owns a timer; the snapshot owner fences re-entrancy. */
export class WorldTick {
  private manual = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    private readonly counts: () => number,
    private readonly tick: () => void,
    private readonly environment?: string,
  ) {}
  get running(): boolean {
    return this.timer !== undefined;
  }
  ensureTicking(): void {
    if (!this.manual && this.timer === undefined && this.counts() > 0)
      this.timer = setInterval(this.tick, 1000 / TICK_HZ);
  }
  maybeStopTicking(): void {
    if (this.timer !== undefined && this.counts() === 0) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
