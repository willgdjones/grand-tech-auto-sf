import { expect, it } from 'vitest';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import type { Pose } from '@gtasf/shared/protocol/types';
import { TrafficSimulation, TRAFFIC_FLAG, TRAFFIC_ID_BASE } from './simulation';

it('smokes shared lane traffic through hill, stop, signal, queue and interest removal', () => {
  const nodes: RoadGraph['nodes'] = [
    { id:'a',x:0,y:20,z:0 }, { id:'b',x:0,y:10,z:100,control:'stop' },
    { id:'c',x:100,y:0,z:100,control:'signal' }, { id:'d',x:100,y:10,z:0 },
  ];
  const graph: RoadGraph = { version:1,nodes,edges:nodes.map((from,i) => {
    const to=nodes[(i+1)%nodes.length]!;
    return { id:`lane:${i}`,from:from.id,to:to.id,lengthM:Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z),speedMps:8,lane:0,
      points:[[from.x,from.y,from.z],[to.x,to.y,to.z]] };
  }) };
  const player:Pose={x:5000,y:1000,z:5000,yaw:0,flags:0};
  const traffic=new TrafficSimulation(graph,{maximum:12,perPlayer:12});
  let stopFrames=0,redFrames=0,movingFrames=0,queueFrames=0,peak=0;
  let validSnapshots=true,minimumGap=Infinity;
  const hold=new Map<number,number>(); let longestStop=0;
  for (let tick=0;tick<1800;tick++) {
    traffic.step(.1,[player],tick*100);
    const entries=traffic.snapshotFor(player); peak=Math.max(peak,entries.length);
    for (const car of entries) {
      validSnapshots &&= car.id>=TRAFFIC_ID_BASE && car.flags===TRAFFIC_FLAG && car.y>=0 && car.y<=2000
        && [car.x,car.y,car.z,car.yaw,car.speedCmps].every(Number.isInteger);
      if (car.speedCmps>100) movingFrames++;
      if (car.x===0&&car.z>9800&&car.z<10000&&car.speedCmps===0) {
        stopFrames++; hold.set(car.id,(hold.get(car.id)??0)+1); longestStop=Math.max(longestStop,hold.get(car.id)!);
      } else hold.delete(car.id);
      if (car.z===10000&&car.x>9800&&car.x<10000&&car.speedCmps===0) redFrames++;
    }
    for (const [queue,axis] of [[entries.filter(car=>car.x===0),'z'],[entries.filter(car=>car.z===10000),'x']] as const) {
      queue.sort((a,b)=>a[axis]-b[axis]);
      for (let i=1;i<queue.length;i++) {
        minimumGap=Math.min(minimumGap,queue[i]![axis]-queue[i-1]![axis]);
        if (queue[i]!.speedCmps===0&&queue[i-1]!.speedCmps===0) queueFrames++;
      }
    }
  }
  expect(peak).toBeGreaterThanOrEqual(4); expect(stopFrames).toBeGreaterThan(0);
  expect(peak).toBeLessThanOrEqual(12); expect(validSnapshots).toBe(true); expect(minimumGap).toBeGreaterThanOrEqual(590);
  expect(longestStop).toBeGreaterThanOrEqual(11); expect(redFrames).toBeGreaterThan(0);
  expect(movingFrames).toBeGreaterThan(100); expect(queueFrames).toBeGreaterThan(0);
  expect(traffic.snapshotFor({...player,x:1000000})).toEqual([]);
  const published = traffic.snapshotFor(player), retained = structuredClone(published);
  traffic.step(.1, [player], 180_000);
  expect(published, 'A later tick does not mutate already published traffic poses').toEqual(retained);
  traffic.step(.1,[]); expect(traffic.size).toBe(0);
  expect(traffic.snapshotFor(player)).toEqual([]);
  expect(new TrafficSimulation(graph,{maximum:999}).maximum).toBe(300);
  const crowd = new TrafficSimulation(graph, { maximum: 96, perPlayer: 12 });
  for (let tick = 0; tick < 100; tick++) crowd.step(.1, Array.from({ length: 100 }, () => player), tick * 100);
  expect(crowd.size, 'A crowd shares one moderate local traffic population').toBeLessThanOrEqual(12);
});

