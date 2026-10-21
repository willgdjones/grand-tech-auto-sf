import { afterEach, expect, test, vi } from 'vitest';
import { flags } from '@gtasf/shared/flags';
import { createCapTable } from './capTable';

// Flag defaults ON so the panel builds; the flag-off case toggles the shared mock below.
vi.mock('@gtasf/shared/flags', () => ({ flags: { capTable: true } }));

/**
 * Targeted DOM + API smoke for the read-only player cap table (gtasf-2r5r, PLAN-v2 decision 5).
 * Exercises the real handlers against a minimal DOM stub (same approach as radar.test.ts): it
 * verifies self vs. another-player fetch URLs, grouped rendering with "+N more", the empty/404/error
 * states, modal open/close signalling, and that the launcher opens the player's own table.
 */
class Node extends EventTarget {
  children: Node[] = [];
  parent?: Node;
  className = '';
  textContent = '';
  type = '';
  hidden = false;
  open = false;
  dataset: Record<string, string> = {};
  constructor(readonly tag: string) { super(); }
  append(...nodes: Node[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes: Node[]) { this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  setAttribute() {}
  removeAttribute() {}
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
  find(predicate: (node: Node) => boolean): Node | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) { const found = child.find(predicate); if (found) return found; }
    return undefined;
  }
  findAll(predicate: (node: Node) => boolean, out: Node[] = []): Node[] {
    if (predicate(this)) out.push(this);
    for (const child of this.children) child.findAll(predicate, out);
    return out;
  }
  hasText(text: string): boolean { return Boolean(this.find(node => node.textContent.includes(text))); }
  clickText(text: string) {
    const button = this.find(node => node.tag === 'button' && node.textContent === text);
    if (!button) throw new Error(`Missing button: ${text}`);
    button.dispatchEvent(new Event('click'));
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function setupDom() {
  const body = new Node('body');
  vi.stubGlobal('document', { body, activeElement: null, createElement: (tag: string) => new Node(tag) });
  return body;
}

function mockFetch(responder: (url: string) => Response) {
  const fetchMock = vi.fn((url: string) => Promise.resolve(responder(url)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const table = {
  deviceId: 'dev-2', startupName: 'Fogware', nickname: 'foggy',
  round: { label: 'Series A' }, totalCents: '250000000', serverNow: 1,
  groups: [
    { source: 'event', title: 'Angel syndicates', totalCents: '50000000', count: 3, entries: [
      { source: 'event', label: 'Founder Mixer', amountCents: '20000000', awardedAt: 2 },
      { source: 'event', label: 'AI Demo Night', amountCents: '30000000', awardedAt: 1 },
    ] },
    { source: 'celebrity', title: 'Celebrity angels', totalCents: '200000000', count: 1, entries: [
      { source: 'celebrity', label: 'Naval Ravikant (parody)', amountCents: '200000000', awardedAt: 3 },
    ] },
  ],
};

afterEach(() => vi.unstubAllGlobals());

test('opening your own table fetches without ?device and renders grouped backers with "+N more"', async () => {
  const body = setupDom();
  const fetchMock = mockFetch(() => Response.json(table));
  const onModalChange = vi.fn();
  const panel = createCapTable({ onModalChange })!;
  expect(panel).not.toBeNull();

  panel.open({ self: true });
  expect(onModalChange).toHaveBeenCalledWith(true);
  expect(panel.isOpen).toBe(true);
  await flush();

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0]![0]).toBe('/api/funding/captable');
  // Header + both grouped sources + a specific entry label render from server rows only.
  expect(body.hasText('Fogware')).toBe(true);
  expect(body.hasText('Series A')).toBe(true);
  expect(body.hasText('@foggy')).toBe(true);
  expect(body.hasText('Angel syndicates')).toBe(true);
  expect(body.hasText('Celebrity angels')).toBe(true);
  expect(body.hasText('Naval Ravikant (parody)')).toBe(true);
  // event group: count 3 but only 2 entries → the capped remainder is disclosed.
  expect(body.hasText('+1 more')).toBe(true);
});

test('player selection resolves nicknames outside the leaderboard and ignores stale target bodies', async () => {
  const body = setupDom();
  const nick = 'Bo & Cy/+雪?';
  const fetchMock = mockFetch(url => Response.json(url.includes('?nick=')
    ? { ...table, startupName: 'Neighbour startup', nickname: nick } : table));
  const panel = createCapTable({})!;
  try {
    panel.open({ deviceId: 'dev abc/42', startup: 'Theirs', nick });
    await flush();
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/funding/captable?device=${encodeURIComponent('dev abc/42')}`);

    panel.open({ nick: ` ${nick} ` }); // No leaderboard or summary-cache device ID is needed.
    await flush();
    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/funding/captable?nick=${encodeURIComponent(nick)}`);
    expect(body.hasText('Neighbour startup')).toBe(true);
    expect(body.hasText('Founder Mixer')).toBe(true);

    panel.open({ self: true, deviceId: 'ignored', nick });
    await flush();
    expect(fetchMock.mock.calls[2]![0]).toBe('/api/funding/captable');
    expect(body.hasText('Fogware')).toBe(true);

    // The response has arrived, but its JSON is still decoding when a different player is selected.
    let resolveBody!: (value: typeof table) => void;
    const slow = Response.json(table);
    vi.spyOn(slow, 'json').mockReturnValue(new Promise(done => { resolveBody = done; }));
    fetchMock.mockResolvedValueOnce(slow);
    panel.open({ nick: 'slow' }); await flush();
    panel.open({ nick }); await flush();
    resolveBody({ ...table, startupName: 'Stale startup' }); await flush();
    expect(body.hasText('Neighbour startup')).toBe(true);
    expect(body.hasText('Stale startup')).toBe(false);

    const closing = Response.json(table);
    vi.spyOn(closing, 'json').mockReturnValue(new Promise(done => { resolveBody = done; }));
    fetchMock.mockResolvedValueOnce(closing);
    panel.open({ nick: 'closing' }); await flush();
    panel.close(); resolveBody({ ...table, startupName: 'Closed late startup' }); await flush();
    expect(panel.isOpen).toBe(false);
    expect(body.hasText('Closed late startup')).toBe(false);
  } finally { panel.destroy(); }
});

test('a founder with no backers shows the empty state, not an error', async () => {
  const body = setupDom();
  mockFetch(() => Response.json({ ...table, groups: [] }));
  const panel = createCapTable({})!;
  panel.open({ self: true });
  await flush();
  expect(body.hasText('still bootstrapping')).toBe(true);
});

test('a 404 reads as "hasn\'t raised anything yet"', async () => {
  const body = setupDom();
  mockFetch(() => Response.json({ error: 'not found' }, { status: 404 }));
  const panel = createCapTable({})!;
  panel.open({ deviceId: 'ghost' });
  await flush();
  expect(body.hasText("hasn't raised anything yet")).toBe(true);
});

test('a server error shows a clear retry message', async () => {
  const body = setupDom();
  mockFetch(() => Response.json({ error: 'boom' }, { status: 500 }));
  const panel = createCapTable({})!;
  panel.open({ self: true });
  await flush();
  expect(body.hasText('Could not load this cap table')).toBe(true);
});

test('closing the panel signals the modal is no longer open so game controls restore', async () => {
  setupDom();
  mockFetch(() => Response.json(table));
  const onModalChange = vi.fn();
  const panel = createCapTable({ onModalChange })!;
  panel.open({ self: true });
  await flush();
  onModalChange.mockClear();
  panel.close();
  expect(onModalChange).toHaveBeenCalledWith(false);
  expect(panel.isOpen).toBe(false);
});

test('the "My cap table" launcher opens the player\'s own table', async () => {
  setupDom();
  const fetchMock = mockFetch(() => Response.json(table));
  const parent = new Node('div') as unknown as HTMLElement;
  const panel = createCapTable({ parent })!;
  expect(panel.button).not.toBeNull();
  (parent as unknown as Node).clickText('My cap table');
  await flush();
  expect(fetchMock.mock.calls[0]![0]).toBe('/api/funding/captable');
  expect(panel.isOpen).toBe(true);
});

test('returns null when the capTable flag is off', () => {
  setupDom();
  const mutable = flags as { capTable: boolean }; // the real flags type is readonly; the mock is a plain object
  mutable.capTable = false;
  try {
    expect(createCapTable({})).toBeNull();
  } finally {
    mutable.capTable = true;
  }
});
