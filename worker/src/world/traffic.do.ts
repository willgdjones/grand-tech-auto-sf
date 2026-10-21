/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects } from 'cloudflare:test';
import { flags } from '@gtasf/shared/flags';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import type { C2SMessage, Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import type { Env } from '../env';
import { LOCAL_SPAWN, LOMBARD_SPAWN } from './localSpawn';
import { worldTestHeaders } from './admission/test-headers';

const NPC_FLAG = 0x20;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) { try { socket.close(); } catch { /* Already closed. */ } }
  await abortAllDurableObjects();
});

it('streams nearby lane traffic with the playable fleet and keeps NPC cars unenterable', async () => {
  expect(flags.traffic, 'Run after the actual traffic entry point is enabled').toBe(true);
  const world = (env as unknown as Env).WORLD;
  const stub = world.get(world.newUniqueId());
  async function connect(name: string, pose: Pose) {
    const response = await stub.fetch(`https://test/api/world?spawn=${pose.x},${pose.y},${pose.z},${pose.yaw}`, {
      headers: await worldTestHeaders(stub),
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.binaryType = 'arraybuffer'; socket.accept(); sockets.push(socket);
    const messages: S2CMessage[] = [];
    socket.addEventListener('message', event => {
      const result = decodeS2C(new Uint8Array(event.data as ArrayBuffer));
      if (!result.ok) throw new Error(`Invalid traffic packet ${result.err}`);
      messages.push(result.msg);
    });
    const send = (message: C2SMessage) => socket.send(encodeC2S(message));
    const latest = () => messages.filter((message): message is Extract<S2CMessage, { type: 'VEHICLE_SNAPSHOT' }> =>
      message.type === 'VEHICLE_SNAPSHOT').at(-1);
    send({ type: 'HELLO', name });
    await expect.poll(() => messages.some(message => message.type === 'WELCOME')).toBe(true);
    return { messages, send, latest };
  }
  const ferry = await connect('Ferry traffic observer', LOCAL_SPAWN);
  const hill = await connect('Lombard traffic observer', LOMBARD_SPAWN);
  for (const [observer, pose, starter] of [[ferry, LOCAL_SPAWN, 1], [hill, LOMBARD_SPAWN, 4]] as const) {
    await expect.poll(() => observer.latest()?.entries.some(car => (car.flags & NPC_FLAG) && car.speedCmps > 0)).toBe(true);
    const entries = observer.latest()!.entries;
    expect(entries.some(car => car.id === starter)).toBe(true);
    const traffic = entries.filter(car => car.flags & NPC_FLAG);
    expect(traffic.length).toBeLessThanOrEqual(300);
    for (const car of traffic) {
      expect(car.driverId).toBe(0);
      expect(Math.hypot(car.x - pose.x, car.z - pose.z)).toBeLessThanOrEqual(40_000);
    }
  }
  const trafficCar = ferry.latest()!.entries.find(car => car.flags & NPC_FLAG)!;
  ferry.send({ type: 'VEHICLE_ENTER', vehicleId: trafficCar.id });
  // PONG follows the enter request on this ordered socket, so it fences the ownership check.
  ferry.send({ type: 'PING', nonce: 41, clientT: Date.now() });
  await expect.poll(() => ferry.messages.some(message => message.type === 'PONG' && message.nonce === 41)).toBe(true);
  expect(ferry.messages.some(message => message.type === 'VEHICLE_STATE' && message.mode === 'driver')).toBe(false);
  ferry.send({ type: 'VEHICLE_ENTER', vehicleId: 1 });
  await expect.poll(() => ferry.messages.some(message => message.type === 'VEHICLE_STATE' && message.mode === 'driver' && message.vehicleId === 1)).toBe(true);
});
