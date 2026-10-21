// gtasf-j7wvv daily check (orchestrator 2026-10-16): world-socket drop rate in prod since #6.37.
// The Workers Logs query API needs an observability scope the wrangler OAuth token lacks, so this samples instead:
//   1. a live `wrangler tail` for MINUTES (default 10): the WorldDO's own close logs by code ('world socket closed ...
//      code N'), instance starts ('world DO start ... sockets 0' after players = a reset), and new world sockets;
//   2. GraphQL durableObjectsInvocationsAdaptiveGroups for the last DAYS (default 2): DO invocations by status per day.
//   3. (netBeacon, once migration 0052 is applied in prod) the consent-free per-client counts from D1 net_beacon_counts:
//      sessions, drops by close code + session age, rejoins by gap, per day — the real drop rate from every player.
// Prints a one-screen summary.   MINUTES=10 node tools/_laneb-drop-rate.mjs   (it refreshes the wrangler OAuth token first)
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MINUTES = Number(process.env.MINUTES ?? 10), DAYS = Number(process.env.DAYS ?? 2);
const ACCOUNT = 'YOUR_CLOUDFLARE_ACCOUNT_ID';
const repo = new URL('..', import.meta.url).pathname;

// The wrangler OAuth token lasts ~1 h and wrangler only refreshes it when it runs: an expired one made GraphQL fail and the
// tail silently see 0 events. 'wrangler whoami' refreshes it before anything reads the config.
spawnSync(process.execPath, [join(repo, 'node_modules/wrangler/bin/wrangler.js'), 'whoami'], { cwd: join(repo, 'worker'), stdio: 'ignore', timeout: 60_000 });

async function graphql() {
  const config = readFileSync(join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  const token = /oauth_token\s*=\s*"([^"]+)"/.exec(config)?.[1];
  if (!token) return 'no wrangler OAuth token';
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);
  const query = `{ viewer { accounts(filter:{accountTag:"${ACCOUNT}"}) { durableObjectsInvocationsAdaptiveGroups(limit:200,
    filter:{date_geq:"${since}"}, orderBy:[date_ASC]) { sum { requests } dimensions { date status } } } } }`;
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const json = await response.json();
  const groups = json?.data?.viewer?.accounts?.[0]?.durableObjectsInvocationsAdaptiveGroups;
  if (!groups) return `graphql: ${JSON.stringify(json?.errors ?? json).slice(0, 200)}`;
  const byDay = new Map();
  for (const g of groups) { const day = byDay.get(g.dimensions.date) ?? {}; day[g.dimensions.status] = (day[g.dimensions.status] ?? 0) + g.sum.requests; byDay.set(g.dimensions.date, day); }
  return [...byDay].map(([day, s]) => `  ${day}: ${Object.entries(s).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`).join('\n');
}

