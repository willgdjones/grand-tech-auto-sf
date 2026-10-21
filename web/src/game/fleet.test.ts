import { expect, it, vi } from 'vitest';
import { BoxGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D, Scene, Vector3 } from 'three';
import type { VehicleEntry } from '@gtasf/shared/protocol/types';
import { sampleCableCar } from '@gtasf/shared/transit/cableCars';
import { createFleet } from './fleet';
import { vehicleCameraHit } from './cameraCollision';

vi.mock('@gtasf/shared/flags', async importOriginal => {
  const actual = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, driving: true, robotaxi: true, cableCars: true, vehiclePolish: true, muni: false, rideAnyVehicle: false } };
});

// Replace the asset load only: a tiny synthetic glTF scene with the shipped models' named parts (body with nested
// trim, four wheel-* nodes, the robotaxi lidar rotor) goes through the PRODUCTION createVehicleTemplate (polish, far
// bake, LOD, seat/exit/camera attachments). Decoding the real meshopt GLBs made this test take seconds and time out
// under machine load (it aborted two deploys); the matrix/attachment contract under test doesn't depend on them.
function syntheticVehicle(id: string): { scene: Group } {
  const scene = new Group(), material = new MeshStandardMaterial();
  const body = new Mesh(new BoxGeometry(1.8, 1.2, 4.2), material); body.name = 'body'; body.position.y = .8;
  const trim = new Mesh(new BoxGeometry(1.7, .1, .2), material); trim.name = 'trim'; trim.position.set(0, .2, 2); body.add(trim);
  scene.add(body);
  for (const [name, x, z] of [['wheel-front-left', -.8, 1.3], ['wheel-front-right', .8, 1.3], ['wheel-back-left', -.8, -1.3], ['wheel-back-right', .8, -1.3]] as const) {
    const wheel = new Mesh(new CylinderGeometry(.35, .35, .25, 8), material); wheel.name = name; wheel.position.set(x, .35, z); scene.add(wheel);
  }
  if (id === 'robotaxi') { const lidar = new Mesh(new CylinderGeometry(.2, .2, .2, 8), material); lidar.name = 'lidar'; lidar.position.y = 1.55; scene.add(lidar); }
  return { scene };
}
vi.mock('../vehicles/models/vehicle', async importOriginal => {
  const actual = await importOriginal<typeof import('../vehicles/models/vehicle')>();
  return { ...actual, async loadVehicleTemplate(id: Parameters<typeof actual.loadVehicleTemplate>[0]) {
    return actual.createVehicleTemplate(id, syntheticVehicle(id) as unknown as Parameters<typeof actual.createVehicleTemplate>[1]);
  } };
});

function expectedWorld(node: Object3D): Matrix4 {
  const local = new Matrix4().compose(node.position, node.quaternion, node.scale);
  return node.parent ? expectedWorld(node.parent).multiply(local) : local;
}
function expectMatrix(actual: Matrix4, expected: Matrix4): void {
  // One assertion per matrix (16 toBeCloseTo calls × ~300 nodes × frames dominated the runtime).
  let worst = 0; actual.elements.forEach((value, i) => { worst = Math.max(worst, Math.abs(value - expected.elements[i]!)); });
  expect(worst).toBeLessThan(5e-10);
}
function expectPosition(actual: Vector3, expected: Vector3): void {
  expect(actual.distanceTo(expected)).toBeLessThan(1e-8);
}

