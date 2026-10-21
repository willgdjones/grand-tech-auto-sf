import { readCanvasStrip } from './stripCanvas';

interface Request {
  id: number;
  crop: ImageBitmap;
  width: number;
  height: number;
  sourceStart: number;
  rowStart: number;
  rowCount: number;
}
// This entry is bundled as a module worker; only this narrow worker boundary needs the overload.
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<Request>) => void;
  postMessage(message: unknown, transfer: Transferable[]): void;
};
scope.onmessage = (event) => {
  const request = event.data;
  try {
    const bytes = readCanvasStrip(
      request.crop,
      request.width,
      request.height,
      request.sourceStart,
      request.rowStart,
      request.rowCount,
      true,
    );
    scope.postMessage({ id: request.id, bytes }, [bytes.buffer]);
  } catch (error) {
    scope.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'ATLAS_STRIP' }, []);
  } finally {
    request.crop.close();
  }
};
