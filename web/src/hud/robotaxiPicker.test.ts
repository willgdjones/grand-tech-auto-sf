import { expect, test, vi } from 'vitest';
import { createRobotaxiPicker } from './robotaxiPicker';
vi.mock('@gtasf/shared/flags', () => ({ flags: { quickRobotaxi: true } }));
vi.mock('../input/cursor', () => ({ holdFreeCursor: () => vi.fn() }));
class Node extends EventTarget {
  children: Node[] = []; textContent = ''; hidden = false; disabled = false; open = false;
  attributes = new Map<string, string>(); onclick?: () => void;
  append(...nodes: Node[]) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  removeAttribute(key: string) { this.attributes.delete(key); }
  showModal() { this.open = true; } close() { this.open = false; }
  focus() {} remove() {} scrollIntoView() {}
}
test('failed hail stays open with visible error, successful retry closes, reopen clears error', async () => {
  const body = new Node(); vi.stubGlobal('HTMLElement', Node);
  vi.stubGlobal('document', { body, activeElement: null, createElement: () => new Node() });
  const hail = vi.fn<() => boolean | string>().mockReturnValueOnce('Exit your vehicle before hailing.').mockReturnValue(true);
  const picker = createRobotaxiPicker({ choices: () => [{ title: 'Lombard', group: 'Landmarks', x: 1, y: 0, z: 2 }],
    quote: async () => ({ label: 'FREE (3 left)', fareCents: '0', affordable: true }), hail, onOpen() {} });
  try {
    picker.show(); for (let i = 0; i < 8; i++) await Promise.resolve(); // quote lookup settles over several ticks
    const dialog = body.children[0]!, status = dialog.children.find(node => node.attributes.get('role') === 'status')!;
    const row = dialog.children.at(-1)!.children.at(-1)!;
    expect(row.disabled).toBe(false); row.onclick!();
    expect(picker.isOpen).toBe(true); expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Exit your vehicle before hailing.');
    row.onclick!(); expect(picker.isOpen).toBe(false);
    picker.show(); expect(status.hidden).toBe(true); expect(status.textContent).toBe('');
  } finally { picker.destroy(); vi.unstubAllGlobals(); }
});
