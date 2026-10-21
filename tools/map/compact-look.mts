/** Explicit experimental build + real disposable WorldDO + cold trace + native hill ride.
 * Run once through tools/heavy.sh with .nvmrc's Node. No activation, fixed steps,
 * virtual input, pose overrides, production upload or shared dev-server restart.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, basename, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
// Use the same locked Vite installation as web/vite.staging.config.ts; tools/map
// has a separate dependency tree whose private Vite types are not interchangeable.
import { build, preview, type PreviewServer } from '../../node_modules/vite/dist/node/index.js';
import { chromium, type Browser, type Page } from '@playwright/test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { deploymentWebConfig } from '../../web/vite.staging.config';

const root = process.cwd(), mapRoot = resolve(process.argv[2] ?? 'tools/map/out/compact-zzpr');
assert.equal(resolve(mapRoot, '..'), resolve('tools/map/out'), 'Only isolated map output candidates');
const output = resolve(process.env.GTASF_COMPACT_EVIDENCE ?? 'docs/perf/map-zzpr/smoke');
const reusePath = process.env.GTASF_COMPACT_REUSE_EXPERIMENT;
const reuse = reusePath ? JSON.parse(await readFile(reusePath, 'utf8')) : undefined;
const districtOnly = process.env.GTASF_COMPACT_DISTRICT_ONLY === '1';
const seamOnly = process.env.GTASF_COMPACT_SEAM_LOOK === '1';
const highOnly = process.env.GTASF_COMPACT_HIGH_LOOK === '1';
const heightOnly = process.env.GTASF_COMPACT_HEIGHT_LOOK === '1';
assert([districtOnly, seamOnly, highOnly, heightOnly].filter(Boolean).length <= 1, 'Choose one focused district view');
const focusedView = districtOnly || seamOnly || highOnly || heightOnly;
assert(!districtOnly || reuse, 'District-only proof must reuse a frozen completed cold build');
const scratch = reuse ? dirname(resolve(reuse.app)) : resolve('artifacts/compact-map', new Date().toISOString().replaceAll(':', '-'));
assert.equal(dirname(scratch), resolve('artifacts/compact-map'), 'Only our frozen local experiment builds');
const app = join(scratch, 'app'), flagsPath = join(scratch, 'flags.ts'), workerOut = join(scratch, 'worker');
await mkdir(scratch, { recursive: true }); await mkdir(output, { recursive: true });
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const save = (name: string, value: unknown) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n');
const sourceFlags = await readFile('shared/flags.ts', 'utf8');
assert.equal(sourceFlags.match(/compactMapAssets: false/g)?.length, 1, 'Production/source flag stays OFF');
const experimentalFlags = sourceFlags.replace('compactMapAssets: false', 'compactMapAssets: true');
const manifestBytes = await readFile(join(mapRoot, 'manifest.json')), manifest = JSON.parse(manifestBytes.toString());
const transportReport = JSON.parse(await readFile(join(mapRoot, 'transport-report.json'), 'utf8'));
const sourceInput = transportReport.sourceRoot as string;
assert.deepEqual(manifest.requiredFeatures, ['compactMapAssets']);
if (reuse) {
  assert.equal(reuse.mapManifestSha256, sha(manifestBytes));
  assert.equal(reuse.app, app); assert.equal(reuse.mapRoot, mapRoot);
  assert.equal(reuse.flagsSha256, sha(await readFile(flagsPath)));
  assert.equal(reuse.workerBundleSha256, sha(await readFile(join(workerOut, 'index.js'))));
  const inventory = JSON.parse(await readFile(join(dirname(reusePath!), 'cold/inventory.json'), 'utf8'));
  for (const file of inventory.emitted) assert.equal(sha(await readFile(join(app, file.path))), file.sha256, `Frozen app file ${file.path}`);
  if (districtOnly) {
    const ride = JSON.parse(await readFile(join(dirname(reusePath!), 'ride.json'), 'utf8'));
    assert.equal(ride.passed, true, 'The reused build already completed its native Lombard ride');
  }
} else {
  await writeFile(flagsPath, '// Explicit local compact-map experiment; this module is not deployed.\n' + experimentalFlags);
  const config = deploymentWebConfig(root, flagsPath);
  await build({ ...config, configFile: false, build: { ...config.build, outDir: app } });
  // Keep the candidate's authored kerbs/road paint paired with its geometry. These are
  // unchanged source bytes and remain included in the emitted app inventory.
  await cp(join(sourceInput, 'art/road-details.json'), join(app, 'art/road-details.json'));
  await cp(join(sourceInput, 'art/district-roads'), join(app, 'art/district-roads'), { recursive: true });
  const workerConfig = join(scratch, 'wrangler.json');
  await writeFile(workerConfig, JSON.stringify({ name: 'gtasf-compact-local-proof', main: resolve('worker/src/index.ts'),
    compatibility_date: '2026-09-28', compatibility_flags: ['nodejs_compat'],
    alias: { '@gtasf/shared/flags': flagsPath },
    durable_objects: { bindings: [{ name: 'WORLD', class_name: 'WorldDO' }, { name: 'LEDGER', class_name: 'LedgerDO' }, { name: 'LOBBY', class_name: 'LobbyDO' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['WorldDO', 'LedgerDO', 'LobbyDO'] }],
  }, null, 2));
  const dryRun = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'deploy', '--dry-run', '--config', workerConfig, '--outdir', workerOut],
    { cwd: root, encoding: 'utf8', env: { ...process.env, CI: '1' }, maxBuffer: 8_000_000 });
  await writeFile(join(output, 'worker-build.log'), dryRun.stdout + dryRun.stderr);
  assert.equal(dryRun.status, 0, 'Worker dry run must pass');
}
const bundlePath = join(workerOut, 'index.js'), graphKey = `map/releases/${sha(manifestBytes)}/roadgraph.bin`;
const worker = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false }, workers: [{
  name: 'gtasf-compact-proof', modules: true, scriptPath: bundlePath, compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
  bindings: { ENVIRONMENT: 'local', LAUNCH_MODE: 'open', WORLD_CAPACITY: '150', WORLD_ROAD_GRAPH_KEY: 'map/lombard/manifest.json' },
  durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true }, LEDGER: { className: 'LedgerDO', useSQLite: true }, LOBBY: { className: 'LobbyDO', useSQLite: true } },
  d1Databases: ['DB'], r2Buckets: ['ASSETS'], queueProducers: { JOBS: 'gtasf-jobs-local' },
}] }));
let server: PreviewServer | undefined, browser: Browser | undefined, page: Page | undefined;
const errors: string[] = [], samples: { at: number; x: number; y: number; z: number; roadY?: number | null; mode?: string; taxiState?: string; mapErrors?: string[] }[] = [];
const recipeAssets = new Set<string>(manifest.chunks.flatMap((chunk: any) => chunk.lods.filter((asset: any) => asset.meshEncoding === 'recipes-v1').map((asset: any) => asset.path)));
const observedRecipes = new Set<string>();
const joinAssets = new Set<string>(manifest.chunks.flatMap((chunk: any) => chunk.lods.filter((asset: any) => asset.meshEncoding === 'joins-v1').map((asset: any) => asset.path)));
const observedJoins = new Set<string>(), observedWorkers = new Set<string>();
const changedHighAssets = new Set<string>(highOnly ? transportReport.records.filter((r: any) => r.changed).map((r: any) => r.path) : []);
const observedHighAssets = new Set<string>();
const heightAssets = new Set<string>(manifest.chunks.flatMap((c: any) => c.lods.filter((a: any) => a.meshEncoding === 'height-predicted-v1').map((a: any) => a.path)));
const observedHeightAssets = new Set<string>();
assert(!highOnly || changedHighAssets.size > 0, 'Detailed-building candidate has measured changed assets');
let passed = false, failure: string | undefined;
try {
  const workerUrl = await worker.ready, db = await worker.getD1Database('DB'), bucket = await worker.getR2Bucket('ASSETS');
  const migrations = (await readdir('worker/migrations')).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of migrations) {
    const ddl = (await readFile(join('worker/migrations', name), 'utf8')).replace(/--[^\n]*/g, '');
    for (const statement of ddl.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const events = JSON.parse(await readFile('worker/src/events/data/sf-tech-week.json', 'utf8'));
  for (let i = 0; i < events.events.length; i += 50) await db.batch(events.events.slice(i, i + 50).map((e: Record<string, any>) => db.prepare(
    'INSERT INTO events(id,title,host,starts_at,ends_at,venue,address,url,lat,lon,approximate,source,tags_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(e.id, e.title, e.host, e.start, e.end, e.venue, e.address, e.url, e.lat, e.lon, Number(e.approx), e.source, JSON.stringify(e.tags), events.capturedAt)));
  // Same transported hash and restored source graph in both real runtime consumers.
  await bucket.put(graphKey, await readFile(join(mapRoot, manifest.roadGraph.path + '.gz')), { httpMetadata: { contentType: 'application/octet-stream', contentEncoding: 'gzip' } });
  const workerManifest = { requiredFeatures: manifest.requiredFeatures, roadGraph: { ...manifest.roadGraph, path: '/' + graphKey } };
  await bucket.put('map/lombard/manifest.json', gzipSync(JSON.stringify(workerManifest)), { httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' } });
  await save('experiment.json', { sourceFlag: false, compiledExperimentalFlag: true, flagsSha256: sha(await readFile(flagsPath)),
    mapManifestSha256: sha(manifestBytes), graph: manifest.roadGraph, workerBundleSha256: sha(await readFile(bundlePath)),
    app, mapRoot, sourceInput, roadDetailManifestSha256: sha(await readFile(join(app, 'art/district-roads/manifest.json'))),
    migrations, eventCount: events.events.length, realDisposableWorldDO: true, reusedExperiment: reusePath,
    note: 'Explicit paired local flag experiment. No source flag changes or production gate acceptance.' });
  // Existing recorder observes the ordinary loading card and CDP bytes; it never builds.
  if (!reuse) {
    const cold = spawn(process.execPath, ['tools/cold-load.mjs'], { cwd: root, stdio: 'inherit', env: { ...process.env,
      GTASF_MAP_AREA: basename(mapRoot), GTASF_COLD_APP: app, GTASF_COLD_API: workerUrl.origin, GTASF_COLD_OUT: join(output, 'cold') } });
    const coldCode = await new Promise<number>((resolve, reject) => { cold.once('error', reject); cold.once('exit', code => resolve(code ?? 1)); });
    assert.equal(coldCode, 0, 'Cold READY trace must pass');
    const sourceReceipt = JSON.parse(await readFile(join(output, 'cold/source.json'), 'utf8'));
    await writeFile(join(output, 'cold/source.json'), JSON.stringify({ ...sourceReceipt,
      compiledFlagsSha256: sha(await readFile(flagsPath)), compiledExperimentalOverrides: { compactMapAssets: true },
      note: 'Explicit local compact-map experiment with one copied flag module shared by browser and Worker. Source flags remain OFF. See ../experiment.json; this is not production/CDN evidence.',
    }, null, 2) + '\n');
  } else {
    await save('cold-reuse.json', { original: resolve(dirname(reusePath!), 'cold'),
      note: 'No repeated cold run or rebuild: every emitted app file, compiled flag module, Worker bundle and map manifest hash was verified against the completed cold trace.' });
  }
  process.env.GTASF_MAP_AREA = basename(mapRoot);
  server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: app },
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: workerUrl.origin, ws: true } } } });
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  page = await context.newPage();
  page.on('worker', worker => observedWorkers.add(worker.url()));
  page.on('pageerror', error => errors.push(error.message)); page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    const asset = path.match(/chunks\/-?\d+_-?\d+\/lod[01]\.bin$/)?.[0];
    if (asset && recipeAssets.has(asset)) observedRecipes.add(asset);
    if (asset && joinAssets.has(asset)) observedJoins.add(asset);
    if (asset && changedHighAssets.has(asset)) observedHighAssets.add(asset);
    if (asset && heightAssets.has(asset)) observedHeightAssets.add(asset);
  });
  const missionUrl = '/?at=37.7599,-122.4148,0&preset=low';
  const seamUrl = '/?at=37.7724950,-122.5098072,270&preset=low';
  const view = heightOnly ? 'height-prediction' : highOnly ? 'high-buildings' : seamOnly ? 'ocean-seams' : 'mission-recipes';
  await page.goto(new URL(seamOnly || heightOnly ? seamUrl : districtOnly ? missionUrl : '/go/lombard?preset=low', server.resolvedUrls!.local[0]!).href);
  await page.waitForFunction(() => document.querySelector<HTMLCanvasElement>('#world')?.dataset.ready === 'true' && document.querySelector<HTMLElement>('#loading')?.hidden, undefined, { timeout: 120_000 });
  // Use the same visible controls as a new player; onboarding owns keyboard input
  // until Skip, and its identity dialog must finish before native hail can work.
  const skip = page.getByRole('button', { name: /^skip$/i });
  const freshIntro = await skip.isVisible();
  if (!await skip.isVisible() && /onboarding: true/.test(sourceFlags)) {
    await page.getByRole('button', { name: 'Game options', exact: true }).click();
    await page.getByRole('button', { name: 'Replay tutorial', exact: true }).click();
    const options = page.getByRole('dialog', { name: 'Game options', exact: true });
    if (await options.isVisible()) await options.getByRole('button', { name: 'Close ×', exact: true }).click();
  }
  if (await skip.isVisible()) {
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>('.gt-sa-intro__img');
      return image?.complete && image.naturalWidth > 0;
    });
    await page.screenshot({ path: join(output, heightOnly ? 'height-intro.png' : highOnly ? 'high-intro.png' : seamOnly ? 'ocean-intro.png' : districtOnly ? 'mission-intro.png' : 'lombard-intro.png') });
    const skippedSave = page.waitForResponse(response => {
      const request = response.request();
      if (!response.url().endsWith('/api/onboarding/state') || request.method() !== 'POST') return false;
      return JSON.parse(request.postDataJSON().state).skipped === true;
    });
    await skip.click();
    assert.equal((await skippedSave).status(), 200);
    const username = page.getByRole('textbox', { name: 'Username', exact: true });
    if (await username.isVisible()) {
      await username.fill(`compact_${Date.now().toString(36)}`);
      await page.getByRole('textbox', { name: 'Startup name', exact: true }).fill('Compact Map Ride');
      await page.getByRole('button', { name: 'Looks good', exact: true }).click();
      await username.waitFor({ state: 'hidden' });
    }
    const persisted = await page.evaluate(async () => {
      const response = await fetch('/api/onboarding/state'); return { status: response.status, body: await response.json() };
    });
    assert.equal(persisted.status, 200);
    assert.equal(persisted.body.state.skipped, true);
    await save('onboarding.json', { nativeSkip: true, posterLoaded: true, freshIntro, replay: !freshIntro, persisted });
  }
  const recoveryClose = page.locator('.gt-recovery-close');
  if (await recoveryClose.isVisible()) { await recoveryClose.click(); await page.locator('dialog.gt-recovery').waitFor({ state: 'hidden' }); }
  const sample = async () => page!.evaluate(() => {
    const data = document.querySelector<HTMLCanvasElement>('#world')!.dataset;
    const map = (window as any).__gtasf?.world?.map;
    const x = Number(data.x), y = Number(data.y), z = Number(data.z);
    return { at: Date.now(), x, y, z, mode: data.mode, taxiState: data.taxiState, roadY: map?.surfaceHeightAt(x, z, y) as number | null | undefined,
      mapErrors: map?.stats.errors as string[] | undefined };
  });
  if (!focusedView) {
    const start = await sample(); samples.push(start);
    await page.screenshot({ path: join(output, 'lombard-start.png') });
    await page.bringToFront();
    const pointerPoint = await page.evaluate(() => {
      const canvas = document.querySelector('#world')!, rect = canvas.getBoundingClientRect();
      for (const [fx, fy] of [[.7, .7], [.7, .8], [.4, .7], [.3, .4]]) {
        const x = rect.x + rect.width * fx!, y = rect.y + rect.height * fy!;
        if (document.elementFromPoint(x, y) === canvas) return { x, y };
      }
      return null;
    });
    assert(pointerPoint, 'A visible canvas location is available for the native focus gesture');
    await page.mouse.click(pointerPoint.x, pointerPoint.y); await page.keyboard.press('KeyH');
    await page.waitForFunction(() => document.querySelector<HTMLCanvasElement>('#world')?.dataset.mode === 'passenger', undefined, { timeout: 60_000 });
    const begun = Date.now(); let middle = false;
    while (Date.now() - begun < 150_000) {
      const current = await sample(); samples.push(current);
      if (!middle && current.y < 70) { await page.screenshot({ path: join(output, 'lombard-middle.png') }); middle = true; }
      if (current.taxiState === 'arrived') break;
      await page.waitForTimeout(500);
    }
    const end = await sample(); await page.screenshot({ path: join(output, 'lombard-arrival.png') });
    assert.equal(end.taxiState, 'arrived'); assert(start.y - end.y > 30, 'Descend the actual source hill');
    const contact = samples.filter(s => s.mode === 'passenger' && Number.isFinite(s.roadY));
    assert(contact.length > 30, 'Observe live contact throughout the ride');
    const maxContactOffsetM = Math.max(...contact.map(s => Math.abs(s.y - s.roadY!)));
    assert(maxContactOffsetM < 1, 'Stay within the real taxi wheelbase support envelope');
    assert.deepEqual(errors, []); assert(samples.every(s => !s.mapErrors?.length));
    await save('ride.json', { passed: true, start, end, samples, maxContactOffsetM, input: 'native keyboard H; real WorldDO autonomous ride', fixedSteps: false });
    // One phone look in the same smoke, after the ordinary resize and render path.
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
    await page.screenshot({ path: join(output, 'lombard-phone.png') });
  } else if (districtOnly) await save('ride-reuse.json', { original: resolve(dirname(reusePath!), 'ride.json'),
    note: 'The native ride independently passed in the hash-verified frozen build. Only its Mission follow-up is retried here.' });
  if (focusedView || process.env.GTASF_COMPACT_DISTRICT_LOOK === '1') {
    await page.setViewportSize({ width: 1280, height: 800 });
    if (!focusedView) {
      observedRecipes.clear(); await page.goto(new URL(missionUrl, server.resolvedUrls!.local[0]!).href);
    }
    await page.waitForFunction(() => document.querySelector<HTMLCanvasElement>('#world')?.dataset.ready === 'true'
      && document.querySelector<HTMLElement>('#loading')?.hidden, undefined, { timeout: 120_000 });
    // Returning-player changelog is a real modal; use its ordinary dismissal.
    const letsGo = page.getByRole('button', { name: "Let's go", exact: true });
    const changelogShown = await letsGo.isVisible();
    if (changelogShown) await letsGo.click();
    if (await recoveryClose.isVisible()) { await recoveryClose.click(); await page.locator('dialog.gt-recovery').waitFor({ state: 'hidden' }); }
    const before = await sample();
    const point = await page.evaluate(() => {
      const canvas = document.querySelector('#world')!, rect = canvas.getBoundingClientRect();
      for (const [fx, fy] of [[.7, .7], [.7, .8], [.4, .7], [.3, .4]]) {
        const x = rect.x + rect.width * fx!, y = rect.y + rect.height * fy!;
        if (document.elementFromPoint(x, y) === canvas) return { x, y };
      }
      return null;
    });
    assert(point, 'Exposed canvas accepts a native district walk'); await page.mouse.click(point.x, point.y);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(2200); await page.keyboard.up('KeyW');
    const after = await sample();
    assert(Math.hypot(after.x - before.x, after.z - before.z) > 1, 'Native movement crosses the district street scene');
    assert(!before.mapErrors?.length && !after.mapErrors?.length);
    if (heightOnly) { assert(observedHeightAssets.size > 0, 'Actual height-predicted assets loaded'); assert([...observedWorkers].some(url => url.includes('compactMesh.worker-')), 'Actual background decoder instantiated'); }
    else if (highOnly) assert(observedHighAssets.size > 0, 'Actual changed detailed-building assets loaded');
    else if (seamOnly) { assert(observedJoins.size > 0, 'Actual seam recipe assets loaded'); assert([...observedWorkers].some(url => url.includes('compactMesh.worker-')), 'Actual background decoder instantiated'); }
    else assert(observedRecipes.size > 0, 'Mission loads actual building-recipe assets');
    await page.screenshot({ path: join(output, `${view}-desktop.png`) });
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
    await page.screenshot({ path: join(output, `${view}-phone.png`) });
    await save(`${view}.json`, { before, after, assets: [...observedRecipes], changedHighAssets: [...observedHighAssets], heightAssets: [...observedHeightAssets], joins: [...observedJoins], workers: [...observedWorkers], errors, changelogShown,
      input: 'native pointer focus and W; ordinary deep link, render loop and source collision/contact', responsiveOnly: true, deviceOrPerformanceAccepted: false });
  }
  assert.deepEqual(errors, []); passed = true;
} catch (error) {
  failure = String(error); await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {}); throw error;
} finally {
  await save('result.json', { passed, failure, errors, samples, changedHighAssets: [...observedHighAssets], heightAssets: [...observedHeightAssets], joins: [...observedJoins], workers: [...observedWorkers], productionAccepted: false });
  await browser?.close();
  if (server) { if ('closeAllConnections' in server.httpServer) server.httpServer.closeAllConnections(); await new Promise<void>(resolve => server!.httpServer.close(() => resolve())); }
  await worker.dispose();
}
