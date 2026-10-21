import { afterEach, expect, test, vi } from 'vitest';
import { createToasts } from './toast';
vi.mock('./toastLayout', () => ({ layoutToasts: () => ({ update: vi.fn(), dispose: vi.fn() }) }));
class Node {
  children: Node[] = []; parent: Node | undefined; textContent = ''; className = '';
  classList = { add: vi.fn(), remove: vi.fn() };
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0]; }
  get isConnected() { return Boolean(this.parent); }
  setAttribute() {}
  append(child: Node) { child.remove(); child.parent = this; this.children.push(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
  replaceChildren() { for (const child of [...this.children]) child.remove(); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
test('action messages stay in the compact-visible title, replace older notices, and expire without removing awards', async () => {
  vi.useFakeTimers(); const body = new Node();
  vi.stubGlobal('document', { body, createElement: () => new Node() });
  vi.stubGlobal('requestAnimationFrame', undefined);
  const toasts = createToasts({ durationMs: 10_000 });
  const root = body.children[0]!;
  toasts.show({ title: 'Event cheque', amount: '+$900' });
  toasts.notice('Walk closer to a parked car to drive it.', 2000);
  expect(root.children).toHaveLength(2);
  expect(root.children[1]!.children[0]!.textContent).toBe('Walk closer to a parked car to drive it.');
  toasts.notice('Not enough funding: $550 fare. Walk or drive', 2000);
  expect(root.children).toHaveLength(2);
  expect(root.children[1]!.className).toContain('gt-toast-notice');
  expect(root.children[1]!.children).toHaveLength(1); // never relegated to compact-hidden detail
  expect(root.children[1]!.children[0]!.textContent).toContain('$550 fare');
  toasts.notice('Not enough funding: $550 fare. Walk or drive', 2000);
  expect(root.children).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(2440);
  expect(root.children).toHaveLength(1); expect(root.children[0]!.children[0]!.textContent).toBe('Event cheque');
  toasts.dispose(); expect(body.children).toHaveLength(0);
});
