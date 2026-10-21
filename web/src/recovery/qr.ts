// Self-contained QR Code encoder — byte mode, error-correction level M.
// No dependencies and no DOM: pure array/string output, so it runs unchanged in
// the browser and in tests. Algorithm follows ISO/IEC 18004 (and the reference
// layout/mask logic of Project Nayuki's QR generator). Versions 1–10 are
// supported and the smallest that fits the payload is chosen automatically;
// recovery codes and short URLs sit well inside v1–v3. Level M is fixed: it is
// the usual QR default (~15% recovery) and keeps the symbols compact.

// Error-correction characteristics for level M, versions 1–10 (ISO/IEC 18004
// Table 9): [ecPerBlock, [[numBlocks, dataPerBlock], ...]]. The block data sums
// to the level-M data capacity and +ec*blocks to the version's total codewords.
const EC_M: Record<number, readonly [number, ReadonlyArray<readonly [number, number]>]> = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]],
};

// Alignment-pattern centre coordinates per version (ISO/IEC 18004 Annex E). The
// last entry always equals size-7, which is how finder-overlapping ones are cut.
const ALIGN: Record<number, readonly number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const MAX_VERSION = 10;

// --- GF(256) arithmetic (primitive polynomial x^8+x^4+x^3+x^2+1 = 0x11d) ------
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
}
const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;

// Reed-Solomon generator polynomial of degree `ec`: product of (x - α^i) for
// i in 0..ec-1. coeff[0] is the x^ec term (monic), coeff[ec] the constant.
function rsGenerator(ec: number): Uint8Array {
  let poly = Uint8Array.of(1);
  for (let i = 0; i < ec; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;                     // x * coeff
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, GF_EXP[i]!); // α^i * coeff
    }
    poly = next;
  }
  return poly;
}

// EC codewords for one data block: remainder of data·x^ec divided by generator.
function rsEncode(data: Uint8Array, ec: number): Uint8Array {
  const gen = rsGenerator(ec);
  const res = new Uint8Array(ec);
  for (const b of data) {
    const factor = b ^ res[0]!;
    res.copyWithin(0, 1);
    res[ec - 1] = 0;
    for (let j = 0; j < ec; j++) res[j] = res[j]! ^ gfMul(gen[j + 1]!, factor);
  }
  return res;
}

// --- bit + byte helpers -------------------------------------------------------
// Minimal UTF-8 encoder so byte mode needs no TextEncoder/DOM. Inputs are ASCII
// in practice, but this keeps any code point correct.
function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

const dataCodewords = (version: number): number =>
  EC_M[version]![1].reduce((s, [n, k]) => s + n * k, 0);

// Smallest version (1..MAX_VERSION) whose level-M data capacity fits the bytes.
function pickVersion(byteLen: number): number {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const need = 4 + (v <= 9 ? 8 : 16) + byteLen * 8; // mode + count + payload
    if (need <= dataCodewords(v) * 8) return v;
  }
  throw new Error(`qr: ${byteLen} bytes exceed level-M capacity of versions 1-${MAX_VERSION}`);
}

// Build the final (interleaved) data+EC codeword stream for the payload.
function buildCodewords(bytes: number[], version: number): Uint8Array {
  const [ec, blocks] = EC_M[version]!;
  const totalData = dataCodewords(version);

  // Bit stream: mode indicator, char count, payload, terminator, byte padding.
  const bits: number[] = [];
  const push = (value: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);                          // byte mode
  push(bytes.length, version <= 9 ? 8 : 16); // character count
  for (const b of bytes) push(b, 8);
  const capacity = totalData * 8;
  push(0, Math.min(4, capacity - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);    // pad to byte boundary

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]!;
    data.push(v);
  }
  const pad = [0xec, 0x11];
  while (data.length < totalData) data.push(pad[data.length % 2]!);

  // Split into blocks, compute EC per block.
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let pos = 0;
  for (const [n, k] of blocks) {
    for (let i = 0; i < n; i++) {
      const blk = data.slice(pos, pos + k);
      pos += k;
      dataBlocks.push(blk);
      ecBlocks.push([...rsEncode(Uint8Array.from(blk), ec)]);
    }
  }

  // Interleave: data codewords column-wise across blocks, then EC the same way.
  const out: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const blk of dataBlocks) if (i < blk.length) out.push(blk[i]!);
  for (let i = 0; i < ec; i++) for (const blk of ecBlocks) out.push(blk[i]!);
  return Uint8Array.from(out);
}

