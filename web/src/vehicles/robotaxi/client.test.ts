import { expect, test, vi } from 'vitest';
import { createRobotaxiClient } from './client';
import type { C2SMessage } from '@gtasf/shared/protocol/types';

const flags = vi.hoisted(() => ({ robotaxi: true, quickRobotaxi: false, reconnectGrace: false }));
vi.mock('@gtasf/shared/flags', () => ({ flags }));

test('disconnect settles queued fares and reconnect sends only fresh destinations', async () => {
  vi.useFakeTimers(); flags.quickRobotaxi = true;
  try {
    const send = vi.fn((_message: Extract<C2SMessage, { requestId: number }>) => true);
    const client = createRobotaxiClient({ send, notify() {}, resolveDestination: point => point, getMode: () => 'on-foot' });
    const destination = { title: 'Lombard', x: 12, y: 0, z: 3 };
    client.setConnected(true);
    const old = [client.quote(destination), client.quote({ ...destination, x: 50 })];
    await Promise.resolve(); expect(send).toHaveBeenCalledTimes(1);
    client.setConnected(false);
    await expect(Promise.all(old)).resolves.toEqual([
      { label: 'Unavailable', affordable: false, fareCents: '' },
      { label: 'Unavailable', affordable: false, fareCents: '' },
    ]);
    client.setConnected(true);
    const fresh = client.quote(destination);
    await Promise.resolve(); expect(send).toHaveBeenCalledTimes(2);
    const id = send.mock.calls[1]![0]!.requestId;
    client.message({ type: 'ROBOTAXI_STATE', requestId: id, state: 'quoted', vehicleId: 0, etaSeconds: 0,
      pose: { x: 0, y: 0, z: 0, yaw: 0, flags: 0 }, destination: { x: 1200, y: 0, z: 300 },
      quick: { title: 'Lombard', fareCents: '0', freeRidesLeft: 3, durationMs: 0 } });
    await expect(fresh).resolves.toMatchObject({ affordable: true, label: 'FREE (3 left)' });
    await vi.runAllTimersAsync(); expect(send).toHaveBeenCalledTimes(2);
  } finally { flags.quickRobotaxi = false; vi.useRealTimers(); }
});

test('cleared routes cannot hail stale coordinates, while active trips still cancel and a new selection hails', () => {
  const send = vi.fn(() => true), notify = vi.fn();
  const resolveDestination = vi.fn((point: { x: number; y: number; z: number }) => point);
  const client = createRobotaxiClient({ send, notify, resolveDestination, getMode: () => 'on-foot' });
  const destination = { title: 'Lombard switchbacks', x: 12, y: 8, z: -4 };
  const cleared = { ...destination, title: '' };
  const pose = { x: 0, y: 0, z: 0, yaw: 0, flags: 0 };
  client.setConnected(true);
  for (const title of ['', '  \t']) {
    expect(client.toggle({ ...cleared, title })).toBe(false);
    expect(notify).toHaveBeenLastCalledWith('Choose a destination on the map before hailing.');
  }
  expect(resolveDestination).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(client.state).toBe('idle');

  expect(client.toggle(destination)).toBe(true);
  expect(send).toHaveBeenLastCalledWith({ type: 'ROBOTAXI_HAIL', requestId: 1,
    destination: { x: 1200, y: 800, z: -400 } });
  client.message({ type: 'ROBOTAXI_STATE', requestId: 1, state: 'riding', vehicleId: 7, etaSeconds: 30, pose,
    destination: { x: 1200, y: 800, z: -400 } });
  expect(client.toggle(cleared)).toBe(true);
  expect(send).toHaveBeenLastCalledWith({ type: 'ROBOTAXI_CANCEL', requestId: 1 });
  expect(resolveDestination).toHaveBeenCalledTimes(1);

  client.message({ type: 'ROBOTAXI_STATE', requestId: 1, state: 'cancelled', vehicleId: 0, etaSeconds: 0, pose,
    destination: { x: 1200, y: 800, z: -400 } });
  expect(client.toggle(cleared)).toBe(false);
  expect(send).toHaveBeenCalledTimes(2);
  expect(client.toggle({ ...destination, title: 'Ferry Building', x: 20 })).toBe(true);
  expect(send).toHaveBeenLastCalledWith({ type: 'ROBOTAXI_HAIL', requestId: 2,
    destination: { x: 2000, y: 800, z: -400 } });
});

