import { expect, it } from 'vitest';
import { muniRoutes } from './muniRoutes';
import { isMuniBus, muniBusIds, nearestMuniStops, sampleMuniBus } from './muni';

it('serves every sourced stop in order without jumps and gives late joins and GPS the same clock', () => {
  const start = Date.UTC(2026, 9, 3, 14), id = muniBusIds[0]!;
  expect(muniRoutes.map(route => route.stops.length)).toEqual([17, 22]);
  expect(muniRoutes.every(route => route.lengthM > 2800 && route.maximumGrade < .4)).toBe(true);
  const state = sampleMuniBus(id, start)!, entry = state.entry;
  let x = entry.x, y = entry.y, z = entry.z, maximumStep = 0, maximumRise = 0, lowest = y, highest = y;
  const stops = new Set<string>(), directions = new Set<string>();
  const orderedStops = muniRoutes.flatMap(route => route.stops.map(stop => `${route.id}/${stop.id}`));
  let reused = true, valid = true, previousStop = -1;
  for (let now = start + 100; now <= start + 3_000_000; now += 100) {
    const next = sampleMuniBus(id, now, state)!;
    reused &&= next === state && next.entry === entry;
    valid &&= next.entry.kind === 'bus' && next.entry.driverId === 0 && next.entry.flags === 0;
    maximumStep = Math.max(maximumStep, Math.hypot(entry.x - x, entry.z - z));
    maximumRise = Math.max(maximumRise, Math.abs(entry.y - y));
    lowest = Math.min(lowest, entry.y); highest = Math.max(highest, entry.y);
    if (next.boarding) {
      const key = `${next.routeId}/${next.stopId}`, index = orderedStops.indexOf(key);
      if (index !== previousStop) {
        valid &&= previousStop < 0 || index === (previousStop + 1) % orderedStops.length;
        previousStop = index;
      }
      stops.add(key); valid &&= entry.speedCmps === 0;
    }
    directions.add(next.routeId); x = entry.x; y = entry.y; z = entry.z;
  }
  expect(valid && reused).toBe(true);
  expect(maximumStep).toBeLessThan(65); expect(maximumRise).toBeLessThan(20);
  expect(highest - lowest).toBeGreaterThan(8000);
  expect(directions.size).toBe(2); expect(stops.size).toBe(39);
  expect(state).toEqual(sampleMuniBus(id, start + 3_000_000)); // Fresh late join agrees after 50 minutes of updates.
  expect(isMuniBus(1)).toBe(false); expect(isMuniBus(id + .5)).toBe(false);
  expect(sampleMuniBus(id, NaN)).toBeUndefined(); expect(sampleMuniBus(-1, start)).toBeUndefined();
  for (const route of muniRoutes) {
    const [px, , pz] = route.stops[8]!.point;
    const choice = nearestMuniStops({ x: px, z: pz }, start).find(stop => stop.destination === route.destination)!;
    expect(choice.distanceM).toBeLessThan(.01);
    expect(choice.waitSeconds).toBeGreaterThanOrEqual(0); expect(choice.waitSeconds).toBeLessThan(240);
    const arriving = muniBusIds.map(busId => sampleMuniBus(busId, start + choice.waitSeconds * 1000)!)
      .find(bus => bus.boarding && bus.routeId === route.id && Math.hypot(bus.entry.x - choice.x * 100, bus.entry.z - choice.z * 100) < 2);
    expect(arriving, `${choice.title} ETA actually serves ${choice.stop}`).toBeDefined();
  }
});
