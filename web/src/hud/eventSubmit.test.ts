import { expect, it, vi } from 'vitest';
import { submitEventLink } from './eventSubmit';

const ok = 'https://lu.ma/foundercoffee';

it('rejects empty, oversized and non-http links without calling the server', async () => {
  const fetcher = vi.fn() as unknown as typeof fetch;
  expect(await submitEventLink('   ', fetcher)).toMatchObject({ ok: false });
  expect(await submitEventLink('ftp://lu.ma/x', fetcher)).toMatchObject({ ok: false });
  expect(await submitEventLink('not a url', fetcher)).toMatchObject({ ok: false });
  expect(await submitEventLink(`https://lu.ma/${'a'.repeat(2100)}`, fetcher)).toMatchObject({ ok: false });
  expect(fetcher).not.toHaveBeenCalled();
});

it('POSTs same-origin JSON and returns the stored event title on success', async () => {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(JSON.parse(String(init?.body))).toEqual({ url: ok });
    return Response.json({ ok: true, status: 'stored', event: { title: 'Founders Coffee' } }, { status: 201 });
  }) as unknown as typeof fetch;
  expect(await submitEventLink(ok, fetcher)).toEqual({ ok: true, status: 'stored', title: 'Founders Coffee' });
  expect(fetcher).toHaveBeenCalledWith('/api/events/submit', expect.objectContaining({ method: 'POST' }));
});

it('reports an updated resubmission distinctly', async () => {
  const fetcher = (async () => Response.json({ ok: true, status: 'updated', event: { title: 'Founders Coffee' } }, { status: 201 })) as unknown as typeof fetch;
  expect(await submitEventLink(ok, fetcher)).toEqual({ ok: true, status: 'updated', title: 'Founders Coffee' });
});

it('surfaces the worker rejection reason verbatim', async () => {
  const fetcher = (async () => Response.json({ error: 'That looks like a virtual event or one outside San Francisco.' }, { status: 422 })) as unknown as typeof fetch;
  expect(await submitEventLink(ok, fetcher)).toEqual({ ok: false, reason: 'That looks like a virtual event or one outside San Francisco.' });
});

it('surfaces a conflict (already on the map) as a rejection reason', async () => {
  const fetcher = (async () => Response.json({ error: 'That event is already on the map.' }, { status: 409 })) as unknown as typeof fetch;
  expect(await submitEventLink(ok, fetcher)).toMatchObject({ ok: false, reason: 'That event is already on the map.' });
});

it('falls back to a generic reason on a non-JSON error body', async () => {
  const fetcher = (async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch;
  expect(await submitEventLink(ok, fetcher)).toMatchObject({ ok: false });
});

it('handles a network failure without throwing', async () => {
  const fetcher = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  const result = await submitEventLink(ok, fetcher);
  expect(result.ok).toBe(false);
  expect((result as { reason: string }).reason).toMatch(/connection|reach/i);
});
