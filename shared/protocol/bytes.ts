/**
 * Little-endian byte access for the protocol codecs (M1.3a). `Reader` never throws: every read checks the
 * remaining length first and, past the end, returns a sentinel and records TRUNCATED, so a decoder can
 * finish and report the first error. Nothing is allocated from an untrusted count before that check.
 * `Writer` range-checks every value and throws `RangeError` (encoders never wrap or truncate silently).
 */
import type { DecodeErrorCode } from './types';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const utf8Encoder = new TextEncoder();

/** Byte `i` of `b`; callers have already bounds-checked `i`. */
export function u8At(b: Uint8Array, i: number): number {
  return b[i] ?? 0;
}

export function u16At(b: Uint8Array, i: number): number {
  return u8At(b, i) | (u8At(b, i + 1) << 8);
}

export function i16At(b: Uint8Array, i: number): number {
  return (u16At(b, i) << 16) >> 16;
}

export function u32At(b: Uint8Array, i: number): number {
  return (u8At(b, i) | (u8At(b, i + 1) << 8) | (u8At(b, i + 2) << 16) | (u8At(b, i + 3) << 24)) >>> 0;
}

/** The little-endian f64 at `i`; callers have already bounds-checked `i + 8`. */
export function f64At(b: Uint8Array, i: number): number {
  return new DataView(b.buffer, b.byteOffset + i, 8).getFloat64(0, true);
}

export class Reader {
  offset = 0;
  error: DecodeErrorCode | null = null;
  errorAt = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  /** Records the first error only. */
  fail(code: DecodeErrorCode, at: number = this.offset): void {
    if (this.error !== null) return;
    this.error = code;
    this.errorAt = at;
  }

  /** Advances over `n` bytes and returns their start, or −1 (and TRUNCATED) if they are not there. */
  private take(n: number): number {
    if (this.error !== null) return -1;
    if (this.remaining < n) {
      this.fail('TRUNCATED');
      return -1;
    }
    const at = this.offset;
    this.offset += n;
    return at;
  }

  u8(): number {
    const at = this.take(1);
    return at < 0 ? 0 : u8At(this.bytes, at);
  }

  u16(): number {
    const at = this.take(2);
    return at < 0 ? 0 : u16At(this.bytes, at);
  }

  i16(): number {
    const at = this.take(2);
    return at < 0 ? 0 : i16At(this.bytes, at);
  }

  u32(): number {
    const at = this.take(4);
    return at < 0 ? 0 : u32At(this.bytes, at);
  }

  i32(): number { return this.u32() | 0; }

  f64(): number {
    const at = this.take(8);
    return at < 0 ? Number.NaN : f64At(this.bytes, at);
  }

  /** A copy of the next `n` bytes (safe to retain). */
  copy(n: number): Uint8Array {
    const at = this.take(n);
    return at < 0 ? new Uint8Array(0) : this.bytes.slice(at, at + n);
  }

  /** The next `n` bytes as fatal UTF-8; BAD_UTF8 on malformed input. */
  utf8(n: number): string {
    const at = this.take(n);
    if (at < 0) return '';
    try {
      return utf8Decoder.decode(this.bytes.subarray(at, at + n));
    } catch {
      // The fatal decoder throws exactly for malformed UTF-8; that is a protocol error, not a bug.
      this.fail('BAD_UTF8', at);
      return '';
    }
  }
}

/** UTF-8 bytes of `text`; throws on lone surrogates, which TextEncoder would silently replace with U+FFFD. */
function encodeWellFormed(text: string, name: string): Uint8Array {
  const body = utf8Encoder.encode(text);
  if (utf8Decoder.decode(body) !== text) throw new RangeError(`${name} is not well-formed Unicode`);
  return body;
}

