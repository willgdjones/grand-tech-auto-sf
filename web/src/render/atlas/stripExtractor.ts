import { readCanvasStrip } from './stripCanvas';

export interface StripRequest {
  bitmap: ImageBitmap;
  rowStart: number;
  rowCount: number;
}
interface WorkerReply {
  id: number;
  bytes?: Uint8Array<ArrayBuffer>;
  error?: string;
}

/** One worker, one bounded crop per job. A cache-owned source is never transferred to the worker. */
export class StripExtractor {
  private worker: Worker | undefined;
  private nextId = 0;
  private disposed = false;
  private readonly pending = new Map<
    number,
    {
      resolve(bytes: Uint8Array<ArrayBuffer>): void;
      reject(error: Error): void;
    }
  >();

  constructor(useWorker = true) {
    if (useWorker && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./stripWorker.ts', import.meta.url), { type: 'module' });
      } catch {
        return;
      } // Unsupported module workers/CSP use the bounded main-thread path.
      this.worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const reply = event.data,
          waiting = this.pending.get(reply.id);
        if (!waiting) return;
        this.pending.delete(reply.id);
        if (reply.bytes) waiting.resolve(reply.bytes);
        else {
          waiting.reject(new Error(reply.error ?? 'ATLAS_STRIP_WORKER'));
          this.stopWorker();
        }
      };
      this.worker.onerror = () => this.stopWorker();
    }
  }

  async extract({ bitmap, rowStart, rowCount }: StripRequest): Promise<Uint8Array<ArrayBuffer>> {
    if (this.disposed) throw new Error('ATLAS_EXTRACTOR_DISPOSED');
    const sourceStart = Math.max(0, rowStart - 1);
    const sourceEnd = Math.min(bitmap.height, rowStart + rowCount - 1);
    // Last border alone still needs the final real row.
    const first = Math.min(sourceStart, bitmap.height - 1);
    const count = Math.max(1, sourceEnd - first);
    const worker = this.worker;
    if (worker) {
      const crop = await createImageBitmap(bitmap, 0, first, bitmap.width, count, {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
        imageOrientation: 'from-image',
      });
      if (this.disposed || worker !== this.worker) {
        crop.close();
        throw new Error('ATLAS_EXTRACTOR_DISPOSED');
      }
      const id = ++this.nextId;
      try {
        return await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
          this.pending.set(id, { resolve, reject });
          try {
            worker.postMessage(
              {
                id,
                crop,
                width: bitmap.width,
                height: bitmap.height,
                sourceStart: first,
                rowStart,
                rowCount,
              },
              [crop],
            );
          } catch (error) {
            this.pending.delete(id);
            crop.close();
            reject(error instanceof Error ? error : new Error('ATLAS_STRIP_TRANSFER'));
          }
        });
      } catch (error) {
        if (this.disposed) throw error;
        // Worker/OffscreenCanvas support differs across engines; the source is still borrowed here.
        return readCanvasStrip(bitmap, bitmap.width, bitmap.height, first, rowStart, rowCount, false);
      }
    }
    return readCanvasStrip(bitmap, bitmap.width, bitmap.height, first, rowStart, rowCount, false);
  }

  dispose(): void {
    this.disposed = true;
    this.stopWorker();
  }
  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = undefined;
    for (const waiting of this.pending.values()) waiting.reject(new Error('ATLAS_STRIP_WORKER'));
    this.pending.clear();
  }
}
