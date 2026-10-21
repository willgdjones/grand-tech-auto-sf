import type { Pose, VehicleEntry } from '@gtasf/shared/protocol/types';
import type { RoadEdge, RoadGraph, RoadNode } from '@gtasf/shared/roadgraph';
import { signalGreen } from '@gtasf/shared/traffic/signals';
import { flags } from '@gtasf/shared/flags';
export { signalGreen } from '@gtasf/shared/traffic/signals';

/** Existing pose byte; agreed with WorldDO and fleet.nearest consumers. */
export const TRAFFIC_FLAG = 0x20;
export const TRAFFIC_ID_BASE = 1_000_000;
export const TRAFFIC_RADIUS_M = 400;
// Loose-arcade NPC reaction (gtasf-arcade-npc-react): a moving driver/robotaxi car that overlaps an
// NPC shoves it sideways with a little spin, then it decays back onto its lane — never stuck, never a
// pile-up. The lane logic is untouched; only the published render pose carries the offset, so it is
// purely cosmetic and server-authoritative (every client sees the same nudge). Gated by arcadeHandling.
const BUMP_CONTACT_M = 3.2;        // centre distance counted as a touch
const BUMP_MIN_SPEED_CMPS = 150;   // only an actually-moving car bumps (parked cars never shove NPCs)
const BUMP_IMPULSE = 3.2;          // sideways push gain (metres/s per contact metre)
const BUMP_MAX_OFFSET_M = 2.2;     // cap the shove so cars stay roughly on the roadway
const BUMP_SPIN = 2.2;             // glancing-hit spin gain (rad/s per contact metre)
const BUMP_MAX_SPIN = 0.9;         // cap the yaw wobble (~51 deg)
const BUMP_HALFLIFE_S = 0.45;      // decay half-life back to the lane
interface TrafficEdge extends RoadEdge { kind?: 'lane' | 'connector'; next?: string[] }
interface TrafficNode extends RoadNode { osmNode?: string }
export interface TrafficRoadSource {
  nearbyEdges(points: readonly { x: number; z: number }[], radius: number): RoadEdge[];
  targetNode(edge: RoadEdge): TrafficNode | undefined;
  successors(edge: RoadEdge): RoadEdge[];
}
interface Lane { edge: TrafficEdge; lengths: number[]; length: number }
interface Car { id: number; lane: Lane; along: number; speed: number; waitingSince?: number; turns: number;
  offX: number; offZ: number; spin: number }