// --- matrix layout ------------------------------------------------------------
interface Layout { cells: Uint8Array; fn: Uint8Array; size: number }

// Place every function pattern and the (unmasked) data stream. `fn` marks
// function/reserved modules, which never carry data and are never masked.
function layout(version: number, cw: Uint8Array): Layout {
  const size = version * 4 + 17;
  const cells = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size);
  const at = (r: number, c: number): number => r * size + c;
  const setF = (r: number, c: number, dark: boolean): void => {
    cells[at(r, c)] = dark ? 1 : 0;
    fn[at(r, c)] = 1;
  };

  // Finder patterns (centres (3,3),(3,size-4),(size-4,3)) with separators.
  for (const [cr, cc] of [[3, 3], [3, size - 4], [size - 4, 3]] as const) {
    for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) {
      const r = cr + dr, c = cc + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const d = Math.max(Math.abs(dr), Math.abs(dc));
      setF(r, c, d !== 2 && d !== 4); // dark at d 0,1,3; light gap/separator at 2,4
    }
  }

  // Timing patterns on row 6 and column 6, skipping already-set function cells.
  for (let i = 0; i < size; i++) {
    if (!fn[at(6, i)]) setF(6, i, i % 2 === 0);
    if (!fn[at(i, 6)]) setF(i, 6, i % 2 === 0);
  }

  // Alignment patterns at every coordinate pair except the three that collide
  // with the finders (centre on (6,6),(6,size-7),(size-7,6)).
  const coords = ALIGN[version]!;
  for (const ar of coords) for (const ac of coords) {
    if ((ar === 6 && ac === 6) || (ar === 6 && ac === size - 7) || (ar === size - 7 && ac === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const d = Math.max(Math.abs(dr), Math.abs(dc));
      setF(ar + dr, ac + dc, d !== 1); // dark at d 0,2; light ring at 1
    }
  }

  // Dark module and reserved format-info area.
  setF(size - 8, 8, true);
  for (const [r, c] of formatPositions(size)) fn[at(r, c)] = 1;

  // Version information (v>=7): two 18-bit copies, mask-independent.
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >> 11) & 1) * 0x1f25);
    const vbits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setF(b, a, bit); // top-right block
      setF(a, b, bit); // bottom-left block
    }
  }

  // Data placement: two-module-wide columns, zig-zagging up then down, skipping
  // the vertical timing column (6) and all reserved modules.
  let bi = 0;
  const totalBits = cw.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - v : v;
        if (fn[at(r, c)]) continue;
        if (bi < totalBits) {
          cells[at(r, c)] = (cw[bi >> 3]! >> (7 - (bi & 7))) & 1;
          bi++;
        }
      }
    }
  }
  return { cells, fn, size };
}

// Module coordinates of the 15 format bits (both copies), in bit order 0..14.
function formatPositions(size: number): Array<[number, number]> {
  const p: Array<[number, number]> = [];
  for (let i = 0; i <= 5; i++) p.push([i, 8]);
  p.push([7, 8], [8, 8], [8, 7]);
  for (let i = 9; i < 15; i++) p.push([8, 14 - i]);
  for (let i = 0; i < 8; i++) p.push([8, size - 1 - i]);
  for (let i = 8; i < 15; i++) p.push([size - 15 + i, 8]);
  return p;
}

// 15-bit format information for level M and the given mask: 2-bit EC level (M =
// 0b00) and 3-bit mask through BCH(15,5), XORed with the 0x5412 spec mask.
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(cells: Uint8Array, size: number, mask: number): void {
  const bits = formatBits(mask);
  const pos = formatPositions(size);
  for (let i = 0; i < 15; i++) {
    const [r, c] = pos[i]!;
    cells[r * size + c] = (bits >> i) & 1;
  }
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2 + (r * c) % 3) === 0;
    case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
    default: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
  }
}

