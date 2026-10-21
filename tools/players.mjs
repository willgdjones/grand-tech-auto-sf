#!/usr/bin/env node
// Real player counts (excluding automated test visits, funding_profiles.is_bot=1, migration 0033).
// Read-only. Local D1 by default; pass --remote to read production (orchestrator/founder only; no writes).
// Usage: node tools/players.mjs [--remote]
import { execFileSync } from 'node:child_process';

const remote = process.argv.includes('--remote');
const config = remote ? 'worker/wrangler.production.jsonc' : 'worker/wrangler.toml';
const db = remote ? 'gtasf-production' : 'gtasf-local';
// "Today" = since midnight America/Los_Angeles, as epoch milliseconds (created_at is ms).
const sf = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const offset = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' }).match(/GMT([+-]\d+)/)?.[1] ?? '-7';
const midnight = Date.parse(`${sf}T00:00:00${offset.startsWith('-') ? '-' : '+'}${String(Math.abs(Number(offset))).padStart(2, '0')}:00`);
const sql = `SELECT
  SUM(CASE WHEN COALESCE(is_bot,0)=0 THEN 1 ELSE 0 END) AS players_total,
  SUM(CASE WHEN COALESCE(is_bot,0)=0 AND created_at>=${midnight} THEN 1 ELSE 0 END) AS players_today,
  SUM(CASE WHEN is_bot=1 THEN 1 ELSE 0 END) AS bots_total
FROM funding_profiles`;
const run = query => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', db, remote ? '--remote' : '--local', '--config', config, '--json', '--command', query],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0]?.results?.[0] ?? {};
let row, note = '';
try { row = run(sql); }
catch (error) {
  // Before migration 0033 is applied (needs a deploy), there is no is_bot column: count every profile instead.
  if (!/no such column: is_bot/.test(String(error.stdout ?? '') + String(error.stderr ?? '') + String(error.message))) throw error;
  row = run(sql.replaceAll('COALESCE(is_bot,0)=0', '1=1').replace('SUM(CASE WHEN is_bot=1 THEN 1 ELSE 0 END)', '0'));
  note = ' (is_bot not migrated yet: bots NOT excluded until migration 0033 is deployed)';
}
console.log(`${remote ? 'production' : 'local'} (${sf} PT): real players today ${row.players_today ?? 0}, total ${row.players_total ?? 0}; bots excluded ${row.bots_total ?? 0}${note}`);
