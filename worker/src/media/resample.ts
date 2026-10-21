import type { Rgba } from './codecs';

// bdts-media downscaler (promoted from the M4.0 spike): Lanczos-3, or an area (box) filter for small
// targets (§3.6.1 step 3). It never upsamples. Each image is resampled only from itself with edge
// clamping. Output is produced in bands of rows, so the separable intermediate is a small Int16 band,
// never a full-size Float32 RGBA buffer (a 2046 x 2048 Float32 intermediate alone is about 64 MiB).

export type Filter = 'lanczos3' | 'box';
export const filterFor = (t: number): Filter => (t >= 16 ? 'lanczos3' : 'box');

const ONE = 1 << 14; // weight fixed point
const SUB = 16; // extra intermediate precision (x16 keeps Lanczos overshoot inside Int16)
const BAND_ROWS = 32;

interface Axis {
  /** First source index per output index. */
  readonly first: Int32Array;
  /** Number of taps per output index. */
  readonly taps: Int32Array;
  /** Offset of each output index's weights in `weights`. */
  readonly offset: Int32Array;
  readonly weights: Int32Array;
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos3 = (x: number) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0);

/** Integer weights per output index (each row sums to exactly 2^14), clamped to the source edge. */
export function axisWeights(src: number, dst: number, filter: Filter): Axis {
  if (!Number.isInteger(src) || !Number.isInteger(dst) || src < 1 || dst < 1)
    throw new RangeError('Bad axis');
  if (dst > src) throw new RangeError('Never upsample');
  const scale = src / dst;
  const first = new Int32Array(dst);
  const taps = new Int32Array(dst);
  const offset = new Int32Array(dst);
  const rows: number[][] = [];
  let total = 0;
  for (let x = 0; x < dst; x++) {
    const raw = new Map<number, number>();
    if (filter === 'box') {
      const a = x * scale;
      const b = (x + 1) * scale;
      for (let j = Math.floor(a); j < Math.ceil(b); j++) {
        const overlap = Math.min(b, j + 1) - Math.max(a, j);
        if (overlap > 0) raw.set(j, (raw.get(j) ?? 0) + overlap);
      }
    } else {
      const center = (x + 0.5) * scale - 0.5;
      const radius = 3 * scale;
      for (let j = Math.floor(center - radius) + 1; j <= Math.floor(center + radius); j++) {
        const w = lanczos3((j - center) / scale);
        if (w === 0) continue;
        const clamped = Math.min(src - 1, Math.max(0, j)); // edge clamp inside this master only
        raw.set(clamped, (raw.get(clamped) ?? 0) + w);
      }
    }
    const keys = [...raw.keys()].sort((p, q) => p - q);
    const lo = keys[0] ?? 0;
    const hi = keys[keys.length - 1] ?? 0;
    const sum = [...raw.values()].reduce((s, w) => s + w, 0);
    const row = Array.from({ length: hi - lo + 1 }, (_, i) =>
      Math.round(((raw.get(lo + i) ?? 0) / sum) * ONE),
    );
    // Put the rounding remainder on the largest tap so every row sums to exactly ONE.
    const drift = ONE - row.reduce((s, w) => s + w, 0);
    const peak = row.indexOf(Math.max(...row));
    row[peak] = (row[peak] ?? 0) + drift;
    first[x] = lo;
    taps[x] = row.length;
    offset[x] = total;
    total += row.length;
    rows.push(row);
  }
  const weights = new Int32Array(total);
  rows.forEach((row, x) => weights.set(row, offset[x]));
  return { first, taps, offset, weights };
}

export interface Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * Resamples all of `src` into the `dw x dh` rectangle at (`dx`, `dy`) of `canvas`. `scratch` reports the
 * band buffer size to a caller that tracks allocations.
 */
export function resampleInto(
  src: Rgba,
  canvas: Canvas,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  filter: Filter,
  scratch?: (bytes: number) => void,
): void {
  if (dx < 0 || dy < 0 || dx + dw > canvas.width || dy + dh > canvas.height)
    throw new RangeError('Target outside canvas');
  const hx = axisWeights(src.width, dw, filter);
  const vy = axisWeights(src.height, dh, filter);
  const sw = src.width;
  const s = src.data;
  const out = canvas.data;
  for (let y0 = 0; y0 < dh; y0 += BAND_ROWS) {
    const y1 = Math.min(dh, y0 + BAND_ROWS);
    const rowLo = vy.first[y0]!;
    let rowHi = rowLo;
    for (let y = y0; y < y1; y++) rowHi = Math.max(rowHi, vy.first[y]! + vy.taps[y]! - 1);
    const bandRows = rowHi - rowLo + 1;
    const band = new Int16Array(bandRows * dw * 4);
    scratch?.(band.byteLength);
    // Horizontal pass over only the source rows this band needs.
    for (let r = 0; r < bandRows; r++) {
      const srcRow = (rowLo + r) * sw * 4;
      const dstRow = r * dw * 4;
      for (let x = 0; x < dw; x++) {
        const f = hx.first[x]!;
        const n = hx.taps[x]!;
        const o = hx.offset[x]!;
        let r0 = 0;
        let g0 = 0;
        let b0 = 0;
        let a0 = 0;
        for (let k = 0; k < n; k++) {
          const w = hx.weights[o + k]!;
          const p = srcRow + (f + k) * 4;
          r0 += w * s[p]!;
          g0 += w * s[p + 1]!;
          b0 += w * s[p + 2]!;
          a0 += w * s[p + 3]!;
        }
        const q = dstRow + x * 4;
        band[q] = Math.round((r0 * SUB) / ONE);
        band[q + 1] = Math.round((g0 * SUB) / ONE);
        band[q + 2] = Math.round((b0 * SUB) / ONE);
        band[q + 3] = Math.round((a0 * SUB) / ONE);
      }
    }
    // Vertical pass into the canvas (Uint8Clamped clamps Lanczos overshoot).
    for (let y = y0; y < y1; y++) {
      const f = vy.first[y]! - rowLo;
      const n = vy.taps[y]!;
      const o = vy.offset[y]!;
      const outRow = ((dy + y) * canvas.width + dx) * 4;
      for (let x = 0; x < dw; x++) {
        let r0 = 0;
        let g0 = 0;
        let b0 = 0;
        let a0 = 0;
        for (let k = 0; k < n; k++) {
          const w = vy.weights[o + k]!;
          const p = ((f + k) * dw + x) * 4;
          r0 += w * band[p]!;
          g0 += w * band[p + 1]!;
          b0 += w * band[p + 2]!;
          a0 += w * band[p + 3]!;
        }
        const q = outRow + x * 4;
        out[q] = Math.round(r0 / (ONE * SUB));
        out[q + 1] = Math.round(g0 / (ONE * SUB));
        out[q + 2] = Math.round(b0 / (ONE * SUB));
        out[q + 3] = Math.round(a0 / (ONE * SUB));
      }
    }
  }
}
