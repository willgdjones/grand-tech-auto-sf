import { expect, it } from 'vitest';
import { DISTRICTS } from '../src/districts';
import { project } from '../src/pipeline/settings';
import { roadDetailCellWithin, selectDistrictRoadCells, splitRoadDetailCells } from '../src/districts/roadDetailCells';
import type { DistrictRoadSource } from '../src/districts/roadDetailCells';

it('extends every district along named surface streets while preserving source phase and existing cells', () => {
  // Keep the original eastern area, and cover distant arrivals without selecting
  // a motorway, bridge or identically named road outside its district.
  const noCorridor = [10_000, 10_000, 10_256, 10_256] as const;
  for (const district of DISTRICTS) {
    const [x, z] = project(district.spawn.lon, district.spawn.lat);
    const road: DistrictRoadSource = { name: district.streets[0]!, highway: 'residential', points: [[x-10, 12, z], [x+10, 13, z]] };
    const key = `${Math.floor(x/256)}_${Math.floor(z/256)}`;
    const selected = selectDistrictRoadCells([road], noCorridor, ['100_100']);
    expect(selected.cells.has(key), district.id).toBe(true);
    expect(selected.cells.has('100_100')).toBe(true);
    expect(selected.byDistrict.get(district.id)?.has(key), district.id).toBe(true);
    expect(selectDistrictRoadCells([{ ...road, highway: 'motorway_link' }], noCorridor).cells.size).toBe(0);
    expect(selectDistrictRoadCells([{ ...road, bridge: true }], noCorridor).cells.size).toBe(0);
    expect(selectDistrictRoadCells([{ ...road, name: 'Unconfigured fixture street' }], noCorridor).cells.size).toBe(0);
  }
  const parts = splitRoadDetailCells([[-300, 10, -100], [300, 16, -100]]);
  expect(parts.map(p=>p.key)).toEqual(['-2_-1','-1_-1','0_-1','1_-1']);
  expect(parts.map(p=>[p.from,p.to])).toEqual([[0,44],[44,300],[300,556],[556,600]]);
  for (let i=1;i<parts.length;i++) expect(parts[i-1]!.points.at(-1)).toEqual(parts[i]!.points[0]);
  expect(roadDetailCellWithin('-1_-1',[-256,-256,0,0])).toBe(true);
  expect(selectDistrictRoadCells([],[-256,-256,0,0],['-1_-1','0_0']).cells).toEqual(new Set(['0_0']));
});
