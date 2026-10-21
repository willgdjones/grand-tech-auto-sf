import type { VoiceTrack } from './hearing';

interface Handoff { tracks: readonly VoiceTrack[]; notify: () => void }
interface Pending { latest: Handoff; running?: Promise<void>; retryAt: number }

/** D1 grants are device-scoped. Keep one write in flight and only the latest waiting replacement. */
export class VoiceGrantHandoffs {
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Map<string, Map<number, Handoff>>();
  constructor(private readonly persist: (device: string, tracks: readonly VoiceTrack[]) => Promise<void>) {}

  replace(device: string, listener: number, tracks: readonly VoiceTrack[], notify: () => void): void {
    const listeners = this.listeners.get(device) ?? new Map<number, Handoff>();
    listeners.set(listener, { tracks, notify });
    this.listeners.set(device, listeners);
    this.stage(device);
  }

  remove(device: string, listener: number): void {
    const listeners = this.listeners.get(device);
    listeners?.delete(listener);
    if (!listeners?.size) this.listeners.delete(device);
    this.stage(device);
  }

  private stage(device: string): void {
    // Multiple tabs share a device: removing one must not revoke the remaining tab's tracks.
    const listeners = [...(this.listeners.get(device)?.values() ?? [])];
    const tracks = new Map<string, VoiceTrack>();
    for (const listener of listeners) for (const track of listener.tracks)
      tracks.set(JSON.stringify([track.sessionId, track.trackName]), track);
    const latest = { tracks: [...tracks.values()], notify: () => { for (const listener of listeners) listener.notify(); } };
    const pending = this.pending.get(device);
    if (pending) pending.latest = latest;
    else this.pending.set(device, { latest, retryAt: 0 });
  }

  /** Called by the voice tick (and on disconnect); failures remain pending without a busy retry loop. */
  flush(now = Date.now()): Promise<void>[] {
    const work: Promise<void>[] = [];
    for (const [device, pending] of this.pending) {
      if (pending.running || now < pending.retryAt) continue;
      pending.running = this.drain(device, pending).finally(() => { pending.running = undefined; });
      work.push(pending.running);
    }
    return work;
  }

  private async drain(device: string, pending: Pending): Promise<void> {
    while (this.pending.get(device) === pending) {
      const handoff = pending.latest;
      try { await this.persist(device, handoff.tracks); }
      catch { pending.retryAt = Date.now() + 1_000; return; }
      // A newer set or disconnect arrived during the write: persist it before announcing anything.
      if (pending.latest !== handoff) continue;
      this.pending.delete(device);
      handoff.notify();
    }
  }
}
