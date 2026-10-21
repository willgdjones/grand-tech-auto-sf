import type { DecodedMapMesh } from '@gtasf/shared/mapMesh';
import type { RecipeCollision } from '@gtasf/shared/mapRecipe';
import { flags } from '@gtasf/shared/flags';

let worker: Worker | undefined, nextId = 0, idle: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, { resolve: (groups: DecodedMapMesh[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function stop(error?: Error) {
  clearTimeout(idle); worker?.terminate(); worker = undefined;
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error ?? new Error('MAP_JOIN_WORKER_STOPPED')); }
  pending.clear();
}
/** One worker serves the existing serialized chunk decode queue. Terminate when
 * idle, and reject every outstanding request on failure instead of blocking READY.
 * GPU attributes are still created/uploaded in the existing bounded main queue. */
export function decodeCompactMeshInWorker(buffer: ArrayBuffer, collision?: RecipeCollision, height?: ArrayBuffer): Promise<DecodedMapMesh[]> {
  if (!flags.compactMapAssets) return Promise.reject(new Error('COMPACT_MAP_ASSETS_DISABLED'));
  clearTimeout(idle);
  if (!worker) {
    worker = new Worker(new URL('./compactMesh.worker.ts', import.meta.url), { type: 'module', name: 'GTASF map seams' });
    worker.onerror = event => { event.preventDefault(); stop(new Error(`MAP_JOIN_WORKER: ${event.message}`)); };
    worker.onmessageerror = () => stop(new Error('MAP_JOIN_WORKER_MESSAGE'));
    worker.onmessage = ({ data }: MessageEvent<{ id: number; groups?: DecodedMapMesh[]; error?: string }>) => {
      const request = pending.get(data.id); if (!request) return;
      pending.delete(data.id); clearTimeout(request.timer);
      if (data.error || !data.groups) request.reject(new Error(data.error ?? 'MAP_JOIN_WORKER_RESULT'));
      else request.resolve(data.groups);
      if (!pending.size) idle = setTimeout(() => stop(), 30_000);
    };
  }
  const active = worker, id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => stop(new Error('MAP_JOIN_WORKER_TIMEOUT')), 60_000);
    pending.set(id, { resolve, reject, timer });
    // The main thread still owns the contact field; clone that small input.
    // Only the mesh body and completed output attributes transfer ownership.
    try { active.postMessage({ id, buffer, collision, height }, [buffer]); }
    catch (error) { stop(error instanceof Error ? error : new Error(String(error))); }
  });
}
