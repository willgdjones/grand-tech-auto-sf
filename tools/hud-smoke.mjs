/** One B04 browser smoke against the real running app and its real local event feed. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const out = 'artifacts/hud'; await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { at: new Date().toISOString(), errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
try {
  await page.goto(base);
  await page.waitForFunction(() => window.__gtasf?.ready, undefined, { timeout: 30000 });
  await page.locator('.gt-hud').waitFor({ state: 'visible', timeout: 10000 });
  assert.match(await page.locator('.gt-hud-clock').innerText(), /^\d{2}:\d{2}$/);
  assert.equal(await page.locator('.gt-star').count(), 6);
  assert.equal(await page.locator('.gt-star.earned').count(), 0);
  const statusClear = await page.evaluate(() => {
    const hud = document.querySelector('.gt-hud').getBoundingClientRect(), controls = document.querySelector('#play-controls').getBoundingClientRect();
    return hud.top >= controls.bottom + 8 || hud.right <= controls.left || hud.left >= controls.right;
  });
  assert(statusClear, 'HUD overlaps the quick destination controls');
  await page.screenshot({ path: `${out}/ferry-hud.png` });
  const target = await page.evaluate(async () => {
    const { projectLocation } = await import('/src/radar/projection.ts');
    const { events } = await (await fetch('/api/events')).json();
    const w = window.__gtasf.world, map = w.map, [x0,z0,x1,z1] = map.manifest.bounds;
    return events.filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lon)).map(event => {
      const p = projectLocation(event.lat,event.lon,map.manifest.frame);
      return { event, ...p, distance: Math.hypot(p.x-w.foot.x,p.z-w.foot.z) };
    }).filter(p => p.x > x0+30 && p.x < x1-30 && p.z > z0+30 && p.z < z1-30)
      .sort((a,b) => a.distance-b.distance)[0];
  });
  assert(target, 'No real event inside the playable map');
  report.target = { id: target.event.id, lat: target.event.lat, lon: target.event.lon, title: target.event.title };
  await page.goto(`${base}/?at=${target.event.lat},${target.event.lon}`);
  await page.waitForFunction(() => window.__gtasf?.ready, undefined, { timeout: 30000 });
  await page.locator('.gt-event-card:not([hidden])').waitFor({ state: 'visible', timeout: 15000 });
  const title = await page.locator('.gt-event-title').innerText();
  const url = await page.locator('.gt-event-link').getAttribute('href');
  assert(url?.startsWith('https://www.tech-week.com/'));
  const events = (await (await page.request.get(`${base}/api/events`)).json()).events;
  const source = events.find(event => event.title === title && event.url === url);
  assert(source, 'Card must correspond to a real source event');
  if (source.approx) await page.locator('.gt-event-approx').waitFor({ state: 'visible' });
  const before = await page.locator('#world').evaluate(canvas => ({ ...canvas.dataset }));
  await page.keyboard.down('KeyW'); await page.waitForTimeout(250); await page.keyboard.up('KeyW');
  const after = await page.locator('#world').evaluate(canvas => ({ ...canvas.dataset }));
  assert.equal(after.x,before.x); assert.equal(after.z,before.z);
  await page.screenshot({ path: `${out}/event-card.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/phone-card.png` });
  const layout = await page.evaluate(() => {
    const hud = document.querySelector('.gt-hud').getBoundingClientRect(), card = document.querySelector('.gt-event-card').getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > innerWidth, hudInBounds: hud.left >= 0 && hud.right <= innerWidth && hud.bottom <= innerHeight,
      cardInBounds: card.left >= 0 && card.right <= innerWidth && card.top >= 0 && card.bottom <= innerHeight };
  });
  assert.deepEqual(layout,{ overflow:false,hudInBounds:true,cardInBounds:true });
  await page.getByRole('button',{name:'Close event details',exact:true}).click();
  await page.locator('.gt-event-card').waitFor({ state:'hidden' });
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.gt-event-card').isVisible(),false,'Card must not immediately reopen while still in marker');
  assert.deepEqual(report.errors,[]);
  report.passed = true; report.card = { title,url,approx:source.approx }; report.layout = layout;
  console.log('TEST_PASSED:HudAndRealEventMarker');
} catch (error) { report.failure = String(error); throw error; }
finally { await writeFile(`${out}/evidence.json`,JSON.stringify(report,null,2)+'\n'); await browser.close(); }
