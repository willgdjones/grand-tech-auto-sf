import { expect, test } from 'vitest';
import { cullOverlappingLabels, nearestDistrictIndex, SF_DISTRICTS, type LabelCandidate } from './districts';

// Helper: a centred label box.
const box = (x: number, y: number, priority: number, halfW = 20, halfH = 7): LabelCandidate =>
  ({ x, y, halfW, halfH, priority });

test('keeps the higher-priority label when two boxes overlap, and always keeps a far one', () => {
  const candidates = [
    box(100, 100, 4), // low priority, overlaps the next one
    box(110, 102, 9), // high priority, boxes overlap (|dx|=10 < 40)
    box(400, 300, 1), // far away, always kept
  ];
  expect(cullOverlappingLabels(candidates, 0)).toEqual([1, 2]); // #0 dropped for higher-priority #1
});

test('a wide label is protected horizontally where a centre-distance test would not', () => {
  // Two labels 60px apart. Narrow boxes (halfW 20) do not overlap; wide ones (halfW 60) do.
  const narrow = [box(100, 100, 5, 20), box(160, 100, 3, 20)];
  expect(cullOverlappingLabels(narrow, 0)).toEqual([0, 1]); // 60 >= 20+20, both fit
  const wide = [box(100, 100, 5, 60), box(160, 100, 3, 60)];
  expect(cullOverlappingLabels(wide, 0)).toEqual([0]); // 60 < 60+60, lower-priority dropped
});

test('stacked labels at the same x only clash when their vertical boxes meet', () => {
  const apart = [box(100, 100, 5, 40, 7), box(100, 120, 3, 40, 7)]; // |dy|=20 >= 7+7
  expect(cullOverlappingLabels(apart, 0)).toEqual([0, 1]);
  const close = [box(100, 100, 5, 40, 7), box(100, 108, 3, 40, 7)]; // |dy|=8 < 7+7
  expect(cullOverlappingLabels(close, 0)).toEqual([0]);
});

test('zooming in spreads boxes apart so a culled label reappears', () => {
  const near = [box(100, 100, 5, 40, 7), box(160, 100, 3, 40, 7)]; // |dx|=60 < 80 -> clash
  expect(cullOverlappingLabels(near, 0)).toEqual([0]);
  const zoomed = near.map(c => ({ ...c, x: c.x * 3 })); // centres now 180px apart
  expect(cullOverlappingLabels(zoomed, 0)).toEqual([0, 1]);
});

test('padding grows the clash region', () => {
  const touching = [box(100, 100, 5, 20, 7), box(141, 100, 3, 20, 7)]; // |dx|=41 > 40 -> no clash at pad 0
  expect(cullOverlappingLabels(touching, 0)).toEqual([0, 1]);
  expect(cullOverlappingLabels(touching, 5)).toEqual([0]); // pad 5 -> 41 < 45 -> clash
});

test('empty input and single candidate are handled', () => {
  expect(cullOverlappingLabels([], 5)).toEqual([]);
  expect(cullOverlappingLabels([box(5, 5, 2)], 5)).toEqual([0]);
});

test('nearestDistrictIndex picks the closest centroid, handles empty and ties', () => {
  const ds = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 0, z: 100 }];
  expect(nearestDistrictIndex(ds, 10, 5)).toBe(0);
  expect(nearestDistrictIndex(ds, 90, -5)).toBe(1);
  expect(nearestDistrictIndex(ds, 5, 95)).toBe(2);
  expect(nearestDistrictIndex([], 0, 0)).toBe(-1);
  // On an exact tie the first (lowest index) wins, since strictly-less-than keeps the earlier best.
  expect(nearestDistrictIndex([{ x: -10, z: 0 }, { x: 10, z: 0 }], 0, 0)).toBe(0);
});

test('the district table is well-formed and the spawn district outranks the rest', () => {
  expect(SF_DISTRICTS.length).toBeGreaterThanOrEqual(12);
  for (const d of SF_DISTRICTS) {
    expect(d.name.length).toBeGreaterThan(0);
    expect(Number.isFinite(d.lat) && Number.isFinite(d.lon)).toBe(true);
    expect(d.priority).toBeGreaterThan(0);
  }
  const top = [...SF_DISTRICTS].sort((a, b) => b.priority - a.priority)[0]!;
  expect(top.name).toBe('Embarcadero'); // the default spawn plaza
});