it('keeps cameras, passengers and animated CC0 parts current without a second descendant pass', async () => {
  const scene = new Scene(), parent = new Group();
  parent.position.set(13, 7, -31); parent.rotation.y = .4; scene.add(parent);
  scene.updateMatrixWorld();
  const fleet = await createFleet(parent);
  try {
    const entries: VehicleEntry[] = ['prius', 'tesla', 'subaru', 'robotaxi'].map((kind, index) => ({
      id: index + 1, kind: kind as VehicleEntry['kind'], x: index * 1000, y: 400,
      z: -2000, yaw: 32, speedCmps: 500, flags: index ? 0x20 : 0, driverId: index ? 0 : 42,
    }));
    const now = 1_800_000_000_000;
    fleet.sync(entries, now - 200);
    fleet.sync(entries.map(entry => ({ ...entry, x: entry.x + 100, y: 500, z: -1900, yaw: 64 })), now - 100);
    const passenger = new Group(), head = new Object3D();
    head.position.set(.1, 1.4, -.05); passenger.add(head);
    fleet.cars.get(1)!.model.seat.add(passenger);
    const descendants: Object3D[] = [];
    for (const car of fleet.cars.values()) car.model.root.traverse(node => { if (node !== car.model.root) descendants.push(node); });
    const spies = descendants.map(node => vi.spyOn(node, 'updateMatrixWorld'));
    const clearVisits = () => spies.forEach(spy => spy.mockClear());
    const visits = () => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    const frameVisits: number[] = [], renderVisits: number[] = [];
    const driver = { x: 40, y: 18, z: -21, yaw: 1.1, pitch: -.23, roll: .12, speed: 7, steering: .27, slip: 0, visualY: 18, bumpVx: 0, bumpVz: 0, bumpSpin: 0, vy: 0, airborne: false, landed: false };
    const wheel = fleet.cars.get(1)!.model.root.getObjectByName('wheel-front-left')!;
    const rotor = fleet.cars.get(4)!.model.root.getObjectByName('lidar')!;
    expect(wheel).toBeDefined(); expect(rotor).toBeDefined();
    const firstWheelX = wheel.rotation.x, firstWheelY = wheel.rotation.y, firstRotorY = rotor.rotation.y;
    for (let frame = 0; frame < 3; frame++) {
      const serverNow = now + frame * 10;
      driver.x += 1; driver.yaw += .05;
      clearVisits();
      fleet.update(1 / 60, 1, driver, undefined, serverNow);
      frameVisits.push(visits());
      expectPosition(fleet.cars.get(1)!.model.root.position, new Vector3(driver.x, driver.y, driver.z));
      const alpha = .5 + frame * .1;
      expectPosition(fleet.cars.get(2)!.model.root.position, new Vector3(10 + alpha, 4 + alpha, -20 + alpha));
      for (const car of fleet.cars.values()) {
        const rootWorld = expectedWorld(car.model.root);
        expectMatrix(car.model.root.matrixWorld, rootWorld);
        expectMatrix(car.cameraInverse, rootWorld.clone().invert());
        if (car.data.kind === 'cable-car') {
          const cable = sampleCableCar(car.data.id, serverNow)!;
          expectPosition(car.model.root.position, new Vector3(cable.entry.x / 100, cable.entry.y / 100, cable.entry.z / 100));
          expect(car.model.root.rotation.x).toBeCloseTo(cable.pitch, 9);
        }
        // Main asks the target for its position before render; attachment users
        // can likewise query the current world transform without a subtree walk.
        for (const target of [car.model.cameraTarget, car.model.seat, car.model.exit]) {
          expectPosition(target.getWorldPosition(new Vector3()), new Vector3().setFromMatrixPosition(expectedWorld(target)));
        }
        const center = car.cameraBounds.getCenter(new Vector3());
        const origin = new Vector3(car.cameraBounds.max.x + 10, center.y, center.z).applyMatrix4(rootWorld);
        const direction = new Vector3(-1, 0, 0).transformDirection(rootWorld);
        expect(vehicleCameraHit(car, origin, direction, .25, 30)).toBeCloseTo(9.75, 8);
      }
      expectPosition(head.getWorldPosition(new Vector3()), new Vector3().setFromMatrixPosition(expectedWorld(head)));
      // This is the same matrix pass WebGLRenderer.render performs. All visible
      // vehicle parts and nested passengers must be current when drawing starts.
      clearVisits(); scene.updateMatrixWorld(); renderVisits.push(visits());
      for (const node of descendants) expectMatrix(node.matrixWorld, expectedWorld(node));
    }
    expect(wheel.rotation.x).not.toBe(firstWheelX);
    expect(rotor.rotation.y).not.toBe(firstRotorY);
    expect(wheel.rotation.y).toBeCloseTo(firstWheelY + .27, 8);
    fleet.setCruiseMode(true); fleet.update(1 / 60, 1, driver, undefined, now + 40);
    expect(fleet.cars.get(1)!.model.root.visible).toBe(true);
    expect(fleet.cars.get(2)!.model.root.visible).toBe(false);
    fleet.setCruiseMode(false); fleet.update(1 / 60, 1, driver, undefined, now + 50);
    expect(fleet.cars.get(2)!.model.root.visible).toBe(true);
    expectPosition(fleet.cars.get(2)!.model.root.position, new Vector3(11, 5, -19));
    console.info(JSON.stringify({ vehicles: fleet.cars.size, descendants: descendants.length, frameVisits, renderVisits }));
    expect(frameVisits).toEqual([0, 0, 0]);
    expect(renderVisits).toEqual([descendants.length, descendants.length, descendants.length]);
    spies.forEach(spy => spy.mockRestore());
  } finally { fleet.dispose(); }
});
