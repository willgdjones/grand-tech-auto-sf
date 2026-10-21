/** Actual client + profile route/identity/store over isolated SQLite and a cookie-delivery transport. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const out = resolve(process.env.GTASF_PROFILE_RETRY_OUT ?? 'artifacts/funding-profile-retry/current');
await mkdir(out, { recursive: true });
const bundle = resolve(out, 'profile.mjs');
await build({ stdin: { contents: "export {createFundingClient} from './web/src/funding/client.ts'; export {handleFundingRequest} from './worker/src/funding/routes.ts'; export {fundingDevice} from './worker/src/funding/identity.ts';", resolveDir: process.cwd(), loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'error',
  plugins: process.env.GTASF_PROFILE_SOURCE ? [{ name: 'recorded-client', setup(builder) {
    builder.onLoad({ filter: /web\/src\/funding\/client\.ts$/ }, async args => ({ contents: await readFile(process.env.GTASF_PROFILE_SOURCE, 'utf8'), loader: 'ts', resolveDir: dirname(args.path) }));
  } }] : [] });
const { createFundingClient, handleFundingRequest, fundingDevice } = await import(pathToFileURL(bundle).href);
const migrations = await Promise.all(['0010_funding.sql', '0014_funding_bonus.sql'].map(file => readFile(resolve('worker/migrations', file), 'utf8')));
const report = { at: new Date().toISOString(), scope: 'Actual client and Worker profile endpoint, isolated SQLite/D1-shaped adapter, controlled cookie delivery; no live Worker or browser gate', checks: [], passed: false };
const originalFetch = globalThis.fetch;
for (const scenario of ['ordinary-missing-cookie', 'temporary-503', 'lost-body-after-headers', 'lost-response-before-headers', 'existing-cookie-body-loss']) {
  const sqlite = new DatabaseSync(':memory:');
  for (const sql of migrations) sqlite.exec(sql);
  const prepare = (sql, values = []) => ({
    bind: (...next) => prepare(sql, next),
    async first(column) { const row = sqlite.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
    async run() { const value = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(value.changes) } }; },
    async all() { return { results: sqlite.prepare(sql).all(...values), success: true }; },
  });
  const db = { prepare }, env = { DB: db, WORLD: { idFromName() { throw new Error('Initial profile must not enter WorldDO'); } } };
  let cookie = '', requests = 0, accepted = 0, client;
  const request = () => new Request('https://gtasf.test/api/funding/profile', { headers: cookie ? { Cookie: cookie } : {} });
  const receiveCookie = response => { const value = response.headers.get('set-cookie'); if (value) cookie = value.split(';')[0]; };
  const row = { name: scenario, passed: false };
  try {
    if (scenario === 'existing-cookie-body-loss') receiveCookie(await handleFundingRequest(request(), env));
    globalThis.fetch = async (url, init) => {
      assert.equal(url, '/api/funding/profile'); assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'same-origin');
      requests++;
      if (scenario === 'temporary-503' && requests === 1) return Response.json({ error: 'Temporary profile failure' }, { status: 503 });
      const response = await handleFundingRequest(request(), env); assert.equal(response.status, 200);
      if (scenario === 'lost-response-before-headers' && requests === 1) {
        await response.body?.cancel(); throw new TypeError('Connection reset before headers');
      }
      receiveCookie(response);
      if (requests === 1 && (scenario === 'lost-body-after-headers' || scenario === 'existing-cookie-body-loss')) {
        await response.body?.cancel(); Object.defineProperty(response, 'text', { value: async () => { throw new TypeError('Connection reset while reading body'); } });
      }
      return response;
    };
    client = createFundingClient({ onProfile() { accepted++; } }); assert.ok(client);
    const results = await Promise.allSettled([client.init(), client.init()]);
    const identities = sqlite.prepare('SELECT COUNT(*) count FROM funding_profiles').get().count;
    const authenticated = await fundingDevice(request(), db);
    Object.assign(row, { requests, acceptedProfiles: accepted, storedEmptyProfiles: identities,
      canonicalCookieMatches: Boolean(authenticated && client.profile?.deviceId === authenticated),
      successfulWaiters: results.filter(result => result.status === 'fulfilled').length });
    assert.equal(row.successfulWaiters, 2, 'Both boot waiters must recover the canonical profile');
    assert.equal(requests, scenario === 'ordinary-missing-cookie' ? 1 : 2, 'Coalesce boot callers and retry only once');
    assert.equal(accepted, 1, 'Install only the one fully received profile'); assert.equal(row.canonicalCookieMatches, true);
    assert.equal(identities, scenario === 'lost-response-before-headers' ? 2 : 1);
    assert.equal(client.profile.totalCents, '0'); assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM funding_awards').get().count, 0);
    row.passed = true;
  } catch (error) { row.error = String(error); }
  finally { client?.destroy(); globalThis.fetch = originalFetch; sqlite.close(); report.checks.push(row); }
}
report.passed = report.checks.every(check => check.passed);
report.identityLimit = 'A response lost before Set-Cookie reaches the browser may leave an inaccessible empty profile, as with manual reload. Only the final cookie-authenticated profile is installed; no profile token is exposed or recovered client-side.';
if (!report.passed) process.exitCode = 1;
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
