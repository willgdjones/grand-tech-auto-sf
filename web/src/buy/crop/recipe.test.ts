import { expect, it } from 'vitest';
import { DEFAULT_CROP, changeCrop, cropCanvasSize, cropGeometry } from './recipe';
it('rotates crop centre with the subject and respects decoded canvas budget', () => {
  const recipe = changeCrop({ ...DEFAULT_CROP, centreU: .2, centreV: .4 }, { kind: 'rotate', direction: 1 });
  expect(recipe.centreU).toBe(.6); expect(recipe.centreV).toBe(.2);
  const size = cropCanvasSize(4000, 4, 3, 3, 1048576); expect(size.width * size.height).toBeLessThanOrEqual(1048576);
  const crop = cropGeometry(1600, 900, 400, 300, DEFAULT_CROP); expect(crop.sourceRect.width).toBeLessThanOrEqual(1600); expect(crop.sourceRect.height).toBeLessThanOrEqual(900);
});
