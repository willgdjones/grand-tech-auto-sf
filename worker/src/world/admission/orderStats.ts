/** Ported from BDTS worker/src/lobby/orderStats.ts.
 * R3-051: rank and k-th lookups over the queued tickets' seq values in O(log n), so a poll at 20,000
 * tickets never scans SQLite. A Fenwick tree over `seq − base`; it grows by doubling and is rebuilt
 * compactly when the covered seq range exceeds twice the live count (plus slack).
 */
export class OrderStats {
  private tree = new Int32Array(1024);
  private base = 0;
  private live = new Set<number>();
  private maxSeq = -1;

  get size(): number {
    return this.live.size;
  }

  /** Bytes held by the tree and the live set (a Set entry is costed at 16 bytes). */
  get bytes(): number {
    return this.tree.byteLength + this.live.size * 16;
  }

  has(seq: number): boolean {
    return this.live.has(seq);
  }

  add(seq: number): void {
    if (!Number.isSafeInteger(seq) || seq < 0) throw new RangeError('ORDER_STATS_SEQ');
    if (this.live.has(seq)) return;
    if (this.live.size === 0) {
      this.base = seq;
      this.tree.fill(0);
    }
    if (seq < this.base || seq - this.base + 1 >= this.tree.length) this.rebuild(seq);
    this.live.add(seq);
    this.maxSeq = Math.max(this.maxSeq, seq);
    this.update(seq - this.base + 1, 1);
  }

  delete(seq: number): void {
    if (!this.live.delete(seq)) return;
    this.update(seq - this.base + 1, -1);
    if (this.live.size === 0) {
      this.maxSeq = -1;
      this.tree = new Int32Array(1024);
    } else if (this.maxSeq - this.base + 1 > 2 * this.live.size + 4096) this.rebuild();
  }

  /** Live seqs strictly smaller than `seq`. */
  countBelow(seq: number): number {
    if (this.live.size === 0 || seq <= this.base) return 0;
    let i = Math.min(seq - this.base, this.tree.length - 1);
    let sum = 0;
    for (; i > 0; i -= i & -i) sum += this.tree[i] ?? 0;
    return sum;
  }

  /** 1-based position of a live seq among the live seqs. */
  rank(seq: number): number {
    return this.countBelow(seq) + 1;
  }

  private update(index: number, delta: number): void {
    for (let i = index; i < this.tree.length; i += i & -i) this.tree[i] = (this.tree[i] ?? 0) + delta;
  }

  /** Re-bases at the smallest live seq (or `extra`) and sizes the tree to the live range. */
  private rebuild(extra?: number): void {
    let low = extra ?? Infinity;
    let high = extra ?? -1;
    for (const seq of this.live) {
      low = Math.min(low, seq);
      high = Math.max(high, seq);
    }
    this.base = low;
    let length = 1024;
    while (length <= high - low + 2) length *= 2;
    this.tree = new Int32Array(length);
    for (const seq of this.live) this.update(seq - this.base + 1, 1);
    this.maxSeq = high;
  }
}
