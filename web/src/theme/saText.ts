/**
 * Shared San Andreas theme primitives for canvas-drawn HUD (radar, world markers, checkpoint labels)
 * and any pane needing the palette in JS. Mirrors the tokens in saTheme.css (gtasf-v2-sa-hud-theme).
 * SA look: solid fills with a THICK BLACK OUTLINE and no soft shadows; a condensed display font for
 * big/blocky text; money in dark green with leading zeros.
 */
export const SA_COLORS = Object.freeze({
  moneyGreen: '#345f27',
  moneyRed: '#a2191c',
  barRed: '#b81d21',
  barWhite: '#e3e3e3',
  barBlue: '#b2cef2',
  gold: '#f0b429',
  titleGold: '#f6a81e',
  titleOrange: '#e3651d',
  menuWhite: '#ffffff',
  menuBlue: '#b2cef2',
  clockGrey: '#dcdcdc',
  ink: '#000000',
  panel: 'rgba(0,0,0,0.62)',
  panelStrong: 'rgba(0,0,0,0.82)',
});

/** No pricedown font is bundled (licensing); this condensed-bold stack approximates it. */
export const SA_FONTS = Object.freeze({
  display: "'Haettenschweiler', 'Arial Narrow Bold', 'Arial Narrow', 'Impact', sans-serif",
  sans: 'Arial, Helvetica, sans-serif',
});

export interface OutlinedTextOptions {
  font: string;
  fill: string;
  outline?: string;
  /** Outline width in px; defaults to 4 (round-joined so corners stay solid). */
  lineWidth?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
}

/**
 * Draw SA-style text: a thick black (round-joined) outline under a solid fill, no drop shadow.
 * Saves/restores the context so callers' state is untouched.
 */
export function drawOutlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, opts: OutlinedTextOptions): void {
  ctx.save();
  ctx.font = opts.font;
  if (opts.align) ctx.textAlign = opts.align;
  if (opts.baseline) ctx.textBaseline = opts.baseline;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = opts.lineWidth ?? 4;
  ctx.strokeStyle = opts.outline ?? SA_COLORS.ink;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = opts.fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** SA money string from integer cents: `$` + zero-padded whole dollars (min width), SA-counter style. */
export function saMoneyCents(cents: string | bigint, minDigits = 8): string {
  let value: bigint;
  try { value = typeof cents === 'bigint' ? cents : BigInt(cents); } catch { return `$${'0'.repeat(minDigits)}`; }
  const negative = value < 0n;
  const dollars = (negative ? -value : value) / 100n;
  return `${negative ? '-' : ''}$${dollars.toString().padStart(minDigits, '0')}`;
}

/** SA money string from whole dollars (e.g. an already-computed total). */
export function saMoneyDollars(dollars: number, minDigits = 8): string {
  const negative = dollars < 0;
  const whole = Math.abs(Math.trunc(dollars));
  return `${negative ? '-' : ''}$${String(whole).padStart(minDigits, '0')}`;
}

/** `★★★☆☆`-style stage stars (filled out of total) for the HUD; render each with an SA gold+outline. */
export function saStars(filled: number, total = 5): { filled: number; total: number; glyphs: string } {
  const f = Math.max(0, Math.min(total, Math.round(filled)));
  return { filled: f, total, glyphs: '★'.repeat(f) + '☆'.repeat(Math.max(0, total - f)) };
}
