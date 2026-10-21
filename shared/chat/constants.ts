export { CHAT_MAX_BYTES } from '../protocol/constants';
export const CHAT_MAX_GRAPHEMES = 160;
export const CHAT_RADIUS_M = 40;
export const CHAT_BUBBLE_MS = 7000;

/** Stable room key for the existing uint32 wire field; zero always means nearby chat. */
export function chatEventId(id: string): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(id)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash || 1;
}
