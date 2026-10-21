import { flags } from '@gtasf/shared/flags';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import type { LombardWorld } from '../render/chunks/world';

/** Compact maps already load the paired city graph before READY. Their retired
 * corridor JSON remains an audit input, not a second runtime dependency. */
export async function cinematicRoadGraph(world: Pick<LombardWorld, 'manifest' | 'routingGraph'>): Promise<RoadGraph> {
  if (world.manifest.requiredFeatures?.includes('compactMapAssets')) {
    if (!flags.compactMapAssets) throw new Error('COMPACT_MAP_ASSETS_DISABLED');
    if (!world.routingGraph) throw new Error('CINEMATIC_CITY_GRAPH_REQUIRED');
    return world.routingGraph;
  }
  const response = await fetch('/map/lombard/roadgraph-playable.json');
  if (!response.ok) throw new Error(`Cinematic roads HTTP ${response.status}`);
  return response.json() as Promise<RoadGraph>;
}
