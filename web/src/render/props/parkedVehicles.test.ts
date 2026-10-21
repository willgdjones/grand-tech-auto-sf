import { afterEach, expect, it, vi } from 'vitest';
import { Group, Vector3 } from 'three';
import type { VehicleTemplate } from '../../vehicles/models/vehicle';
import { flags } from '@gtasf/shared/flags';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, parkedProps: true, realisticRender: true, driving: true, graphicsV2: false, pbrCarsV2: true } };
});

// Replace only the GLB transport: a lightweight template so placement/dispose logic is testable
// without decoding real assets.
vi.mock('../../vehicles/models/vehicle', async importOriginal => {
  const actual = await importOriginal<typeof import('../../vehicles/models/vehicle')>();
  return { ...actual, async loadRealisticExtraTemplate() {
    return { createInstance: () => ({ root: new Group(), dispose: () => {} }), dispose: () => {} } as unknown as VehicleTemplate;
  } };
});

import { createParkedVehicles, PARKED_SPOTS } from './parkedVehicles';

const landmark = (id: string) => Object.assign(new Group(), { userData: { landmarkId: id } });
const ground = { heightAt: () => 4, isLoaded: () => true };
afterEach(() => Object.assign(flags, { parkedProps: true, realisticRender: true, driving: true, graphicsV2: false, pbrCarsV2: true }));

it('exposes food-truck + scooter spots anchored to known landmarks', () => {
  expect(PARKED_SPOTS.length).toBeGreaterThan(0);
  expect(PARKED_SPOTS.some(spot => spot.kind === 'food-truck')).toBe(true);
  expect(PARKED_SPOTS.some(spot => spot.kind === 'scooter')).toBe(true);
  expect(new Set(PARKED_SPOTS.map(spot => spot.landmark)).has('ferry-building')).toBe(true);
  for (const spot of PARKED_SPOTS) expect(['food-truck', 'scooter']).toContain(spot.kind);
});




it('does not create props when any required feature is disabled', async () => {
  for (const gate of ['parkedProps', 'realisticRender', 'driving'] as const) {
    Object.assign(flags, { [gate]: false });
    expect(await createParkedVehicles({ landmarks: new Group(), ...ground })).toBeNull();
    Object.assign(flags, { [gate]: true });
  }
  // graphicsV2 (the live renderer) gates on pbrCarsV2 instead of realisticRender (gtasf-8s12).
  Object.assign(flags, { graphicsV2: true, pbrCarsV2: false });
  expect(await createParkedVehicles({ landmarks: new Group(), ...ground })).toBeNull();
});

it('creates props on the graphicsV2 path when pbrCarsV2 is on, even without realisticRender', async () => {
  Object.assign(flags, { graphicsV2: true, pbrCarsV2: true, realisticRender: false });
  expect(await createParkedVehicles({ landmarks: new Group(), ...ground })).not.toBeNull();
});
