import { expect, test } from 'vitest';
import { qrModules, qrSvg } from './qr';

// These tests verify qr.ts two ways, neither of which trusts qr.ts's own code:
//   1. Published vectors — the ISO/IEC 18004 level-M format-information table
//      and the Annex A Reed-Solomon generator polynomial (degree 10).
//   2. A fully independent QR *decoder* implemented below (its own GF(256), its
//      own geometry, its own RS syndrome check). We encode with qrModules(),
//      decode the matrix back, and assert the text (and EC level, mask, version
//      info, and RS consistency) all check out.

// --- independent GF(256) (primitive polynomial 0x11d) ------------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);
const popcount = (x: number): number => { let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; };

// --- tables duplicated independently from qr.ts ------------------------------
const EC_M: Record<number, readonly [number, ReadonlyArray<readonly [number, number]>]> = {
  1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]],
  5: [24, [[2, 43]]], 6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]],
};
const ALIGN: Record<number, readonly number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// --- reference primitives ----------------------------------------------------
function refFormat(data5: number): number { // BCH(15,5) + 0x5412, as in the spec
  let rem = data5;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537);
  return ((data5 << 10) | rem) ^ 0x5412;
}
function refVersion(v: number): number { // BCH(18,6) version information
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >> 11) & 1) * 0x1f25);
  return (v << 12) | rem;
}
function refGenerator(ec: number): number[] {
  let poly = [1];
  for (let i = 0; i < ec; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j]! ^= poly[j]!; next[j + 1]! ^= mul(poly[j]!, EXP[i]!); }
    poly = next;
  }
  return poly;
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
function formatPositions(size: number): Array<[number, number]> {
  const p: Array<[number, number]> = [];
  for (let i = 0; i <= 5; i++) p.push([i, 8]);
  p.push([7, 8], [8, 8], [8, 7]);
  for (let i = 9; i < 15; i++) p.push([8, 14 - i]);
  for (let i = 0; i < 8; i++) p.push([8, size - 1 - i]);
  for (let i = 8; i < 15; i++) p.push([size - 15 + i, 8]);
  return p;
}

// Rebuild the function/reserved map from geometry alone (no data knowledge).
function functionMap(version: number): Uint8Array {
  const size = version * 4 + 17;
  const fn = new Uint8Array(size * size);
  const mark = (r: number, c: number): void => { if (r >= 0 && r < size && c >= 0 && c < size) fn[r * size + c] = 1; };
  for (const [cr, cc] of [[3, 3], [3, size - 4], [size - 4, 3]] as const)
    for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) mark(cr + dr, cc + dc);
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  const coords = ALIGN[version]!;
  for (const ar of coords) for (const ac of coords) {
    if ((ar === 6 && ac === 6) || (ar === 6 && ac === size - 7) || (ar === size - 7 && ac === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(ar + dr, ac + dc);
  }
  mark(size - 8, 8);
  for (const [r, c] of formatPositions(size)) mark(r, c);
  if (version >= 7) for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3); mark(b, a); mark(a, b); }
  return fn;
}

