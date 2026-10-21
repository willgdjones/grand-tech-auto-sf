// Read-only founder-ladder funnel snapshot (lane C). One command for the A/B reads (loadingHook boot bounce, walkUpPitch,
// opening_step beats): prod D1 (rows_written 0) + the consent-free loading beacon + PostHog HogQL.
//   node tools/funnel-snapshot.mjs [sinceDay=YYYY-MM-DD]      (PT days; default: today PT minus 1)
// Needs wrangler auth for gtasf-production and POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID / POSTHOG_HOST in worker/.dev.vars
// (never printed). Excludes is_bot devices; lane C's two fresh-visitor test profiles (10-15 ~14:15/14:20 PT) are real-looking.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pt = d => new Date(d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
const day = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const since = process.argv[2] ?? day(new Date(pt(new Date()).getTime() - 86_400_000));

function d1(sql) {
  const out = execFileSync(process.execPath, ['../node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'gtasf-production', '--remote', '--json', '--command', sql],
    { cwd: 'worker', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const json = JSON.parse(out.slice(out.indexOf('[')));
  const r = Array.isArray(json) ? json[0] : json;
  if (r?.meta?.rows_written) throw new Error('refusing: a read wrote rows');
  return r?.results ?? [];
}
async function hog(query) {
  const vars = Object.fromEntries(readFileSync('worker/.dev.vars', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
  if (!vars.POSTHOG_PERSONAL_API_KEY) return null;
  const host = (vars.POSTHOG_HOST || 'https://us.posthog.com').replace(/\/$/, '').replace('://us.i.', '://us.').replace('://eu.i.', '://eu.');
  const res = await fetch(`${host}/api/projects/${vars.POSTHOG_PROJECT_ID}/query/`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${vars.POSTHOG_PERSONAL_API_KEY}` },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }) });
  return res.ok ? (await res.json()).results ?? [] : null;
}
const table = (title, rows) => { console.log(`\n## ${title}`); if (!rows?.length) { console.log('(none)'); return; } console.log(Object.keys(rows[0]).join(' | ')); for (const r of rows) console.log(Object.values(r).join(' | ')); };

console.log(`# Funnel snapshot since ${since} (PT) — generated ${new Date().toISOString()}`);
table('First-pitch cheques (real / bot)', d1(`SELECT c.day, substr(c.source_ref,10,5) AS firm, SUM(CASE WHEN COALESCE(p.is_bot,0)=0 THEN 1 ELSE 0 END) AS real, SUM(CASE WHEN p.is_bot=1 THEN 1 ELSE 0 END) AS bot
  FROM funding_credits c LEFT JOIN funding_profiles p ON p.device_id=c.device_id WHERE c.source='celebrity' AND c.source_ref LIKE 'pitch:vc:%' AND c.day >= '${since}' GROUP BY 1,2 ORDER BY 1 DESC, 2`));
table('New profiles (PT day)', d1(`SELECT d, COUNT(*) AS total, SUM(b) AS bots, COUNT(*)-SUM(b) AS real FROM (SELECT date(created_at/1000,'unixepoch','-7 hours') AS d, CASE WHEN is_bot=1 THEN 1 ELSE 0 END AS b FROM funding_profiles) WHERE d >= '${since}' GROUP BY d ORDER BY d DESC`));
table('Loading beacon (UTC day): starts / ready / abandons, boot 0-3 s abandons', d1(`SELECT day, SUM(CASE WHEN kind='start' THEN count ELSE 0 END) AS starts, SUM(CASE WHEN kind='ready' THEN count ELSE 0 END) AS ready,
  SUM(CASE WHEN kind='abandon' THEN count ELSE 0 END) AS abandons, SUM(CASE WHEN kind='abandon' AND stage='boot' AND bucket='0-3s' THEN count ELSE 0 END) AS boot_0_3s
  FROM loading_beacon_counts WHERE day >= '${since}' GROUP BY day ORDER BY day DESC`));
// gtasf-ep30n: the cold-phone READY bundle's acceptance number — READY / starts by device and UTC day.
table('Loading beacon READY rate by device (UTC day)', d1(`SELECT day, device, SUM(CASE WHEN kind='start' THEN count ELSE 0 END) AS starts,
  SUM(CASE WHEN kind='ready' THEN count ELSE 0 END) AS ready, ROUND(100.0 * SUM(CASE WHEN kind='ready' THEN count ELSE 0 END) / MAX(1, SUM(CASE WHEN kind='start' THEN count ELSE 0 END))) AS ready_pct
  FROM loading_beacon_counts WHERE day >= '${since}' GROUP BY day, device ORDER BY day DESC, device`));
// Lane D (mobile READY 0/9, 10-18): WHERE do loads die - abandons by device x stage x elapsed bucket over the window.
// One dominant stage + early buckets = a boot/first-seconds problem, not a mid-load stall.
table('Loading beacon abandons by stage and elapsed bucket (window)', d1(`SELECT device, stage, bucket, SUM(count) AS abandons
  FROM loading_beacon_counts WHERE kind='abandon' AND day >= '${since}' GROUP BY device, stage, bucket ORDER BY device, abandons DESC`));
// loadingBeaconClass (migration 0053): the same funnel split by coarse client class and whether the page was ever visible —
// 'preview' or seen=0 rows are link unfurlers, not players; read mobile READY from ua=browser|inapp, seen=1 (reviewer 13:3x).
try {
  table('Loading beacon by client class (window): ua x seen', d1(`SELECT device, ua, seen, SUM(CASE WHEN kind='start' THEN count ELSE 0 END) AS starts,
    SUM(CASE WHEN kind='ready' THEN count ELSE 0 END) AS ready, SUM(CASE WHEN kind='abandon' THEN count ELSE 0 END) AS abandons
    FROM loading_beacon_class_counts WHERE day >= '${since}' GROUP BY device, ua, seen ORDER BY device, ua, seen DESC`));
  // Lane D: the stage x bucket abandon split for REAL players only (critic 14:1x acceptance: ua browser|inapp AND seen=1), so
  // the boot 0-3 s cell no longer includes JS-running link unfurlers.
  table('Loading beacon abandons by stage and elapsed bucket, real players only (ua browser|inapp, seen=1)', d1(`SELECT device, stage, bucket,
    SUM(count) AS abandons FROM loading_beacon_class_counts WHERE kind='abandon' AND ua IN ('browser','inapp') AND seen=1 AND day >= '${since}'
    GROUP BY device, stage, bucket ORDER BY device, abandons DESC`));
} catch { console.log('\n## Loading beacon by client class\n(no loading_beacon_class_counts yet: migration 0053 not applied)'); }
const beats = await hog(`SELECT properties.step AS step, count(DISTINCT distinct_id) AS users, round(median(properties.ms_since_join)/1000) AS median_s FROM events WHERE event='opening_step' AND timestamp >= toDateTime('${since} 00:00:00') GROUP BY step ORDER BY users DESC`);
table('PostHog opening_step (consented subset)', beats?.map(([step, users, median_s]) => ({ step, users, median_s })));
const top = await hog(`SELECT event, count(DISTINCT distinct_id) AS users FROM events WHERE timestamp >= toDateTime('${since} 00:00:00') AND event IN ('landing_view','play_start','load_ready','founder_bucket','founder_found','billboard_seen','opening_step') GROUP BY event ORDER BY users DESC`);
table('PostHog top-of-funnel (consented subset)', top?.map(([event, users]) => ({ event, users })));
