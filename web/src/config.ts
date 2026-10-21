/** Initial §3.11 policy. Change only with M3.11c/M15.3 device measurements. */
export const QUALITY_TIERS = {
  high: {
    frameMs: 1000 / 60,
    layers: 4,
    q: 1,
    tmax: 64,
    bloomLevels: 5,
    bloomScale: 0.5,
    gpuMiB: 256,
    chunk: 'full',
    pixelCap: 2_100_000,
  },
  medium: {
    frameMs: 1000 / 60,
    layers: 3,
    q: 0.75,
    tmax: 64,
    bloomLevels: 4,
    bloomScale: 0.5,
    gpuMiB: 160,
    chunk: 'full',
    pixelCap: 1_500_000,
  },
  low: {
    frameMs: 1000 / 30,
    floorFps: 24,
    layers: 2,
    q: 0.5,
    tmax: 32,
    bloomLevels: 3,
    bloomScale: 0.25,
    gpuMiB: 96,
    chunk: 'low',
    pixelCap: 800_000,
  },
} as const;
/** Touch devices at/below this memory class start Low; missing memory also starts Low. */
export const QUALITY_TOUCH_MEMORY_GIB = 4;
/** Desktop High requires both this memory class and this logical CPU count. */
export const QUALITY_DESKTOP_MEMORY_GIB = 8;
export const QUALITY_DESKTOP_CORES = 8;
/** Mandatory checks still run if a synchronous driver call overruns; optional HDR is discarded. */
export const CAPABILITY_BUDGET_MS = 250;
/** §3.5.2: tile, surface, ad, fallback, flags, atlas, labels; surface is also sampled in vertex. */
export const SCREEN_FRAGMENT_SAMPLERS = 7;
export const SCREEN_VERTEX_SAMPLERS = 1;
/** First-frame sampling window and strictly-greater-than degradation threshold. */
export const QUALITY_WARMUP_MS = 3000;
export const QUALITY_WARMUP_FACTOR = 1.3;
/** Only explicitly attributed asset-upload bookkeeping beyond this duration is excluded. */
export const QUALITY_UPLOAD_EXCLUSION_MS = 200;
