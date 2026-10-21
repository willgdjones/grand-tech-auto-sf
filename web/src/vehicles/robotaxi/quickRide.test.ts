import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createQuickRide } from './quickRide';
import { createRobotaxiClient } from './client';
import type { C2SMessage, S2CMessage } from '@gtasf/shared/protocol/types';
vi.mock('@gtasf/shared/flags', () => ({ flags: { robotaxi: true, quickRobotaxi: true } }));
class Node {
  hidden = false; textContent = ''; className = ''; disabled = false;
  children: Node[] = []; classList = (() => { const set = new Set<string>(); return { // Set-backed: quickRide reads contains('gt-quick-fadein')
    add: (...c: string[]) => { for (const x of c) set.add(x); }, remove: (...c: string[]) => { for (const x of c) set.delete(x); },
    toggle: (c: string, on?: boolean) => { const v = on ?? !set.has(c); if (v) set.add(c); else set.delete(c); return v; },
    contains: (c: string) => set.has(c) }; })();
  append(...nodes: Node[]) { this.children.push(...nodes); }
  setAttribute() {} remove() {}
}
let win: EventTarget;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  win = new EventTarget(); vi.stubGlobal('window', win);
  vi.stubGlobal('document', { body: new Node(), createElement: () => new Node() });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const pose = { x: 0, y: 0, z: 0, yaw: 0, flags: 0 };
const message: Extract<S2CMessage, { type: 'ROBOTAXI_STATE' }> = { type: 'ROBOTAXI_STATE', requestId: 1, vehicleId: 5, state: 'quick', pose, destination: { x: 80000, y: 0, z: 100 }, etaSeconds: 0, quick: { title: 'Lombard', fareCents: '0', freeRidesLeft: 2, durationMs: 4000 } };
const key = () => { const e = new Event('keydown', { cancelable: true }); Object.assign(e, { repeat: false }); win.dispatchEvent(e); };
test('first title card plays fully; later skip waits for chunks and keeps black until authoritative arrival', async () => {
  let complete!: () => void;
  const load = vi.fn(() => new Promise<void>(resolve => { complete = resolve; })), ready = vi.fn(() => true), cut = vi.fn();
  const card = createQuickRide({ load, ready, onCut: cut }); card.start(message);
  await vi.advanceTimersByTimeAsync(999); expect(load).not.toHaveBeenCalled(); expect(card.destination).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1); expect(load).toHaveBeenCalledWith({ x: 800, z: 1 });
  complete(); await vi.advanceTimersByTimeAsync(0); key(); expect(ready).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3000); expect(ready).toHaveBeenCalledTimes(1); expect(card.active).toBe(true);
  card.end(true); expect(card.active).toBe(false); expect(cut).toHaveBeenCalledOnce();
  card.start(message); await vi.advanceTimersByTimeAsync(1000); key(); expect(ready).toHaveBeenCalledTimes(1);
  complete(); await vi.advanceTimersByTimeAsync(0); key(); expect(ready).toHaveBeenCalledTimes(2);
  expect(card.active).toBe(true); card.end(true); expect(card.active).toBe(false); card.destroy();
});
test('server timeout arrival stays covered until loading finishes; cancellation clears overlay', async () => {
  let complete!: () => void;
  const card = createQuickRide({ load: () => new Promise(resolve => { complete = resolve; }), ready: vi.fn(() => true), onCut: vi.fn() });
  card.start(message); await vi.advanceTimersByTimeAsync(6000); card.end(true); expect(card.active).toBe(true);
  complete(); await vi.advanceTimersByTimeAsync(0); expect(card.active).toBe(false);
  card.start(message); card.end(false); expect(card.active).toBe(false); card.destroy();
});
test('failed ready sends retry at a bounded rate and stay covered until arrival', async () => {
  const ready = vi.fn(() => true).mockReturnValueOnce(false), cut = vi.fn();
  const card = createQuickRide({ load: async () => {}, ready, onCut: cut });
  card.start(message); await vi.advanceTimersByTimeAsync(4000);
  expect(ready).toHaveBeenCalledTimes(1); expect(card.active).toBe(true);
  await vi.advanceTimersByTimeAsync(499); expect(ready).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(ready).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1000); expect(ready).toHaveBeenCalledTimes(2);
  expect(card.active).toBe(true); expect(cut).not.toHaveBeenCalled();
  card.end(true); expect(card.active).toBe(false); expect(cut).toHaveBeenCalledOnce(); card.destroy();
});
test('quotes do not become trips; hail caps charged fare and sends ready only in quick state', async () => {
  const commands: C2SMessage[] = [], onQuick = vi.fn(), onEnd = vi.fn(), notify = vi.fn();
  const taxi = createRobotaxiClient({ send: m => { commands.push(m); return true; }, notify, getMode: () => 'on-foot', resolveDestination: d => d, onQuick, onEnd });
  taxi.setConnected(true);
  const target = { x: 800, y: 0, z: 1, title: 'Lombard' }, quote = taxi.quote(target);
  await vi.advanceTimersByTimeAsync(0);
  const query = commands[0]!; expect(query.type).toBe('ROBOTAXI_QUOTE');
  taxi.message({ ...message, requestId: 'requestId' in query ? query.requestId : 0, state: 'quoted' });
  await expect(quote).resolves.toEqual({ label: 'FREE (2 left)', affordable: true, fareCents: '0' }); expect(taxi.active).toBe(false);
  expect(taxi.hail(target)).toBe(true); const hail = commands.at(-1)!;
  expect(hail).toMatchObject({ type: 'ROBOTAXI_HAIL', quick: { maxFareCents: '0' } }); expect(taxi.ready()).toBe(false);
  const id = 'requestId' in hail ? hail.requestId : 0;
  taxi.message({ ...message, requestId: id }); taxi.message({ ...message, requestId: id });
  expect(onQuick).toHaveBeenCalledOnce(); expect(taxi.active).toBe(true); expect(taxi.ready()).toBe(true);
  taxi.message({ ...message, requestId: id, state: 'arrived' }); expect(onEnd).toHaveBeenCalledWith(true); expect(taxi.active).toBe(false);
  taxi.message({ type: 'ROBOTAXI_FRIEND_NOTICE', name: 'Ada' }); expect(notify).toHaveBeenLastCalledWith('Ada is on the way', 6000);
});
