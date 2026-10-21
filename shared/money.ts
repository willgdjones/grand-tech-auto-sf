import { MAX_DECIMAL_DIGITS } from './constants';

export const DECIMAL_RE = /^(0|[1-9][0-9]*)$/;
export type DecimalError = 'NOT_STRING' | 'EMPTY' | 'TOO_LONG' | 'NONCANONICAL' | 'OUT_OF_RANGE';
export type DecimalResult = { ok: true; value: bigint } | { ok: false; code: DecimalError };

interface DecimalOptions {
  max: bigint;
  min?: bigint;
  maxDigits?: number;
}

const encoder = new TextEncoder();

/** Numeric order for canonical, unsigned decimal strings; no numeric conversion occurs. */
export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Bound external text before the sole decimal-to-BigInt conversion boundary. */
export function parseDecimal(input: unknown, opts: DecimalOptions): DecimalResult {
  if (typeof opts !== 'object' || opts === null) throw new RangeError('Decimal options are required');
  const min = opts.min === undefined ? 0n : opts.min;
  const max = opts.max;
  const maxDigits = opts.maxDigits === undefined ? MAX_DECIMAL_DIGITS : opts.maxDigits;
  if (typeof min !== 'bigint' || typeof max !== 'bigint' || min < 0n || max < min)
    throw new RangeError('Decimal bounds must be non-negative bigints with min <= max');
  if (!Number.isSafeInteger(maxDigits) || maxDigits < 1)
    throw new RangeError('Decimal maxDigits must be a positive safe integer');

  if (typeof input !== 'string') return { ok: false, code: 'NOT_STRING' };
  if (input === '') return { ok: false, code: 'EMPTY' };
  // UTF-16 length is a lower bound on UTF-8 bytes, so huge inputs avoid allocation and scanning.
  if (input.length > maxDigits || encoder.encode(input).byteLength > maxDigits)
    return { ok: false, code: 'TOO_LONG' };
  // JavaScript's $ also matches before a final newline; require the entire matched text.
  if (DECIMAL_RE.exec(input)?.[0] !== input) return { ok: false, code: 'NONCANONICAL' };
  if (compareDecimalStrings(input, min.toString()) < 0 || compareDecimalStrings(input, max.toString()) > 0)
    return { ok: false, code: 'OUT_OF_RANGE' };
  return { ok: true, value: BigInt(input) };
}

export function parseCents(input: unknown, max: bigint): DecimalResult {
  return parseDecimal(input, { max });
}


export function formatDecimal(value: bigint): string {
  if (typeof value !== 'bigint' || value < 0n)
    throw new RangeError('Decimal value must be a non-negative bigint');
  return value.toString();
}
