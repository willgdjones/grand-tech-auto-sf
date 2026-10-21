import { ROW_2048, SURFACE_TEXELS, TILE_ROW } from './constants';

/**
 * The single definition of table indexing (R6-015), for TypeScript and GLSL alike. `cellTexel` addresses the
 * 512-wide per-cell tables; `texelOf` the 2,048-wide per-ad-slot tables (slot 0 = none); `surfaceTexel` the
 * surface table (ids are 1-based, id 0 unused). Row helpers let writers mark dirty rows without allocating.
 */
export const cellRow = (cell: number): number => Math.floor(cell / TILE_ROW);
export const slotRow = (slot: number): number => Math.floor(slot / ROW_2048);
export const surfaceRow = (id: number, k: number): number => slotRow(id * SURFACE_TEXELS + k);

export function cellTexel(cell: number): readonly [number, number] {
  return [cell % TILE_ROW, cellRow(cell)];
}
export function texelOf(adSlot: number): readonly [number, number] {
  return [adSlot % ROW_2048, slotRow(adSlot)];
}
export function surfaceTexel(id: number, k: number): readonly [number, number] {
  return texelOf(id * SURFACE_TEXELS + k);
}

/** GLSL ES 3.00 include: the same functions, generated from the same constants. */
export const TEXEL_GLSL = /* glsl */ `
const uint TILE_ROW = ${TILE_ROW}u;
const uint ROW_2048 = ${ROW_2048}u;
const uint SURFACE_TEXELS = ${SURFACE_TEXELS}u;
ivec2 cellTexel(uint cell) { return ivec2(int(cell % TILE_ROW), int(cell / TILE_ROW)); }
ivec2 texelOf(uint adSlot) { return ivec2(int(adSlot % ROW_2048), int(adSlot / ROW_2048)); }
ivec2 surfaceTexel(uint id, uint k) { return texelOf(id * SURFACE_TEXELS + k); }
`;
