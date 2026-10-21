/**
 * Dirty texel rows of one table (§3.5.2 uploads). Writers mark rows; once per frame `flush` reports each
 * maximal run of dirty rows once (overlapping and adjacent marks coalesce) and clears them. A row bitmap
 * keeps marking and flushing allocation-free; tables have at most a few hundred rows.
 */
export class DirtyRows {
  private readonly rows: Uint8Array;
  private count = 0;
  constructor(readonly height: number) {
    if (!Number.isSafeInteger(height) || height < 1) throw new RangeError('DIRTY_ROWS_HEIGHT');
    this.rows = new Uint8Array(height);
  }
  get pending(): boolean {
    return this.count > 0;
  }
  /** Marks rows `first…last` inclusive. */
  mark(first: number, last = first): void {
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(last) ||
      first < 0 ||
      last < first ||
      last >= this.height
    )
      throw new RangeError('DIRTY_ROWS_RANGE');
    for (let row = first; row <= last; row++) {
      if (this.rows[row] === 0) {
        this.rows[row] = 1;
        this.count++;
      }
    }
  }
  markAll(): void {
    this.mark(0, this.height - 1);
  }
  clear(): void {
    this.rows.fill(0);
    this.count = 0;
  }
  /** @hot Calls `run(first, count)` per maximal dirty run in ascending order; returns the number of runs. */
  flush(run: (first: number, count: number) => void): number {
    if (this.count === 0) return 0;
    let runs = 0;
    let start = -1;
    for (let row = 0; row <= this.height; row++) {
      const dirty = row < this.height && this.rows[row] === 1;
      if (dirty && start < 0) start = row;
      else if (!dirty && start >= 0) {
        run(start, row - start);
        runs++;
        start = -1;
      }
    }
    this.clear();
    return runs;
  }
}
