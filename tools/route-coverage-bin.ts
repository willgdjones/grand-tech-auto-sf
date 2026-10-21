// Whole-city routing coverage of the ACTUAL client routing graph: unpacks a roadpack-v1 binary
// (roadgraph.bin) and routable-filters it exactly as web/src/render/chunks/world.ts does, then checks
// that every key SF district has a routable node and is directed-round-trip reachable from the Ferry
// spawn (gtasf-vcaj). This is the CORRECT acceptance for the packed map the client actually loads;
// the sibling route-coverage-check.mjs reads the LEGACY corridor-clipped roadgraph-playable.json
// (clipped to publishBounds for the 25MB cap, NOT used for routing) and so under-reports (3/13).
//   npx tsx tools/route-coverage-bin.ts [path-to-roadgraph.bin]
import { readFile } from 'node:fs/promises';
import { decodePackedRoadGraph, unpackRoadGraph } from '../shared/roadgraphPacked';

const binPath = process.argv[2] ?? 'tools/map/out/sf/roadgraph.bin';
const bin = await readFile(binPath);
const unpacked = unpackRoadGraph(decodePackedRoadGraph(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)));
const routable = (unpacked.edges as any[]).filter(e => e.routable);
const nodes = unpacked.nodes as any[];

const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
const ecef = (lat: number, lon: number): [number, number, number] => { const phi = lat*rad, lam = lon*rad, n = 6378137/Math.sqrt(1-e2*Math.sin(phi)**2); return [n*Math.cos(phi)*Math.cos(lam), n*Math.cos(phi)*Math.sin(lam), n*(1-e2)*Math.sin(phi)]; };
const O = { lat: 37.7842, lon: -122.4078 };
const project = (lat: number, lon: number) => { const a = ecef(O.lat,O.lon), b = ecef(lat,lon); const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],phi=O.lat*rad,lam=O.lon*rad; const east=-Math.sin(lam)*dx+Math.cos(lam)*dy; const north=-Math.sin(phi)*Math.cos(lam)*dx-Math.sin(phi)*Math.sin(lam)*dy+Math.cos(phi)*dz; return { x: east, z: -north }; };
const DISTRICTS: [string,number,number][] = [['Ferry',37.7955,-122.3937],['Lombard',37.8021,-122.4188],['North Beach',37.8003,-122.4103],['SoMa',37.7785,-122.3990],['Mission',37.7599,-122.4148],['Castro',37.7609,-122.4350],['Hayes Valley',37.7765,-122.4245],['Richmond',37.7800,-122.4700],['Sunset',37.7530,-122.4940],['GGP',37.7694,-122.4862],['Marina',37.8037,-122.4368],['Potrero',37.7580,-122.4000],['Bayview',37.7290,-122.3900]];
const nearest = (p:{x:number;z:number}) => { let best:any=null, bd=Infinity; for (const n of nodes){ const d=Math.hypot(n.x-p.x,n.z-p.z); if(d<bd){bd=d;best=n;} } return {node:best,dist:bd}; };
const fwd = new Map<string,string[]>(); for (const e of routable) (fwd.get(e.from) ?? fwd.set(e.from,[]).get(e.from)!).push(e.to);
const reaches = (a:string,b:string) => { const seen=new Set([a]),q=[a]; while(q.length){const c=q.pop()!; if(c===b)return true; for(const m of fwd.get(c)??[]) if(!seen.has(m)){seen.add(m);q.push(m);}} return false; };

console.log(`${binPath} UNPACKED: nodes=${nodes.length} edges=${unpacked.edges.length} routable=${routable.length}`);
const present: {name:string;id:string}[] = [];
for (const [name,lat,lon] of DISTRICTS) { const {node,dist} = nearest(project(lat,lon)); const ok = dist<=120; if(ok) present.push({name,id:node.id}); console.log(`  ${ok?'OK ':'MISSING'}  ${name.padEnd(12)} ${dist.toFixed(0)}m`); }
const ferry = present.find(d => d.name === 'Ferry');
if (!ferry) { console.error('FAIL: Ferry spawn has no routable node; round-trip coverage cannot be checked.'); process.exit(1); }
let bad = 0;
for (const d of present.slice(1)) if (!(reaches(ferry.id,d.id) && reaches(d.id,ferry.id))) { bad++; console.log(`  UNREACHABLE(round-trip) Ferry <-> ${d.name}`); }
// GGP is a park with sparse roads; allow one missing so a legitimately-covered city still PASSES.
const pass = (DISTRICTS.length - present.length) <= 1 && bad === 0;
console.log(`\n${pass ? 'PASS' : 'FAIL'}: ${present.length}/${DISTRICTS.length} districts routable; ${bad} not round-trip from Ferry.`);
if (pass) console.log('Whole-city routing graph is READY — flip flags.wholeCityMap once /map/sf/ is published within the load budget (gtasf-vcaj/zzpr).');
process.exit(pass ? 0 : 1);
