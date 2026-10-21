import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startPreview } from './preview.mjs';
const preview = await startPreview();
let browser;
try {
  const health = await fetch(`${preview.url}/api/health`).then(r => r.json());
  assert.equal(health.ok, true); assert.equal(health.game, 'GTASF');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  const first = await context.newPage(), second = await context.newPage();
  const errors = [], received = [];
  for (const page of [first, second]) {
    page.on('console', m => { if (m.type() === 'error' || m.text().startsWith('WS_CLOSE')) console.error('Browser:', m.text()); });
    page.on('websocket', ws => { console.log('WebSocket', ws.url()); ws.on('socketerror', e => console.error('WS error', e)); ws.on('close', () => console.log('WS closed')); ws.on('framereceived', f => { if(typeof f.payload !== 'string' && f.payload[0] !== 0x82) console.log('WS frame', f.payload[0], f.payload.length); }); });
  }
  for (const page of [first, second]) page.on('pageerror', error => errors.push(error.message));
  second.on('websocket', socket => socket.on('framereceived', frame => {
    if (typeof frame.payload !== 'string') received.push(frame.payload);
  }));
  await context.addInitScript(() => { const Native = window.WebSocket; window.WebSocket = class extends Native { constructor(...args) { super(...args); this.addEventListener('close', event => console.log('WS_CLOSE', event.code, event.reason)); } }; });
  await first.goto(preview.url);
  await first.waitForFunction(() => document.querySelector('#world')?.dataset.ready === 'true', null, { timeout: 15_000 });
  await second.goto(preview.url);
  for (const page of [first, second]) await page.waitForFunction(() => document.querySelector('#world')?.dataset.players === '2', null, { timeout: 15_000 });
  await first.bringToFront(); await first.keyboard.down('KeyW'); await first.waitForTimeout(500); await first.keyboard.up('KeyW');
  await second.waitForTimeout(600);
  assert(received.some(bytes => bytes[0] === 0x82 && bytes.length >= 33 && bytes.readInt32LE(27) < -10), 'second browser receives first player movement');
  await mkdir('artifacts', { recursive: true });
  await first.screenshot({ path: 'artifacts/bootstrap-scene.png' });
  assert.deepEqual(errors, [], 'browser runtime errors');
  console.log(JSON.stringify({ health: health.ok, players: 2, movementReplicated: true, browserErrors: errors, screenshot: 'artifacts/bootstrap-scene.png' }));
  await context.close();
} finally { await browser?.close(); await preview.close(); }
