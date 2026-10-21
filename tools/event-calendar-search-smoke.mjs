/** Real event-view DOM and the committed 1,596-event public calendar; no World/API writes. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import { chromium } from '@playwright/test';

const out = resolve('artifacts/event-calendar-search');
await mkdir(out, { recursive: true });
await writeFile(`${out}/index.html`, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#264236"><script type="module" src="/entry.js"></script></body></html>');
await writeFile(`${out}/entry.js`, `
import {createUpcomingEvents} from '${resolve('web/src/events/upcoming.ts')}';
import {matchesPeriod,upcomingEvents} from '${resolve('web/src/events/schedule.ts')}';
import calendar from '${resolve('worker/src/events/data/sf-tech-week.json')}';
const now=Date.parse('2026-10-05T17:00:00Z'),events=calendar.events;
const schedule=[];
for(const query of ['', 'investor', 'north beach']){
  const start=performance.now();
  const counts=['live','today','tomorrow','week'].map(period=>events.filter(event=>matchesPeriod(event,period,now)).length);
  const selected=upcomingEvents(events,'week',query,now);
  schedule.push({query,events:events.length,counts,matches:selected.length,scheduleMs:performance.now()-start});
}
const view=createUpcomingEvents({enabled:true,frame:{origin:{lat:37.79,lon:-122.4},gridRotationDeg:0},now:()=>now,onSelect:()=>false,onHail:()=>false});
view.setEvents(events);view.toggle(true);
let inputStart=0;
const inputs=[];
document.addEventListener('input',()=>{inputStart=performance.now();},true);
document.addEventListener('input',event=>inputs.push({query:event.target.value,synchronousInputMs:performance.now()-inputStart}));
window.fixture={view,inspect:()=>({schedule,inputs})};
`);
const config = { configFile: false, root: out, logLevel: 'warn', resolve: { alias: { '@gtasf/shared': resolve('shared') } }, build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
const report = { checkedAt: new Date().toISOString(), errors: [], checks: [] };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => !!window.fixture);
  const search = page.getByRole('searchbox', { name: 'Search upcoming events' }), rows = page.locator('.gt-upcoming-row');
  const status = page.locator('.gt-upcoming-status');
  assert.equal(await rows.count(), 50); assert.match(await status.innerText(), /^1596 events/);
  for (const name of ['Live now (35)', 'Today (189)', 'Tomorrow (379)', 'Tech Week (1596)']) assert.equal(await page.getByRole('tab', { name, exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Show more events' }).click(); assert.equal(await rows.count(), 100);
  for (const [query, count] of [['investor', 77], ['north beach', 19]]) {
    await search.fill(''); await search.pressSequentially(query, { delay: 5 });
    assert.equal(await search.inputValue(), query);
    assert.equal(await search.evaluate(element => element === document.activeElement), true);
    assert.equal(await rows.count(), Math.min(50, count));
    assert.match(await status.innerText(), new RegExp('^' + count + ' events'));
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${out}/full-calendar-phone.png` });
  await search.fill(''); assert.equal(await rows.count(), 50);
  await page.getByRole('tab', { name: 'Live now (35)', exact: true }).click(); assert.equal(await rows.count(), 35);
  await page.getByRole('tab', { name: 'Tech Week (1596)', exact: true }).click(); assert.equal(await rows.count(), 50);
  report.checks.push('Full public calendar, SF date counts, physical search typing, stable input focus, pagination reset and live tab');
  report.measurements = await page.evaluate(() => window.fixture.inspect());
  assert.deepEqual(report.measurements.schedule.map(value => [value.counts, value.matches]), [
    [[35, 189, 379, 1596], 1596], [[35, 189, 379, 1596], 77], [[35, 189, 379, 1596], 19],
  ]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${out}/full-calendar-desktop.png` });
  await page.evaluate(() => window.fixture.view.destroy());
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log('TEST_PASSED:FullCalendarKeyboardSearch');
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
}
