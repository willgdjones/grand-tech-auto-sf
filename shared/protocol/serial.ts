/**
 * Serial-number arithmetic (RFC 1982 style, R1-034) for wrapping counters: u16 MOVE seq and batch ids, u32
 * ticks and batch ids. Only forward deltas below half the range are "newer", so a stale replay after a
 * wrap is never mistaken for new data. Inputs must already be in range (u16 or u32).
 */

/** true iff next is ahead of prev by 1 to 2¹⁵ − 1 (mod 2¹⁶). */
export function seqNewer16(prev: number, next: number): boolean {
  const delta = (next - prev) & 0xffff;
  return delta > 0 && delta < 0x8000;
}

/** The signed distance from prev to next in [−2¹⁵, 2¹⁵). */
export function seqDelta16(prev: number, next: number): number {
  const delta = (next - prev) & 0xffff;
  return delta >= 0x8000 ? delta - 0x1_0000 : delta;
}

/** true iff next is ahead of prev by 1 to 2³¹ − 1 (mod 2³²). */
export function seqNewer32(prev: number, next: number): boolean {
  const delta = (next - prev) >>> 0;
  return delta > 0 && delta < 0x8000_0000;
}

/** The signed distance from prev to next in [−2³¹, 2³¹). */
export function seqDelta32(prev: number, next: number): number {
  const delta = (next - prev) >>> 0;
  return delta >= 0x8000_0000 ? delta - 0x1_0000_0000 : delta;
}
