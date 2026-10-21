import { packRoadGraph } from '../../../tools/map/src/pipeline/roadPack';
import type { PackedPublicRoadGraph } from '@gtasf/shared/roadgraphPacked';

// Middle Drive West source lane from city graph 5763c53, near the cached GGP event.
// OSM source attribution follows PROVENANCE.md. Bounded test specimen, not a runtime map.
const graph: PackedPublicRoadGraph = { version: 1, warnings: [], nodes: [
  { id: 'nlyk', x: -6778.7, y: 58.03, z: 1754.49, osmNode: 'osm:4036026163' },
  { id: 'nlyl', x: -6730.14, y: 58.54, z: 1753.75, osmNode: 'osm:5437182906' },
], edges: [{ id: 'lane:aza', from: 'nlyk', to: 'nlyl', lengthM: 48.57400131225586, speedMps: 11.175999641418457,
  lane: 0, points: [[-6778.7, 58.03, 1754.49], [-6773.59, 58.12, 1754.37], [-6763.37, 58.24, 1754.14],
    [-6749.25, 58.39, 1753.96], [-6732.32, 58.51, 1753.75], [-6730.14, 58.54, 1753.75]],
  kind: 'lane', osmWay: 158602262, name: 'Middle Drive West', inferredLanes: true,
  layer: 0, bridge: false, tunnel: false, routable: true, next: [],
}] };
export const cityAnchorRoadBytes = packRoadGraph(graph);
export const cityAnchorRoadKey = 'maps/test-city-anchor/roadgraph.bin';
export const cityAnchorEventId = 'tech-week:620fc85a-6db8-4654-90f6-c0cd958bc033';
