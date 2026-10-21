import { QUALITY_TIERS } from '../config';

export const MEMORY_MIB = 1024 * 1024;
export type MemoryTier = keyof typeof QUALITY_TIERS;
export const MEMORY_KINDS = [
  'atlas',
  'renderTarget',
  'bloom',
  'geometry',
  'instances',
  'tables',
  'labels',
  'sky',
  'decals',
  'preview',
  'staging',
  'repack',
  'screenshot',
  'restore',
  'cropSource',
  'cropCanvas',
  'master',
  'bitmapCache',
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryDomain = 'gpu' | 'cpuDecoded' | 'cpuOther';
const domains = ['gpu', 'cpuDecoded', 'cpuOther'] as const;
const domainIndex = { gpu: 0, cpuDecoded: 1, cpuOther: 2 } as const;
const kindIndex = Object.fromEntries(MEMORY_KINDS.map((kind, index) => [kind, index])) as Record<
  MemoryKind,
  number
>;

/** §3.6.4 table, in MiB. CPU cache/heap limits in the plan use decimal MB instead. */
export const MEMORY_BUDGETS = {
  high: {
    atlas: 64,
    renderTargets: 32,
    bloom: 12,
    geometry: 40,
    tables: 8,
    transient: 32,
    peak: 188,
    gpuCeiling: QUALITY_TIERS.high.gpuMiB,
    jsHeapBytes: 300_000_000,
  },
  medium: {
    atlas: 48,
    renderTargets: 22.9,
    bloom: 8,
    geometry: 32,
    tables: 8,
    transient: 24,
    peak: 142.9,
    gpuCeiling: QUALITY_TIERS.medium.gpuMiB,
    jsHeapBytes: 250_000_000,
  },
  low: {
    atlas: 32,
    renderTargets: 12.2,
    bloom: 4,
    geometry: 16,
    tables: 8,
    transient: 16,
    peak: 88.2,
    gpuCeiling: QUALITY_TIERS.low.gpuMiB,
    jsHeapBytes: 180_000_000,
  },
} as const;
export const BITMAP_CACHE_BYTES = { desktop: 96_000_000, mobile: 32_000_000 } as const;
export const MOBILE_DECODED_TRANSIENT_BYTES = 64 * MEMORY_MIB;

const texelBytes = {
  SRGB8_ALPHA8: 4,
  RGBA8: 4,
  RGBA16F: 8,
  R32UI: 4,
  RGBA32F: 16,
  RGBA16UI: 8,
  R8UI: 1,
  depth24: 4,
  depth24Stencil8: 4,
} as const;
export type MemoryTextureFormat = keyof typeof texelBytes;

export function checkMemoryBytes(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('INVALID_MEMORY_BYTES');
}
export function textureBytes(
  width: number,
  height: number,
  depth: number,
  format: MemoryTextureFormat,
): number {
  checkMemoryBytes(width);
  checkMemoryBytes(height);
  checkMemoryBytes(depth);
  const texel = texelBytes[format];
  if (typeof texel !== 'number') throw new RangeError('INVALID_MEMORY_FORMAT');
  const bytes = width * height * depth * texel;
  checkMemoryBytes(bytes);
  return bytes;
}
export function renderTargetBytes(
  width: number,
  height: number,
  attachments: readonly MemoryTextureFormat[],
  samples = 1,
): number {
  checkMemoryBytes(width);
  checkMemoryBytes(height);
  checkMemoryBytes(samples);
  if (samples < 1) throw new RangeError('INVALID_MEMORY_SAMPLES');
  let bytes = 0;
  for (const format of attachments) bytes += textureBytes(width, height, 1, format) * samples;
  checkMemoryBytes(bytes);
  return bytes;
}
export function bufferBytes(buffer: Pick<ArrayBuffer, 'byteLength'>): number {
  checkMemoryBytes(buffer.byteLength);
  return buffer.byteLength;
}

declare const memoryHandle: unique symbol;
export type MemoryHandle = number & { readonly [memoryHandle]: true };
export interface MemoryRegistration {
  domain: MemoryDomain;
  transient?: boolean;
}
export interface MemorySnapshot {
  gpuBytes: number;
  gpuPeakBytes: number;
  cpuDecodedBytes: number;
  cpuDecodedPeakBytes: number;
  cpuOtherBytes: number;
  cpuOtherPeakBytes: number;
  bitmapCacheBytes: number;
  byKind: Record<MemoryDomain, Record<MemoryKind, number>>;
  allocations: number;
  capacity: number;
  jsHeapBytes?: number;
}
export interface MemoryLedgerOptions {
  tier: MemoryTier;
  capacity?: number;
  /** Default true for development/tests. Production can account and report an overrun without throwing. */
  throwOnOverBudget?: boolean;
  onOverBudget?: (event: 'mem.overBudget', gpuBytes: number, budgetBytes: number) => void;
  jsHeapBytes?: () => number | undefined;
}

// Numeric, globally unique generations avoid allocating a handle object or growing a Map on a hot
// register/release path. A fixed stride also prevents handles from another ledger being accepted.
const handleStride = 65_536;
let nextGeneration = 1;
function invalidHandle(): never {
  throw new Error('STALE_OR_FOREIGN_MEMORY_HANDLE');
}
function capacityExceeded(): never {
  throw new Error('MEMORY_LEDGER_CAPACITY');
}
function reportBudget(event: 'mem.overBudget', bytes: number, budget: number): void {
  console.warn(event, { gpuBytes: bytes, budgetBytes: budget });
}

export class MemoryLedger {
  private tier: MemoryTier;
  private readonly strict: boolean;
  private readonly report: NonNullable<MemoryLedgerOptions['onOverBudget']>;
  private readonly heap: MemoryLedgerOptions['jsHeapBytes'];
  private readonly handles: Float64Array;
  private readonly sizes: Float64Array;
  private readonly kinds: Uint8Array;
  private readonly domainIds: Uint8Array;
  private readonly transient: Uint8Array;
  private readonly labels: string[];
  private readonly free: Uint32Array;
  private readonly current = new Float64Array(3);
  private readonly peaks = new Float64Array(3);
  private readonly totals = new Float64Array(3 * MEMORY_KINDS.length);
  private readonly kindPeaks = new Float64Array(3 * MEMORY_KINDS.length);
  private freeCount: number;
  private reporting = false;

  constructor(options: MemoryLedgerOptions) {
    this.tier = options.tier;
    this.strict = options.throwOnOverBudget ?? true;
    this.report = options.onOverBudget ?? reportBudget;
    this.heap = options.jsHeapBytes;
    const capacity = options.capacity ?? 4096;
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > handleStride) capacityExceeded();
    this.handles = new Float64Array(capacity);
    this.sizes = new Float64Array(capacity);
    this.kinds = new Uint8Array(capacity);
    this.domainIds = new Uint8Array(capacity);
    this.transient = new Uint8Array(capacity);
    this.labels = new Array<string>(capacity).fill('');
    this.free = Uint32Array.from({ length: capacity }, (_, index) => capacity - 1 - index);
    this.freeCount = capacity;
  }
  get qualityTier(): MemoryTier {
    return this.tier;
  }
  get gpuBudgetedBytes(): number {
    return Math.ceil(MEMORY_BUDGETS[this.tier].peak * MEMORY_MIB);
  }
  get gpuCeilingBytes(): number {
    return MEMORY_BUDGETS[this.tier].gpuCeiling * MEMORY_MIB;
  }

  private checkBudget(gpuBytes: number, tier = this.tier): void {
    if (this.reporting) throw new Error('MEMORY_REPORT_REENTRANCY');
    const limit = Math.ceil(MEMORY_BUDGETS[tier].peak * MEMORY_MIB);
    if (gpuBytes <= limit) return;
    this.reporting = true;
    try {
      this.report('mem.overBudget', gpuBytes, limit);
    } finally {
      this.reporting = false;
    }
    if (this.strict) throw new Error('MEMORY_OVER_BUDGET');
  }
  private slot(handle: MemoryHandle): number {
    const slot = handle % handleStride;
    if (!Number.isSafeInteger(handle) || handle <= 0 || this.handles[slot] !== handle) invalidHandle();
    return slot;
  }
  private classify(kind: MemoryKind, domain: MemoryDomain): void {
    if (!Object.hasOwn(kindIndex, kind) || !Object.hasOwn(domainIndex, domain))
      throw new Error('INVALID_MEMORY_CLASSIFICATION');
  }
  private adjust(domain: number, kind: number, delta: number): void {
    this.current[domain] = this.current[domain]! + delta;
    this.peaks[domain] = Math.max(this.peaks[domain]!, this.current[domain]);
    const at = domain * MEMORY_KINDS.length + kind;
    this.totals[at] = this.totals[at]! + delta;
    this.kindPeaks[at] = Math.max(this.kindPeaks[at]!, this.totals[at]);
  }
  /** Allocation-time high-water mark, including resources created and released within one frame. */
  peakBytes(kind: MemoryKind, domain: MemoryDomain): number {
    this.classify(kind, domain);
    return this.kindPeaks[domainIndex[domain] * MEMORY_KINDS.length + kindIndex[kind]]!;
  }
  /** @hot All storage and free slots are allocated in the constructor. Register before allocating. */
  register(kind: MemoryKind, label: string, bytes: number, options: MemoryRegistration): MemoryHandle {
    this.classify(kind, options.domain);
    checkMemoryBytes(bytes);
    if (!this.freeCount || nextGeneration >= Math.floor(Number.MAX_SAFE_INTEGER / handleStride))
      capacityExceeded();
    const domain = domainIndex[options.domain],
      k = kindIndex[kind];
    checkMemoryBytes(this.current[domain]! + bytes);
    this.checkBudget(this.current[0]! + (domain === 0 ? bytes : 0));
    const slot = this.free[--this.freeCount]!;
    const handle = (nextGeneration++ * handleStride + slot) as MemoryHandle;
    this.handles[slot] = handle;
    this.sizes[slot] = bytes;
    this.kinds[slot] = k;
    this.domainIds[slot] = domain;
    this.labels[slot] = label;
    this.transient[slot] = options.transient ? 1 : 0;
    this.adjust(domain, k, bytes);
    return handle;
  }
  /** @hot A rejected resize leaves both allocation and high-water marks unchanged. */
  resize(handle: MemoryHandle, bytes: number): void {
    const slot = this.slot(handle),
      domain = this.domainIds[slot]!;
    checkMemoryBytes(bytes);
    const delta = bytes - this.sizes[slot]!;
    checkMemoryBytes(this.current[domain]! + delta);
    this.checkBudget(this.current[0]! + (domain === 0 ? delta : 0));
    this.sizes[slot] = bytes;
    this.adjust(domain, this.kinds[slot]!, delta);
  }
  /** @hot Stale/double releases fail instead of freeing a reused slot. */
  release(handle: MemoryHandle): void {
    if (this.reporting) throw new Error('MEMORY_REPORT_REENTRANCY');
    const slot = this.slot(handle);
    this.adjust(this.domainIds[slot]!, this.kinds[slot]!, -this.sizes[slot]!);
    this.handles[slot] = 0;
    this.sizes[slot] = 0;
    this.labels[slot] = '';
    this.free[this.freeCount++] = slot;
  }
  /** Transfer existing ownership (e.g. master → bitmapCache) without releasing or double charging. */
  transfer(handle: MemoryHandle, kind: MemoryKind, label: string, options: MemoryRegistration): void {
    this.classify(kind, options.domain);
    const slot = this.slot(handle),
      oldDomain = this.domainIds[slot]!,
      domain = domainIndex[options.domain];
    const bytes = this.sizes[slot]!;
    checkMemoryBytes(this.current[domain]! + (domain === oldDomain ? 0 : bytes));
    const gpuDelta = domain === oldDomain ? 0 : domain === 0 ? bytes : oldDomain === 0 ? -bytes : 0;
    this.checkBudget(this.current[0]! + gpuDelta);
    this.adjust(oldDomain, this.kinds[slot]!, -bytes);
    this.adjust(domain, kindIndex[kind], bytes);
    this.kinds[slot] = kindIndex[kind];
    this.domainIds[slot] = domain;
    this.labels[slot] = label;
    this.transient[slot] = options.transient ? 1 : 0;
  }
  setTier(tier: MemoryTier): void {
    this.checkBudget(this.current[0]!, tier);
    this.tier = tier;
  }
  describe(handle: MemoryHandle) {
    const slot = this.slot(handle);
    return {
      kind: MEMORY_KINDS[this.kinds[slot]!]!,
      label: this.labels[slot]!,
      bytes: this.sizes[slot]!,
      domain: domains[this.domainIds[slot]!]!,
      transient: this.transient[slot] === 1,
    };
  }
  /** Cold diagnostic path; returned objects are independent of the fixed hot-path storage. */
  snapshot(): MemorySnapshot {
    const byKind = Object.fromEntries(
      domains.map((domain, d) => [
        domain,
        Object.fromEntries(MEMORY_KINDS.map((kind, k) => [kind, this.totals[d * MEMORY_KINDS.length + k]!])),
      ]),
    ) as MemorySnapshot['byKind'];
    const heap = this.heap?.();
    if (heap !== undefined) checkMemoryBytes(heap);
    return {
      gpuBytes: this.current[0]!,
      gpuPeakBytes: this.peaks[0]!,
      cpuDecodedBytes: this.current[1]!,
      cpuDecodedPeakBytes: this.peaks[1]!,
      cpuOtherBytes: this.current[2]!,
      cpuOtherPeakBytes: this.peaks[2]!,
      bitmapCacheBytes: byKind.cpuDecoded.bitmapCache,
      byKind,
      allocations: this.handles.length - this.freeCount,
      capacity: this.handles.length,
      ...(heap === undefined ? {} : { jsHeapBytes: heap }),
    };
  }
}