it('loose-arcade: a moving car shoves an NPC off its lane with spin, then it eases back (gtasf-arcade-npc-react)', () => {
  // A straight x=0 lane loop so any lateral deviation is purely the bump offset.
  const nodes: RoadGraph['nodes'] = [{ id:'a',x:0,y:0,z:0 }, { id:'b',x:0,y:0,z:500 }];
  const graph: RoadGraph = { version:1, nodes, edges:[
    { id:'lane:a',from:'a',to:'b',lengthM:500,speedMps:8,lane:0,points:[[0,0,0],[0,0,500]] },
    { id:'lane:b',from:'b',to:'a',lengthM:500,speedMps:8,lane:0,points:[[0,0,500],[0,0,0]] },
  ] };
  const player: Pose = { x:0,y:0,z:20000,yaw:0,flags:0 }; // 200 m up the lane, well inside the radius
  const sim = new TrafficSimulation(graph, { maximum:8, perPlayer:8 });
  const maxAbsX = () => Math.max(0, ...sim.snapshotFor(player).map(c => Math.abs(c.x) / 100));
  const intsOk = () => sim.snapshotFor(player).every(c =>
    [c.x,c.y,c.z,c.yaw,c.speedCmps].every(Number.isInteger) && c.yaw>=0 && c.yaw<=255);

  for (let t=0; t<40; t++) sim.step(.1, [player], t*100); // spawn + get cars rolling
  const cars = sim.snapshotFor(player);
  expect(cars.length).toBeGreaterThan(0);
  expect(maxAbsX()).toBeLessThan(0.05); // on-lane: no bump yet
  expect(intsOk()).toBe(true);

  // Drive a fast car right alongside one NPC for a few ticks (obstacle placed just +1.2 m to its side).
  const target = cars[0]!;
  for (let t=0; t<4; t++) {
    const cur = sim.snapshotFor(player).find(c => c.id===target.id) ?? sim.snapshotFor(player)[0]!;
    const obstacle = { id:7, x:cur.x+120, y:cur.y, z:cur.z, yaw:0, flags:0, kind:'tesla' as const, driverId:9, speedCmps:600 };
    sim.step(.1, [player], (40+t)*100, [obstacle]);
  }
  const bumped = maxAbsX();
  expect(bumped).toBeGreaterThan(0.3);        // shoved clearly off the lane
  expect(bumped).toBeLessThanOrEqual(2.31);   // but capped near the roadway (BUMP_MAX_OFFSET_M)
  expect(intsOk()).toBe(true);

  for (let t=0; t<25; t++) sim.step(.1, [player], (50+t)*100); // bumper gone: decay back
  expect(maxAbsX()).toBeLessThan(0.1);        // eased back onto its lane
  expect(intsOk()).toBe(true);
});

it('openingDrive: seed puts cars on same-direction lanes 30-220 m ahead, spaced, within the cap', () => {
  // Two parallel one-way lanes running +z (ahead) and one running -z (behind/opposite) from x=0..; a 400 m straight.
  const nodes: RoadGraph['nodes'] = [{ id:'n0',x:0,y:0,z:0 },{ id:'n1',x:0,y:0,z:400 },{ id:'s0',x:6,y:0,z:400 },{ id:'s1',x:6,y:0,z:0 }];
  const edge = (id: string, a: RoadGraph['nodes'][number], b: RoadGraph['nodes'][number]) => ({ id, from:a.id, to:b.id, lengthM:400, speedMps:12, lane:0, points:[[a.x,a.y,a.z],[a.x,a.y,(a.z+b.z)/2],[b.x,b.y,b.z]] as [number,number,number][] });
  const graph: RoadGraph = { version:1, nodes, edges:[edge('lane:north',nodes[0]!,nodes[1]!), edge('lane:south',nodes[2]!,nodes[3]!)] };
  const traffic = new TrafficSimulation(graph, { maximum: 12, perPlayer: 0 });
  const placed = traffic.seed({ x: 0, z: 0 }, { x: 0, z: 1 }, 3);
  expect(placed).toBeGreaterThanOrEqual(1);
  const cars = traffic.snapshotFor({ x: 0, y: 0, z: 0, yaw: 0, flags: 0 });
  expect(cars).toHaveLength(placed);
  for (const car of cars) { expect(car.x).toBe(0); expect(car.z / 100).toBeGreaterThanOrEqual(30); expect(car.z / 100).toBeLessThanOrEqual(220); } // never the opposite lane, never behind
  const capped = new TrafficSimulation(graph, { maximum: 0 });
  expect(capped.seed({ x: 0, z: 0 }, { x: 0, z: 1 }, 3)).toBe(0);
});
