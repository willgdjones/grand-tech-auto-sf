#!/usr/bin/env node
/**
 * Voice metrics report (gtasf-voice-metrics, migration 0039): "how many people have tried to speak?"
 *   node tools/voice-report.mjs [--remote | --local] [--days 7]
 * Reads only the aggregate tables (no device ids exist): caption attempts by outcome, unique speaking devices,
 * voice opt-ins (devices that created a Realtime session) and verified speakers (passed the verified-email
 * publish gate), per Pacific day. --remote: gtasf-production via worker/wrangler.production.jsonc.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2), remote = args.includes('--remote');
const days = Math.max(1, Math.min(90, Number(args[args.indexOf('--days') + 1]) || 7));
const since = new Date(Date.now() - (days - 1) * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
function query(sql) {
  const wranglerArgs = ['wrangler', 'd1', 'execute', remote ? 'gtasf-production' : 'gtasf-local', remote ? '--remote' : '--local', '--json', '--command', sql];
  if (remote) wranglerArgs.push('--config', 'wrangler.production.jsonc');
  const out = JSON.parse(execFileSync('npx', wranglerArgs, { cwd: join(root, 'worker'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  return (Array.isArray(out) ? out[0] : out)?.results ?? [];
}
const counts = query(`SELECT day,metric,outcome,count FROM voice_metric_counts WHERE day>='${since}' ORDER BY day,metric,outcome`);
const devices = query(`SELECT day,metric,COUNT(*) AS devices FROM voice_metric_devices WHERE day>='${since}' GROUP BY day,metric ORDER BY day,metric`);
const byDay = new Map();
const row = day => byDay.get(day) ?? byDay.set(day, { day, attempts: 0, outcomes: {}, speakers: 0, optins: 0, verified: 0, sessions: 0 }).get(day);
for (const c of counts) {
  const r = row(c.day);
  if (c.metric === 'caption') { r.attempts += c.count; r.outcomes[c.outcome] = c.count; }
  if (c.metric === 'voice_session') r.sessions += c.count;
}
for (const d of devices) {
  const r = row(d.day);
  if (d.metric === 'caption_speaker') r.speakers = d.devices;
  if (d.metric === 'voice_optin') r.optins = d.devices;
  if (d.metric === 'verified_speaker') r.verified = d.devices;
}
const rows = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
console.log(`Voice metrics (${remote ? 'production' : 'local'}), last ${days} Pacific days`);
console.log('day         speakers  attempts  sent  empty  rejected  dropped  unavail  refused  voice-on  verified');
for (const r of rows) {
  const o = r.outcomes, refused = (o['refused-budget'] ?? 0) + (o['refused-banned'] ?? 0);
  console.log([r.day, r.speakers, r.attempts, o.sent ?? 0, o.empty ?? 0, o.rejected ?? 0, o.dropped ?? 0, o.unavailable ?? 0, refused, r.optins, r.verified]
    .map((v, i) => String(v).padEnd(i === 0 ? 12 : i === 1 ? 10 : 9)).join(''));
}
if (!rows.length) console.log('(no voice activity recorded yet; counters start once migration 0039 is applied and the Worker is deployed)');