function requireInt(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}], got ${String(value)}`);
  }
}

/**
 * Writes into one preallocated buffer. `view()` exposes the written bytes without copying and stays valid
 * only until the next `reset()`; `ws.send` copies synchronously, so hot paths can reuse one writer.
 */
export class Writer {
  private readonly bytes: Uint8Array;
  // Two bounded cached lengths cover alternating MOVE/PING without allocating a view per send.
  private firstView: Uint8Array | undefined;
  private secondView: Uint8Array | undefined;
  private cachedViews: (Uint8Array | undefined)[] | undefined;
  offset = 0;

  constructor(capacity: number) {
    this.bytes = new Uint8Array(capacity);
  }

  reset(): this {
    this.offset = 0;
    return this;
  }

  private room(n: number): number {
    if (this.offset + n > this.bytes.length)
      throw new RangeError(`message exceeds ${this.bytes.length} bytes`);
    const at = this.offset;
    this.offset += n;
    return at;
  }

  u8(value: number, name = 'u8'): this {
    requireInt(name, value, 0, 0xff);
    this.bytes[this.room(1)] = value;
    return this;
  }

  u16(value: number, name = 'u16'): this {
    requireInt(name, value, 0, 0xffff);
    const at = this.room(2);
    this.bytes[at] = value & 0xff;
    this.bytes[at + 1] = value >>> 8;
    return this;
  }

  i16(value: number, name = 'i16'): this {
    requireInt(name, value, -0x8000, 0x7fff);
    const at = this.room(2);
    this.bytes[at] = value & 0xff;
    this.bytes[at + 1] = (value >> 8) & 0xff;
    return this;
  }

  u32(value: number, name = 'u32'): this {
    requireInt(name, value, 0, 0xffff_ffff);
    const at = this.room(4);
    this.bytes[at] = value & 0xff;
    this.bytes[at + 1] = (value >>> 8) & 0xff;
    this.bytes[at + 2] = (value >>> 16) & 0xff;
    this.bytes[at + 3] = value >>> 24;
    return this;
  }

  i32(value: number, name = 'i32'): this {
    requireInt(name, value, -0x80000000, 0x7fffffff);
    return this.u32(value >>> 0, name);
  }

  /** A finite f64; epoch-ms callers check integrality themselves. */
  f64(value: number, name = 'f64'): this {
    if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite, got ${String(value)}`);
    const at = this.room(8);
    new DataView(this.bytes.buffer, this.bytes.byteOffset + at, 8).setFloat64(0, value, true);
    return this;
  }

  raw(bytes: Uint8Array): this {
    this.bytes.set(bytes, this.room(bytes.length));
    return this;
  }

  /** A u8 byte-length prefix and UTF-8 body of at most `maxBytes`. */
  str8(text: string, maxBytes: number, name = 'str8'): this {
    const body = encodeWellFormed(text, name);
    if (body.length > Math.min(maxBytes, 0xff))
      throw new RangeError(`${name} is ${body.length} bytes, above ${maxBytes}`);
    return this.u8(body.length).raw(body);
  }

  /** A u16 byte-length prefix and UTF-8 body of at most `maxBytes`. */
  str16(text: string, maxBytes: number, name = 'str16'): this {
    const body = encodeWellFormed(text, name);
    if (body.length > Math.min(maxBytes, 0xffff)) {
      throw new RangeError(`${name} is ${body.length} bytes, above ${maxBytes}`);
    }
    return this.u16(body.length).raw(body);
  }

  /** Prewarm known wire lengths once; variable-count server snapshots allocate no views in their loop. */
  cacheViews(lengths: readonly number[]): this {
    this.cachedViews ??= new Array<Uint8Array | undefined>(this.bytes.length + 1);
    for (const length of lengths) {
      if (!Number.isInteger(length) || length < 0 || length > this.bytes.length)
        throw new RangeError('INVALID_CACHED_VIEW_LENGTH');
      this.cachedViews[length] ??= this.bytes.subarray(0, length);
    }
    return this;
  }

  /** The written bytes, without copying; valid until the next `reset()`. */
  view(): Uint8Array {
    const cached = this.cachedViews?.[this.offset];
    if (cached) return cached;
    if (this.firstView?.length === this.offset) return this.firstView;
    if (this.secondView?.length === this.offset) return this.secondView;
    this.secondView = this.firstView;
    this.firstView = this.bytes.subarray(0, this.offset);
    return this.firstView;
  }

  /** A fresh copy of the written bytes. */
  toBytes(): Uint8Array {
    return this.bytes.slice(0, this.offset);
  }
}

/** UTF-8 byte length of `text` (for exact-length encoders). */
export function utf8Length(text: string): number {
  return utf8Encoder.encode(text).length;
}
