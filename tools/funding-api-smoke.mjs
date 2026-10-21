/* Funding v2 API smoke (PLAN-v2 decisions 1/2/5) — fast, headless, no browser/build. Exercises the
 * real HTTP endpoints against a running origin (local worker :8787 by default, or GTASF_SMOKE_URL for
 * prod), so it's reliable where the mounted-game browser smoke is at the mercy of local-worker load.
 * Verifies: a device session issues a cookie; leaderboard shape; the three v2 endpoints
 * summary/collected/captable?nick; the summary batch bound (400); cap-table self + no-match (404).
 * Run: node tools/funding-api-smoke.mjs   (GTASF_SMOKE_URL=https://gtasf.com for prod). */
import assert from 'node:assert/strict';

const base = (process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const origin = new URL(base).origin;
let cookie = '';
const checks = [];

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Origin: origin, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const sc of setCookie) { const m = /^gtasf_device=[^;]+/.exec(sc); if (m) cookie = m[0]; }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text: text.slice(0, 200) };
}
function ok(name, cond, detail) { assert.ok(cond, `${name}: ${detail}`); checks.push(name); }

try {
  // 1. A device session issues a cookie and a fresh bootstrapping profile.
  const profile = await call('/api/funding/profile');
  ok('profile-200-cookie', profile.status === 200 && cookie.startsWith('gtasf_device='), `status ${profile.status}, cookie ${cookie ? 'set' : 'MISSING'}`);
  ok('profile-shape', profile.json?.round?.id === 'bootstrapping' && typeof profile.json.totalCents === 'string', JSON.stringify(profile.json)?.slice(0, 120));

  // 2. Leaderboard shape (week/today/you/serverNow).
  const board = await call('/api/funding/leaderboard');
  ok('leaderboard-200-shape', board.status === 200 && Array.isArray(board.json?.week) && Array.isArray(board.json?.today) && board.json?.you && board.json?.serverNow > 0,
    `status ${board.status}, keys ${board.json ? Object.keys(board.json) : 'none'}`);

  // 3. collected (drive-through once-ever set) — my endpoint, behind driveThroughFunding.
  const collected = await call('/api/funding/collected');
  ok('collected-200-array', collected.status === 200 && Array.isArray(collected.json?.collectedEventIds), `status ${collected.status} body ${collected.text}`);

  // 4. summary — my endpoint: shape + the 64-nickname server bound (oversized -> 400).
  const summary = await call('/api/funding/summary', { method: 'POST', body: { nicknames: ['Nobody'] } });
  ok('summary-200-shape', summary.status === 200 && Array.isArray(summary.json?.summaries) && summary.json?.serverNow > 0, `status ${summary.status} body ${summary.text}`);
  const oversized = await call('/api/funding/summary', { method: 'POST', body: { nicknames: Array.from({ length: 65 }, (_, i) => `n${i}`) } });
  ok('summary-oversized-400', oversized.status === 400, `status ${oversized.status} (expect 400)`);

  // 5. cap table: self ($0 profile -> 200 with empty groups, not 404) and a no-match nick -> 404.
  const capSelf = await call('/api/funding/captable');
  ok('captable-self-200', capSelf.status === 200 && capSelf.json?.round?.id && Array.isArray(capSelf.json?.groups), `status ${capSelf.status}`);
  const capNick = await call('/api/funding/captable?nick=__no_such_founder__');
  ok('captable-nick-404', capNick.status === 404, `status ${capNick.status} (expect 404 for an unknown nickname)`);

  console.log(`FUNDING_API_SMOKE_PASS ${base} [${checks.length} checks: ${checks.join(', ')}]`);
} catch (error) {
  console.error(`FUNDING_API_SMOKE_FAIL ${base} — ${error instanceof Error ? error.message : error}`);
  console.error(`passed before failure: ${checks.join(', ') || '(none)'}`);
  process.exitCode = 1;
}
