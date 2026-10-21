import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('@gtasf/shared/flags', () => ({ flags: { hud: true } }));
import { createStreetHud } from './streetHud';

// Minimal DOM stub (no Element.animate / matchMedia), so streetHud takes the deterministic
// immediate-hide path and the fade timer is driven by fake timers. Matches the hud test convention.
class Node extends EventTarget {
  children: Node[] = [];
  parent?: Node;
  className = '';
  textContent = '';
  hidden = false;
  constructor(readonly tag: string) { super(); }
  append(...nodes: Node[]) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  setAttribute() {}
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
}

beforeEach(() => {
  vi.useFakeTimers();
  const body = new Node('body');
  vi.stubGlobal('document', { createElement: (tag: string) => new Node(tag), body });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function nameOf(root: any): string {
  return (root.children as Node[]).map(c => c.textContent).filter(Boolean).join(' ');
}

test('area name shows big on entering, fades out after ~3s, and reappears only on a NEW area', () => {
  const hud = createStreetHud()!;
  const root: any = hud.element;

  // Entering the first area shows immediately (no entry debounce on the very first sample).
  hud.update({ street: 'Lombard St', neighbourhood: 'Russian Hill' }, 0);
  expect(root.hidden).toBe(false);
  expect(nameOf(root)).toContain('Lombard St');

  // Staying in the same area keeps it (until the fade), without re-triggering.
  hud.update({ street: 'Lombard St', neighbourhood: 'Russian Hill' }, 100);
  expect(root.hidden).toBe(false);

  // After ~3s it fades out so the default screen stays clean (SA style).
  vi.advanceTimersByTime(3000);
  expect(root.hidden).toBe(true);

  // Still in that same area → it does NOT come back.
  hud.update({ street: 'Lombard St', neighbourhood: 'Russian Hill' }, 4000);
  expect(root.hidden).toBe(true);

  // Crossing into a new area shows it again (after the 600ms area-change debounce).
  hud.update({ street: 'Columbus Ave', neighbourhood: 'North Beach' }, 5000);
  expect(root.hidden).toBe(true); // debounced, not yet committed
  hud.update({ street: 'Columbus Ave', neighbourhood: 'North Beach' }, 5700);
  expect(root.hidden).toBe(false);
  expect(nameOf(root)).toContain('Columbus Ave');

  // And it fades again on its own timer.
  vi.advanceTimersByTime(3000);
  expect(root.hidden).toBe(true);
});
