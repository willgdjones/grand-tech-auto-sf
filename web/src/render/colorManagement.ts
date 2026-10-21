import { ColorManagement } from 'three';

/**
 * Pin three.js colour management ON so the whole-screen San Andreas grade stays correct.
 *
 * The time-of-day grade (`timeGrade.ts`) is the single biggest part of the SA look
 * ("the sky tints everything", docs/art/SA-STYLE.md #1). It is built by lerping
 * between sRGB **hex** keyframes with `new Color('#hex').lerp(...)`. That blend only
 * happens in LINEAR space while `ColorManagement.enabled` is true — otherwise the hex
 * is kept as raw sRGB and every sky/fog/light colour blends in the wrong space, which
 * is exactly the "sky values must use the correct colour space" mistake called out in
 * the BDTS lessons (AGENTS.md) and the overnight review (docs/review/2026-10-03.md).
 *
 * three r152+ enables this by default (we ship 0.186.1) and `foundation.ts` sets
 * `outputColorSpace = SRGBColorSpace`, so the look is already correct. Pinning it here
 * makes the dependency explicit and regression-proof: a future library-default change
 * or any module flipping the global can no longer silently shift the grade.
 */
export function enableLinearColorManagement(): void {
  ColorManagement.enabled = true;
}