// Independent decoder: recovers the byte-mode payload from a QR matrix. Asserts
// EC level M, the format bits match the ISO table, version info (v>=7), and
// that every block is a valid RS codeword (all syndromes zero).
function decode(mods: boolean[][]): string {
  const size = mods.length;
  expect((size - 17) % 4).toBe(0);
  const version = (size - 17) / 4;
  const cell = (r: number, c: number): number => (mods[r]![c] ? 1 : 0);

  // Format information (copy 1) → BCH-decode to EC level + mask.
  const fpos = formatPositions(size);
  let fval = 0;
  for (let i = 0; i < 15; i++) { const [r, c] = fpos[i]!; fval |= cell(r, c) << i; }
  let data5 = -1, dist = 99;
  for (let d = 0; d < 32; d++) { const dd = popcount(refFormat(d) ^ fval); if (dd < dist) { dist = dd; data5 = d; } }
  expect(dist).toBeLessThanOrEqual(3);
  const ecl = data5 >> 3, mask = data5 & 7;
  expect(ecl).toBe(0); // level M
  expect(fval).toBe(refFormat(data5)); // encoder's format modules == ISO value

  if (version >= 7) {
    let vval = 0;
    for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3); vval |= cell(b, a) << i; }
    let v = -1, vd = 99;
    for (let d = 1; d <= 40; d++) { const dd = popcount(refVersion(d) ^ vval); if (dd < vd) { vd = dd; v = d; } }
    expect(vd).toBeLessThanOrEqual(3);
    expect(v).toBe(version);
  }

  const [ec, blocks] = EC_M[version]!;
  const totalData = blocks.reduce((s, [n, k]) => s + n * k, 0);
  const numBlocks = blocks.reduce((s, [n]) => s + n, 0);
  const total = totalData + ec * numBlocks;

  // Read + unmask codeword bits in the zig-zag order.
  const fn = functionMap(version);
  const bits: number[] = [];
  const maxBits = total * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const c = right - j;
      const upward = ((right + 1) & 2) === 0;
      const r = upward ? size - 1 - v : v;
      if (fn[r * size + c]) continue;
      if (bits.length < maxBits) bits.push(cell(r, c) ^ (maskBit(mask, r, c) ? 1 : 0));
    }
  }
  const codes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) { let x = 0; for (let j = 0; j < 8; j++) x = (x << 1) | bits[i + j]!; codes.push(x); }
  expect(codes.length).toBe(total);

  // De-interleave into blocks.
  const sizes: number[] = [];
  for (const [n, k] of blocks) for (let i = 0; i < n; i++) sizes.push(k);
  const dBlocks: number[][] = sizes.map(() => []);
  const eBlocks: number[][] = sizes.map(() => []);
  let p = 0;
  const maxK = Math.max(...sizes);
  for (let i = 0; i < maxK; i++) for (let b = 0; b < sizes.length; b++) if (i < sizes[b]!) dBlocks[b]!.push(codes[p++]!);
  for (let i = 0; i < ec; i++) for (let b = 0; b < sizes.length; b++) eBlocks[b]!.push(codes[p++]!);

  // RS syndrome check: a valid codeword evaluates to zero at α^0..α^(ec-1).
  for (let b = 0; b < sizes.length; b++) {
    const full = [...dBlocks[b]!, ...eBlocks[b]!];
    for (let j = 0; j < ec; j++) {
      let val = 0; const a = EXP[j]!;
      for (const coef of full) val = mul(val, a) ^ coef;
      expect(val).toBe(0);
    }
  }

  // Parse the byte-mode segment.
  const dataBits: number[] = [];
  for (const blk of dBlocks) for (const byte of blk) for (let i = 7; i >= 0; i--) dataBits.push((byte >> i) & 1);
  let pos = 0;
  const read = (len: number): number => { let x = 0; for (let i = 0; i < len; i++) x = (x << 1) | dataBits[pos++]!; return x; };
  expect(read(4)).toBe(0b0100); // byte mode
  const count = read(version <= 9 ? 8 : 16);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(read(8));
  return out.map((b) => String.fromCharCode(b)).join(''); // inputs are ASCII
}

// ---------------------------------------------------------------------------
// Published vector 1: ISO/IEC 18004 level-M (EC bits 00) format-information
// strings, one per mask. Validates the reference BCH used throughout the tests.
const ISO_M_FORMAT = [
  0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011,
  0b100010111111001, 0b100000011001110, 0b100111110010111, 0b100101010100000,
];
test('format information matches the ISO/IEC 18004 level-M table', () => {
  for (let mask = 0; mask < 8; mask++) expect(refFormat((0b00 << 3) | mask)).toBe(ISO_M_FORMAT[mask]);
});

