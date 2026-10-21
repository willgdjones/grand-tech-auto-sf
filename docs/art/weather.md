# SF sun and Karl weather

Local-v1 bead `gtasf-wz9g` fills PLAN's SunCalc/NWS atmosphere gap. It does not
close the original deployed G1 or phone/device performance gates.

`shared/flags.ts` switches `sun` and `weather` independently. Both are enabled
for local play after source, cache and visual checks. The renderer reads them
through `createRenderFoundation`; no additional main-loop hook is needed.
`worker/src/index.ts` calls `handleWeatherRequest(request, context)` before its
final 404. No new bindings, credentials or provider account are required.

## Sources and bounded fallback

- [NWS API documentation](https://www.weather.gov/documentation/services-web-api):
  public HTTPS JSON with an identifying GTASF user-agent. Each refresh resolves
  the SF point, then the returned same-host hourly forecast, plus the latest
  KSFO observation. No provider key is needed.
- The strict-TLS source fetch on October 3, 2026 resolved MTR/85,105. The
  08:56 UTC KSFO reading was Mostly Cloudy, BKN clouds and 16,090m visibility.
  Saved raw responses are ignored artifacts in `artifacts/weather/`.
- One refresh per isolate; a shared edge cache and memory copy remain fresh
  for 15 minutes and usable for two hours. Stale values return immediately
  while the Worker refreshes in the background. Failure backs off for a
  minute. No valid source returns a labelled time-of-day fallback with HTTP200.
- NWS requests share a six-second abort deadline covering response bodies.
  Responses over 350KB are rejected. Client polling is nonblocking, every ten
  minutes, pauses when hidden, retries failures after a minute, and aborts on
  disposal. Its deadline is eight seconds and payload cap 12KB.
- Observations older than two hours and expired/current-hour forecasts with
  generation times older than six hours are ignored. API source timestamps and
  measured visibility stay separate from art-directed cloud/fog values.

## Rendering

[SunCalc 2.1](https://github.com/mourner/suncalc) returns azimuth clockwise from
north and apparent altitude in degrees. At SF latitude/longitude these map to
east +X, up +Y, south +Z. The direction updates with the existing 30-second clock
grade. Direct sunlight fades to zero below the horizon; the accepted blue night
palette, sodium lamps, windows and neon retain readable ambient fill.

Weather eases over roughly 12 seconds and modifies the existing fog, light and
sky uniforms. It adds no render pass or image asset. Dense fog starts at least
55m away and far fog stays at least 260m away. Cloud cover attenuates sunlight,
changes procedural cloud coverage and obscures stars; night stays blue.
Expired/unavailable readings ease back to the base atmosphere.

## Verification

Web and Worker strict checks pass. Scoped weather/solar and existing foundation
tests pass 11/11, covering source freshness, measurement units, shared cache,
single-flight refresh, stale failure/backoff, stalled-body timeout, sunrise/day/
sunset direction, night fill and readable fog transitions. Source checkpoint
`cd47a88` and route/bounded-reader checkpoint `6acbe12` are pushed. After route
wiring, Worker strict, the four cache tests and Wrangler dry run pass again.
The mounted local Worker at `127.0.0.1:8787/api/weather` returns HTTP200 with
`status: live` after enablement, using a fresh 09:40 UTC KSFO observation and
the 09:00 UTC hourly forecast (cloud cover 0.27, visibility 16,093.44m).
The response is recorded in `artifacts/weather/native-response.json`.

The October 3 09:49–09:50 UTC real-source renderer smoke passes all three views:
1100×720 desktop at 00:36 and 13:00 SF time, and 390×844 phone at 00:36.
`artifacts/weather/evidence.json` records zero console/page/HTTP errors, exactly
one weather request per browser and clean feed disposal. The reviewed night
has blue atmosphere, warm lit windows and sodium pools, direct sunlight zero,
ambient 2.25, fog beginning at 65m and far fog around 455m. Daylight has an
above-ground sun with intensity about 0.994. Actual NWS cloud cover is 0.59;
the screenshots are taken after its smooth influence passes 0.7.

Reproduce with Node24: `node tools/weather-smoke.mjs`, after saving current
NWS point/hourly/KSFO responses under `artifacts/weather/`. It uses the actual
Lombard chunks and character, an isolated static source feed, and explicit
renderer options. This establishes atmosphere behavior; it does not establish
native multiplayer, production deployment or phone performance. Existing map
surface gaps visible in the source geometry remain a separate map issue.
