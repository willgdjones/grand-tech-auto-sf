import { afterEach, expect, test, vi } from 'vitest';
import { flags } from '@gtasf/shared/flags';
import { fundingRound, type FundingProfile } from '@gtasf/shared/funding';
import { createPlayableHud } from './playableHud';
vi.mock('@gtasf/shared/flags', async importOriginal => {
  const original = await importOriginal<typeof import('@gtasf/shared/flags')>();
  return { flags: { ...original.flags, hud: true, fundingLoop: true, economyV3: true } };
});
class Element extends EventTarget {
  className = ''; textContent = ''; hidden = false; children: Element[] = [];
  classList = { toggle() {} }; attributes = new Map<string, string>();
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  append(...items: Element[]) { this.children.push(...items); }
  replaceChildren(...items: Element[]) { this.children = items; }
  remove() {}
  find(name: string): Element | undefined { return this.className === name ? this : this.children.map(v => v.find(name)).find(Boolean); }
}
function mount() {
  const body = new Element();
  vi.stubGlobal('document', { body, createElement: () => new Element(), addEventListener() {}, removeEventListener() {} });
  const hud = createPlayableHud()!;
  return { hud, root: hud.element as unknown as Element, burn: body.find('gt-hud-burn')! };
}
function profile(rate: string | undefined, stars = 1): FundingProfile {
  return { deviceId: 'fixture', startupName: 'Fogware', nickname: 'Founder', totalCents: '7500000', todayCents: '0',
    round: { ...fundingRound('7500000'), stars }, rank: null, todayRank: null, lastAwardAt: null, streak: 0,
    burnPerSecCents: rate };
}
afterEach(() => { vi.unstubAllGlobals(); Object.assign(flags, { economyV3: true }); });

test('one line beneath money uses the server stage rate, even when the total does not change', () => {
  const { hud, root, burn } = mount();
  expect(burn.hidden).toBe(true);
  for (const [rate, expected] of [['180', 'BURN −$108/min'], ['546', 'BURN −$328/min'], ['1091', 'BURN −$655/min'], ['2344', 'BURN −$1.4k/min']]) {
    hud.setFundingProfile(profile(rate));
    expect(burn.hidden).toBe(false); expect(burn.textContent).toBe(expected);
    expect(root.find('gt-hud-money')!.children.at(-1)).toBe(burn);
    expect(root.find('gt-hud-money')!.attributes.get('aria-label')).toContain(expected);
  }
  // A new server rate, rather than a client stage lookup, controls the readout.
  hud.setFundingProfile(profile('200'));
  expect(burn.textContent).toBe('BURN −$120/min');
  expect(root.find('gt-funding-runway')).toBeUndefined();
  hud.destroy();
});
test('Bootstrapping, missing, zero and invalid rates hide the line after a burning stage', () => {
  const { hud, burn } = mount();
  for (const next of [profile('180', 0), profile('0'), profile(undefined), profile('bad'), profile('-1')]) {
    hud.setFundingProfile(profile('180')); expect(burn.hidden).toBe(false);
    hud.setFundingProfile(next); expect(burn.hidden).toBe(true); expect(burn.textContent).toBe('');
  }
  hud.destroy();
});
test('economy flag off hides burn without changing the money counter', () => {
  const { hud, root, burn } = mount();
  hud.setFundingProfile(profile('180'));
  const amount = root.find('gt-hud-money-value')!.textContent;
  Object.assign(flags, { economyV3: false }); hud.update();
  expect(burn.hidden).toBe(true);
  expect(root.find('gt-hud-money-value')!.textContent).toBe(amount);
  hud.destroy();
});
