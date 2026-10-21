import {
  BITMAP_CACHE_BYTES,
  type MemoryLedger,
  checkMemoryBytes,
  textureBytes,
  type MemoryHandle,
} from '../../perf/memoryLedger';

export interface BitmapKey {
  surfaceId: number;
  version: number;
  t: number;
}
export interface ClosableBitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}
export interface BorrowedBitmap<B extends ClosableBitmap> {
  readonly bitmap: B;
  readonly generation: number;
  readonly signal: AbortSignal;
  /** Check immediately before upload, and again after any asynchronous decode/readback. */
  isValid(): boolean;
  release(): void;
}
interface Entry<B extends ClosableBitmap> {
  key: BitmapKey;
  id: string;
  bitmap: B;
  bytes: number;
  handle: MemoryHandle;
  borrowers: number;
  generation: number;
  eligible: boolean;
  revoked: boolean;
  closed: boolean;
  controller: AbortController;
}
export interface BitmapCacheOptions {
  device: 'desktop' | 'mobile';
  ledger: MemoryLedger;
  /** May lower the device cap, never raise it. */
  capacityBytes?: number;
  /** The owner supplies current ad eligibility; revoked/non-LIVE versions cannot be readmitted. */
  isLive: (key: Readonly<BitmapKey>) => boolean;
}
function keyId(key: BitmapKey): string {
  checkMemoryBytes(key.surfaceId);
  checkMemoryBytes(key.version);
  checkMemoryBytes(key.t);
  if (key.t === 0) throw new RangeError('INVALID_BITMAP_TIER');
  return `${key.surfaceId}:${key.version}:${key.t}`;
}

/** Byte-weighted lookup order; retired but borrowed entries still consume the same capacity. */
export class BitmapCache<B extends ClosableBitmap = ImageBitmap> {
  private readonly eligible = new Map<string, Entry<B>>();
  private readonly owned = new Set<Entry<B>>();
  private readonly bitmaps = new WeakMap<B, Entry<B>>();
  private readonly ledger: MemoryLedger;
  private readonly isLive: BitmapCacheOptions['isLive'];
  private readonly capacity: number;
  private bytes = 0;
  private nextGeneration = 1;
  private disposed = false;

  constructor(options: BitmapCacheOptions) {
    this.capacity = options.capacityBytes ?? BITMAP_CACHE_BYTES[options.device];
    checkMemoryBytes(this.capacity);
    if (this.capacity > BITMAP_CACHE_BYTES[options.device]) throw new Error('BITMAP_CACHE_CAP');
    this.ledger = options.ledger;
    this.isLive = options.isLive;
  }
  /** A rejection never transfers ownership. Never offer a bitmap already owned by this cache. */
  put(key: BitmapKey, bitmap: B, handle?: MemoryHandle): boolean {
    const id = keyId(key);
    const bytes = textureBytes(bitmap.width, bitmap.height, 1, 'RGBA8');
    if (!bytes) throw new RangeError('EMPTY_BITMAP');
    if (
      this.disposed ||
      !this.isLive(key) ||
      this.eligible.has(id) ||
      this.bitmaps.has(bitmap) ||
      bytes > this.capacity
    )
      return false;
    if (handle !== undefined) {
      const allocation = this.ledger.describe(handle);
      if (
        allocation.domain !== 'cpuDecoded' ||
        allocation.bytes !== bytes ||
        allocation.kind === 'bitmapCache'
      )
        throw new Error('BITMAP_OWNERSHIP_MISMATCH');
    }
    // Decide before evicting anything: pinned and already-retired entries cannot make room.
    let reclaimable = 0;
    for (const entry of this.eligible.values()) if (entry.borrowers === 0) reclaimable += entry.bytes;
    if (this.bytes + bytes - reclaimable > this.capacity) return false;
    while (this.bytes + bytes > this.capacity) {
      const oldest = this.eligible.values().next().value;
      if (!oldest) throw new Error('BITMAP_CACHE_ACCOUNTING');
      this.retire(oldest, false);
    }
    const label = `bitmap:${id}`;
    if (handle === undefined)
      handle = this.ledger.register('bitmapCache', label, bytes, { domain: 'cpuDecoded' });
    else this.ledger.transfer(handle, 'bitmapCache', label, { domain: 'cpuDecoded' });
    const entry: Entry<B> = {
      key: { ...key },
      id,
      bitmap,
      bytes,
      handle,
      borrowers: 0,
      generation: this.nextGeneration++,
      eligible: true,
      revoked: false,
      closed: false,
      controller: new AbortController(),
    };
    this.eligible.set(id, entry);
    this.owned.add(entry);
    this.bitmaps.set(bitmap, entry);
    this.bytes += bytes;
    return true;
  }
  borrow(key: BitmapKey): BorrowedBitmap<B> | null {
    const entry = this.eligible.get(keyId(key));
    if (!entry || this.disposed) return null;
    if (!this.isLive(entry.key)) {
      this.retire(entry, true);
      return null;
    }
    this.eligible.delete(entry.id);
    this.eligible.set(entry.id, entry);
    entry.borrowers++;
    const generation = entry.generation;
    let released = false;
    return {
      bitmap: entry.bitmap,
      generation,
      signal: entry.controller.signal,
      isValid: () =>
        !released &&
        !entry.revoked &&
        !entry.closed &&
        entry.generation === generation &&
        this.isLive(entry.key),
      release: () => {
        if (released) return;
        released = true;
        entry.borrowers--;
        if (!entry.eligible && entry.borrowers === 0) this.close(entry);
      },
    };
  }
  private close(entry: Entry<B>): void {
    if (entry.closed) return;
    entry.bitmap.close();
    entry.closed = true;
    this.ledger.release(entry.handle);
    this.bytes -= entry.bytes;
    this.owned.delete(entry);
    this.bitmaps.delete(entry.bitmap);
  }
  private retire(entry: Entry<B>, revoked: boolean): void {
    if (entry.eligible) {
      entry.eligible = false;
      this.eligible.delete(entry.id);
    }
    if (revoked && !entry.revoked) {
      entry.revoked = true;
      entry.generation = this.nextGeneration++;
      entry.controller.abort();
    }
    if (entry.borrowers === 0) this.close(entry);
  }
  /** Ordinary eviction preserves a borrower's right to finish; it cannot be found by new borrowers. */
  evict(key: BitmapKey): void {
    const entry = this.eligible.get(keyId(key));
    if (entry) this.retire(entry, false);
  }
  /** Also invalidates retired entries held by repack/restore, not just current lookup entries. */
  revoke(surfaceId: number, version?: number): void {
    checkMemoryBytes(surfaceId);
    if (version !== undefined) checkMemoryBytes(version);
    for (const entry of [...this.owned])
      if (entry.key.surfaceId === surfaceId && (version === undefined || entry.key.version === version))
        this.retire(entry, true);
  }
  snapshot() {
    let borrowed = 0,
      retiredBytes = 0;
    for (const entry of this.owned) {
      borrowed += entry.borrowers;
      if (!entry.eligible) retiredBytes += entry.bytes;
    }
    return {
      bytes: this.bytes,
      capacityBytes: this.capacity,
      entries: this.eligible.size,
      borrowed,
      retiredBytes,
    };
  }
  dispose(): void {
    this.disposed = true;
    for (const entry of [...this.owned]) this.retire(entry, true);
  }
}
