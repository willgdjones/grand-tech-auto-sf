/** One isolated native server scenario. No local game, provider, or GPU mutation. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const output = resolve('artifacts/chat'); await mkdir(output, { recursive: true });
const bundle = await build({ entryPoints: ['worker/src/world/chat/chat-smoke.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'error', plugins: [{ name: 'isolated-chat-flags', setup(b) {
  b.onLoad({ filter: /shared\/flags\.ts$/ }, async args => ({ loader: 'ts', contents: (await readFile(args.path, 'utf8')).replace(/\b(chat|eventChat): false/g, '$1: true') }));
} }] });
const pool = new Miniflare(convertV4MiniflareOptions({ cf: false, telemetry: { enabled: false }, workers: [{
  name: 'chat-smoke', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-28', d1Databases: ['DB'],
  durableObjects: { CHAT: { className: 'ChatSmoke', useSQLite: true } }, outboundService: () => { throw new Error('Unexpected external request'); },
}] }));
try {
  await pool.ready; const db = await pool.getD1Database('DB');
  for (const file of ['0001_initial.sql', '0002_events.sql']) {
    for (const sql of (await readFile(`worker/migrations/${file}`, 'utf8')).replace(/--[^\n]*/g, '').split(';').filter(s => s.trim())) await db.prepare(sql).run();
  }
  const response = await pool.dispatchFetch('https://chat-fixture.test/'); const body = await response.text();
  assert.equal(response.status, 200, body); const report = JSON.parse(body); assert.equal(report.passed, true);
  await writeFile(`${output}/server-report.json`, JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2));
  console.log('TEST_PASSED:Chat', report.checks.join('; '));
} finally { await pool.dispose(); }
