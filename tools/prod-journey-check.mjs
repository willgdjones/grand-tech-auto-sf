// Fast, non-browser prod founder-journey health gate (gtasf-prod-journey-check-x6lk).
// Checks the live journey's API/map contract in one shot — complements pane 6's browser smoke as a
// post-each-deploy gate. No deps, no browser.
//   node tools/prod-journey-check.mjs            # defaults to https://gtasf.com
//   GTASF_URL=https://gtasf.pages.dev node tools/prod-journey-check.mjs
// Exit 0 = all PASS; exit 1 = any FAIL. Each check prints PASS/FAIL + a short detail.
const BASE = (process.env.GTASF_URL ?? 'https://gtasf.com').replace(/\/$/, '');
const TIMEOUT = Number(process.env.GTASF_TIMEOUT_MS ?? 12000);

async function req(path, { expect = 200, json = false, text = false } = {}) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const res = await fetch(BASE + path, { signal: ac.signal, redirect: 'follow' });
    const body = json && res.ok ? await res.json().catch(() => null) : null;
    const str = text && res.ok ? await res.text().catch(() => '') : '';
    const len = Number(res.headers.get('content-length') ?? 0) || str.length;
    return { status: res.status, ok: res.status === expect, body, str, len };
  } catch (e) { return { status: 0, ok: false, error: String(e.message).slice(0, 80) }; }
  finally { clearTimeout(t); }
}

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(26)} ${detail}`); };

console.log(`Prod founder-journey health gate -> ${BASE}\n`);

// 1. The page serves (fetch the HTML so we can verify the bundle it references).
const page = await req('/', { text: true });
check('page', page.ok, `GET / -> ${page.status}${page.error ? ' ' + page.error : ''}`);

// 1b. The content-hashed client bundle + stylesheet actually load (a bad asset path 404s the game to
// a blank screen while / still returns 200 HTML — this catches that catastrophic deploy regression).
const jsRef = page.str?.match(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/)?.[1]
  ?? page.str?.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
const cssRef = page.str?.match(/<link[^>]+stylesheet[^>]*href="([^"]+\.css)"/)?.[1]
  ?? page.str?.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
if (!jsRef) {
  check('client bundle', false, 'no module <script> found in index.html');
} else {
  const js = await req(jsRef, { text: true }); // read body: CF/Pages often omit content-length (chunked/compressed)
  const css = cssRef ? await req(cssRef) : { ok: true, status: 'n/a', len: 0 };
  // The real game bundle is hundreds of KB; a stub/error page would be tiny.
  const jsBig = js.ok && js.len > 50_000;
  check('client bundle', jsBig && css.ok, `js ${jsRef.split('/').pop()} -> ${js.status} ${js.len}B; css -> ${css.status}${jsBig ? '' : ' (JS missing/too-small — game would not boot)'}`);
}

// 2. Worker health + onboarding flag live. /api/health nests the flag set under `flags` (older
// builds had it flat), so read either shape. onboarding is a shipped founder-journey feature — assert
// it's ON so a silent flag regression fails the gate. economyV3/realisticRender are surfaced (not
// asserted) so a run shows the moment the founder flips econ-v3 or the #6 renderer.
const health = await req('/api/health', { json: true });
const hflags = health.body?.flags ?? health.body ?? {};
check('api/health', health.ok && hflags.onboarding === true,
  `-> ${health.status}${health.body ? ` ok=${health.body.ok} onboarding=${hflags.onboarding} economyV3=${hflags.economyV3} realisticRender=${hflags.realisticRender}` : ''}`);

// 3. Map manifest is the CITYWIDE routable pack (catches the vcaj corridor-pack regression).
const man = await req('/map/lombard/manifest.json', { json: true });
const rg = man.body?.roadGraph ?? {};
const citywide = man.body?.area === 'sf' && Number(rg.bytes) > 15_000_000; // citywide bin is ~23MB; corridor slice is ~7MB
check('map citywide routing', man.ok && citywide,
  man.ok ? `area=${man.body?.area} roadGraph.bytes=${rg.bytes} sha=${(rg.sha256 || '').slice(0, 8)} (citywide=${citywide})` : `-> ${man.status}`);

// 4. Events API serves a non-empty feed.
const events = await req('/api/events', { json: true });
const evList = Array.isArray(events.body) ? events.body : events.body?.events;
check('api/events', events.ok && Array.isArray(evList) && evList.length > 0, `-> ${events.status} events=${Array.isArray(evList) ? evList.length : 'n/a'}`);

// 5. VC fund-drop state endpoint responds.
const drops = await req('/api/drops/state');
check('api/drops/state', drops.ok, `-> ${drops.status}`);

// 6. Cap table is device-bound: unauthenticated GET must be 401 (NOT 200/500).
const cap = await req('/api/funding/captable', { expect: 401 });
check('api/funding/captable auth', cap.ok, `unauth -> ${cap.status} (expect 401)`);

// 7. Onboarding state loads (GET issues a fresh-device cookie).
const onb = await req('/api/onboarding/state');
check('api/onboarding/state', onb.ok, `-> ${onb.status}`);

const failed = results.filter(r => !r.pass);
console.log(`\n${failed.length ? 'FAIL' : 'PASS'}: ${results.length - failed.length}/${results.length} checks green${failed.length ? ' — ' + failed.map(f => f.name).join(', ') : ''}`);
process.exitCode = failed.length ? 1 : 0;
