/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects } from 'cloudflare:test';
import { flags } from '@gtasf/shared/flags';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import type { C2SMessage, S2CMessage } from '@gtasf/shared/protocol/types';
import type { Env } from '../env';
import { LOCAL_SPAWN, LOMBARD_SPAWN, LOCAL_TAXI_DESTINATION } from './localSpawn';
import { worldTestHeaders } from './admission/test-headers';

const sockets: WebSocket[] = [];
afterEach(async () => { for (const ws of sockets.splice(0)) { try { ws.close(); } catch { /* Already closed. */ } } await abortAllDurableObjects(); });

it('local socket smoke: two players, Ferry car, linked spawn, hail and cancellation', async () => {
  expect(flags.driving && flags.robotaxi, 'Run after actual playable feature switches are enabled').toBe(true);
  const world = (env as unknown as Env).WORLD;
  const stub = world.get(world.newUniqueId());
  async function connect(query = '') {
    const response = await stub.fetch(`https://test/api/world${query}`, { headers: await worldTestHeaders(stub) });
    expect(response.status).toBe(101);
    const socket = response.webSocket!; socket.binaryType = 'arraybuffer'; socket.accept(); sockets.push(socket);
    const messages: S2CMessage[] = [];
    socket.addEventListener('message', event => {
      if (typeof event.data === 'string') throw new Error('Expected binary');
      const decoded = decodeS2C(new Uint8Array(event.data));
      if (!decoded.ok) throw new Error(`Invalid server packet ${decoded.err}`);
      messages.push(decoded.msg);
    });
    async function next<T extends S2CMessage['type']>(type: T, from = 0) {
      await expect.poll(() => messages.slice(from).some(m => m.type === type)).toBe(true);
      return messages.slice(from).find(m => m.type === type) as Extract<S2CMessage, { type: T }>;
    }
    return { socket, messages, next, send: (message: C2SMessage) => socket.send(encodeC2S(message)) };
  }
  const a = await connect(), b = await connect();
  a.send({ type: 'HELLO', name: 'Ferry driver' }); const welcome = await a.next('WELCOME');
  expect(welcome.pose).toEqual(LOCAL_SPAWN);
  b.send({ type: 'HELLO', name: 'Observer' }); await b.next('WELCOME');
  expect((await b.next('PLAYER_JOIN')).id).toBe(welcome.id);
  expect((await a.next('VEHICLE_SNAPSHOT')).entries.some(car => car.id === 1)).toBe(true);

  a.send({ type: 'VEHICLE_ENTER', vehicleId: 1 });
  expect(await a.next('VEHICLE_STATE')).toMatchObject({ mode: 'driver', playerId: welcome.id, vehicleId: 1 });
  const seated = (await a.next('CORRECTION')).pose;
  a.send({ ...seated, type: 'VEHICLE_MOVE', vehicleId: 1, seq: 1, x: seated.x + 50 });
  await expect.poll(() => b.messages.some(m => m.type === 'VEHICLE_SNAPSHOT' && m.entries.some(car => car.id === 1 && car.x === seated.x + 50 && car.driverId === welcome.id))).toBe(true);
  const beforeExit = a.messages.length;
  a.send({ type: 'VEHICLE_EXIT', vehicleId: 1 });
  expect(await a.next('VEHICLE_STATE', beforeExit)).toMatchObject({ mode: 'on-foot' });

  const { x, y, z, yaw } = LOMBARD_SPAWN;
  const linked = await connect(`?spawn=${x},${y},${z},${yaw}`);
  linked.send({ type: 'HELLO', name: 'Same identity', resumeToken: welcome.resumeToken });
  expect(await linked.next('WELCOME')).toMatchObject({ id: welcome.id, pose: LOMBARD_SPAWN, resumed: true });
  linked.send({ type: 'ROBOTAXI_HAIL', requestId: 77, destination: LOCAL_TAXI_DESTINATION });
  expect(await linked.next('ROBOTAXI_STATE')).toMatchObject({ requestId: 77, state: 'requested' });
  const beforeCancel = linked.messages.length;
  linked.send({ type: 'ROBOTAXI_CANCEL', requestId: 77 });
  expect(await linked.next('ROBOTAXI_STATE', beforeCancel)).toMatchObject({ requestId: 77, state: 'cancelled' });
});
