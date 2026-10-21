import { ShapeUtils, Vector2 } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { flags } from '@gtasf/shared/flags';
import type { RecipeCollision, RecipeTriangulator } from '@gtasf/shared/mapRecipe';
import { decodeSurfaceContainer } from '@gtasf/shared/mapSurfaceRecipe';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; buffer: ArrayBuffer; collision?: RecipeCollision; height?: ArrayBuffer }>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};
scope.onmessage = async ({ data: { id, buffer, collision, height } }) => {
  try {
    if (!flags.compactMapAssets) throw new Error('COMPACT_MAP_ASSETS_DISABLED');
    const source = new Uint8Array(buffer);
    const triangulate: RecipeTriangulator = rings => ShapeUtils.triangulateShape(
      rings[0]!.map(p => new Vector2(p[0], p[1])), rings.slice(1).map(r => r.map(p => new Vector2(p[0], p[1]))));
    const groups = await decodeSurfaceContainer(source, height ? new Uint8Array(height) : undefined, MeshoptDecoder, collision, triangulate);
    const transfer = [...new Set(groups.flatMap(g => [g.positions.buffer, g.indices.buffer, g.colors.buffer]))] as ArrayBuffer[];
    scope.postMessage({ id, groups }, transfer);
  } catch (error) { scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, []); }
};
