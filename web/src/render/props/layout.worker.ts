import { flags } from '@gtasf/shared/flags';
import { decodePackedRoadGraph, unpackRoadGraph } from '@gtasf/shared/roadgraphPacked';
import { restoreMapArtifact, type TransportMetadata } from '@gtasf/shared/mapTransport';
import { createStreetPropLayout } from './layout';

/** gtasf-c8sj: whole-city street-prop layout off the main thread (was 40-90 s of 5 ms slices on phones). */
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ url: string; artifact: TransportMetadata & { encoding?: string }; graphicsV2Hd: boolean }>) => void) | null;
  postMessage(message: unknown): void;
};
scope.onmessage = async ({ data: { url, artifact, graphicsV2Hd } }) => {
  try {
    if (artifact.encoding !== 'roadpack-v1') throw new Error('Unsupported road graph encoding');
    const response = await fetch(url); if (!response.ok) throw new Error(`Road graph HTTP ${response.status}`);
    const bytes = await restoreMapArtifact(await response.arrayBuffer(), artifact, 'road', flags.compactMapAssets);
    const graph = unpackRoadGraph(decodePackedRoadGraph(bytes));
    const plazas: [number, number, number, number][] = [];
    const { nearby: _nearby, cells, kerbCars, ...layout } = await createStreetPropLayout(graph, { graphicsV2Hd, yieldToMain: () => Promise.resolve(),
      onPlaza: (minX, minZ, maxX, maxZ) => plazas.push([minX, minZ, maxX, maxZ]) });
    // The whole layout is ~17-19 MB; one message is deserialised in a single main-thread task (~1 s on a throttled
    // phone). Small batches are each their own task (~15 ms desktop), then the remainder ends the stream.
    const entries = [...cells.entries()];
    for (let i = 0; i < entries.length; i += 250) scope.postMessage({ cells: entries.slice(i, i + 250) });
    for (let i = 0; i < kerbCars.length; i += 4000) scope.postMessage({ kerbCars: kerbCars.slice(i, i + 4000) });
    scope.postMessage({ layout, plazas });
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