interface Junction { carId: number; until: number }
type Point = { x: number; y: number; z: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function hash(value: string): number { let result=2166136261; for (const c of value) result=Math.imul(result^c.charCodeAt(0),16777619); return result>>>0; }
function location(lane: Lane, along: number) {
  const points=lane.edge.points; let offset=clamp(along,0,lane.length);
  for (let i=0;i<lane.lengths.length;i++) {
    const length=lane.lengths[i]!;
    if (offset<=length || i===lane.lengths.length-1) {
      const a=points[i]!,b=points[i+1]!,t=length?offset/length:0;
      return { x:a[0]+(b[0]-a[0])*t,y:a[1]+(b[1]-a[1])*t,z:a[2]+(b[2]-a[2])*t,yaw:Math.atan2(b[0]-a[0],b[2]-a[2]) };
    }
    offset-=length;
  }
  return { x:points[0]![0],y:points[0]![1],z:points[0]![2],yaw:0 };
}
/** Pure authoritative 10 Hz-friendly traffic. All simulation geometry is in metres. */
export class TrafficSimulation {
  private readonly lanes=new Map<string,Lane>();
  private readonly nodes = new Map<string,TrafficNode>();
  private readonly source: TrafficRoadSource | undefined;
  private readonly outgoing=new Map<string,Lane[]>();
  private readonly cars=new Map<number,Car>();
  private readonly junctions=new Map<string,Junction>();
  private wireEntries: VehicleEntry[] | undefined;
  private clock=0;
  private replenishAt=-Infinity;
  private spawnCursor=0;
  readonly maximum: number;
  constructor(graph: RoadGraph | TrafficRoadSource, options: { maximum?: number; perPlayer?: number } = {}) {
    this.maximum=clamp(Math.floor(options.maximum??300),0,300);
    this.perPlayer=clamp(Math.floor(options.perPlayer??8),0,24);
    if ('nearbyEdges' in graph) this.source = graph;
    else {
      for (const node of graph.nodes as TrafficNode[]) this.nodes.set(node.id, node);
      for (const edge of graph.edges) {
        const lane = this.addLane(edge); if (!lane) continue;
        const list=this.outgoing.get(edge.from)??[]; list.push(lane); this.outgoing.set(edge.from,list);
      }
    }
    for (const list of this.outgoing.values()) list.sort((a,b)=>a.edge.id.localeCompare(b.edge.id));
  }
  private readonly perPlayer: number;
  private addLane(edge: TrafficEdge): Lane | undefined {
    const old = this.lanes.get(edge.id); if (old) return old;
    if (edge.points.length<2 || edge.points.some(point=>point.some(value=>!Number.isFinite(value)))) return;
    const lengths=edge.points.slice(1).map((p,i)=>Math.hypot(p[0]-edge.points[i]![0],p[1]-edge.points[i]![1],p[2]-edge.points[i]![2]));
    const length=lengths.reduce((sum,n)=>sum+n,0); if (length<.001) return;
    const lane={edge,lengths,length}; this.lanes.set(edge.id,lane);
    const node = this.source?.targetNode(edge); if (node) this.nodes.set(node.id, node);
    return lane;
  }
  get size() { return this.cars.size; }
  /** openingDrive (critic look check: "the road is empty"): put up to `count` cars on lanes heading the same way as
   *  `ahead` (unit x/z), 30-220 m in front of `point` (metres), so a new player's first drive has traffic to follow.
   *  Same spacing rules as populate (14 m apart, clear of obstacles, never within 18 m of the point); the world cap holds.
   *  They are ordinary traffic afterwards (driven, pruned out of range). Returns how many were placed. */
  seed(point: { x: number; z: number }, ahead: { x: number; z: number }, count: number, obstacles: readonly VehicleEntry[] = []): number {
    let placed = 0;
    if (count <= 0) return 0;
    const edges = this.source ? this.source.nearbyEdges([point], 240) : [...this.lanes.values()].map(lane => lane.edge);
    const lanes = edges.flatMap(edge => { const lane = this.addLane(edge); return lane ? [lane] : []; })
      .filter(lane => (lane.edge.kind === 'lane' || (!lane.edge.kind && !lane.edge.id.startsWith('turn:'))) && lane.length >= 14)
      .filter(lane => { const a = lane.edge.points[0]!, b = lane.edge.points[lane.edge.points.length - 1]!; return (b[0] - a[0]) * ahead.x + (b[2] - a[2]) * ahead.z > 0; })
      .sort((a, b) => a.edge.id.localeCompare(b.edge.id));
    for (const lane of lanes) {
      for (const t of [.3, .7]) {
        if (placed >= count || this.cars.size >= this.maximum) return placed;
        const along = lane.length * t, at = location(lane, along), dx = at.x - point.x, dz = at.z - point.z;
        const forward = dx * ahead.x + dz * ahead.z, d = Math.hypot(dx, dz);
        if (forward < 30 || d > 220 || d < 18) continue;
        if ([...this.cars.values()].some(car => { const p = location(car.lane, car.along); return Math.hypot(at.x - p.x, at.z - p.z) < 14; })
          || obstacles.some(p => Math.hypot(at.x - p.x / 100, at.z - p.z / 100) < 14)) continue;
        let id = TRAFFIC_ID_BASE; while (this.cars.has(id) || obstacles.some(entry => entry.id === id)) id++;
        this.cars.set(id, { id, lane, along, speed: 0, turns: 0, offX: 0, offZ: 0, spin: 0 }); this.wireEntries = undefined; placed++;
      }
    }
    return placed;
  }
  /** dt is bounded after suspended ticks; optional absolute now keeps signal phases shared. */
  step(dtSeconds: number, playerPoses: readonly Pose[], nowMs?: number, obstacles: readonly VehicleEntry[] = [], retained?: ReadonlySet<number>): void {
    this.wireEntries = undefined;
    const dt=clamp(Number.isFinite(dtSeconds)?dtSeconds:0,0,.25);
    this.clock=Number.isFinite(nowMs)?nowMs!:this.clock+dt*1000;
    const players=playerPoses.map(p=>({x:p.x/100,y:p.y/100,z:p.z/100}));
    if (!players.length) { this.cars.clear(); this.junctions.clear(); this.replenishAt=-Infinity; return; }
    const nearby=(p:Point)=>players.some(player=>Math.hypot(p.x-player.x,p.z-player.z)<=TRAFFIC_RADIUS_M);
    for (const [id,car] of this.cars) if (!retained?.has(id) && !nearby(location(car.lane,car.along))) this.cars.delete(id);
    for (const [id,claim] of this.junctions) if (claim.until<=this.clock || !this.cars.has(claim.carId)) this.junctions.delete(id);
    if (this.clock>=this.replenishAt) {
      // A crowd is one occupied area, not hundreds of independent traffic sources.
      // Stable 400 m cells bound population and spawn work as player count grows.
      const areas = new Map<string, Point>();
      for (const player of players) {
        const key = `${Math.floor(player.x / 400)},${Math.floor(player.z / 400)}`;
        if (!areas.has(key)) areas.set(key, player);
      }
      this.populate([...areas.values()],Math.min(this.maximum,areas.size*this.perPlayer),obstacles);
      this.replenishAt=this.clock+2000;
    }
    // Front-to-back order on each edge lets following cars use their leader's final position.
    const order=[...this.cars.values()].sort((a,b)=>a.lane.edge.id.localeCompare(b.lane.edge.id)||b.along-a.along||a.id-b.id);
    for (const car of order) {
      const at=location(car.lane,car.along),remaining=car.lane.length-car.along;
      const node=this.nodes.get(car.lane.edge.to),key=node?.osmNode??node?.id??car.lane.edge.to;
      const successors=this.next(car.lane),isConnector=car.lane.edge.kind==='connector'||car.lane.edge.id.startsWith('turn:');
      let limit=remaining,blocked=false;
      const claim=this.junctions.get(key);
      if (!isConnector && node?.control==='signal' && !signalGreen(this.clock,key,at.yaw)) blocked=true;
      if (!isConnector && node?.control==='stop') {
        if (remaining<=1.05 && car.speed<.1) car.waitingSince??=this.clock;
        if (car.waitingSince===undefined || this.clock-car.waitingSince<1100) blocked=true;
      }
      if (claim && claim.carId!==car.id) blocked=true;
      if (!successors.length) blocked=true;
      if (blocked) limit=Math.max(0,remaining-1);
      for (const other of this.cars.values()) {
        if (other.id===car.id) continue;
        if (other.lane===car.lane && other.along>car.along) limit=Math.min(limit,Math.max(0,other.along-car.along-6));
        if (successors.includes(other.lane)) limit=Math.min(limit,Math.max(0,remaining+other.along-6));
      }
      // Yield to a driven/parked vehicle in this car's forward corridor; never push it.
      for (const obstacle of obstacles) {
        const dx=obstacle.x/100-at.x,dz=obstacle.z/100-at.z;
        const forward=dx*Math.sin(at.yaw)+dz*Math.cos(at.yaw),side=dx*Math.cos(at.yaw)-dz*Math.sin(at.yaw);
        if (forward>0 && Math.abs(side)<2.2 && Math.abs(obstacle.y/100-at.y)<3) limit=Math.min(limit,Math.max(0,forward-6));
      }
      const free=!blocked&&limit>=remaining-1e-6;
      const target=Math.min(clamp(car.lane.edge.speedMps,1,11),free?Infinity:Math.sqrt(2*4*Math.max(0,limit)));
      car.speed=Math.max(0,Math.min(target,car.speed+2.2*dt));
      const travel=Math.min(car.speed*dt,limit);
      if (travel>=limit-1e-6 && !free) car.speed=0;
      if (!isConnector && remaining<=Math.max(4,travel+1) && !blocked) {
        const held=this.junctions.get(key);
        if (held && held.carId!==car.id) { car.speed=0; continue; }
        const crossingMs=Math.max(2500,...successors.map(next=>next.edge.kind==='connector'
          ? (next.length/clamp(next.edge.speedMps,1,4)+1)*1000 : 2500));
        this.junctions.set(key,{carId:car.id,until:this.clock+crossingMs});
      }
      car.along+=travel;
      if (!successors.length && remaining<=1.05 && car.speed<.1) { if (!retained?.has(car.id)) this.cars.delete(car.id); continue; }
      if (car.along>=car.lane.length-1e-6 && free) {
        const next=successors[(hash(String(car.id))+car.turns++)%successors.length];
        if (next) { car.lane=next; car.along=0; car.waitingSince=undefined; }
        else this.cars.delete(car.id);
      }
    }
    // Always runs the decay (so a shoved NPC eases back onto its lane after the bumper drives off);
    // the impulse loop no-ops when nothing is overlapping, and zero-offset cars stay byte-exact.
    if (flags.arcadeHandling) this.reactToBumps(dt, obstacles);
  }
  /** Loose-arcade: moving cars shove overlapping NPCs aside (+a little spin), decaying back to lane. */
  private reactToBumps(dt: number, obstacles: readonly VehicleEntry[]): void {
    const decay = Math.pow(0.5, dt / BUMP_HALFLIFE_S);
    for (const car of this.cars.values()) {
      car.offX *= decay; car.offZ *= decay; car.spin *= decay;
      const at = location(car.lane, car.along);
      for (const ob of obstacles) {
        if (ob.speedCmps < BUMP_MIN_SPEED_CMPS) continue; // a parked car never shoves an NPC
        const dx = at.x + car.offX - ob.x / 100, dz = at.z + car.offZ - ob.z / 100;
        const dist = Math.hypot(dx, dz), overlap = BUMP_CONTACT_M - dist;
        if (overlap <= 0 || dist < 1e-4) continue;
        const nx = dx / dist, nz = dz / dist, push = overlap * BUMP_IMPULSE * dt;
        car.offX += nx * push; car.offZ += nz * push;
        // Glancing hit: the obstacle's heading across the contact normal imparts spin.
        const obYaw = ob.yaw / 256 * Math.PI * 2;
        car.spin += (Math.sin(obYaw) * nz - Math.cos(obYaw) * nx) * BUMP_SPIN * push;
      }
      const off = Math.hypot(car.offX, car.offZ);
      if (off > BUMP_MAX_OFFSET_M) { const s = BUMP_MAX_OFFSET_M / off; car.offX *= s; car.offZ *= s; }
      car.spin = clamp(car.spin, -BUMP_MAX_SPIN, BUMP_MAX_SPIN);
    }
  }
  private next(lane: Lane): Lane[] {
    if (this.source) return this.source.successors(lane.edge).flatMap(edge => { const next = this.addLane(edge); return next ? [next] : []; });
    return lane.edge.next ? lane.edge.next.flatMap(id=>{const next=this.lanes.get(id);return next?[next]:[];}) : this.outgoing.get(lane.edge.to)??[];
  }
  private populate(players: Point[],target: number,obstacles: readonly VehicleEntry[]) {
    if (this.source && this.lanes.size > 4096) {
      const keep = new Set([...this.cars.values()].map(car => car.lane.edge.id));
      for (const [id] of this.lanes) if (!keep.has(id)) this.lanes.delete(id);
      this.nodes.clear();
      for (const lane of this.lanes.values()) { const node = this.source.targetNode(lane.edge); if (node) this.nodes.set(node.id, node); }
    }
    const nearby = this.source ? this.source.nearbyEdges(players, TRAFFIC_RADIUS_M).flatMap(edge => { const lane = this.addLane(edge); return lane ? [lane] : []; }) : [...this.lanes.values()];
    const candidates=nearby.filter(lane=>(lane.edge.kind==='lane'||(!lane.edge.kind&&!lane.edge.id.startsWith('turn:')))&&lane.length>=14)
      .filter(lane=>lane.edge.points.some(p=>players.some(player=>Math.hypot(p[0]-player.x,p[2]-player.z)<TRAFFIC_RADIUS_M-15)))
      .sort((a,b)=>a.edge.id.localeCompare(b.edge.id));
    if (!candidates.length) return;
    const byPlayer=players.map(player=>candidates.filter(lane=>lane.edge.points.some(p=>Math.hypot(p[0]-player.x,p[2]-player.z)<TRAFFIC_RADIUS_M-15)));
    for (let attempts=0;attempts<Math.min(64,candidates.length*2)&&this.cars.size<target;attempts++) {
      const local=byPlayer[attempts%byPlayer.length]!; if (!local.length) continue;
      const lane=local[this.spawnCursor++%local.length]!,along=lane.length*(.2+(hash(lane.edge.id)%60)/100),at=location(lane,along);
      if (!players.some(p=>Math.hypot(at.x-p.x,at.z-p.z)<=TRAFFIC_RADIUS_M) || players.some(p=>Math.hypot(at.x-p.x,at.z-p.z)<18)) continue;
      if ([...this.cars.values()].some(car=>{const p=location(car.lane,car.along);return Math.hypot(at.x-p.x,at.z-p.z)<14;})
        || obstacles.some(p=>Math.hypot(at.x-p.x/100,at.z-p.z/100)<14)) continue;
      let id=TRAFFIC_ID_BASE; while (this.cars.has(id) || obstacles.some(entry => entry.id === id)) id++;
      this.cars.set(id,{id,lane,along,speed:0,turns:0,offX:0,offZ:0,spin:0});
    }
  }
  private entries(): VehicleEntry[] {
    // Convert lane geometry once per simulation step, not once per recipient.
    // Entries are never mutated after publication; the next step builds new ones.
    this.wireEntries ??= [...this.cars.values()].map(car=>{
      const p=location(car.lane,car.along), yaw=p.yaw+car.spin;
      return { id:car.id,x:Math.round((p.x+car.offX)*100),y:Math.round(p.y*100),z:Math.round((p.z+car.offZ)*100),
        yaw:((Math.round((yaw/(Math.PI*2)+1)*256)%256)+256)%256,flags:TRAFFIC_FLAG,
        kind:flags.rideAnyVehicle && !flags.zonedWorld && car.id % 10 === 4 ? 'bus' :
          flags.rideAnyVehicle && !flags.zonedWorld && car.id % 10 === 7 ? 'robotaxi' :
          (['prius','tesla','subaru'] as const)[car.id%3]!,driverId:0,speedCmps:Math.round(car.speed*100) };
    });
    return this.wireEntries;
  }
  vehicle(id: number): VehicleEntry | undefined { return this.entries().find(entry => entry.id === id); }
  /** Remove only the NPC simulation owner; the transferred car keeps its id and current motion. */
  relinquish(id: number): void {
    this.cars.delete(id); this.wireEntries = undefined;
    for (const [key, claim] of this.junctions) if (claim.carId === id) this.junctions.delete(key);
  }
  snapshotFor(playerPose: Pose): VehicleEntry[] {
    const radiusCm = TRAFFIC_RADIUS_M * 100;
    return this.entries().filter(car => (car.x-playerPose.x)**2 + (car.z-playerPose.z)**2 <= radiusCm**2);
  }
}