function tail() {
  return new Promise(resolve => {
    // TAIL_FILE=<saved wrangler tail json> replays a capture instead of tailing live (parser check / past windows).
    const child = process.env.TAIL_FILE ? spawn('cat', [process.env.TAIL_FILE], { stdio: ['ignore', 'pipe', 'ignore'] })
      : spawn(process.execPath, [join(repo, 'node_modules/wrangler/bin/wrangler.js'), 'tail', '-c', 'wrangler.production.jsonc', '--format', 'json'], { cwd: join(repo, 'worker'), stdio: ['ignore', 'pipe', 'ignore'] });
    if (process.env.TAIL_FILE) child.on('close', () => resolve(counts));
    let buffer = '';
    const counts = { closes: {}, resets: 0, starts: 0, upgrades: 0, events: 0 };
    child.stdout.on('data', chunk => {
      buffer += chunk;
      // wrangler prints pretty JSON objects back to back; split on top-level boundaries.
      let depth = 0, start = -1, inString = false, escape = false;
      for (let i = 0; i < buffer.length; i++) {
        const c = buffer[i];
        if (inString) { if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') inString = false; continue; }
        if (c === '"') inString = true; else if (c === '{') { if (depth++ === 0) start = i; } else if (c === '}' && --depth === 0 && start >= 0) {
          try {
            const e = JSON.parse(buffer.slice(start, i + 1)); counts.events++;
            if (/\/api\/world(\?|$)/.test(e?.event?.request?.url ?? '') && e?.event?.request?.headers?.upgrade === 'websocket') counts.upgrades++;
            for (const log of e.logs ?? []) {
              const m = (log.message ?? []).join(' ');
              const close = /world socket closed .*?code (\d+)(?: client\/runtime close (\d+))?/.exec(m);
              if (close) { const code = close[2] ?? close[1]; counts.closes[code] = (counts.closes[code] ?? 0) + 1; }
              const started = /world DO start .*sockets (\d+)/.exec(m);
              if (started) { counts.starts++; if (started[1] === '0') counts.resets++; }
            }
          } catch { /* partial */ }
          buffer = buffer.slice(i + 1); i = -1; start = -1;
        }
      }
    });
    setTimeout(() => { child.kill(); resolve(counts); }, MINUTES * 60_000);
  });
}

function beaconCounts() {
  return new Promise(resolve => {
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);
    const sql = `SELECT day, kind, code, bucket, device, count FROM net_beacon_counts WHERE day >= '${since}' ORDER BY day, kind, code, bucket`;
    const child = spawn(process.execPath, [join(repo, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'gtasf-production', '--remote', '-c', 'wrangler.production.jsonc', '--json', '--command', sql], { cwd: join(repo, 'worker'), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('close', () => {
      try {
        const parsed = JSON.parse(out);
        if (!Array.isArray(parsed)) { const why = JSON.stringify(parsed?.error ?? parsed); return resolve(/no such table/i.test(why) ? '  net_beacon_counts not created yet (apply migration 0052, then add netBeacon to prepare.ts)' : `  d1: ${why.slice(0, 160)}`); }
        const rows = parsed[0]?.results ?? [];
        if (!rows.length) return resolve('  (no rows yet)');
        const byDay = new Map();
        for (const r of rows) { const d = byDay.get(r.day) ?? { session: 0, drop: 0, rejoin: 0, codes: {}, ages: {} }; d[r.kind] += r.count; if (r.kind === 'drop') { d.codes[r.code] = (d.codes[r.code] ?? 0) + r.count; d.ages[r.bucket] = (d.ages[r.bucket] ?? 0) + r.count; } byDay.set(r.day, d); }
        resolve([...byDay].map(([day, d]) => `  ${day}: sessions ${d.session}, drops ${d.drop} (${d.session ? (100 * d.drop / d.session).toFixed(1) : '-'}% of sessions; codes ${JSON.stringify(d.codes)}; session age ${JSON.stringify(d.ages)}), rejoins ${d.rejoin}`).join('\n'));
      } catch { resolve(`  d1: ${/no such table/i.test(out + err) ? 'net_beacon_counts not created yet (apply migration 0052)' : (err || out).trim().split('\n').pop()?.slice(0, 160)}`); }
    });
  });
}

const [stats, daily, beacons] = await Promise.all([tail(), graphql(), beaconCounts()]);
console.log(`World-socket drop sample (${MINUTES} min tail, ${new Date().toISOString()}):`);
console.log(`  tail events ${stats.events}, new world sockets ${stats.upgrades}, instance starts ${stats.starts} (with 0 sockets: ${stats.resets})`);
console.log(`  closes logged by the DO, by code: ${JSON.stringify(stats.closes)} (1006 = no close frame; a DO reset logs none)`);
console.log(`WorldDO invocations by status, last ${DAYS} days (GraphQL):\n${daily}`);
console.log(`Client drop beacons (netBeacon, D1 net_beacon_counts), last ${DAYS} days:\n${beacons}`);
process.exit(0); // the tail timer would otherwise hold a TAIL_FILE replay open for MINUTES
