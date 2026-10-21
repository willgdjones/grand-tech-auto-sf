import { afterEach, expect, it, vi } from 'vitest';
import { encodeS2C } from '@gtasf/shared/protocol/s2c';
import { connectWorld } from '../net/ws';
import { waitForCityConnection } from './connection';

vi.mock('../admission/client', () => ({
  waitForAdmission: vi.fn(async () => undefined), admissionConsumed: vi.fn(), invalidateAdmission: vi.fn(),
}));
vi.mock('@gtasf/shared/flags', async importOriginal => {
  const original = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { ...original, flags: { ...original.flags, multiplayer: true, worldCapacity: true } };
});

class Transport {
  static OPEN = 1;
  static instances: Transport[] = [];
  readyState = 0;
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  onmessage?: (event: { data: ArrayBuffer }) => void;
  constructor() { Transport.instances.push(this); }
  send() {}
  open() { this.readyState = Transport.OPEN; this.onopen?.(); }
  close(code: number) { this.readyState = 3; this.onclose?.({ code }); }
}

// DOM fixture records the visible status and the actual button listener without a WebGL/browser run.
function card() {
  const reloadPage = vi.fn();
  let attached: Button | undefined;
  class Button extends EventTarget {
    type = ''; className = ''; textContent = '';
    remove() { attached = undefined; }
  }
  const detail = {
    textContent: 'Loading Noe Valley…',
    ownerDocument: { defaultView: { location: { reload: reloadPage } }, createElement: () => new Button() },
    after(button: Button) { attached = button; },
  };
  return { detail: detail as unknown as HTMLElement, reloadPage, button: () => attached };
}

let disconnect: (() => void) | undefined;
afterEach(() => { disconnect?.(); disconnect = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it('finishes the same boot after a failed handshake and a late WELCOME, then clears the waiting UI', async () => {
  vi.useFakeTimers(); Transport.instances = [];
  vi.stubGlobal('WebSocket', Transport);
  vi.stubGlobal('location', { href: 'https://gtasf.example/go/noe-valley' });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  const ui = card();
  let welcome!: () => void;
  const ready = new Promise<void>(resolve => { welcome = resolve; });
  const completed = vi.fn();
  const waiting = waitForCityConnection(ready, ui.detail).then(completed);
  const net = connectWorld({ name: 'Karl', status: () => {}, message: message => {
    if (message.type === 'WELCOME') welcome();
  } });
  disconnect = net.dispose;
  await vi.advanceTimersByTimeAsync(0);
  const first = Transport.instances[0]!; first.open();
  await vi.advanceTimersByTimeAsync(11_000); // First handshake times out; the real client retries.
  expect(first.readyState).toBe(3);
  expect(Transport.instances).toHaveLength(2);
  expect(ui.button()).toBeUndefined();
  const second = Transport.instances[1]!; second.open();
  await vi.advanceTimersByTimeAsync(4000);
  expect(completed).not.toHaveBeenCalled();
  expect(ui.detail.textContent).toContain('Still connecting');
  const reload = ui.button()!;
  expect(reload.textContent).toBe('Reload city');
  reload.dispatchEvent(new Event('click'));
  expect(ui.reloadPage).toHaveBeenCalledTimes(1);
  second.onmessage?.({ data: encodeS2C({
    type: 'WELCOME', id: 7, serverT: Date.now(), name: 'Karl', resumed: false,
    pose: { x: 100, y: 200, z: 300, yaw: 0, flags: 0 }, resumeToken: 'a'.repeat(64), lastMoveSeq: 0,
  }).buffer as ArrayBuffer });
  await waiting;
  expect(completed).toHaveBeenCalledTimes(1);
  expect(ui.detail.textContent).toBe('Loading Noe Valley…');
  expect(ui.button()).toBeUndefined();
  reload.dispatchEvent(new Event('click'));
  expect(ui.reloadPage).toHaveBeenCalledTimes(1); // Removed control has no retained action.
  net.dispose(); disconnect = undefined;
  expect(vi.getTimerCount()).toBe(0);

  await waitForCityConnection(Promise.resolve(), ui.detail);
  expect(ui.button()).toBeUndefined();
  const failure = new Error('World startup rejected');
  await expect(waitForCityConnection(Promise.reject(failure), ui.detail)).rejects.toBe(failure);
  expect(vi.getTimerCount()).toBe(0);
});
