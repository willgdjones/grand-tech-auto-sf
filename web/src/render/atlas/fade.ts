import { ATLAS_FADE_MS } from '@gtasf/shared/constants';
import type { AdTables } from '../screens/adTable';

/** Fixed slot storage: slot reuse/revocation cancels a fade before it can alter a different ad. */
export class AtlasFade {
  private readonly started: Float64Array;
  private readonly revisions: Float64Array;
  private readonly identities: Float64Array;
  private readonly seenRevisions: Float64Array;
  private readonly seenIdentities: Float64Array;
  private readonly active: Uint32Array;
  private readonly activeIndex: Int32Array;
  private count = 0;
  constructor(private readonly ads: AdTables) {
    const capacity = ads.flags.data.length;
    this.started = new Float64Array(capacity);
    this.revisions = new Float64Array(capacity);
    this.identities = new Float64Array(capacity);
    this.seenRevisions = new Float64Array(capacity);
    this.seenIdentities = new Float64Array(capacity);
    this.active = new Uint32Array(capacity);
    this.activeIndex = new Int32Array(capacity).fill(-1);
  }

  resident(slot: number, adId: number, revision: number, at: number, restore = false): void {
    if (this.identities[slot] === adId && this.revisions[slot] === revision) return;
    this.cancel(slot);
    this.identities[slot] = adId;
    this.revisions[slot] = revision;
    if (restore && this.seenIdentities[slot] === adId && this.seenRevisions[slot] === revision) {
      this.ads.setFade(slot, 127);
      return;
    }
    this.started[slot] = at;
    this.activeIndex[slot] = this.count;
    this.active[this.count++] = slot;
    this.ads.setFade(slot, 0);
  }
  cancel(slot: number): void {
    const index = this.activeIndex[slot]!;
    if (index >= 0) this.remove(index);
    this.identities[slot] = this.revisions[slot] = 0;
    this.ads.setFade(slot, 0);
  }
  finish(slot: number): void {
    const index = this.activeIndex[slot]!;
    if (index >= 0) this.remove(index);
    this.seenIdentities[slot] = this.identities[slot]!;
    this.seenRevisions[slot] = this.revisions[slot]!;
    this.ads.setFade(slot, 127);
  }
  /** A full ledger install may reuse ids, revisions and slots. */
  reset(): void {
    while (this.count) this.cancel(this.active[this.count - 1]!);
    this.identities.fill(0);
    this.revisions.fill(0);
    this.seenIdentities.fill(0);
    this.seenRevisions.fill(0);
  }
  private remove(index: number): void {
    const slot = this.active[index]!;
    const last = this.active[--this.count]!;
    this.active[index] = last;
    this.activeIndex[last] = index;
    this.activeIndex[slot] = -1;
  }
  /** @hot Called every render frame, including under prefers-reduced-motion. */
  frame(at: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      const slot = this.active[i]!;
      if (!(this.ads.flags.data[slot]! & 1)) {
        this.cancel(slot);
        continue;
      }
      const level = Math.min(
        127,
        Math.max(0, Math.floor(((at - this.started[slot]!) * 127) / ATLAS_FADE_MS)),
      );
      if (this.ads.flags.data[slot]! >>> 1 !== level) this.ads.setFade(slot, level);
      if (level === 127) {
        this.seenIdentities[slot] = this.identities[slot]!;
        this.seenRevisions[slot] = this.revisions[slot]!;
        this.remove(i);
      }
    }
  }
}
