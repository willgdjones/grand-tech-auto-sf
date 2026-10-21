/** Run with node --import tsx. Real game/Worker; physical inputs, no pose/clock changes. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { decodeS2C } from '../shared/protocol/s2c.ts';
import { decodeC2S } from '../shared/protocol/c2s.ts';

let base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173', server;
const out = resolve(process.env.GTASF_CHAT_OUT ?? 'artifacts/chat/game'); await mkdir(out, { recursive: true });
if (process.env.GTASF_CHAT_APP) {
  server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'), build: { outDir: resolve(process.env.GTASF_CHAT_APP) },
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } }); base = server.resolvedUrls.local[0];
}
const awardCheck = process.env.GTASF_CHAT_AWARD_CHECK === '1';
const report = { at: new Date().toISOString(), scope: 'Actual two-client local game and native Worker, real controls/server time; not a production/device gate', awardCheck, errors: [], httpErrors: [], checks: [], passed: false };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const peers = [];
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
async function state(page) { return page.evaluate(() => { const w = window.__gtasf.world; return { foot: { ...w.foot }, cameraYaw: w.camera.yaw, target: w.funding.target, inside: w.funding.inside, mode: w.mode, eventCardOpen: !!document.querySelector('.gt-event-card:not([hidden])') }; }); }
async function walk(page, point, radius = 3) {
  const until = Date.now() + 35_000;
  while (Date.now() < until) {
    // A real funding award may open event details while walking. Close it as a player would.
    const details = page.getByRole('button', { name: 'Close event details', exact: true }); if (await details.isVisible()) await details.click();
    const s = await state(page), distance = Math.hypot(point.x - s.foot.x, point.z - s.foot.z); if (distance <= radius) return;
    const delta = angle(Math.atan2(point.x - s.foot.x, point.z - s.foot.z) + Math.PI - s.cameraYaw);
    if (Math.abs(delta) > .10) { const key = delta > 0 ? 'ArrowLeft' : 'ArrowRight'; await page.keyboard.down(key); await page.waitForTimeout(Math.max(35, Math.min(500, Math.abs(delta) / 1.68 * 850))); await page.keyboard.up(key); }
    else { await page.keyboard.down('KeyW'); await page.keyboard.down('Shift'); await page.waitForTimeout(Math.min(600, Math.max(70, (distance - radius) / 6 * 700))); await page.keyboard.up('Shift'); await page.keyboard.up('KeyW'); }
    await page.waitForTimeout(60);
  }
  throw new Error('Actual keyboard walk to event anchor timed out');
}
async function openChat(peer) {
  await peer.page.bringToFront();
  await peer.page.getByRole('button', { name: 'Game options', exact: true }).click();
  await peer.page.getByRole('button', { name: 'Chat · Enter', exact: true }).click();
  await peer.page.getByRole('dialog', { name: 'City chat', exact: true }).waitFor();
}
async function say(peer, text, channel = 'nearby') {
  const page = peer.page; if (!await page.locator('.gt-chat-dialog').isVisible()) await openChat(peer);
  await page.getByLabel('Chat channel', { exact: true }).selectOption(channel);
  await page.getByLabel('Your message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function received(peer, text) {
  for (let i = 0; i < 60; i++) { if (peer.messages.some(m => m.text === text)) return; await peer.page.waitForTimeout(100); }
  throw new Error(`Missing actual broadcast: ${text}`);
}
try {
  const eventsResponse = await fetch(new URL('/api/events', base)), payload = await eventsResponse.json(), events = Array.isArray(payload) ? payload : payload.events;
  const event = events.find(e => e.id === 'tech-week:f9c5d885-7f83-4a7d-b9cb-9df83f93e262'); assert.ok(event, 'Known canonical Ferry event exists'); report.event = { id: event.id, title: event.title };
  for (const phone of [false, true]) {
    const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1365, height: 900 }, hasTouch: phone, isMobile: phone });
    const page = await context.newPage(); page.setDefaultTimeout(45_000); const peer = { page, context, messages: [], membership: [], commands: [], corrections: [], id: 0, phone }; peers.push(peer);
    page.on('pageerror', error => report.errors.push(error.message)); page.on('console', msg => { if (msg.type() === 'error') report.errors.push(msg.text()); });
    page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    page.on('websocket', socket => {
      socket.on('framereceived', ({ payload }) => { if (Buffer.isBuffer(payload)) {
        const result = decodeS2C(new Uint8Array(payload)); if (!result.ok) return; const m = result.msg;
        if (m.type === 'CHAT_BROADCAST') peer.messages.push(m);
        if (m.type === 'WELCOME') peer.id = m.id; // Do not record resume credentials.
        if (m.type === 'EVENT_STATE') peer.membership.push({ ...m, at: Date.now() });
        if (m.type === 'CORRECTION') peer.corrections.push({ ...m, at: Date.now() });
      } });
      socket.on('framesent', ({ payload }) => { if (Buffer.isBuffer(payload)) { const result = decodeC2S(new Uint8Array(payload)); if (result.ok && ['EVENT_JOIN', 'EVENT_LEAVE'].includes(result.msg.type)) peer.commands.push({ ...result.msg, at: Date.now() }); } });
    });
    await page.goto(new URL(`/go/${encodeURIComponent(event.id)}`, base).href);
    await page.waitForSelector('#world[data-ready="true"][data-connected="true"]'); await page.waitForSelector('#loading', { state: 'hidden' });
    const identity = page.locator('.gt-funding-onboarding[open]'); await identity.waitFor();
    await page.getByLabel('Startup name', { exact: true }).fill(`Chat ${phone ? 'Phone' : 'Desktop'} ${Date.now().toString(36)}`);
    await page.getByLabel('Your nickname', { exact: true }).fill(phone ? 'Chat Phone' : 'Chat Desktop');
    await identity.getByRole('button', { name: 'Save startup', exact: true }).click(); await identity.waitFor({ state: 'hidden' });
    if ((await state(page)).target?.eventId !== event.id) {
      await page.keyboard.press('KeyV'); await page.getByRole('tab', { name: /^(Tech Week|This week)/ }).click();
      await page.getByRole('searchbox', { name: 'Search upcoming events' }).fill(event.title);
      await page.locator(`[data-event-id="${event.id}"]`).getByRole('button', { name: /^Set destination:/ }).click();
    }
    await page.waitForFunction(id => window.__gtasf.world.funding.target?.eventId === id, event.id);
    await walk(page, (await state(page)).target.anchor);
    await page.waitForFunction(() => window.__gtasf.world.funding.inside);
    await openChat(peer); await page.waitForFunction(() => !document.querySelector('.gt-chat-dialog option[value="event"]').disabled);
    assert.equal(await page.locator('.gt-chat-dialog').evaluate(el => {
      const r = el.getBoundingClientRect(), header = el.querySelector('header').getBoundingClientRect(), button = el.querySelector('header button'), b = button.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && el.scrollWidth <= el.clientWidth && header.left >= r.left && header.right <= r.right && button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
    }), true, 'Chat fits viewport and Close receives pointer events');
    const before = (await state(page)).foot; await page.keyboard.down('KeyW'); await page.waitForTimeout(180); await page.keyboard.up('KeyW');
    const after = (await state(page)).foot; assert.ok(Math.hypot(before.x - after.x, before.z - after.z) < .03, 'Chat holds world movement');
    if (awardCheck && !phone) {
      const beforeCents = await page.evaluate(() => window.__gtasf.world.funding.profile.totalCents);
      assert.equal(beforeCents, '0', 'Fresh identity has not earned this real-time award yet');
      const draft = 'Keep this draft while I close the round';
      const composer = page.getByLabel('Your message', { exact: true }); await composer.fill(draft);
      await page.waitForFunction(before => BigInt(window.__gtasf.world.funding.profile.totalCents) > BigInt(before), beforeCents, { timeout: 35_000 });
      // Let the actual funding animation settle; never advance the server or animation clock.
      await page.waitForTimeout(1000);
      assert.equal(await page.getByRole('dialog', { name: 'City chat', exact: true }).isVisible(), true, 'Award preserves the open chat');
      assert.equal(await composer.inputValue(), draft, 'Award preserves the unsent draft');
      assert.equal(await composer.evaluate(el => document.activeElement === el), true, 'Award preserves keyboard focus');
      assert.equal((await state(page)).eventCardOpen, false, 'Award does not replace chat with event details');
      const afterCents = await page.evaluate(() => window.__gtasf.world.funding.profile.totalCents), displayed = await page.locator('.gt-hud-money-value').textContent();
      assert.equal(BigInt(displayed.replace(/\D/g, '')), BigInt(afterCents) / 100n, 'Visible funding counter reaches the awarded total');
      report.award = { beforeCents, afterCents, displayed, draftPreserved: true, focusPreserved: true };
      await page.screenshot({ path: `${out}/desktop-award-chat.png` }); await composer.fill('');
    }
    await page.getByRole('dialog', { name: 'City chat', exact: true }).getByRole('button', { name: 'Close ×', exact: true }).click();
    console.log(`CHAT_PEER_READY:${phone ? 'phone' : 'desktop'}`);
  }
  const [a, b] = peers; await a.page.bringToFront(); await a.page.waitForTimeout(2200);
  await say(a, 'Hello from the Ferry'); await received(b, 'Hello from the Ferry');
  assert.equal(b.messages.at(-1).eventId, 0);
  assert.equal(b.messages.find(m => m.text === 'Hello from the Ferry').name, 'Chat Desktop', 'Broadcast uses the saved desktop nickname');
  await b.page.bringToFront(); await b.page.waitForSelector('.gt-chat-bubble:not([hidden])'); await b.page.waitForTimeout(100);
  report.phoneBubble = await b.page.locator('.gt-chat-bubble').filter({ hasText: 'Hello from the Ferry' }).evaluate(el => {
    const r = el.getBoundingClientRect();
    const hud = [...document.querySelectorAll('.gt-funding-room,.gt-gps-status,#app>footer,.gt-radar:not([data-expanded=true]),.gtasf-touch .buttons,.gtasf-touch .stick,.gtasf-touch .ride-hint')].flatMap(el => {
      const s = getComputedStyle(el), b = el.getBoundingClientRect();
      return s.visibility === 'visible' && b.width > 0 && b.height > 0 ? [{ name: el.className || el.tagName, left: b.left, top: b.top, right: b.right, bottom: b.bottom }] : [];
    });
    return { visible: getComputedStyle(el).visibility === 'visible', left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight, hud, overlaps: hud.filter(b => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top).map(b => b.name) };
  });
  await b.page.screenshot({ path: `${out}/phone-bubble.png` });
  assert.ok(report.phoneBubble.visible && report.phoneBubble.left >= 7 && report.phoneBubble.top >= 7 && report.phoneBubble.right <= report.phoneBubble.width - 7 && report.phoneBubble.bottom <= report.phoneBubble.height - 7, 'Actual phone bubble remains visible inside the viewport');
  assert.deepEqual(report.phoneBubble.overlaps, [], 'Actual phone bubble stays clear of the funding notice, radar and touch controls');
  await say(b, 'Hello from my phone'); await received(a, 'Hello from my phone');
  assert.equal(a.messages.find(m => m.text === 'Hello from my phone').name, 'Chat Phone', 'Broadcast uses the saved phone nickname');
  await a.page.bringToFront(); await a.page.waitForTimeout(2200); await say(a, 'sh1t'); await a.page.waitForTimeout(600);
  assert.ok(!a.messages.some(m => m.text === 'sh1t') && !b.messages.some(m => m.text === 'sh1t'), 'Local wordlist drops evasion with no TypeSafe key');
  await a.page.waitForTimeout(1800); await say(a, 'See you at this event', 'event'); await received(b, 'See you at this event'); assert.notEqual(b.messages.at(-1).eventId, 0);
  await a.page.screenshot({ path: `${out}/desktop-event-chat.png` });
  await b.page.bringToFront(); await b.page.getByLabel('Chat channel', { exact: true }).selectOption('event'); await b.page.screenshot({ path: `${out}/phone-event-chat.png` });
  await b.page.keyboard.press('Escape'); await b.page.locator('.gt-chat-dialog').waitFor({ state: 'hidden' });
  await b.page.waitForFunction(() => !!window.__gtasf.world.funding.target?.anchor);
  const beforeExit = await state(b.page), anchor = beforeExit.target.anchor;
  const exit = await b.page.evaluate(anchor => { const ferry = window.__gtasf.world.landmarks.children.find(o => o.userData.landmarkId === 'ferry-building'); const dx = anchor.x - ferry.position.x, dz = anchor.z - ferry.position.z, length = Math.hypot(dx, dz); return { x: anchor.x + dx / length * 18, z: anchor.z + dz / length * 18 }; }, anchor);
  await walk(b.page, exit, 1);
  await b.page.waitForFunction(anchor => { const w = window.__gtasf.world; return Math.hypot(w.foot.x - anchor.x, w.foot.z - anchor.z) > 12 && !w.funding.inside; }, anchor);
  const roomId = b.messages.find(message => message.text === 'See you at this event').eventId;
  for (let i = 0; i < 40 && b.membership.filter(m => m.playerId === b.id && m.eventId === roomId).at(-1)?.present !== false; i++) await b.page.waitForTimeout(100);
  assert.equal(b.membership.filter(m => m.playerId === b.id && m.eventId === roomId).at(-1)?.present, false, 'Server confirms physical event departure');
  report.departure = { before: beforeExit, after: await state(b.page), anchor, server: b.membership.filter(m => m.playerId === b.id && m.eventId === roomId).at(-1) };
  await a.page.bringToFront(); await a.page.waitForTimeout(2200); await say(a, 'Only the room hears this', 'event'); await received(a, 'Only the room hears this'); await a.page.waitForTimeout(500);
  assert.ok(!b.messages.some(m => m.text === 'Only the room hears this'), 'Departed player hears no event messages');
  report.checks.push('Actual desktop/390px touch-capable peers at canonical source event, real input walking and server room confirmation, bidirectional proximity/overhead bubble, local filter, event chat and leave exclusion, modal input/Close/Escape and bounds');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []); report.passed = true; console.log('TEST_PASSED:ChatGame');
} catch (error) { report.failure = String(error); for (const [i, peer] of peers.entries()) await peer.page.screenshot({ path: `${out}/failed-${i}.png` }).catch(() => {}); throw error;
} finally { report.peers = await Promise.all(peers.map(async peer => ({ phone: peer.phone, id: peer.id, state: await state(peer.page).catch(() => null), membership: peer.membership, commands: peer.commands, corrections: peer.corrections, messages: peer.messages }))); await browser.close(); if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); } report.finishedAt = new Date().toISOString(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
