/**
 * The rain-wet ground signal (0..1). foundation.ts writes it each frame through urbanSurfaces' `uWet` uniform
 * (wetRoads), and with wetLampStreaks urbanSurfaces hands out THIS object as that uniform, so other ground
 * hooks (lampLightMap's wet reflection streaks) read the same value with no extra per-frame write.
 */
export const wetSignal: { value: number } = { value: 0 };