test('a thrown quote send leaves the queue usable and unavailable fares can retry', async () => {
  vi.useFakeTimers(); flags.quickRobotaxi = true;
  try {
    const send = vi.fn((_message: Extract<C2SMessage, { requestId: number }>) => true)
      .mockImplementationOnce(() => { throw new Error('Socket closed during send'); });
    const client = createRobotaxiClient({ send, notify() {}, resolveDestination: point => point, getMode: () => 'on-foot' });
    const destination = { title: 'Lombard', x: 12, y: 0, z: 3 };
    client.setConnected(true);
    const failed = client.quote(destination);
    const next = client.quote({ ...destination, x: 50 });
    await expect(failed).resolves.toMatchObject({ label: 'Unavailable', affordable: false });
    const retry = client.quote(destination);
    const reply = () => client.message({ type: 'ROBOTAXI_STATE', requestId: send.mock.calls.at(-1)![0].requestId,
      state: 'quoted', vehicleId: 0, etaSeconds: 0, pose: { x: 0, y: 0, z: 0, yaw: 0, flags: 0 },
      destination: { x: 1200, y: 0, z: 300 }, quick: { title: 'Lombard', fareCents: '0', freeRidesLeft: 3, durationMs: 0 } });
    // gtasf-x9sm: a dead transport releases every queued quote at once (no 5 s wait per row).
    await expect(next).resolves.toMatchObject({ label: 'Unavailable', affordable: false });
    await vi.advanceTimersByTimeAsync(100); expect(send).toHaveBeenCalledTimes(2); reply();
    await expect(retry).resolves.toMatchObject({ affordable: true });
    await vi.runAllTimersAsync(); expect(vi.getTimerCount()).toBe(0);
  } finally { flags.quickRobotaxi = false; vi.useRealTimers(); }
});

test('reconnectGrace: a fare cut off by a socket drop waits for the reconnect and is quoted, not FARE UNAVAILABLE', async () => {
  vi.useFakeTimers(); flags.quickRobotaxi = true; flags.reconnectGrace = true;
  try {
    const send = vi.fn((_message: Extract<C2SMessage, { requestId: number }>) => true);
    const notify = vi.fn();
    const client = createRobotaxiClient({ send, notify, resolveDestination: point => point, getMode: () => 'on-foot' });
    const destination = { title: 'Lombard', x: 12, y: 0, z: 3 };
    client.setConnected(true);
    const fare = client.quote(destination);
    await Promise.resolve(); expect(send).toHaveBeenCalledTimes(1);
    client.setConnected(false);                                   // the drop, while the fare is loading
    expect(notify).toHaveBeenCalledWith('Reconnecting to the city…', 10000);
    await vi.advanceTimersByTimeAsync(2000);
    client.setConnected(true);                                    // back 2 s later
    await vi.advanceTimersByTimeAsync(150); expect(send).toHaveBeenCalledTimes(2); // asked again
    client.message({ type: 'ROBOTAXI_STATE', requestId: send.mock.calls[1]![0]!.requestId, state: 'quoted', vehicleId: 0, etaSeconds: 0,
      pose: { x: 0, y: 0, z: 0, yaw: 0, flags: 0 }, destination: { x: 1200, y: 0, z: 300 },
      quick: { title: 'Lombard', fareCents: '0', freeRidesLeft: 3, durationMs: 0 } });
    await expect(fare).resolves.toMatchObject({ affordable: true, label: 'FREE (3 left)' });
  } finally { flags.quickRobotaxi = false; flags.reconnectGrace = false; vi.useRealTimers(); }
});

test('reconnectGrace: no reconnect within 10 s still ends as Unavailable', async () => {
  vi.useFakeTimers(); flags.quickRobotaxi = true; flags.reconnectGrace = true;
  try {
    const send = vi.fn((_message: Extract<C2SMessage, { requestId: number }>) => true);
    const client = createRobotaxiClient({ send, notify() {}, resolveDestination: point => point, getMode: () => 'on-foot' });
    client.setConnected(true);
    const fare = client.quote({ title: 'Lombard', x: 12, y: 0, z: 3 });
    await Promise.resolve();
    client.setConnected(false);
    await vi.advanceTimersByTimeAsync(10_500);
    await expect(fare).resolves.toEqual({ label: 'Unavailable', affordable: false, fareCents: '' });
    expect(send).toHaveBeenCalledTimes(1);
  } finally { flags.quickRobotaxi = false; flags.reconnectGrace = false; vi.useRealTimers(); }
});