function applyMask(cells: Uint8Array, fn: Uint8Array, size: number, mask: number): void {
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (fn[r * size + c]) continue;
    if (maskBit(mask, r, c)) cells[r * size + c] = cells[r * size + c]! ^ 1;
  }
}

// Penalty score (ISO/IEC 18004 §8.8.2) used to pick the least-conspicuous mask.
function penalty(cells: Uint8Array, size: number): number {
  const get = (r: number, c: number): number => cells[r * size + c]!;
  let score = 0;

  // Rule 1: runs of 5+ same-colour modules in each row and column.
  for (let a = 0; a < size; a++) {
    for (const row of [true, false]) {
      let run = 1;
      let prev = row ? get(a, 0) : get(0, a);
      for (let b = 1; b < size; b++) {
        const cur = row ? get(a, b) : get(b, a);
        if (cur === prev) { run++; } else { if (run >= 5) score += run - 2; run = 1; prev = cur; }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    const v = get(r, c);
    if (v === get(r, c + 1) && v === get(r + 1, c) && v === get(r + 1, c + 1)) score += 3;
  }

  // Rule 3: 1:1:3:1:1 finder-like patterns (with 4 light modules) in lines.
  const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let a = 0; a < size; a++) for (let b = 0; b <= size - 11; b++) {
    let rowP1 = true, rowP2 = true, colP1 = true, colP2 = true;
    for (let k = 0; k < 11; k++) {
      const v = get(a, b + k), w = get(b + k, a);
      if (v !== p1[k]) rowP1 = false;
      if (v !== p2[k]) rowP2 = false;
      if (w !== p1[k]) colP1 = false;
      if (w !== p2[k]) colP2 = false;
    }
    if (rowP1 || rowP2) score += 40;
    if (colP1 || colP2) score += 40;
  }

  // Rule 4: deviation of dark-module proportion from 50%.
  let dark = 0;
  for (let i = 0; i < size * size; i++) if (cells[i]) dark++;
  const ratio = (dark * 100) / (size * size);
  const lower = Math.floor(ratio / 5) * 5;
  const dev = Math.min(Math.abs(lower - 50), Math.abs(lower + 5 - 50));
  score += (dev / 5) * 10;

  return score;
}

/**
 * Encode `text` (byte mode, error-correction level M) into a QR matrix.
 * The smallest fitting version (1–10) is chosen automatically and the mask with
 * the lowest penalty score is selected per the spec. Returns row-major modules
 * where `true` is a dark module.
 */
export function qrModules(text: string): boolean[][] {
  const bytes = utf8(text);
  const version = pickVersion(bytes.length);
  const cw = buildCodewords(bytes, version);
  const { cells, fn, size } = layout(version, cw);

  let best: Uint8Array | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const cand = cells.slice();
    applyMask(cand, fn, size, mask);
    drawFormat(cand, size, mask);
    const s = penalty(cand, size);
    if (s < bestScore) { bestScore = s; best = cand; }
  }

  const grid = best!;
  const out: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(grid[r * size + c] === 1);
    out.push(row);
  }
  return out;
}

export interface QrSvgOptions {
  moduleSize?: number;
  margin?: number;
  dark?: string;
  light?: string;
}

/**
 * Render `text` as a standalone `<svg>` string (one `<rect>` per dark module on
 * a light background). Defaults: 4px modules, a 4-module quiet zone, dark #111
 * on light #fff, with crisp (non-antialiased) edges. Builds on {@link qrModules}.
 */
export function qrSvg(text: string, options: QrSvgOptions = {}): string {
  const moduleSize = options.moduleSize ?? 4;
  const margin = options.margin ?? 4;
  const dark = options.dark ?? '#111';
  const light = options.light ?? '#fff';
  const m = qrModules(text);
  const n = m.length;
  const dim = (n + margin * 2) * moduleSize;

  const rects: string[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!m[r]![c]) continue;
    const x = (c + margin) * moduleSize;
    const y = (r + margin) * moduleSize;
    rects.push(`<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">`
    + `<rect width="${dim}" height="${dim}" fill="${light}"/>`
    + `<g fill="${dark}">${rects.join('')}</g>`
    + `</svg>`;
}
