import { expect, test, vi } from 'vitest';
import type { ReferralProfile } from '@gtasf/shared/referrals';

vi.mock('@gtasf/shared/flags', () => ({ flags: { referrals: true, referralClaims: true } }));
const profile: ReferralProfile = {
  code: '1234567890abcdef12345678', clicks: 0, players: 0, pendingCents: '0', availableCents: '0',
  claimed: false, creditEnabled: false, claimEnabled: false, cashoutEnabled: false,
};

test('stalled referral headers, bodies and visits release boot, abort and allow a real retry', async () => {
  vi.useFakeTimers();
  try {
    for (const stage of ['headers', 'body', 'visit']) {
      vi.resetModules();
      vi.stubGlobal('location', new URL('https://gtasf.test/?ref=abcdef1234567890abcdef12'));
      let stalledSignal: AbortSignal | undefined;
      let recover = false;
      const fetcher = vi.fn(async (url: string, init: RequestInit) => {
        const stalls = !recover && (stage === 'visit' ? url.endsWith('/visit') : url.endsWith('/profile'));
        if (stalls) {
          stalledSignal = init.signal as AbortSignal;
          if (stage === 'body') return { ok: true, json: () => new Promise(() => {}) } as Response;
          return new Promise<Response>(() => {});
        }
        return Response.json(url.endsWith('/profile') ? profile : { ok: true });
      });
      vi.stubGlobal('fetch', fetcher);
      const client = await import('./client');
      const boot = client.initReferrals();
      expect(client.initReferrals()).toBe(boot); // Concurrent callers share the attempt.
      await vi.advanceTimersByTimeAsync(4000);
      expect(await boot).toBeNull();
      expect(stalledSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      recover = true;
      expect(await client.initReferrals()).toEqual(profile);
      const visit = [...fetcher.mock.calls].reverse().find(([url]) => url.endsWith('/visit'))!;
      expect(JSON.parse(visit[1].body as string)).toMatchObject({ code: 'abcdef1234567890abcdef12' });
      expect(visit[1].credentials).toBe('same-origin');
      const calls = fetcher.mock.calls.length;
      expect(await client.referralShareUrl('/go/lombard')).toBe(`https://gtasf.test/go/lombard?ref=${profile.code}`);
      expect(fetcher).toHaveBeenCalledTimes(calls);
      expect(vi.getTimerCount()).toBe(0);
    }
    const client = await import('./client');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'Check your email.' })));
    expect(await client.referralAction('claim', { email: 'founder@example.test' })).toBe('Check your email.');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'That proof has expired.' }, { status: 400 })));
    await expect(client.referralAction('verify', { proof: 'expired' })).rejects.toThrow('That proof has expired.');
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});
