/**
 * Live-API smoke for "Become an angel" (gtasf-become-an-angel-7ggb): hits /api/angels/* on the
 * running local dev stack (the npm dev server proxies /api to the Worker). Verifies the route is
 * wired behind the becomeAnAngel flag, the D1 table exists, and the submit flow validates +
 * fail-closes correctly. Does NOT run a real checkout (that is pane 7's injected piece, gated).
 *
 *   GTASF_SMOKE_URL=http://127.0.0.1:5173 node tools/become-an-angel-smoke.mjs
 */
import assert from 'node:assert/strict';

const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const json = async (path, init) => {
  const res = await fetch(new URL(path, base), init);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
};
const post = (path, data) => json(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

const report = { base, checks: [], passed: false };
function check(name, ok, detail) { report.checks.push({ name, ok, detail }); assert.ok(ok, `${name}: ${detail}`); }

try {
  // 1) Spots list is served with the USD price (flag on, D1 table present).
  const spots = await json('/api/angels/spots');
  check('spots-200', spots.status === 200, `status ${spots.status}`);
  check('spots-nonempty', Array.isArray(spots.body?.spots) && spots.body.spots.length > 0, 'no spots');
  check('spots-have-id-label', spots.body.spots.every(s => typeof s.id === 'string' && typeof s.label === 'string'), 'bad spot shape');
  check('price-usd-cents', /^\d+$/.test(String(spots.body?.priceUsdCents)), `priceUsdCents=${spots.body?.priceUsdCents}`);
  const spotId = spots.body.spots[0].id;

  // 2) A bad spot is rejected at validation (400), never a 500.
  const badSpot = await post('/api/angels/submit', { displayName: 'Smoke Ventures', line: 'Hi there.', spotId: 'not-a-real-spot' });
  check('submit-bad-spot-400', badSpot.status === 400, `status ${badSpot.status}`);

  // 3) A well-formed submit is HANDLED (not a 500): it either reaches checkout (200) or fail-closes
  //    (503 when the Jev key / checkout is not configured) or is moderated (422) — never a crash.
  const good = await post('/api/angels/submit', { displayName: 'Smoke Ventures', line: 'Backing the bold.', avatarColor: '#4f7cff', spotId });
  check('submit-handled', [200, 422, 503].includes(good.status), `unexpected status ${good.status}: ${JSON.stringify(good.body)}`);

  // 4) The sponsor dashboard responds with an angels array.
  const mine = await json('/api/angels/mine');
  check('mine-200', mine.status === 200, `status ${mine.status}`);
  check('mine-array', Array.isArray(mine.body?.angels), 'no angels array');

  report.passed = true;
  console.log('TEST_PASSED:BecomeAnAngelApi', JSON.stringify({ spots: spots.body.spots.length, submitStatus: good.status }));
} catch (error) {
  report.failure = String(error);
  console.error('TEST_FAILED:BecomeAnAngelApi', JSON.stringify(report, null, 2));
  throw error;
}
