import { BoxGeometry, Box3, Color, ConeGeometry, CylinderGeometry, Group, InstancedMesh, LOD, Matrix4, MeshLambertMaterial, Object3D, Quaternion, Vector3 } from 'three';
import { flags } from '@gtasf/shared/flags';
import type { FacadeBuilding } from './facadeBuildings';
import type { FrontStyle } from './facadeStyles';

export interface RooftopClutterStats { parapets: number; units: number; tanks: number; escapes: number; instances: number; triangles: number }

/** Graphics V2 building silhouettes: parapets, rooftop AC units, timber water tanks on walk-ups and
 * black fire-escape landings on brick street fronts. Deterministic per building seed, no collision or payload.
 *
 * Two layers per chunk (gtasf-qc8o): the SKYLINE layer (parapets + tank drums) is always drawn because it
 * is what reads from across the city; the DETAIL layer (AC units, tank legs, fire escapes) sits in an LOD
 * that drops beyond 300 m (200 m on Low). Each category has its own budget, so parapets on a dense chunk can
 * no longer starve fire escapes. Low: parapets only on street walls >= 4 m, one AC unit, landings
 * without rails, 6-sided tanks, no shadow casting. */
export function buildRooftopClutter(buildings: readonly FacadeBuilding[], styleOf: (b: FacadeBuilding) => { style: FrontStyle; seed: number },
  inverse: Matrix4, options: { low?: boolean } = {}): { group: Group; dispose: () => void; stats: RooftopClutterStats } {
  const low = options.low === true;
  type Item = { m: Matrix4; c: Color };
  const skyline: Item[] = [], detail: Item[] = [], tanks: Item[] = [], caps: Item[] = [], stacks: Item[] = [];
  // rooftopLife (gtasf-3o55, founder look gap item 3): more water towers (with cones), stair/elevator penthouses, vents.
  const life = flags.rooftopLife;
  // biggerWaterTanks (gtasf look gap): scale the timber towers up so they dominate the roofscape like the reference.
  // Flag-off values are the originals, so the geometry is byte-identical when off. Same instance count either way.
  const bigTank = flags.biggerWaterTanks;
  // Chunky, not tall: a WIDER drum on moderate legs reads as the reference's fat timber towers (and avoids a
  // pole-like silhouette at phone/Low), rather than just scaling everything up.
  const tLegH = bigTank ? 2.6 : 2.4, tLegOff = bigTank ? 1.9 : 1.2, tLegW = bigTank ? .22 : .18;
  const tDrumD = bigTank ? 2.7 : 1.6, tDrumH = bigTank ? 3.6 : 3.2;
  const tCapD = bigTank ? 3.0 : 1.75, tCapH = bigTank ? 1.15 : .9;
  const budget = low ? { parapets: 500, units: 150, tanks: 120, escapes: 300 } : { parapets: 2400, units: 900, tanks: 400, escapes: 1400 };
  const stats: RooftopClutterStats = { parapets: 0, units: 0, tanks: 0, escapes: 0, instances: 0, triangles: 0 };
  const q = new Quaternion(), up = new Vector3(0, 1, 0);
  const box = (into: Item[], x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, c: Color) => {
    q.setFromAxisAngle(up, yaw);
    into.push({ m: new Matrix4().compose(new Vector3(x, y + sy / 2, z), q, new Vector3(sx, sy, sz)).premultiply(inverse), c });
  };
  const metal = new Color(0.08, 0.08, 0.09), ac = new Color(0.62, 0.63, 0.62), timber = new Color(0.36, 0.25, 0.16), band = new Color(0.12, 0.12, 0.12);
  const grating = new Color(0.27, 0.28, 0.3); // fireEscapeLight: landing grating
  // fireEscapeFix (critic N48): a fire escape sits ~0.8-1.5 m in front of its wall. Where a shorter neighbour stands against
  // that wall, the lower landings were INSIDE the neighbour and the upper ones floated over its roof as bare dark slabs
  // (Jackson Square, 16-job-deliver). Skip an escape if any landing lands inside another building below its roof. The walls
  // are the footprint's edges, so a ray-crossing test over them gives point-in-building.
  const roofOf = new Map<FacadeBuilding, number>();
  for (const b of buildings) if (b.walls.length) roofOf.set(b, Math.max(...b.walls.map(w => w.top)));
  const insideBuilding = (b: FacadeBuilding, px: number, pz: number) => {
    let inside = false;
    for (const w of b.walls) if ((w.az > pz) !== (w.bz > pz) && px < (w.bx - w.ax) * (pz - w.az) / (w.bz - w.az) + w.ax) inside = !inside;
    return inside;
  };
  const blocked = (self: FacadeBuilding, px: number, py: number, pz: number) => {
    for (const [other, roof] of roofOf) if (other !== self && py < roof + .3 && insideBuilding(other, px, pz)) return true;
    return false;
  };
  for (const building of buildings) {
    if (!building.walls.length) continue;
    const { style, seed } = styleOf(building);
    const roof = Math.max(...building.walls.map(w => w.top)), ground = Math.min(...building.walls.map(w => w.ground));
    const height = roof - ground;
    if (height < 5) continue;
    const rnd = (k: number) => ((seed * 9301 + k * 49297) % 233280) / 233280;
    const walkUp = (style === 'brk' || style === 'apt' || style === 'mix') && height < 40;
    // Parapet: a low wall lip in the facade colour, so roofs stop reading as cut-off boxes.
    const lip = style === 'tower' ? .5 : .9;
    for (const wall of building.walls) {
      if (stats.parapets >= budget.parapets) break;
      if (low && (!wall.street || wall.width < 4)) continue; // Low: only the street-facing lip that reads in silhouette
      if (wall.width < 1.5) continue; // sliver walls add instances, not silhouette
      box(skyline, (wall.ax + wall.bx) / 2, wall.top, (wall.az + wall.bz) / 2, -Math.atan2(wall.bz - wall.az, wall.bx - wall.ax), wall.width + .3, lip, .3,
        new Color(...wall.colour).multiplyScalar(.8));
      stats.parapets++;
      // buildingPaint (gtasf-5mvt): a projecting cornice band under the roofline on residential street fronts, in a
      // light trim colour, so Victorian/Edwardian/apartment rooflines read (founder look gap item 2).
      if (flags.buildingPaint && wall.street && (style === 'vic' || style === 'edw' || style === 'apt' || style === 'mix') && stats.parapets < budget.parapets) {
        box(skyline, (wall.ax + wall.bx) / 2 + wall.nx * .4, wall.top - .55, (wall.az + wall.bz) / 2 + wall.nz * .4, -Math.atan2(wall.bz - wall.az, wall.bx - wall.ax),
          wall.width + .5, .35, .9, new Color(...wall.colour).lerp(new Color(.94, .92, .86), .55));
        stats.parapets++;
      }
    }
    const area = building.footprint, span = Math.sqrt(area) * .3;
    // Rooftop units: AC boxes on everything with a usable roof.
    const units = Math.min(low ? 1 : 6, Math.max(1, Math.round(area / 220)));
    for (let i = 0; i < units && stats.units < budget.units; i++, stats.units++) {
      const x = building.x + (rnd(i * 3) - .5) * span, z = building.z + (rnd(i * 3 + 1) - .5) * span;
      box(detail, x, roof, z, rnd(i * 3 + 2) * Math.PI, 1.6 + rnd(i) * 1.4, 1.1 + rnd(i + 7) * .6, 1.2 + rnd(i + 3), ac);
    }
    // Water tanks on walk-up mid-rises: the drum is skyline, the legs are detail. The classic SF/NYC timber tower
    // reads by its conical cap. rooftopWaterTowers (look gap vs teleoperator-reference) studs far more rooftops:
    // a wider style set (adds Edwardians) and height band (3+ storeys, up to ~14), ~92% chance, and a second tank
    // on large roofs — still bounded by budget.tanks.
    const denseTanks = flags.rooftopWaterTowers;
    const tankStyle = style === 'brk' || style === 'apt' || style === 'mix' || (denseTanks && style === 'edw');
    const tankWalkUp = tankStyle && height < (denseTanks ? 48 : 40);
    const placeTank = (tx: number, tz: number, capped: boolean) => {
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) box(detail, tx + dx * tLegOff, roof, tz + dz * tLegOff, 0, tLegW, tLegH, tLegW, metal);
      tanks.push({ m: new Matrix4().compose(new Vector3(tx, roof + tLegH + tDrumH / 2, tz), new Quaternion(), new Vector3(tDrumD, tDrumH, tDrumD)).premultiply(inverse), c: timber });
      if (capped) caps.push({ m: new Matrix4().compose(new Vector3(tx, roof + tLegH + tDrumH + tCapH / 2, tz), new Quaternion(), new Vector3(tCapD, tCapH, tCapD)).premultiply(inverse), c: timber.clone().multiplyScalar(.75) });
      stats.tanks++;
    };
    if (tankWalkUp && height > (denseTanks ? 9 : 12) && rnd(99) < (denseTanks ? .92 : life ? .75 : .55) && stats.tanks < budget.tanks) {
      placeTank(building.x + (rnd(50) - .5) * span, building.z + (rnd(51) - .5) * span, life);
      // A second tank on a large roof, offset to the far corner, so big walk-up blocks read like the reference.
      if (denseTanks && area > 650 && stats.tanks < budget.tanks && rnd(55) < .6) {
        placeTank(building.x + (rnd(52) - .5) * span - span * .35, building.z + (rnd(53) - .5) * span + span * .35, life);
      }
    }
    if (life && style !== 'tower' && height > 20 && stats.units < budget.units) {
      // Stair/elevator penthouse: a plain box on taller roofs, in the wall colour, darker.
      const x = building.x + (rnd(80) - .5) * span * .5, z = building.z + (rnd(81) - .5) * span * .5;
      box(skyline, x, roof, z, rnd(82) * Math.PI, 3 + rnd(83) * 2, 2.8, 3 + rnd(84) * 2, new Color(...(building.walls[0]?.colour ?? [.6, .6, .6])).multiplyScalar(.7));
      stats.units++;
    }
    if (life && !low) for (let i = 0; i < 2 && stats.units < budget.units; i++, stats.units++) {
      // Vent stacks: thin dark pipes.
      const x = building.x + (rnd(90 + i) - .5) * span, z = building.z + (rnd(92 + i) - .5) * span;
      stacks.push({ m: new Matrix4().compose(new Vector3(x, roof + .6, z), new Quaternion(), new Vector3(.25, 1.2 + rnd(94 + i), .25)).premultiply(inverse), c: metal });
    }
    // Fire escapes: stacked black landings with a rail on brick walk-up street fronts (2nd floor up).
    if (walkUp && height > 8 && rnd(71) < .7 && stats.escapes < budget.escapes) {
      const wall = building.walls.filter(w => (w.street || w.exposed) && w.width > 6).sort((a, b) => b.width - a.width)[0];
      const t = wall ? .25 + rnd(70) * .4 : 0, x = wall ? wall.ax + (wall.bx - wall.ax) * t : 0, z = wall ? wall.az + (wall.bz - wall.az) * t : 0;
      const len = wall ? Math.hypot(wall.bx - wall.ax, wall.bz - wall.az) || 1 : 1, tx = wall ? (wall.bx - wall.ax) / len : 0, tz = wall ? (wall.bz - wall.az) / len : 0;
      // fireEscapeFix: every landing (both ends, outer edge) must be clear of other buildings, or the whole escape is skipped.
      const clear = !flags.fireEscapeFix || !wall || ((): boolean => {
        for (let y = ground + 4; y < roof - 2; y += 3.4) for (const along of [-2.1, 0, 2.1])
          if (blocked(building, x + tx * along + wall.nx * 1.5, y, z + tz * along + wall.nz * 1.5)) return false;
        return true;
      })();
      if (wall && clear) {
        const yaw = -Math.atan2(wall.bz - wall.az, wall.bx - wall.ax);
        for (let y = ground + 4; y < roof - 2 && stats.escapes < budget.escapes; y += 3.4) {
          // fireEscapeLight (critic N48 nit): a 10 cm near-black landing read as a solid dark slab at distance; a 5 cm grating
          // in weathered steel grey reads lighter and thinner.
          box(detail, x + wall.nx * .8, y, z + wall.nz * .8, yaw, 4.2, flags.fireEscapeLight ? .05 : .1, 1.4, flags.fireEscapeLight ? grating : metal);
          // fireEscapeLight: the rail was a SOLID 0.9 m dark sheet (the 'dark fill' the critic saw); an open railing instead,
          // a top bar and a mid bar between the corner posts.
          if (!low && flags.fireEscapeLight) for (const h of [.9, .45]) box(detail, x + wall.nx * 1.48, y + h, z + wall.nz * 1.48, yaw, 4.2, .05, .05, band);
          else if (!low) box(detail, x + wall.nx * 1.48, y + .1, z + wall.nz * 1.48, yaw, 4.2, .9, .05, band);
          // fireEscapeFix: a landing-and-rail stack with nothing between read as floating grey slabs. Give each storey the
          // fire-escape structure: four treads stepping up along the wall to the next landing, and the outer corner posts.
          if (flags.fireEscapeFix && !low && y + 3.4 < roof - 2) {
            for (let k = 0; k < 4; k++) {
              const along = -1.4 + k * .93, ty = y + .68 * (k + 1);
              box(detail, x + tx * along + wall.nx * .55, ty, z + tz * along + wall.nz * .55, yaw, .8, .08, .7, metal);
            }
            for (const end of [-2.05, 2.05]) box(detail, x + tx * end + wall.nx * 1.48, y, z + tz * end + wall.nz * 1.48, yaw, .06, 3.4, .06, metal);
          }
          stats.escapes++;
        }
      }
    }
  }
  const group = new Group(); group.name = 'Rooftop clutter';
  const material = new MeshLambertMaterial(), cube = new BoxGeometry(1, 1, 1), drum = new CylinderGeometry(.5, .5, 1, low ? 6 : 10), cone = new ConeGeometry(.5, 1, low ? 6 : 10);
  const instanced = (list: Item[], geometry: BoxGeometry | CylinderGeometry | ConeGeometry, name: string) => {
    const mesh = new InstancedMesh(geometry, material, list.length); mesh.name = name;
    list.forEach((item, i) => { mesh.setMatrixAt(i, item.m); mesh.setColorAt(i, item.c); });
    mesh.computeBoundingSphere(); mesh.castShadow = !low; mesh.receiveShadow = !low;
    stats.instances += list.length; stats.triangles += list.length * (geometry.index ? geometry.index.count / 3 : 0);
    return mesh;
  };
  if (skyline.length) group.add(instanced(skyline, cube, 'Rooftop parapets'));
  if (tanks.length) group.add(instanced(tanks, drum, 'Rooftop water tanks'));
  if (caps.length) group.add(instanced(caps, cone, 'Rooftop water tank caps'));
  if (stacks.length) group.add(instanced(stacks, drum, 'Rooftop vent stacks'));
  if (detail.length) {
    const mesh = instanced(detail, cube, 'Rooftop detail');
    const bounds = new Box3(); mesh.computeBoundingBox(); bounds.copy(mesh.boundingBox!);
    const lod = new LOD(); lod.name = 'Rooftop detail LOD';
    lod.addLevel(mesh, 0); lod.addLevel(new Object3D(), bounds.getSize(new Vector3()).length() / 2 + (low ? 200 : 300), .1);
    // LOD distance is measured to the LOD origin, so place it at the detail centre.
    const centre = bounds.getCenter(new Vector3()); lod.position.copy(centre); mesh.position.copy(centre).negate();
    group.add(lod);
  }
  return { group, dispose: () => { cube.dispose(); drum.dispose(); cone.dispose(); material.dispose(); }, stats };
}
