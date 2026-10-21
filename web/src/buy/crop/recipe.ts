import { masterDims } from '@gtasf/shared/master';
import type { CropRecipe } from '../buyFlow.types';

export const DEFAULT_CROP: CropRecipe = Object.freeze({
  rotation: 0,
  mode: 'fill',
  bg: '#000000',
  zoom: 1,
  centreU: 0.5,
  centreV: 0.5,
});
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Persistence and UI actions share this boundary; malformed stored recipes never reach Canvas. */
export function validRecipe(recipe: CropRecipe): CropRecipe {
  if (
    ![0, 90, 180, 270].includes(recipe.rotation) ||
    !['fill', 'fit'].includes(recipe.mode) ||
    !/^#[0-9a-f]{6}$/i.test(recipe.bg) ||
    ![recipe.zoom, recipe.centreU, recipe.centreV].every(Number.isFinite)
  )
    throw new TypeError('Invalid crop recipe');
  return {
    ...recipe,
    bg: recipe.bg.toLowerCase(),
    zoom: clamp(recipe.zoom, 1, 8),
    centreU: clamp(recipe.centreU, 0, 1),
    centreV: clamp(recipe.centreV, 0, 1),
  };
}

export type CropAction =
  | { readonly kind: 'pan'; readonly u: number; readonly v: number }
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'rotate'; readonly direction: 1 | -1 }
  | { readonly kind: 'mode' }
  | { readonly kind: 'background'; readonly colour: string }
  | { readonly kind: 'centre' };

export function changeCrop(current: CropRecipe, action: CropAction): CropRecipe {
  const recipe = validRecipe(current);
  switch (action.kind) {
    case 'pan':
      return validRecipe({
        ...recipe,
        centreU: recipe.centreU + action.u,
        centreV: recipe.centreV + action.v,
      });
    case 'zoom':
      return validRecipe({ ...recipe, zoom: recipe.zoom * action.factor });
    case 'rotate':
      return validRecipe({
        ...recipe,
        rotation: ((recipe.rotation + action.direction * 90 + 360) % 360) as CropRecipe['rotation'],
        // Centre coordinates rotate with the image, preserving the selected subject.
        centreU: action.direction === 1 ? 1 - recipe.centreV : recipe.centreV,
        centreV: action.direction === 1 ? recipe.centreU : 1 - recipe.centreU,
      });
    case 'mode':
      return { ...recipe, mode: recipe.mode === 'fill' ? 'fit' : 'fill' };
    case 'background':
      return validRecipe({ ...recipe, bg: action.colour });
    case 'centre':
      return { ...recipe, centreU: 0.5, centreV: 0.5 };
  }
}

export function cropKeyAction(key: string, shift = false): CropAction | 'accept' | null {
  const step = shift ? 0.1 : 0.01;
  switch (key) {
    case 'ArrowLeft':
      return { kind: 'pan', u: -step, v: 0 };
    case 'ArrowRight':
      return { kind: 'pan', u: step, v: 0 };
    case 'ArrowUp':
      return { kind: 'pan', u: 0, v: -step };
    case 'ArrowDown':
      return { kind: 'pan', u: 0, v: step };
    case '+':
    case '=':
      return { kind: 'zoom', factor: 1.1 };
    case '-':
      return { kind: 'zoom', factor: 0.9 };
    case 'r':
    case 'R':
      return { kind: 'rotate', direction: shift ? -1 : 1 };
    case 'f':
    case 'F':
      return { kind: 'mode' };
    case 'Enter':
      return 'accept';
    default:
      return null;
  }
}

export interface CropGeometry {
  readonly rotatedWidth: number;
  readonly rotatedHeight: number;
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  /** Visible rectangle in rotated source pixels. Fit may include letterbox outside the source. */
  readonly sourceRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export function cropGeometry(
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
  input: CropRecipe,
): CropGeometry {
  if (![width, height, targetWidth, targetHeight].every((value) => Number.isFinite(value) && value > 0))
    throw new RangeError('Invalid crop dimensions');
  const recipe = validRecipe(input);
  const rotatedWidth = recipe.rotation % 180 === 0 ? width : height;
  const rotatedHeight = recipe.rotation % 180 === 0 ? height : width;
  const base = (recipe.mode === 'fill' ? Math.max : Math.min)(
    targetWidth / rotatedWidth,
    targetHeight / rotatedHeight,
  );
  const scale = base * recipe.zoom;
  const viewWidth = targetWidth / scale,
    viewHeight = targetHeight / scale;
  let cx = recipe.centreU * rotatedWidth,
    cy = recipe.centreV * rotatedHeight;
  if (recipe.mode === 'fill') {
    cx = clamp(cx, viewWidth / 2, rotatedWidth - viewWidth / 2);
    cy = clamp(cy, viewHeight / 2, rotatedHeight - viewHeight / 2);
  }
  const x = targetWidth / 2 - cx * scale,
    y = targetHeight / 2 - cy * scale;
  return {
    rotatedWidth,
    rotatedHeight,
    scale,
    x,
    y,
    sourceRect: { x: -x / scale, y: -y / scale, width: viewWidth, height: viewHeight },
  };
}

export function cropQuality(width: number, height: number, cols: number, rows: number, recipe: CropRecipe) {
  const master = masterDims(cols, rows);
  const ratio = 1 / cropGeometry(width, height, master.width, master.height, recipe).scale;
  const level = ratio < 0.25 ? 'red' : ratio < 0.5 ? 'amber' : 'none';
  const message = level === 'red' ? 'will look very blurry' : level === 'amber' ? 'may look blurry' : '';
  return { ratio, level, message } as const;
}

/** Pixel cap applies after DPR. Rounding down guarantees the allocated area never exceeds it. */
export function cropCanvasSize(
  cssWidth: number,
  cols: number,
  rows: number,
  dpr: number,
  maxPixels = 3_000_000,
) {
  masterDims(cols, rows); // Reuse the rectangle dimension validation.
  if (![cssWidth, dpr, maxPixels].every((value) => Number.isFinite(value) && value > 0))
    throw new RangeError('Invalid crop viewport');
  const width = Math.max(1, Math.floor(Math.min(cssWidth * dpr, Math.sqrt((maxPixels * cols) / rows))));
  const height = Math.max(1, Math.floor(Math.min((width * rows) / cols, maxPixels / width)));
  return { width, height };
}

export function cropSummary(input: CropRecipe): string {
  const recipe = validRecipe(input);
  const centre =
    recipe.centreU === 0.5 && recipe.centreV === 0.5
      ? 'centred'
      : `centre ${Math.round(recipe.centreU * 100)}%, ${Math.round(recipe.centreV * 100)}%`;
  return `${recipe.mode === 'fill' ? 'Fill' : 'Fit'}, ${centre}, ${Math.round(recipe.zoom * 100)}%${recipe.rotation ? `, rotated ${recipe.rotation}°` : ''}`;
}
