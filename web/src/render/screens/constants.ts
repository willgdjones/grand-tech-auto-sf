const N_TILES = 150;

/**
 * M3.5a screen table layout (§3.5.2, R6-015). Per-cell tables are 512 texels wide; every per-ad-slot and
 * per-surface table uses rows of 2,048 texels, so one `texelOf` serves them all. `texel.ts` generates the
 * GLSL indexing from these same numbers.
 */
export const TILE_ROW = 512;
export const ROW_2048 = 2048;
/** RGBA32F texels per surface in `uSurfaceTable` (texel0 grid, texel1 atlas, texel2/3 reserved). */
export const SURFACE_TEXELS = 4;
/** Ad slots 1…N_TILES; slot 0 means "none". Allocated once at capacity so the tables never resize. */
export const AD_SLOTS = N_TILES + 1;
/** Float32 represents every integer below 2^24 exactly; table integers must stay below it (R3-039). */
export const FLOAT_EXACT_LIMIT = 2 ** 24;
/**
 * The one dark neutral (sRGB8 RGBA) for unknown and revoked ads. Never a surface average (R1-021); M3.5c,
 * M4.2 and M3.8 import it rather than writing another neutral grey.
 */
export const AD_FALLBACK_NEUTRAL: readonly [number, number, number, number] = Object.freeze([
  28, 29, 32, 255,
]);
/** Screens sit this far in front of their facade (≤ 1 cm) so bezels never z-fight them. */
export const SCREEN_OFFSET_M = 0.005;
/** `uLabels`: three pre-rendered rows in state order (copy keys wired by M3.15a). */
export const LABELS_WIDTH = 1024;
export const LABELS_HEIGHT = 256;
export const LABEL_ROWS = Object.freeze(['inReview', 'awaiting', 'hold'] as const);
