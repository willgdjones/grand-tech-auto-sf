/** One real-time local-game ride check. No fixed-step, performance or golden suite. */
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const uphill = process.argv.includes('--uphill');
const virtualInput = process.argv.includes('--virtual-input');
const facadesOnly = process.argv.includes('--facades-only');
const facadeViews = facadesOnly || process.argv.includes('--facades');
const out = fileURLToPath(new URL(`./out/hill-smoke/${facadesOnly ? 'facades/' : uphill ? 'uphill/' : ''}`, import.meta.url));
await mkdir(out, { recursive: true });
const headless = process.env.GTASF_HEADLESS === '1';
const browser = await chromium.launch({ headless, args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : [] });
const report = { checkedAt: new Date().toISOString(), mode: uphill ? 'uphill-walk' : 'downhill-taxi', input: virtualInput ? 'public Input.virtual through normal controller' : 'keyboard events', headless, viewport: { width: 640, height: 480 }, errors: [], samples: [] };
let page;
try {
  const context = await browser.newContext({ viewport: { width: 640, height: 480 } });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  let target = '/go/lombard';
  if (uphill && !facadesOnly) {
    const sources = JSON.parse(await readFile(new URL('./out/cache/lombard/sources.json', import.meta.url), 'utf8'));
    const source = sources.records.find(r => r.key === 'osm');
    const osm = JSON.parse(await readFile(new URL(`./out/cache/lombard/${source.file}`, import.meta.url), 'utf8'));
    const end = osm.elements.find(e => e.type === 'way' && e.id === 402111597).geometry.at(-1);
    target = `/?at=${end.lat},${end.lon},270`;
  }
  await page.goto(`${base}${target}${target.includes('?') ? '&' : '?'}preset=low`);
  await page.waitForSelector('#world[data-ready="true"]', { timeout: 60_000 });
  report.gpu = await page.evaluate(() => {
    const context = document.querySelector('#world').getContext('webgl2');
    const debug = context.getExtension('WEBGL_debug_renderer_info');
    return context.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : context.RENDERER);
  });
  const sample = () => page.evaluate(() => {
    const data = { ...document.querySelector('#world').dataset };
    const world = window.__gtasf?.world;
    const car = world?.fleet.cars.get(Number(data.vehicleId));
    return { ...data, at: Date.now(), roadY: world?.map.surfaceHeightAt(Number(data.x), Number(data.z), Number(data.y)),
      pitch: car?.model.root.rotation.x, roll: car?.model.root.rotation.z, mapErrors: world?.map.stats.errors,
      focused: document.hasFocus(), visibility: document.visibilityState, yaw: world?.foot.yaw,
      eventCard: document.querySelector('.gt-event-card')?.hidden === false,
      eventTitle: document.querySelector('.gt-event-title')?.textContent };
  });
  report.start = await sample();
  await page.screenshot({ path: `${out}/${uphill ? 'foot-of-hill' : 'hilltop'}.png` });
  if (uphill) {
    await page.locator('#movement-mode').click();
    assert.equal(await page.locator('#movement-mode').getAttribute('aria-pressed'), 'true');
    // Exercise the exposed tank setting through normal input. The guide reads the
    // pose but never assigns it, changes camera state or steps the clock.
    await page.evaluate(async useVirtual => {
      const local = await (await fetch('/map/lombard/local-play.json')).json();
      const points = local.downhill.points.slice().reverse().filter((p, i, a) => !i || Math.hypot(p[0]-a[i-1][0], p[2]-a[i-1][2]) > .05);
      const world = window.__gtasf.world, progress = window.__uphill = { index: 0, total: points.length, done: false };
      const held = new Set();
      let stopped = false;
      const input = window.__gtasf.input;
      // The real Input clears held keys when its window loses focus. Mirror that
      // bookkeeping so an OS focus change cannot leave the guide believing W is held.
      window.addEventListener('blur', () => held.clear());
      window.addEventListener('focus', () => held.clear());
      function key(code, down) {
        if (held.has(code) === down) return;
        if (down) held.add(code); else held.delete(code);
        window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'ShiftLeft' ? 'Shift' : code.slice(-1).toLowerCase(), bubbles: true, cancelable: true }));
      }
      const release = window.__stopUphill = () => { stopped = true; for (const code of [...held]) key(code, false); if (useVirtual) { input.virtual = null; input.release(); } };
      function aim() {
        if (stopped) return;
        while (progress.index < points.length && Math.hypot(points[progress.index][0]-world.foot.x, points[progress.index][2]-world.foot.z) < .8) progress.index++;
        if (progress.index === points.length) { progress.done = true; release(); return; }
        const p = points[progress.index];
        const desired = Math.atan2(p[0]-world.foot.x, p[2]-world.foot.z);
        const delta = Math.atan2(Math.sin(desired-world.foot.yaw), Math.cos(desired-world.foot.yaw));
        progress.distance = Math.hypot(p[0]-world.foot.x, p[2]-world.foot.z);
        progress.headingError = delta;
        if (useVirtual) input.virtual = { move: { x: delta > .07 ? -1 : delta < -.07 ? 1 : 0, y: Math.abs(delta) < .6 ? 1 : 0 }, actions: ['run'] };
        else { key('KeyA', delta > .07); key('KeyD', delta < -.07); key('KeyW', Math.abs(delta) < .6); key('ShiftLeft', true); }
        requestAnimationFrame(aim);
      }
      aim();
    }, virtualInput);
    console.log(`Walking uphill with tank-control ${virtualInput ? 'public virtual' : 'key'} input along the sourced switchbacks.`);
    const start = Date.now();
    while (Date.now() - start < 240_000) {
      report.samples.push(await sample());
      // Real event markers open a modal on arrival. Dismiss it with the ordinary
      // Escape action so this terrain-contact route can continue through the city.
      if (report.samples.at(-1).eventCard) {
        (report.eventsEncountered ??= []).push(report.samples.at(-1).eventTitle);
        await page.keyboard.press('Escape');
      }
      if (!report.samples.at(-1).focused) await page.bringToFront();
      report.progress = await page.evaluate(() => window.__uphill);
      if (report.samples.length % 20 === 0) {
        console.log(`Uphill: ${report.progress.index}/${report.progress.total}, y=${report.samples.at(-1).y}m`);
        await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
      }
      if (report.progress.done) break;
      await page.waitForTimeout(500);
    }
    await page.evaluate(() => window.__stopUphill());
    report.end = await sample();
    await page.screenshot({ path: `${out}/arrival.png` });
    assert(report.progress.done, 'Foot controller must traverse every uphill waypoint');
    assert(Number(report.end.y) - Number(report.start.y) > 30, 'Walk must climb the complete hill');
    report.maxContactOffsetM = Math.max(...report.samples.map(s => Math.abs(Number(s.y) - s.roadY)));
    assert(report.maxContactOffsetM < .5, 'Walking contact must follow the runtime surface');
  } else if (!facadesOnly) {
  await page.keyboard.press('KeyH');
  await page.waitForFunction(() => document.querySelector('#world')?.dataset.mode === 'passenger', undefined, { timeout: 40_000 });
  console.log('Taxi boarded; recording full real-time Lombard descent.');
  const start = Date.now();
  let lastShot = -1;
  while (Date.now() - start < 150_000) {
    const state = await sample(); report.samples.push(state);
    const stage = Number(state.y) > 76 ? 0 : Number(state.y) > 62 ? 1 : 2;
    if (stage !== lastShot) { await page.screenshot({ path: `${out}/downhill-${stage}.png` }); lastShot = stage; }
    if (report.samples.length % 20 === 0) console.log(`Ride: ${state.taxiState}, y=${state.y}m, x=${state.x}, z=${state.z}`);
    if (state.taxiState === 'arrived') break;
    await page.waitForTimeout(500);
  }
  report.end = await sample();
  await page.screenshot({ path: `${out}/arrival.png` });
  assert.equal(report.end.taxiState, 'arrived', 'Taxi must complete the hill ride');
  assert(Number(report.start.y) - Number(report.end.y) > 30, 'Ride must descend the full source hill');
  const contact = report.samples.filter(s => s.mode === 'passenger' && Number.isFinite(s.roadY));
  assert(contact.length > 30, 'Record continuous live contact, not only endpoints');
  report.maxContactOffsetM = Math.max(...contact.map(s => Math.abs(Number(s.y) - s.roadY)));
  assert(report.maxContactOffsetM < 1, 'Taxi contact must remain within its wheelbase support envelope');
  }
  assert.deepEqual(report.errors, [], 'Runtime errors fail the hill smoke');
  assert(report.samples.every(s => !s.mapErrors?.length), 'Streamed chunks must stay available throughout the ride');
  if (facadeViews) {
    report.facades = [];
    for (const view of [
      { name: 'ferry-facades', path: '/?preset=medium', width: 1280, height: 800, yaw: Math.PI/2 },
      { name: 'lombard-facades', path: '/go/lombard?preset=low', width: 1280, height: 800, yaw: Math.PI*1.5 },
      { name: 'lombard-facades-phone', path: '/go/lombard?preset=low', width: 390, height: 844, yaw: Math.PI*1.5 },
    ]) {
      await page.setViewportSize({ width: view.width, height: view.height });
      await page.goto(`${base}${view.path}`);
      await page.waitForSelector('#world[data-ready="true"]', { timeout: 60_000 });
      await page.waitForFunction(() => window.__gtasf.world.map.stats.queuedUploads === 0 && window.__gtasf.world.map.stats.loading === 0);
      await page.keyboard.press('KeyC');
      await page.waitForTimeout(100); // Let the normal frame consume recenter before the inspection orbit.
      await page.evaluate(yaw => {
        const camera = window.__gtasf.world.camera;
        camera.setOrbit(yaw, -.12);
        camera.look(.001, 0); // Use the manual-look hold so automatic chase preserves this inspection angle.
      }, view.yaw);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${view.name}.png` });
      report.facades.push({ view: view.name, ...(await sample()) });
    }
    assert.deepEqual(report.errors, [], 'Shader/runtime errors fail the facade smoke');
    assert(report.facades.every(s => !s.mapErrors?.length), 'Facade chunks must load');
  }
  report.passed = true;
  console.log(JSON.stringify({ passed: true, samples: report.samples.length, maxContactOffsetM: report.maxContactOffsetM, start: report.start, end: report.end }));
} catch (error) {
  report.failure = String(error);
  await page?.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
