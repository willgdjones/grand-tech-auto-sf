import { expect, it } from 'vitest';
import { ribbonGeometry, routeProgress } from './guidance';

it('reports remaining lane distance and deviation instead of a straight-line shortcut', () => {
  const route = { points: [[0, 0, 0], [0, 0, 100], [100, 0, 100]] as [number, number, number][], distanceM: 200, approach: { x: 100, y: 0, z: 100 }, destinationDistanceM: 0 };
  expect(routeProgress(route, { x: 0, y: 0, z: 40 }, 2)).toEqual({ remainingM: 160, offRouteM: 0, etaSeconds: 80 });
  expect(routeProgress(route, { x: -30, y: 0, z: 40 }, 2)).toEqual({ remainingM: 160, offRouteM: 30, etaSeconds: 95 });
});

it('keeps the GPS ribbon above an intervening plaza without lowering elevated source lanes', () => {
  const route = { points: [[0, 2.97, 0], [20, 2.97, 0], [30, 8, 0]] as [number, number, number][], distanceM: 30, approach: { x: 30, y: 8, z: 0 }, destinationDistanceM: 0 };
  const original = structuredClone(route.points);
  const geometry = ribbonGeometry(route, x => x >= 4 && x <= 16 ? 3.33 : x >= 20 ? 3 : null);
  const positions = geometry.getAttribute('position');
  let plazaVertices = 0;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i);
    if (x >= 4 && x <= 16) { expect(y).toBeCloseTo(3.51, 5); plazaVertices++; }
    if (x === 30) expect(y).toBeCloseTo(8.18, 5);
    if (x === 0) expect(y).toBeCloseTo(3.15, 5);
  }
  expect(plazaVertices).toBeGreaterThan(0);
  expect(route.points).toEqual(original);
  geometry.dispose();
});
