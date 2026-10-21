/** Stable A/D/C handoff; pipeline owns the serialized graph, all consumers use these units. */
export interface RoadNode { id: string; x: number; y: number; z: number; control?: 'signal' | 'stop' }
export interface RoadEdge { id: string; from: string; to: string; lengthM: number; speedMps: number; lane: number; points: [number, number, number][] }
export interface RoadGraph { version: 1; nodes: RoadNode[]; edges: RoadEdge[] }
