/** Isolated visual smoke using the running local API; not part of the game entry. */
import { createRadar } from './radar';
import type { RadarDestination } from './radar';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import type { MapFrame } from './projection';
const [manifest, graph] = await Promise.all([
  fetch('/map/lombard/manifest.json').then(r => r.json() as Promise<{ frame: MapFrame }>),
  fetch('/map/lombard/roadgraph.json').then(r => r.json() as Promise<RoadGraph>),
]);
const selected: RadarDestination[] = [];
const radar = createRadar({ frame: manifest.frame, graph, enabled: true, onSelect: event => { selected.push(event); }, onHail: event => { selected.push(event); } })!;
await radar.ready;
let yaw = 2.158799;
function frame() { radar.update({ x: 1196.869, z: -1224.309 }, yaw, [{ id: 'peer', x: 1205, z: -1240 }], [{ id: 'taxi', x: 1212, z: -1236 }]); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
Object.assign(window, { radarSmoke: { radar, selected, rotate() { yaw += Math.PI / 2; } } });
