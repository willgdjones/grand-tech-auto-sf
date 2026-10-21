import { QUALITY_TIERS } from '../config';
import type { QualityTier } from './qualityTier';
import { flags } from '@gtasf/shared/flags';
import { graphicsPreset } from './graphicsPreset';

export interface ViewportSize {
  cssW: number;
  cssH: number;
  aspect: number;
  effectiveDpr: number;
  width: number;
  height: number;
}
/** Scale is 1 on High/Medium until the degradation ladder requests a lower ceiling. */
export function drawingSize(
  tier: QualityTier,
  cssW: number,
  cssH: number,
  dpr: number,
  scale = 1,
  maxEdge = Infinity,
): ViewportSize | undefined {
  if (
    !Number.isFinite(cssW * cssH) ||
    cssW <= 0 ||
    cssH <= 0 ||
    !Number.isFinite(dpr) ||
    dpr <= 0 ||
    !Number.isFinite(scale) ||
    Number.isNaN(maxEdge) ||
    maxEdge < 1
  )
    return;
  const boundedScale = Math.max(0.6, Math.min(1, scale));
  // Founder-approved graphics preview: a modest HD sharpness lift, still bounded
  // in total pixels. Low and the production baseline keep their measured budgets.
  const hdPolish = flags.graphicsV2 && tier !== 'low' && graphicsPreset() === 'hd';
  const pixelCap = hdPolish ? (tier === 'high' ? 2_800_000 : 2_100_000) : QUALITY_TIERS[tier].pixelCap;
  const effectiveDpr = Math.min(
    Math.min(dpr, tier === 'low' || hdPolish ? 2 : 1.5) * boundedScale,
    Math.sqrt(pixelCap / (cssW * cssH)),
    maxEdge / cssW,
    maxEdge / cssH,
  );
  const width = Math.floor(cssW * effectiveDpr);
  const height = Math.floor(cssH * effectiveDpr);
  if (width < 1 || height < 1) return;
  return { cssW, cssH, aspect: cssW / cssH, effectiveDpr, width, height };
}
