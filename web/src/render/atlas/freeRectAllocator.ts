import { ATLAS_PAGE_EDGE } from '@gtasf/shared/constants';

export interface AtlasRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export interface RectAllocation extends AtlasRect {
  /** Opaque, never reused within this allocator. Pass this id back to free(). */
  readonly id: number;
  readonly generation: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function dimension(n: number): void {
  if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError('ATLAS_RECT_DIMENSION');
}
function order(a: AtlasRect, b: AtlasRect): number {
  return a.y - b.y || a.x - b.x || a.h - b.h || a.w - b.w;
}
function overlaps(a: AtlasRect, b: AtlasRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function mergeable(a: AtlasRect, b: AtlasRect): boolean {
  return (
    (a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y)) ||
    (a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x))
  );
}

/**
 * Disjoint guillotine rectangles. Interior holes are returned and full-edge neighbours coalesce.
 * Scratch rectangles are pooled; successful allocations return immutable identities so a late free
 * cannot reclaim a replacement. Allocation is called by the streamer's IO completion, outside tick().
 */
export class FreeRectAllocator {
  private readonly freeRects: Rect[] = [];
  private readonly spare: Rect[] = [];
  private readonly allocated = new Map<number, RectAllocation>();
  private readonly largest = { w: 0, h: 0, area: 0 };
  private nextId = 1;
  private generation = 0;
  private area: number;
  private layoutRevision = 0;

  constructor(
    readonly width = ATLAS_PAGE_EDGE,
    readonly height = ATLAS_PAGE_EDGE,
  ) {
    dimension(width);
    dimension(height);
    if (!Number.isSafeInteger(width * height)) throw new RangeError('ATLAS_RECT_AREA');
    this.area = width * height;
    this.freeRects.push({ x: 0, y: 0, w: width, h: height });
  }

  get freeArea(): number {
    return this.area;
  }
  get revision(): number {
    return this.layoutRevision;
  }
  get size(): number {
    return this.allocated.size;
  }
  /** Borrowed metrics object; copy it only if a diagnostic needs to retain a snapshot. */
  get largestFreeRect(): Readonly<{ w: number; h: number; area: number }> {
    let best: Rect | undefined;
    for (const r of this.freeRects)
      if (!best || r.w * r.h > best.w * best.h || (r.w * r.h === best.w * best.h && order(r, best) < 0))
        best = r;
    this.largest.w = best?.w ?? 0;
    this.largest.h = best?.h ?? 0;
    this.largest.area = this.largest.w * this.largest.h;
    return this.largest;
  }
  get fragmentation(): number {
    return this.area === 0 ? 0 : 1 - this.largestFreeRect.area / this.area;
  }

  fits(w: number, h: number): boolean {
    dimension(w);
    dimension(h);
    return this.best(w, h) !== -1;
  }

  private best(w: number, h: number): number {
    let found = -1;
    let bestShort = Infinity;
    let bestArea = Infinity;
    for (let i = 0; i < this.freeRects.length; i++) {
      const r = this.freeRects[i]!;
      if (w > r.w || h > r.h) continue;
      const short = Math.min(r.w - w, r.h - h);
      const area = r.w * r.h;
      if (
        short < bestShort ||
        (short === bestShort &&
          (area < bestArea || (area === bestArea && (found === -1 || order(r, this.freeRects[found]!) < 0))))
      ) {
        found = i;
        bestShort = short;
        bestArea = area;
      }
    }
    return found;
  }

  private add(x: number, y: number, w: number, h: number): void {
    if (w === 0 || h === 0) return;
    const r = this.spare.pop() ?? { x: 0, y: 0, w: 0, h: 0 };
    r.x = x;
    r.y = y;
    r.w = w;
    r.h = h;
    this.freeRects.push(r);
  }

