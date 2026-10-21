import { systemClock } from '@gtasf/shared/clock';
import type { Clock } from '@gtasf/shared/clock';

/** M6.11b supplies a synchronised implementation through this exact interface. */
export interface NetworkClock {
  monotonicMs(): number;
  localMonotonicEpochMs(): number;
  serverNow(): number;
  welcome(serverEpochMs: number): void;
  pong(serverEpochMs: number, sentAtMono: number, receivedAtMono: number): void;
  /** A PONG the socket could not match (unknown nonce or a mismatched clientT32 echo); counted by M6.11b. */
  rejectPong?(reason: 'nonce' | 'echo'): void;
  reset(): void;
}

export function provisionalClock(clock: Clock = systemClock): NetworkClock {
  const localEpoch = clock.now() - clock.monotonicMs();
  let serverEpoch: number | undefined;
  return {
    monotonicMs: () => clock.monotonicMs(),
    localMonotonicEpochMs: () => localEpoch + clock.monotonicMs(),
    serverNow: () => (serverEpoch ?? localEpoch) + clock.monotonicMs(),
    welcome(epoch) {
      serverEpoch = epoch - clock.monotonicMs();
    },
    pong(epoch, sent, received) {
      serverEpoch = epoch + Math.max(0, received - sent) / 2 - received;
    },
    // Keep the last estimate until the next sample; never fall back to a skewed local wall clock.
    reset() {},
  };
}
