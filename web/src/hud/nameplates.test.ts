import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { flags } from '@gtasf/shared/flags';
import { FUNDING_ROUNDS, type FundingProfile } from '@gtasf/shared/funding';
import { createNameplates, selectNameplatePeers, summaryFetchBatch, type NameplatePeer } from './nameplates';

vi.mock('@gtasf/shared/flags', () => ({ flags: { nameplates: true, emailCapture: true, economyV3: false } }));

const self: NameplatePeer = { id: 1, x: 0, y: 0, z: 0, name: 'me' };
function at(id: number, x: number, name: string | null = `p${id}`): NameplatePeer {
  return { id, x, y: 0, z: 0, name };
}

describe('selectNameplatePeers', () => {
  it('excludes self and unnamed/blank peers', () => {
    const out = selectNameplatePeers([self, at(2, 5), at(3, 6, null), at(4, 7, '   ')], 1);
    expect(out.map(p => p.id)).toEqual([2]);
  });

  it('drops peers beyond the distance limit and orders nearest first', () => {
    const out = selectNameplatePeers([self, at(2, 90), at(3, 10), at(4, 30)], 1, 80);
    expect(out.map(p => p.id)).toEqual([3, 4]); // 90 m excluded; 10 m before 30 m
  });

  it('caps the number of plates to the nearest N when a crowd forms', () => {
    const crowd = [self, ...Array.from({ length: 10 }, (_, i) => at(i + 2, i + 1))];
    expect(selectNameplatePeers(crowd, 1, 80, 3).map(p => p.id)).toEqual([2, 3, 4]);
  });

  it('without self in the roster, keeps every named peer in stable id order', () => {
    const out = selectNameplatePeers([at(5, 500), at(2, 9), at(9, 1)], 1, 80);
    expect(out.map(p => p.id)).toEqual([2, 5, 9]); // no distance filter; tie-broken by id
  });
});

describe('summaryFetchBatch', () => {
  const peer = (id: number, name: string | null): NameplatePeer => ({ id, x: 0, y: 0, z: 0, name });
  const noLeaders = { has: () => false };
  const noSummaries = { get: () => undefined };

  it('returns named peers that are neither in the leaderboard nor freshly cached', () => {
    const named = [peer(2, 'Ada'), peer(3, 'Bo'), peer(4, 'Cy')];
    expect(summaryFetchBatch(named, noLeaders, noSummaries, 1000)).toEqual(['Ada', 'Bo', 'Cy']);
  });

  it('skips peers already in the top-50 leaderboard', () => {
    const leaders = { has: (n: string) => n === 'Ada' };
    expect(summaryFetchBatch([peer(2, 'Ada'), peer(3, 'Bo')], leaders, noSummaries, 1000)).toEqual(['Bo']);
  });

  it('skips a peer with a fresh cached summary and refetches a stale one', () => {
    const summaries = new Map([['Ada', { at: 30_600 }], ['Bo', { at: 0 }]]);
    // TTL 30s, now 31s: Ada cached 400ms ago is fresh (skip); Bo cached 31s ago is stale (refetch).
    expect(summaryFetchBatch([peer(2, 'Ada'), peer(3, 'Bo')], noLeaders, summaries, 31_000, 30_000)).toEqual(['Bo']);
  });

  it('treats a fresh negative cache as a skip (no refetch until TTL)', () => {
    const summaries = new Map([['Ghost', { at: 1000 }]]); // negative entries carry an `at` too
    expect(summaryFetchBatch([peer(2, 'Ghost')], noLeaders, summaries, 1200, 30_000)).toEqual([]);
  });

  it('de-duplicates nicknames and drops unnamed/blank peers', () => {
    const named = [peer(2, 'Ada'), peer(3, 'Ada'), peer(4, null), peer(5, '  ')];
    expect(summaryFetchBatch(named, noLeaders, noSummaries, 1000)).toEqual(['Ada']);
  });

  it('caps the batch at max', () => {
    const named = Array.from({ length: 10 }, (_, i) => peer(i + 2, `p${i}`));
    expect(summaryFetchBatch(named, noLeaders, noSummaries, 1000, 30_000, 3)).toEqual(['p0', 'p1', 'p2']);
  });
});

