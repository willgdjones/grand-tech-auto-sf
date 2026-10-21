import { afterEach, expect, test, vi } from 'vitest';
import { createChat } from './client';
vi.mock('@gtasf/shared/flags', () => ({ flags: { chat: true, eventChat: false, voiceChat: false } }));
vi.mock('./voice', () => ({ createVoiceChat: () => null }));
class Node extends EventTarget {
  children: Node[] = []; parent?: Node; textContent = ''; className = ''; value = ''; hidden = false; open = false;
  style = {}; dataset = {}; attrs = new Map<string, string>();
  append(...nodes: Node[]) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  focus() {} blur() {} close() { this.open = false; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
}
const all = (node: Node): Node[] => [node, ...node.children.flatMap(all)];
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
test('inline send failures are visible beside a retained draft, and reconnect retry sends it once', () => {
  vi.useFakeTimers(); const body = new Node(), win = new EventTarget();
  Object.assign(win, { setTimeout });
  vi.stubGlobal('window', win); vi.stubGlobal('document', { body, createElement: () => new Node() });
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  class Observer { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', Observer); vi.stubGlobal('MutationObserver', Observer);
  let connected = false, accepted = false;
  const send = vi.fn(() => accepted), chat = createChat({ connected: () => connected, send })!;
  const find = (name: string) => all(body).find(n => n.className === name)!;
  const form = find('gt-chat-inline'), input = find('gt-chat-inline-input'), status = find('gt-chat-inline-status');
  chat.openInline(); expect(status.hidden).toBe(true);
  input.value = 'Meet me at the Ferry Building'; form.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(status.hidden).toBe(false); expect(status.textContent).toContain('reconnecting');
  expect(input.value).toBe('Meet me at the Ferry Building'); expect(send).not.toHaveBeenCalled();
  expect(status.parent).toBe(form); expect(input.attrs.get('aria-describedby')).toBe('gt-chat-inline-status');
  connected = true; form.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(status.textContent).toContain('Try again'); expect(input.value).toBe('Meet me at the Ferry Building');
  input.value = 'a'.repeat(161); form.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(status.textContent).toContain('160 characters'); expect(input.value).toHaveLength(161); expect(send).toHaveBeenCalledTimes(1);
  accepted = true; input.value = 'Meet me at the Ferry Building'; form.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'CHAT', eventId: 0, text: 'Meet me at the Ferry Building' }));
  expect(input.value).toBe(''); expect(status.textContent).toBe('Sent.');
  chat.closeInline(); chat.openInline(); expect(status.hidden).toBe(true); chat.destroy();
});
