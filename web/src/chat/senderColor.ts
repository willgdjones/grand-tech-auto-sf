/**
 * Stable per-sender chat colour (PLAN-v2.1 §6 / gtasf-6ofg: "messages persist briefly with sender
 * colours"). A pure helper the natural-chat log and the proximity bubbles share so a given speaker
 * always reads in the same hue. The palette is tuned for readability on the SA chat panels (dark,
 * semi-transparent black) — bright, distinct, high-contrast; no near-black entries.
 *
 * Deterministic: the same key (session id or display name) always maps to the same colour, with no
 * state and no allocation. Keep this UI-only; it never affects moderation or transport.
 */
export const SENDER_COLORS: readonly string[] = Object.freeze([
  '#f6a81e', // SA gold
  '#8fe06a', // money green
  '#6cc6ff', // sky blue
  '#ff8ab0', // pink
  '#ffd24a', // yellow
  '#b78bff', // violet
  '#ff9e5a', // orange
  '#5fe0c9', // teal
  '#9be35a', // lime
  '#7fb0ff', // periwinkle
  '#ff7a7a', // coral red
  '#e3e3e3', // menu white
]);

/** Fixed colour for the local player's own lines, so "you" always reads the same regardless of id. */
export const SELF_SENDER_COLOR = '#ffffff';

/** djb2-ish hash → stable index; works for a numeric session id or a display name. */
function hashKey(key: string | number): number {
  if (typeof key === 'number') return Math.abs(Math.trunc(key));
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/** Stable, readable chat colour for a sender. Pass `self: true` for the local player. */
export function senderColor(key: string | number, self = false): string {
  if (self) return SELF_SENDER_COLOR;
  return SENDER_COLORS[hashKey(key) % SENDER_COLORS.length]!;
}