  allocate(w: number, h: number): RectAllocation | null {
    dimension(w);
    dimension(h);
    const at = this.best(w, h);
    if (at === -1) return null;
    if (this.nextId >= Number.MAX_SAFE_INTEGER || this.generation >= Number.MAX_SAFE_INTEGER)
      throw new Error('ATLAS_GENERATION_EXHAUSTED');
    const r = this.freeRects[at]!;
    const allocation = Object.freeze({
      id: this.nextId++,
      x: r.x,
      y: r.y,
      w,
      h,
      generation: ++this.generation,
    });
    const dw = r.w - w;
    const dh = r.h - h;
    this.freeRects.splice(at, 1);
    // Shorter leftover width: horizontal cut, then split the top strip vertically. Ties use this rule.
    if (dw <= dh) {
      this.add(r.x + w, r.y, dw, h);
      this.add(r.x, r.y + h, r.w, dh);
    } else {
      this.add(r.x + w, r.y, dw, r.h);
      this.add(r.x, r.y + h, w, dh);
    }
    this.spare.push(r);
    this.allocated.set(allocation.id, allocation);
    this.area -= w * h;
    this.layoutRevision++;
    this.coalesce();
    return allocation;
  }

  free(id: number): boolean {
    const r = this.allocated.get(id);
    if (!r) return false;
    if (this.generation >= Number.MAX_SAFE_INTEGER) throw new Error('ATLAS_GENERATION_EXHAUSTED');
    this.allocated.delete(id);
    this.add(r.x, r.y, r.w, r.h);
    this.area += r.w * r.h;
    this.generation++;
    this.layoutRevision++;
    this.coalesce();
    return true;
  }

  private coalesce(): void {
    for (;;) {
      this.freeRects.sort(order);
      let changed = false;
      outer: for (let i = 0; i < this.freeRects.length; i++) {
        const a = this.freeRects[i]!;
        for (let j = i + 1; j < this.freeRects.length; j++) {
          const b = this.freeRects[j]!;
          if (!mergeable(a, b)) continue;
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          a.w = Math.max(a.x + a.w, b.x + b.w) - x;
          a.h = Math.max(a.y + a.h, b.y + b.h) - y;
          a.x = x;
          a.y = y;
          this.freeRects.splice(j, 1);
          this.spare.push(b);
          changed = true;
          break outer;
        }
      }
      if (!changed) return;
    }
  }

  /** Cold, deterministic diagnostics for property-test replay and failed repack reports. */
  fork(): FreeRectAllocator {
    const copy = new FreeRectAllocator(this.width, this.height);
    copy.freeRects.length = 0;
    for (const r of this.freeRects) copy.freeRects.push({ ...r });
    for (const [id, r] of this.allocated) copy.allocated.set(id, r);
    copy.nextId = this.nextId;
    copy.generation = this.generation;
    copy.layoutRevision = this.layoutRevision;
    copy.area = this.area;
    return copy;
  }

  /** Cold, deterministic diagnostics for property-test replay and failed repack reports. */
  snapshot() {
    return {
      width: this.width,
      height: this.height,
      free: this.freeRects.map((r) => ({ ...r })).sort(order),
      allocated: [...this.allocated.values()].sort((a, b) => a.id - b.id),
      freeArea: this.freeArea,
      largestFreeRect: { ...this.largestFreeRect },
      fragmentation: this.fragmentation,
      revision: this.revision,
    };
  }

  /** Debug/test boundary; never traversed by the render loop. */
  assertInvariants(): void {
    const rects = [...this.freeRects, ...this.allocated.values()];
    let total = 0;
    let free = 0;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]!;
      if (r.x < 0 || r.y < 0 || r.w <= 0 || r.h <= 0 || r.x + r.w > this.width || r.y + r.h > this.height)
        throw new Error('ATLAS_RECT_OUTSIDE_PAGE');
      total += r.w * r.h;
      if (i < this.freeRects.length) free += r.w * r.h;
      for (let j = i + 1; j < rects.length; j++)
        if (overlaps(r, rects[j]!)) throw new Error('ATLAS_RECT_OVERLAP');
    }
    if (total !== this.width * this.height || free !== this.area) throw new Error('ATLAS_RECT_ACCOUNTING');
    for (let i = 0; i < this.freeRects.length; i++)
      for (let j = i + 1; j < this.freeRects.length; j++)
        if (mergeable(this.freeRects[i]!, this.freeRects[j]!)) throw new Error('ATLAS_RECT_UNCOALESCED');
  }
}
