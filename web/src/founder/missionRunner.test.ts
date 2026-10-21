import { describe, expect, it, vi } from 'vitest';
import type { MissionSpec } from '@gtasf/shared/founder/missions';
import { placePoint } from '../spawn/locations';
import { createFounderMissionRunner } from './missionRunner';

// A minimal single-deliver mission so the runner reaches complete() in one step (no escape to drive).
const MISSION = {
  id: 'test-job', kind: 'delivery', title: 'Test Job', phoneBlurb: '', payoutDemoX: 1n, cooldown: 'daily',
  start: { lat: 37.8, lon: -122.4, letter: 'T' },
  objectives: [{ id: 'deliver', kind: 'deliver', label: 'Deliver', at: { lat: 37.8, lon: -122.4 }, radiusM: 10 }],
} as unknown as MissionSpec;
const WP = placePoint({ lat: 37.8, lon: -122.4 });

function runner(completeBody: { status: number; body: unknown }) {
  const notes: string[] = [];
  const fetcher = vi.fn(async (url: string) => {
    if (String(url).includes('mission-start')) return new Response(JSON.stringify({ status: 'started' }), { status: 200 });
    return new Response(JSON.stringify(completeBody.body), { status: completeBody.status });
  }) as unknown as typeof fetch;
  const r = createFounderMissionRunner({ onProfile: vi.fn(), notify: (t, d) => notes.push(`${t}${d ? ' · ' + d : ''}`), onObjective: vi.fn(), fetcher });
  return { r, notes };
}
const flush = () => new Promise(res => setTimeout(res, 0));

describe('mission runner — complete() response handling', () => {
  it('a server "incomplete" does NOT crash the next update() (index was advanced past the end)', async () => {
    const { r } = runner({ status: 200, body: { status: 'incomplete' } });
    r.start(MISSION); await flush();
    r.update(WP, false); await flush();        // reach the deliver → complete() → incomplete
    expect(() => r.update(WP, false)).not.toThrow(); // the regression: objectives[length] must not be read
    expect(r.running).toBe(true);               // still active, re-checking from the deliver
  });

  it('a server-cleared mission (no-active-mission 409) ends cleanly, no silent retry', async () => {
    const { r, notes } = runner({ status: 409, body: { error: 'no-active-mission' } });
    r.start(MISSION); await flush();
    r.update(WP, false); await flush();
    expect(r.running).toBe(false);
    expect(notes.some(n => /reset after recovery/i.test(n))).toBe(true);
  });

  it('an unnamed player gets a clear prompt and the run ends', async () => {
    const { r, notes } = runner({ status: 200, body: { status: 'unnamed' } });
    r.start(MISSION); await flush();
    r.update(WP, false); await flush();
    expect(r.running).toBe(false);
    expect(notes.some(n => /found your startup/i.test(n))).toBe(true);
  });

  it('a completed mission reports and ends', async () => {
    const { r, notes } = runner({ status: 200, body: { status: 'completed', profile: {} } });
    r.start(MISSION); await flush();
    r.update(WP, false); await flush();
    expect(r.running).toBe(false);
    expect(notes.some(n => /Mission complete/i.test(n))).toBe(true);
  });
});

describe('mission runner — abandon (gtasf-9lzk6, #6.25 regression)', () => {
  it('ends the job at once even when mission-abandon never answers, and still sends the abandon POST', async () => {
    const notes: string[] = [], onObjective = vi.fn(), steps: string[] = [];
    const urls: string[] = [];
    const fetcher = vi.fn((url: string) => {
      urls.push(String(url));
      if (String(url).includes('mission-start')) return Promise.resolve(new Response(JSON.stringify({ status: 'started' }), { status: 200 }));
      return new Promise<Response>(() => {}); // a stalled world DO: never answers
    }) as unknown as typeof fetch;
    const r = createFounderMissionRunner({ onProfile: vi.fn(), notify: (t, d) => notes.push(`${t}${d ? ' · ' + d : ''}`), onObjective, onStep: (_id, step) => steps.push(step), fetcher });
    r.start(MISSION); await flush();
    r.cancel(); await flush();
    expect(r.running).toBe(false);                              // phone: no live job
    expect(onObjective).toHaveBeenLastCalledWith(null);         // objective pill gone
    expect(steps).toContain('abandon');                         // MISSION FAILED band
    expect(notes.some(n => /Job abandoned: Test Job/.test(n))).toBe(true); // the notice, without waiting
    expect(urls.some(u => u.includes('mission-abandon'))).toBe(true);     // the server still hears it
  });
});
