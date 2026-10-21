import { quoteFunding } from '@gtasf/shared/funding';
import type { RadarEvent } from '../radar/radar';
import type { GraphicsPreset } from '../render/graphicsPreset';
import type { VenueGroup } from './venues';

export const labelLimits = (preset: GraphicsPreset, phone = false) => preset === 'low' || phone
  ? { range: 250, count: 6, canvasWidth: 512 } : { range: 500, count: 60, canvasWidth: 768 };
export function selectLabelCandidates<T extends { distance: number }>(values: readonly T[], preset: GraphicsPreset, phone = false): T[] {
  const limits = labelLimits(preset, phone);
  return values.filter(v => v.distance <= limits.range).sort((a, b) => a.distance - b.distance).slice(0, limits.count);
}
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
/** What one pass through this ring pays now (a lone player, streak 1): the server pays EVERY visible event at
 *  the venue, each at its live/upcoming/follow-up rate, so the label shows that sum on the active (v3) base. */
export function venuePayout(event: RadarEvent, group: VenueGroup | null, now = Date.now()): bigint {
  return (group ? group.focus.map(v => v.event) : [event]).reduce((sum, value) => {
    try { return sum + BigInt(quoteFunding(value, now, 0, 1).amountCents); } catch { return sum; }
  }, 0n);
}
export function payoutText(cents: bigint): string {
  const dollars = cents / 100n;
  if (dollars < 1000n) return `$${dollars}`;
  const divisor = dollars >= 1_000_000n ? 1_000_000n : 1000n;
  const tenths = (dollars * 10n + divisor / 2n) / divisor;
  return `$${tenths / 10n}${tenths % 10n ? `.${tenths % 10n}` : ''}${divisor === 1000n ? 'k' : 'm'}`;
}
export interface WorldLabelText { title: string; badge: string; detail: string; live: boolean }
export function worldLabelText(event: RadarEvent, group: VenueGroup | null, distance: number, now: number): WorldLabelText {
  const start = Date.parse(event.start), end = Date.parse(event.end ?? '') || start + 2 * 60 * 60_000;
  const live = start <= now && now < end;
  const near = distance <= 80;
  return {
    title: event.title,
    badge: live ? 'LIVE NOW' : near && Number.isFinite(start) ? timeFormat.format(start) : '',
    detail: near ? [payoutText(venuePayout(event, group, now)), event.host ? `by ${event.host}` : '', event.venue || group?.title || ''].filter(Boolean).join(' · ') : '',
    live,
  };
}

/** Pixel boxes, with y increasing downwards. Same strict intersection rule as radar districts. */
export interface LabelBox { x: number; y: number; width: number; height: number }
export interface LabelAnchor extends LabelBox { id: string; distance: number }
export interface LabelPlacement extends LabelAnchor { compact: boolean }
export function labelsOverlap(a: LabelBox, b: LabelBox, pad = 3): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + pad && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + pad;
}
export function layoutWorldLabels(input: readonly LabelAnchor[], width: number, height: number): LabelPlacement[] {
  const ordered = [...input].sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  const placed: LabelPlacement[] = [];
  const margin = 12;
  for (const anchor of ordered) {
    let found: LabelPlacement | undefined;
    for (const compact of [false, true]) {
      const w = Math.min(anchor.width * (compact ? .72 : 1), width - margin * 2);
      const h = compact ? 24 : anchor.height;
      const x = Math.max(margin + w / 2, Math.min(width - margin - w / 2, anchor.x));
      for (let step = 0; step < 12; step++) {
        const y = Math.min(height - margin - h / 2, anchor.y) - step * (h + 5);
        if (y - h / 2 < margin) break;
        const candidate = { ...anchor, x, y, width: w, height: h, compact };
        if (!placed.some(other => labelsOverlap(candidate, other))) { found = candidate; break; }
      }
      if (found) break;
    }
    if (!found) {
      // A finite viewport cannot fit arbitrarily many full titles in one vertical stack.
      // Pack compact title chips in viewport cells instead of pushing them offscreen or hiding.
      // All chosen venues remain represented; leader lines preserve their world anchors.
      const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length * width / height * .22)));
      const rows = Math.ceil(ordered.length / columns);
      const cellW = (width - margin * 2) / columns, cellH = Math.min(32, (height - margin * 2) / rows);
      return ordered.map((value, index) => ({ ...value, compact: true,
        x: margin + (index % columns + .5) * cellW, y: margin + (Math.floor(index / columns) + .5) * cellH,
        width: Math.max(1, cellW - 5), height: Math.max(1, cellH - 5) }));
    }
    placed.push(found);
  }
  return placed;
}
/** Smooth only when the whole intermediate arrangement is still collision-free. */
export function smoothLabelPlacements(previous: ReadonlyMap<string, LabelPlacement>, target: readonly LabelPlacement[], alpha: number, width = Infinity, height = Infinity): LabelPlacement[] {
  const next = target.map(value => {
    const old = previous.get(value.id);
    return old ? { ...value, x: old.x + (value.x - old.x) * alpha, y: old.y + (value.y - old.y) * alpha } : value;
  });
  if (next.some(v => v.x - v.width / 2 < 0 || v.y - v.height / 2 < 0 || v.x + v.width / 2 > width || v.y + v.height / 2 > height)) return [...target];
  for (let i = 0; i < next.length; i++) for (let j = 0; j < i; j++) if (labelsOverlap(next[i]!, next[j]!)) return [...target];
  return next;
}
