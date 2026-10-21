import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTimeTrialLeaderboard } from './timeTrialLeaderboard';

class FakeNode {
  hidden = false; className = ''; textContent = ''; type = ''; children: FakeNode[] = [];
  private listeners = new Map<string, () => void>();
  constructor(readonly tag: string) {}
  setAttribute(): void {}
  append(...nodes: FakeNode[]): void { this.children.push(...nodes); }
  replaceChildren(): void { this.children = []; }
  remove(): void {}
  addEventListener(type: string, fn: () => void): void { this.listeners.set(type, fn); }
  fire(type: string): void { this.listeners.get(type)?.(); }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('time-trial leaderboard', () => {
  it('auto-hides the post-run board so it never parks over the HUD', () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { createElement: (tag: string) => new FakeNode(tag) });
    const parent = new FakeNode('body');
    const board = createTimeTrialLeaderboard({ parent: parent as unknown as HTMLElement, autoHideMs: 20_000 });
    board.setBoard('Embarcadero Sprint', []);
    board.show();
    expect(board.isOpen).toBe(true);
    vi.advanceTimersByTime(19_000);
    expect(board.isOpen).toBe(true);
    board.show(); // a fresh result restarts the clock
    vi.advanceTimersByTime(19_000);
    expect(board.isOpen).toBe(true);
    vi.advanceTimersByTime(1_500);
    expect(board.isOpen).toBe(false);
  });

  it('closes on × and stays closed', () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { createElement: (tag: string) => new FakeNode(tag) });
    const parent = new FakeNode('body');
    const board = createTimeTrialLeaderboard({ parent: parent as unknown as HTMLElement });
    board.show();
    const close = (parent.children[0]!.children[0]!);
    close.fire('click');
    expect(board.isOpen).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(board.isOpen).toBe(false);
  });
});
