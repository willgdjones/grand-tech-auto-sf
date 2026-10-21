import { expect, it, vi } from 'vitest';
import { setupOnboarding } from './integrate';

vi.mock('@gtasf/shared/flags', () => ({ flags: { onboarding: true, hud: true } }));
// Keep the real flow and API adapter; this Node smoke replaces only DOM painting.
vi.mock('../theme/saMission', () => ({
  SaHintChips: class {},
  SaMissionBanner: class { setStep() {} clear() {} },
  SaIntroSlides: class {},
  saMissionStinger() {},
}));

it('resumes a server envelope and persists the next step in the route contract', async () => {
  const saved = { step: 'walk', hints: ['enterCar'], completed: false, skipped: false };
  const loaded = { ...saved, emailPrompts: 0 }; // Legacy persisted state gains the new default.
  const writes: unknown[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      expect(Object.keys(body)).toEqual(['state']);
      writes.push(JSON.parse(body.state));
      return Response.json({ state: JSON.parse(body.state) });
    }
    return Response.json({ state: saved });
  };
  const flow = await setupOnboarding({ isTouch: false, fetcher, revealPanels() {}, requestIdentity() {} });
  expect(flow?.state).toEqual(loaded);
  flow!.stepCleared('walk');
  expect(writes).toEqual([loaded, { ...loaded, step: 'drive_ring' }]);
});
