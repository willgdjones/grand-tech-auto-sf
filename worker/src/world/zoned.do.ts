/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects } from 'cloudflare:test';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { CloseCode } from '@gtasf/shared/protocol/constants';
import type { C2SMessage, S2CMessage } from '@gtasf/shared/protocol/types';
import type { WorldDO } from './WorldDO';
import type { Env } from '../env';
import { LOCAL_SPAWN } from './localSpawn';
import { SF_ZONE_GRID, cellIndex, cellOf, globalPlayerId, splitPlayerId } from '@gtasf/shared/world/zones';
import { worldTestHeaders } from './admission/test-headers';

const bindings = env as unknown as Env;
const sockets: WebSocket[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const ws of sockets.splice(0)) { try { ws.close(); } catch { /* closed */ } } await abortAllDurableObjects(); });
function zone() { return bindings.WORLD.get(bindings.WORLD.newUniqueId()) as DurableObjectStub<WorldDO>; }

function reader(ws: WebSocket) {
  ws.binaryType = 'arraybuffer'; ws.accept(); sockets.push(ws);
  const messages: S2CMessage[] = [];
  const listeners = new Set<() => void>();
  ws.addEventListener('message', event => {
    if (typeof event.data === 'string') throw new Error('Unexpected text frame');
    const decoded = decodeS2C(new Uint8Array(event.data));
    if (!decoded.ok) throw new Error(`Bad server frame: ${decoded.err}`);
    messages.push(decoded.msg); for (const listener of listeners) listener();
  });
  function next<T extends S2CMessage['type']>(type: T, predicate?: (message: Extract<S2CMessage, { type: T }>) => boolean): Promise<Extract<S2CMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`No ${type}; received ${messages.map(m => m.type)}`)); }, 5000);
      function check() {
        const found = messages.find((m): m is Extract<S2CMessage, { type: T }> => m.type === type && (!predicate || predicate(m as Extract<S2CMessage, { type: T }>)));
        if (found) { clearTimeout(timer); listeners.delete(check); resolve(found); }
      }
      listeners.add(check); check();
    });
  }
  const closed = new Promise<number>(resolve => ws.addEventListener('close', event => resolve(event.code), { once: true }));
  return { ws, messages, next, closed, send: (m: C2SMessage) => ws.send(encodeC2S(m)) };
}

async function player(stub: DurableObjectStub<WorldDO>, pose = LOCAL_SPAWN) {
  const response = await stub.fetch(`https://test/api/world?spawn=${pose.x},${pose.y},${pose.z},${pose.yaw}`, { headers: await worldTestHeaders(stub) });
  expect(response.status).toBe(101);
  const r = reader(response.webSocket!);
  r.send({ type: 'HELLO', name: 'Resident' });
  return r;
}

async function playerInZone(stub: DurableObjectStub<WorldDO>, cx: number, cy: number) {
  const response = await stub.fetch(`https://test/api/world?zone=${cx},${cy}`, { headers: await worldTestHeaders(stub) });
  expect(response.status).toBe(101);
  const r = reader(response.webSocket!);
  r.send({ type: 'HELLO', name: 'Resident' });
  return r;
}

async function observer(stub: DurableObjectStub<WorldDO>, pose = LOCAL_SPAWN) {
  const response = await stub.fetch(`https://test/api/world?observe=1&spawn=${pose.x},${pose.y},${pose.z},${pose.yaw}`, { headers: await worldTestHeaders(stub) });
  expect(response.status).toBe(101);
  return reader(response.webSocket!);
}

it('delivers a zone\'s players to a read-only observer, which stays invisible to those players', async () => {
  const stub = zone();
  const resident = await player(stub); const welcome = await resident.next('WELCOME');
  const watcher = await observer(stub, LOCAL_SPAWN);
  // The observer receives the resident in a SNAPSHOT at its filter pose, at the resident's real pose.
  const snapshot = await watcher.next('SNAPSHOT', m => m.entries.some(e => e.id === welcome.id));
  const entry = snapshot.entries.find(e => e.id === welcome.id);
  expect(entry?.x).toBe(welcome.pose.x);
  expect(entry?.z).toBe(welcome.pose.z);
  // The observer is a ghost (id -1, never a peer): residents never get a snapshot entry for it.
  await resident.next('SNAPSHOT');
  expect(resident.messages.filter(m => m.type === 'SNAPSHOT').every(m => m.entries.every(e => e.id !== -1))).toBe(true);
});

it('seeds a zone\'s player ids into its globally-unique cell block', async () => {
  const stub = zone();
  const resident = await player(stub, LOCAL_SPAWN);
  const welcome = await resident.next('WELCOME');
  const cell = cellOf(SF_ZONE_GRID, LOCAL_SPAWN.x / 100, LOCAL_SPAWN.z / 100);
  // First player in the cell gets local id 1, namespaced to the cell's block.
  expect(welcome.id).toBe(globalPlayerId(cellIndex(SF_ZONE_GRID, cell.cx, cell.cy), 1));
});

it('assigns different zones\' players ids in different global blocks (no cross-zone collision)', async () => {
  // Two separate zone instances, routed to cells (0,0) and (1,0) by explicit ?zone.
  const a = await playerInZone(zone(), 0, 0); const wa = await a.next('WELCOME');
  const b = await playerInZone(zone(), 1, 0); const wb = await b.next('WELCOME');
  expect(wa.id).toBe(globalPlayerId(cellIndex(SF_ZONE_GRID, 0, 0), 1));
  expect(wb.id).toBe(globalPlayerId(cellIndex(SF_ZONE_GRID, 1, 0), 1));
  expect(splitPlayerId(wa.id).cellIndex).toBe(0);
  expect(splitPlayerId(wb.id).cellIndex).toBe(1);
  expect(wa.id).not.toBe(wb.id); // the merge hazard — both would be local id 1 without namespacing
});

it('closes an observer that sends a control frame (read-only)', async () => {
  const stub = zone();
  await player(stub); // keep the zone ticking
  const watcher = await observer(stub);
  watcher.send({ type: 'HELLO', name: 'nope' }); // not MOVE/PING/ACTIVITY
  expect(await watcher.closed).toBe(CloseCode.PROTOCOL);
});
