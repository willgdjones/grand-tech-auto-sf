/**
 * Alamo Square "Painted Ladies" body + trim colour schemes (bead gtasf-painted-lady-colour-variety-mv1y;
 * docs/art/SA-STYLE.md). The real Steiner St "Seven Sisters" are a run of muted Victorian/Italianate
 * pastels, each house a different one — so a single flat facade colour reads wrong. This gives each
 * building in the row a distinct scheme (adjacent houses never share one) and wraps deterministically for
 * any extra buildings.
 *
 * Ready module contract for the facade-styling pane (web/src/render/buildingDetail.ts): apply `body` as the
 * wall vertex/material colour and `trim` to cornices/window frames. Colours are chosen to read under the SA
 * time-of-day grade (docs/art/SA-STYLE.md §1); pane 6 confirms the in-game look at Alamo Square.
 */
export interface PaintedLadyScheme {
  /** Wall body colour (0xRRGGBB). */
  readonly body: number;
  /** Trim/cornice accent colour (0xRRGGBB). */
  readonly trim: number;
}

// Muted Victorian pastels sampled to evoke the real Steiner St row; ordered so neighbours contrast.
const SCHEMES: readonly PaintedLadyScheme[] = Object.freeze([
  { body: 0xbfd3c1, trim: 0xf3efe0 }, // sage green / cream
  { body: 0xa8c0d6, trim: 0xf5f1e6 }, // dusty blue / ivory
  { body: 0xe8d8a8, trim: 0x8a7b55 }, // pale ochre / walnut
  { body: 0xd9b6a3, trim: 0xf0e4d8 }, // terracotta rose / cream
  { body: 0xcfc3d6, trim: 0xf2ece2 }, // mauve-grey / ivory
  { body: 0xbfc9a8, trim: 0x7e8a5c }, // olive / sage trim
  { body: 0xe2c7b0, trim: 0x9c6b4a }, // tan / chestnut trim
]);

export const PAINTED_LADY_SCHEME_COUNT = SCHEMES.length;

/**
 * A deterministic scheme for the building at `index` in the row. Sequential indices step through distinct
 * schemes (so adjacent houses differ), wrapping after {@link PAINTED_LADY_SCHEME_COUNT}. Handles negative
 * and fractional indices defensively.
 */
export function paintedLadyScheme(index: number): PaintedLadyScheme {
  const n = SCHEMES.length;
  const i = ((Math.trunc(index) % n) + n) % n;
  return SCHEMES[i]!;
}