// Published vector 2: ISO/IEC 18004 Annex A generator polynomial for 10 EC
// codewords, as α exponents; and its defining roots α^0..α^9.
test('Reed-Solomon generator matches ISO/IEC 18004 Annex A (degree 10)', () => {
  const g = refGenerator(10);
  expect(g.map((c) => LOG[c]!)).toEqual([0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45]);
  for (let i = 0; i < 10; i++) { let val = 0; const a = EXP[i]!; for (const c of g) val = mul(val, a) ^ c; expect(val).toBe(0); }
});

// ---------------------------------------------------------------------------
// Decode round-trip across several inputs, including lengths that force larger
// versions (v7 version info; v10 version info + 16-bit character count).
const forty = '0123456789'.repeat(4);                 // 40 chars  -> v3
const long120 = 'A1b2'.repeat(30);                      // 120 chars -> v7
const long200 = 'GTASF'.repeat(40);                     // 200 chars -> v10
const INPUTS = ['A', 'GTASF-ABCD-2345', 'https://gtasf.com', forty, long120, long200];
for (const input of INPUTS) {
  test(`decode round-trip: ${JSON.stringify(input.slice(0, 20))} (${input.length} chars)`, () => {
    expect(decode(qrModules(input))).toBe(input);
  });
}

// ---------------------------------------------------------------------------
// Structural invariants.
const FINDER = [
  [1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 1], [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1],
];
function finderAt(m: boolean[][], r0: number, c0: number): boolean {
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) if ((m[r0 + r]![c0 + c] ? 1 : 0) !== FINDER[r]![c]) return false;
  return true;
}

test('three 7x7 finder patterns sit at the top-left, top-right and bottom-left corners', () => {
  const m = qrModules('A');
  const n = m.length;
  expect(finderAt(m, 0, 0)).toBe(true);
  expect(finderAt(m, 0, n - 7)).toBe(true);
  expect(finderAt(m, n - 7, 0)).toBe(true);
});

test('version selection yields size 21 + 4*(version-1)', () => {
  expect(qrModules('A').length).toBe(21);                 // v1
  expect(qrModules('GTASF-ABCD-2345').length).toBe(25);   // v2 (15 bytes > v1's 14)
  expect(qrModules(forty).length).toBe(29);               // v3
  expect(qrModules(long120).length).toBe(45);             // v7
  expect(qrModules(long200).length).toBe(57);             // v10
  for (const m of [qrModules('A'), qrModules(forty)]) expect((m.length - 21) % 4).toBe(0);
});

test('qrSvg is well-formed, has the quiet zone, and one rect per dark module', () => {
  const text = 'GTASF-ABCD-2345';
  const m = qrModules(text);
  const n = m.length;
  const darkCount = m.flat().filter(Boolean).length;
  const svg = qrSvg(text);

  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg.endsWith('</svg>')).toBe(true);
  expect(svg).toContain('shape-rendering="crispEdges"');
  expect(svg).toContain('fill="#111"');
  expect(svg).toContain('fill="#fff"');

  const dim = (n + 4 * 2) * 4; // default margin 4 modules, moduleSize 4
  expect(svg).toContain(`width="${dim}" height="${dim}"`);
  expect(svg).toContain(`viewBox="0 0 ${dim} ${dim}"`);

  // One module <rect> (x=) per dark module; background rect has no x attribute.
  const moduleRects = svg.match(/<rect x="/g) ?? [];
  expect(moduleRects.length).toBe(darkCount);

  // Quiet zone: no module rect is placed inside the 4-module margin.
  const coords = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)"/g)];
  const minCoord = Math.min(...coords.flatMap((mm) => [Number(mm[1]), Number(mm[2])]));
  expect(minCoord).toBeGreaterThanOrEqual(16); // 4 modules * 4px
});

test('qrSvg honours moduleSize, margin and colour options', () => {
  const svg = qrSvg('A', { moduleSize: 8, margin: 2, dark: '#000', light: '#eee' });
  const n = qrModules('A').length;
  const dim = (n + 2 * 2) * 8;
  expect(svg).toContain(`width="${dim}" height="${dim}"`);
  expect(svg).toContain('fill="#000"');
  expect(svg).toContain('fill="#eee"');
  expect(svg).toContain('width="8" height="8"');
});
