import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createFalClient, type FalRecipe } from './fal.mjs';
import { readLedger, editLedger } from './ledger';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(cap = 1) {
  const root = await mkdtemp(join(tmpdir(), 'gtasf-fal-')); roots.push(root);
  await mkdir(join(root, 'tools/art'), { recursive: true });
  await writeFile(join(root, 'tools/art/.env'), `FAL_KEY=fixture-secret\nFAL_MAX_USD=${cap}\n`);
  return root;
}
const recipe = (label: string, estimatedUsd = .6): FalRecipe => ({ model: 'fal-ai/flux/dev', input: { prompt: label, num_images: 1 }, estimatedUsd, output: `web/public/art/${label}.png` });
const submitted = { request_id: 'request-1', status_url: 'https://queue.fal.run/fal-ai/flux/requests/request-1/status', response_url: 'https://queue.fal.run/fal-ai/flux/requests/request-1' };
const cdn = 'https://fal.media/files/fixture.png';

test('reserves under the shared lock before POST, refuses a competing over-cap call, downloads without auth and reuses cached work', async () => {
  const root = await fixture(); const ledgerPath = join(root, 'tools/art/ledger.json');
  await editLedger(ledgerPath, ledger => { ledger.entries.push({ id: 'scenario-old', key: 'old', createdAt: '', prompt: '', model: 'scenario', body: {}, output: 'web/public/art/old.png', estimatedCredits: 10, reservedCredits: 10, usdPerCredit: .01, actualCredits: 10, status: 'complete' }); });
  let finishSubmit!: (response: Response) => void;
  let entered!: () => void; const started = new Promise<void>(done => { entered = done; });
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === 'POST') {
      const ledger = await readLedger(ledgerPath);
      expect(ledger.entries.at(-1)).toMatchObject({ status: 'submitting', reservedCredits: .6, usdPerCredit: 1 });
      expect(new Headers(init.headers).get('Authorization')).toBe('Key fixture-secret');
      entered(); return new Promise<Response>(done => { finishSubmit = done; });
    }
    if (String(url) === cdn) { expect(new Headers(init?.headers).has('Authorization')).toBe(false); return new Response(new Uint8Array([1, 2, 3])); }
    if (String(url).endsWith('/status')) return Response.json({ status: 'COMPLETED' });
    return Response.json({ images: [{ url: cdn }] });
  });
  const first = createFalClient({ root, fetchImpl: fetchMock });
  const second = createFalClient({ root, fetchImpl: fetchMock });
  const running = first.run(recipe('pavement')); await started;
  await expect(second.run(recipe('kerb'))).rejects.toThrow('cap');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  finishSubmit(Response.json(submitted));
  const complete = await running;
  expect(complete).toMatchObject({ status: 'complete', bytes: 3, estimatedUsd: .6 });
  expect(await readFile(join(root, complete.output))).toEqual(Buffer.from([1, 2, 3]));
  const calls = fetchMock.mock.calls.length;
  expect((await second.run(recipe('pavement'))).id).toBe(complete.id);
  expect(fetchMock).toHaveBeenCalledTimes(calls);
  expect(await first.budget()).toMatchObject({ capUsd: 1, reservedUsd: .6, remainingUsd: .4 });
  const ledgerText = await readFile(ledgerPath, 'utf8');
  expect(ledgerText).toContain('scenario-old'); expect(ledgerText).not.toContain('fixture-secret');
  expect((await readLedger(ledgerPath)).totals.budgetCountedUsd).toBe(.7);
});

test('ambiguous submission keeps its reservation and cannot trigger another paid attempt; caps cannot be raised by process env', async () => {
  const root = await fixture(50);
  vi.stubEnv('FAL_MAX_USD', '500');
  const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('provider echoed fixture-secret'));
  const client = createFalClient({ root, fetchImpl: fetchMock });
  await expect(client.run(recipe('gravel', 51))).rejects.toThrow('cap');
  for (const model of ['fal-ai/../secret', 'fal-ai//flux', 'fal-ai/./flux']) {
    await expect(client.run({ ...recipe('invalid', 1), model })).rejects.toThrow('model ID');
  }
  const versioned = { ...recipe('gravel', 1), model: 'fal-ai/wan/v2.2-a14b/image-to-video/turbo' };
  await expect(client.run(versioned)).rejects.toThrow('no automatic paid retry');
  expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/wan/v2.2-a14b/');
  await expect(client.run(versioned)).rejects.toThrow('unresolved');
  await expect(client.run(recipe('asphalt', 1))).rejects.toThrow('Unresolved');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await client.budget()).toMatchObject({ capUsd: 50, reservedUsd: 1 });
  expect(await readFile(join(root, 'tools/art/ledger.json'), 'utf8')).not.toContain('fixture-secret');
});

test('a failed download resumes the original queue job and queue-supplied foreign URLs never receive the key', async () => {
  const root = await fixture(); let downloads = 0;
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === 'POST') return Response.json(submitted);
    if (String(url).endsWith('/status')) return Response.json({ status: 'COMPLETED' });
    if (String(url) === cdn) return ++downloads === 1 ? new Response('', { status: 503 }) : new Response('image');
    return Response.json({ image: { url: cdn } });
  });
  const client = createFalClient({ root, fetchImpl: fetchMock });
  await expect(client.run(recipe('pavers'))).rejects.toThrow('download unavailable');
  const id = (await client.budget()).calls[0]!.id;
  expect((await client.resume(id)).status).toBe('complete');
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect((await client.budget()).reservedUsd).toBe(.6);

  const foreignRoot = await fixture();
  const malicious = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...submitted, status_url: 'https://elsewhere.example/status' }));
  await expect(createFalClient({ root: foreignRoot, fetchImpl: malicious }).run(recipe('parking'))).rejects.toThrow('Untrusted');
  expect(malicious).toHaveBeenCalledTimes(1);
});
