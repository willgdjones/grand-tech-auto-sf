import { AD_FALLBACK_NEUTRAL, AD_SLOTS, ROW_2048 } from './constants';
import { RowTexture } from './rowTexture';
import { slotRow } from './texel';

/**
 * The per-ad-slot tables, all addressed by `texelOf(adSlot)` in rows of 2,048 (R6-015) and allocated once at
 * `AD_SLOTS` (slot 0 = none, never written):
 * - `uAdTable` (usampler2D RGBA16UI): `col0, row0, cols, rows` (M3.5c);
 * - `uAdFallback` (sampler2D SRGB8_ALPHA8): the approved per-ad average colour (M4.2), `AD_FALLBACK_NEUTRAL`
 *   until known and after revocation (M3.5c resets it);
 * - `uAdFlags` (usampler2D R8UI): bit0 `resident` (M4.2, R4-025), bits 1–7 the fade level 0…127 (M4.4).
 */
const HEIGHT = Math.ceil(AD_SLOTS / ROW_2048);

function slotIndex(slot: number): number {
  if (!Number.isInteger(slot) || slot < 1 || slot >= AD_SLOTS) throw new RangeError(`AD_SLOT: ${slot}`);
  return slot;
}
function u16(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff)
    throw new RangeError(`AD_TABLE_VALUE: ${what}`);
  return value;
}
function u8(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`AD_TABLE_VALUE: ${what}`);
  return value;
}

export class AdTables {
  private readonly fallbackListeners = new Set<(slot: number) => void>();
  readonly rects = new RowTexture(
    'uAdTable',
    'RGBA16UI',
    new Uint16Array(ROW_2048 * HEIGHT * 4),
    ROW_2048,
    HEIGHT,
  );
  readonly fallback = new RowTexture(
    'uAdFallback',
    'SRGB8_ALPHA8',
    new Uint8Array(ROW_2048 * HEIGHT * 4),
    ROW_2048,
    HEIGHT,
  );
  readonly flags = new RowTexture('uAdFlags', 'R8UI', new Uint8Array(ROW_2048 * HEIGHT), ROW_2048, HEIGHT);
  constructor() {
    for (let i = 0; i < this.fallback.data.length; i += 4) this.fallback.data.set(AD_FALLBACK_NEUTRAL, i);
  }
  /** M3.5c: the ad's rectangle on its surface. */
  setRect(slot: number, col0: number, row0: number, cols: number, rows: number): void {
    const at = slotIndex(slot) * 4;
    this.rects.data[at] = u16(col0, 'col0');
    this.rects.data[at + 1] = u16(row0, 'row0');
    this.rects.data[at + 2] = u16(cols, 'cols');
    this.rects.data[at + 3] = u16(rows, 'rows');
    this.rects.dirty.mark(slotRow(slot));
  }
  rect(slot: number): number[] {
    const at = slotIndex(slot) * 4;
    return Array.from(this.rects.data.subarray(at, at + 4));
  }
  /** M3.5c on slot allocation, slot free and whenever the ad leaves LIVE: neutral colour, not resident. */
  resetSlot(slot: number): void {
    this.fallback.data.set(AD_FALLBACK_NEUTRAL, slotIndex(slot) * 4);
    this.flags.data[slot] = 0;
    this.fallback.dirty.mark(slotRow(slot));
    this.flags.dirty.mark(slotRow(slot));
    for (const listener of this.fallbackListeners) listener(slot);
  }
  /** M4.2: the approved per-ad average (sRGB8). */
  setFallback(slot: number, r: number, g: number, b: number): void {
    this.fallback.data.set([u8(r, 'r'), u8(g, 'g'), u8(b, 'b'), 255], slotIndex(slot) * 4);
    this.fallback.dirty.mark(slotRow(slot));
    for (const listener of this.fallbackListeners) listener(slot);
  }
  /** M3.8 receives metadata changes even when the surface is not resident yet. */
  onFallbackChanged(listener: (slot: number) => void): () => void {
    this.fallbackListeners.add(listener);
    return () => this.fallbackListeners.delete(listener);
  }
  /** M4.2 (R4-025): the approved revision is inside the resident composite. */
  setResident(slot: number, resident: boolean): void {
    const i = slotIndex(slot);
    this.flags.data[i] = (this.flags.data[i]! & 0xfe) | Number(resident);
    this.flags.dirty.mark(slotRow(slot));
  }
  /** M4.4: the fade level 0…127 (127 = fully shown). */
  setFade(slot: number, level: number): void {
    if (!Number.isInteger(level) || level < 0 || level > 127) throw new RangeError('AD_FADE');
    const i = slotIndex(slot);
    this.flags.data[i] = (this.flags.data[i]! & 1) | (level << 1);
    this.flags.dirty.mark(slotRow(slot));
  }
  get bytes(): number {
    return this.rects.bytes + this.fallback.bytes + this.flags.bytes;
  }
  dispose(): void {
    this.fallbackListeners.clear();
    this.rects.dispose();
    this.fallback.dispose();
    this.flags.dispose();
  }
}
