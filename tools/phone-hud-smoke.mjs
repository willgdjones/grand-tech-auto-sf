/** Compact HUD acceptance in the native game. Physical inputs; read-only state inspection. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const out = process.env.GTASF_PHONE_HUD_OUT ?? 'artifacts/phone-hud';
await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), errors: [], httpErrors: [], steps: [], passed: false };
let browser, server, page;
let base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const state = () => page.evaluate(() => {
  const world = window.__gtasf.world;
  const selectors = ['.gt-outbid-banner', '#app>aside', '#movement-mode', '.gt-hud', '.gt-upcoming-open',
    '.gt-street-hud', '.gt-radar', '.gt-gps-status', '.gtasf-touch .stick', '.gtasf-touch .buttons'];
  const boxes = Object.fromEntries(selectors.map(selector => {
    const element = document.querySelector(selector);
    const box = element?.getBoundingClientRect();
    return [selector, box && element.checkVisibility({ visibilityProperty: true }) ? { x: box.x, y: box.y, width: box.width, height: box.height } : null];
  }));
  return { mode: world.mode, foot: { ...world.foot }, speed: Number(document.querySelector('#world').dataset.speed),
    connected: document.querySelector('#world').dataset.connected, mapErrors: [...world.map.stats.errors], boxes,
    focused: document.activeElement?.id, phone: document.body.classList.contains('gt-phone-hud') };
});
const overlap = (a, b) => a && b && Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)+1 && Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y)+1;
async function record(name, checkLayout = false) {
  const data = await state(); report.steps.push({ name, at: new Date().toISOString(), data });
  assert.equal(data.connected, 'true'); assert.deepEqual(data.mapErrors, []);
  if (checkLayout) {
    const boxes = Object.entries(data.boxes).filter(([, box]) => box);
    for (const [name, box] of boxes) {
      assert.ok(box.x >= -1 && box.x+box.width <= 391, `${name} fits phone width`);
      assert.ok(box.y >= -1 && box.y+box.height <= 845, `${name} fits phone height`);
    }
    for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++)
      assert.ok(!overlap(boxes[i][1], boxes[j][1]), `${boxes[i][0]} overlaps ${boxes[j][0]}`);
  }
  await page.screenshot({ path: `${out}/${name}.png` });
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)+'\n');
  console.log(`PHONE_HUD_STEP:${name}`); return data;
}
async function options() {
  await page.locator('#movement-mode').tap();
  const panel = page.getByRole('dialog', { name: 'Game options', exact: true });
  await panel.waitFor(); return panel;
}
async function menuPanel(selector, panelSelector) {
  const menu = await options(); await menu.locator(selector).tap();
  const panel = page.locator(panelSelector); await panel.waitFor();
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('dialog[open]').count(), 1);
  await panel.getByRole('button', { name: /^Close/ }).tap();
  await panel.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.id === 'movement-mode');
  report.steps.push({ name: `menu-${selector}`, at: new Date().toISOString() });
}
try {
  if (process.env.GTASF_PHONE_HUD_APP) {
    server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'),
      build: { outDir: resolve(process.env.GTASF_PHONE_HUD_APP) }, preview: { host: '127.0.0.1', port: 0 } });
    base = server.resolvedUrls.local[0];
  }
  assert.equal((await fetch(new URL('/api/health', base))).status, 200);
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  page = await context.newPage(); page.setDefaultTimeout(20_000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.goto(new URL('/?at=37.80199520213967,-122.41963019831591,87.8&touch=1', base).href);
  await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');
  await page.locator('#loading').waitFor({ state: 'hidden' });
  const identity = page.locator('.gt-funding-onboarding[open]'); await identity.waitFor();
  await page.getByLabel('Startup name', { exact: true }).fill(`Phone HUD ${Date.now().toString(36)}`);
  await page.getByLabel('Your nickname', { exact: true }).fill('Phone Founder');
  await identity.getByRole('button', { name: 'Save startup', exact: true }).tap();
  await identity.waitFor({ state: 'hidden' });
  await record('phone-idle', true);

  let menu = await options();
  for (const selector of ['#enter-exit', '#hail', '#map-toggle', '#destination-lombard', '#destination-ferry',
    '.gt-funding-open', '.gt-funding-identity', '.gt-funding-perks-open', '#share-location', '.gt-referral-launch', '.gt-outbid-board-button'])
    assert.equal(await menu.locator(selector).count(), 1, `Retained ${selector} in options`);
  await record('phone-actions');
  await menu.getByRole('button', { name: 'Close ×', exact: true }).tap();
  await menuPanel('.gt-funding-identity', '.gt-funding-onboarding[open]');
  await menuPanel('.gt-funding-open', '.gt-funding-dialog[open]');
  await menuPanel('.gt-referral-launch', '.gt-referral-panel[open]');
  await menuPanel('.gt-outbid-board-button', '.gt-outbid-dialog[open]');
  menu = await options();
  await menu.getByRole('button', { name: 'Play radio', exact: true }).tap();
  await page.waitForFunction(() => document.querySelector('.gt-radio-status')?.textContent?.startsWith('Playing'));
  await menu.getByRole('button', { name: 'Close ×', exact: true }).tap();
  await record('phone-radio', true);
  menu = await options();
  await menu.getByRole('button', { name: 'Pause radio', exact: true }).tap();
  await menu.getByRole('button', { name: 'Close ×', exact: true }).tap();
  menu = await options(); await menu.locator('#map-toggle').tap();
  await page.locator('.gt-radar[data-expanded="true"]').waitFor();
  await page.getByRole('button', { name: 'Close event map', exact: true }).tap();
  // The spawn is already within Lombard's arrival radius; choose a genuinely distant target.
  menu = await options(); await menu.locator('#destination-ferry').tap();
  await menu.waitFor({ state: 'hidden' }); await page.locator('.gt-gps-status').waitFor();
  assert.match(await page.locator('.gt-gps-status').innerText(), /Ferry/);
  await record('phone-navigation', true);

  // Enter through the moved original toolbar action and drive through the touch controls.
  menu = await options(); await menu.locator('#enter-exit').tap();
  await page.waitForSelector('#world[data-mode="driver"]');
  const go = page.getByRole('button', { name: 'Go', exact: true });
  const b = await go.boundingBox(); assert.ok(b);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart',touchPoints:[{ x:b.x+b.width/2,y:b.y+b.height/2,id:1 }] });
  await page.waitForFunction(() => Number(document.querySelector('#world').dataset.speed)>1);
  await record('phone-driving', true);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchCancel',touchPoints:[] });
  const brake = await page.getByRole('button', { name:'H-brake',exact:true }).boundingBox(); assert.ok(brake);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart',touchPoints:[{ x:brake.x+brake.width/2,y:brake.y+brake.height/2,id:1 }] });
  await page.waitForFunction(() => Number(document.querySelector('#world').dataset.speed)===0);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchCancel',touchPoints:[] });
  await page.getByRole('button', { name:'Enter / exit',exact:true }).tap();
  await page.waitForSelector('#world[data-mode="on-foot"]');
  const before = (await state()).foot;
  await page.keyboard.down('KeyW'); await page.waitForTimeout(550); await page.keyboard.up('KeyW');
  const after = await record('phone-walking', true);
  assert.ok(Math.hypot(after.foot.x-before.x,after.foot.z-before.z)>.4, 'Walking resumes after panels');

  await page.setViewportSize({ width:1365,height:900 });
  await page.waitForFunction(() => !document.body.classList.contains('gt-phone-hud'));
  assert.equal(await page.locator('#play-controls #destination-lombard').count(),1);
  assert.equal(await page.locator('.gt-hud .gt-funding-controls').count(),1);
  assert.equal(await page.locator('.gt-outbid-banner > .gt-outbid-board-button').count(),1);
  await record('desktop-restored');
  assert.deepEqual(report.errors,[]); assert.deepEqual(report.httpErrors,[]); report.passed=true;
} catch(error) {
  report.failure=error.stack??String(error); report.failedState=await state().catch(()=>null);
  process.exitCode=1; console.error(report.failure);
  await page?.screenshot({path:`${out}/failed.png`}).catch(()=>{});
} finally {
  report.finishedAt=new Date().toISOString();
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');
  await browser?.close();
  if(server){server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));}
  console.log(`PHONE_HUD_REPORT:${out}/report.json`);
}
