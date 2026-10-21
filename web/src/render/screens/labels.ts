import { LABEL_ROWS, LABELS_HEIGHT, LABELS_WIDTH } from './constants';
import { RowTexture } from './rowTexture';

/**
 * `uLabels` (sampler2D RGBA8, 1024 × 256): the pre-rendered "SOLD · IN REVIEW", "SOLD · AWAITING ARTWORK" and
 * "ON HOLD" labels, white on transparent, one band of `LABEL_BAND_PX` texel rows each in `LABEL_ROWS` order.
 * Texel row 0 is the canvas's top row (flipY = false). Drawn with the system UI font stack only, after the
 * first frame, so no font request can delay it (CSP `font-src 'self'`). Callers pass the strings for the copy
 * keys `state.inReview`, `state.awaiting` and `state.hold` (M3.15a).
 */
export const LABEL_BAND_PX = Math.floor(LABELS_HEIGHT / LABEL_ROWS.length);
export const LABEL_FONT_STACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export type LabelStrings = Readonly<Record<(typeof LABEL_ROWS)[number], string>>;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Resolve each concrete canvas overload before joining the resulting 2D context types. */
function context2d(make?: () => { getContext(kind: '2d'): Context2D | null }): Context2D {
  const context = make
    ? make().getContext('2d')
    : typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(LABELS_WIDTH, LABELS_HEIGHT).getContext('2d')
      : Object.assign(document.createElement('canvas'), {
          width: LABELS_WIDTH,
          height: LABELS_HEIGHT,
        }).getContext('2d');
  if (!context) throw new Error('LABELS_CANVAS');
  return context;
}

export function createLabelsTexture(): RowTexture<'RGBA8'> {
  return new RowTexture(
    'uLabels',
    'RGBA8',
    new Uint8Array(LABELS_WIDTH * LABELS_HEIGHT * 4),
    LABELS_WIDTH,
    LABELS_HEIGHT,
  );
}

/** Draws the three bands into a 1024 × 256 context: centred, shrunk to fit the width. */
export function drawLabels(context: Context2D, strings: LabelStrings): void {
  context.clearRect(0, 0, LABELS_WIDTH, LABELS_HEIGHT);
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const [band, key] of LABEL_ROWS.entries()) {
    const text = strings[key];
    let size = Math.floor(LABEL_BAND_PX * 0.6);
    context.font = `700 ${size}px ${LABEL_FONT_STACK}`;
    const width = context.measureText(text).width;
    if (width > LABELS_WIDTH * 0.95) {
      size = Math.max(8, Math.floor((size * LABELS_WIDTH * 0.95) / width));
      context.font = `700 ${size}px ${LABEL_FONT_STACK}`;
    }
    context.fillText(text, LABELS_WIDTH / 2, band * LABEL_BAND_PX + LABEL_BAND_PX / 2);
  }
}

/**
 * Waits for the first rendered frame, draws the labels on a canvas from `canvas()` and copies them into the
 * texture mirror for the next upload. Returns false if `signal` aborted first.
 */
export async function buildLabels(
  labels: RowTexture<'RGBA8'>,
  strings: LabelStrings,
  options: {
    firstFrame: Promise<unknown>;
    signal?: AbortSignal;
    canvas?: () => { getContext(kind: '2d'): Context2D | null };
  },
): Promise<boolean> {
  await options.firstFrame;
  if (options.signal?.aborted) return false;
  const context = context2d(options.canvas);
  drawLabels(context, strings);
  labels.data.set(context.getImageData(0, 0, LABELS_WIDTH, LABELS_HEIGHT).data);
  labels.dirty.markAll();
  return true;
}
