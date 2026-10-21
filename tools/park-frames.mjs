// Compute park-local world frames (centre, u/v basis, half-extents) from corner lat/lons, for the
// district-park-greens registry in web/src/render/urbanSurfaces.ts. Run: node tools/park-frames.mjs
import { geodeticToWorld } from './map/src/geo.ts';
import { SF_FRAME } from './map/src/config.ts';

// Corners NW, NE, SE, SW (lat, lon). Rough OSM-derived block corners; refined against before-captures.
const PARKS = {
  'washington-square': { nw: [37.80112, -122.41040], ne: [37.80120, -122.40930], se: [37.80020, -122.40940], sw: [37.80012, -122.41050] },
  'lafayette':         { nw: [37.79205, -122.42820], ne: [37.79250, -122.42610], se: [37.79100, -122.42660], sw: [37.79060, -122.42865] },
  'alta-plaza':        { nw: [37.79165, -122.43695], ne: [37.79175, -122.43495], se: [37.79085, -122.43505], sw: [37.79075, -122.43705] },
  'panhandle':         { nw: [37.77330, -122.45360], ne: [37.77240, -122.44230], se: [37.77160, -122.44250], sw: [37.77250, -122.45380] },
};

const w = ([lat, lon]) => geodeticToWorld(lat, lon, SF_FRAME); // -> [x, z]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => { const l = len(a); return [a[0] / l, a[1] / l]; };
const r2 = (n) => Math.round(n * 10) / 10;
const r4 = (n) => Math.round(n * 10000) / 10000;

for (const [id, c] of Object.entries(PARKS)) {
  const nw = w(c.nw), ne = w(c.ne), se = w(c.se), sw = w(c.sw);
  const centre = [(nw[0] + ne[0] + se[0] + sw[0]) / 4, (nw[1] + ne[1] + se[1] + sw[1]) / 4];
  // u-axis: the W->E edges (nw->ne, sw->se). v-axis: the N->S edges (nw->sw, ne->se).
  const uDir = norm(add(sub(ne, nw), sub(se, sw)));
  const vDir = norm(add(sub(sw, nw), sub(se, ne)));
  const halfU = (len(sub(ne, nw)) + len(sub(se, sw))) / 4;
  const halfV = (len(sub(sw, nw)) + len(sub(se, ne))) / 4;
  console.log(`${id}:`);
  console.log(`  centre vec2(${r2(centre[0])}, ${r2(centre[1])})`);
  console.log(`  u dot(C, vec2(${r4(uDir[0])}, ${r4(uDir[1])}))  halfU ~${r2(halfU)}`);
  console.log(`  v dot(C, vec2(${r4(vDir[0])}, ${r4(vDir[1])}))  halfV ~${r2(halfV)}`);
}