class PlateNode extends EventTarget {
  children: PlateNode[] = [];
  parent?: PlateNode;
  className = '';
  title = '';
  hidden = false;
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  private text = '';
  constructor(readonly tag: string) { super(); }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.text = value; this.children = []; }
  classList = {
    toggle: (name: string, enabled: boolean) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    },
    contains: (name: string) => this.className.split(' ').includes(name),
  };
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  append(...nodes: PlateNode[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes: PlateNode[]) { this.text = ''; this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  find(className: string): PlateNode | undefined {
    if (this.classList.contains(className)) return this;
    for (const child of this.children) { const found = child.find(className); if (found) return found; }
    return undefined;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  const mutable = flags as { nameplates: boolean; emailCapture: boolean };
  mutable.nameplates = true; mutable.emailCapture = true;
});

it('shows server-verified ticks for self, leaders and cached peers while preserving crowns and selection', async () => {
  const body = new PlateNode('body');
  vi.stubGlobal('document', { body, createElement: (tag: string) => new PlateNode(tag), querySelectorAll: () => [] });
  vi.stubGlobal('innerWidth', 800); vi.stubGlobal('innerHeight', 600);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: (entries: Array<{ target: Element; borderBoxSize: Array<{ inlineSize: number; blockSize: number }> }>) => void) {}
    observe(target: Element) { this.callback([{ target, borderBoxSize: [{ inlineSize: 120, blockSize: 32 }] }]); }
    unobserve() {}
    disconnect() {}
  });
  const profile = (nickname: string, extra: Partial<FundingProfile> = {}): FundingProfile => ({
    deviceId: `device-${nickname}`, nickname, startupName: `${nickname} startup`,
    totalCents: '10000', todayCents: '10000', round: FUNDING_ROUNDS[0]!,
    rank: null, todayRank: null, lastAwardAt: null, streak: 0, ...extra,
  });
  const local = profile('me'), top = profile('top', { rank: 3 });
  const outsider = profile('nearby', { verifiedFounder: true });
  const fetchSummaries = vi.fn().mockResolvedValue([outsider]);
  const onSelect = vi.fn();
  const plates = createNameplates({ fetchSummaries, onSelect })!;
  const camera = new PerspectiveCamera(60, 800 / 600, .1, 1000);
  camera.position.set(0, 2, 12); camera.lookAt(0, 2, 0); camera.updateMatrixWorld();
  const peers = [self, at(2, 1, 'top'), at(3, 2, 'nearby')];
  const update = (now: number) => plates.update(camera, 1, peers, now, true);
  const plate = (name: string) => (plates.element as unknown as PlateNode).children.find(node => node.textContent.includes(`${name} startup`))!;
  const badge = (name: string) => plate(name).find('gt-nameplate-verified');
  const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
  try {
    plates.setLocal(local); plates.setLeaders([top]); update(1000);
    expect(fetchSummaries).toHaveBeenCalledWith(['nearby']);
    await flush(); update(1500);
    expect(badge('me')).toBeUndefined(); expect(badge('top')).toBeUndefined();
    expect(badge('nearby')?.textContent).toBe('✓');
    expect(badge('nearby')?.title).toBe('Verified Founder');
    expect(badge('nearby')?.attributes['aria-label']).toBe('Verified Founder');

    // Neither funding nor names changed: the new verification field alone must refresh the DOM.
    plates.setLocal({ ...local, verifiedFounder: true });
    plates.setLeaders([{ ...top, verifiedFounder: true }]); update(1600);
    expect(badge('me')?.textContent).toBe('✓'); expect(badge('top')?.textContent).toBe('✓');
    expect(plate('top').classList.contains('gt-nameplate--top')).toBe(true);
    expect(plate('top').textContent).toContain('👑 top startup');
    expect(plate('top').textContent).toContain(' · #3');
    plate('top').dispatchEvent(new Event('click')); expect(onSelect).toHaveBeenCalledWith(2);
    const sameBadge = badge('me'); update(1601); expect(badge('me')).toBe(sameBadge);

    plates.setLocal({ ...local, verifiedFounder: false }); plates.setLeaders([top]); update(1700);
    expect(badge('me')).toBeUndefined(); expect(badge('top')).toBeUndefined();
    expect(badge('nearby')).toBeDefined();
    fetchSummaries.mockResolvedValue([{ ...outsider, verifiedFounder: false }]);
    update(32_001); await flush(); update(32_002);
    expect(fetchSummaries).toHaveBeenCalledTimes(2); expect(badge('nearby')).toBeUndefined();

    plates.setLocal({ ...local, verifiedFounder: true }); plates.setLeaders([{ ...top, verifiedFounder: true }]);
    const mutable = flags as { emailCapture: boolean; nameplates: boolean };
    mutable.emailCapture = false; update(32_003);
    expect(badge('me')).toBeUndefined(); expect(badge('top')).toBeUndefined();
    mutable.emailCapture = true; update(32_004);
    expect(badge('me')).toBeDefined(); expect(badge('top')).toBeDefined();
    mutable.nameplates = false; expect(createNameplates()).toBeNull();
  } finally { plates.destroy(); }
  expect(body.children).toHaveLength(0);
});
