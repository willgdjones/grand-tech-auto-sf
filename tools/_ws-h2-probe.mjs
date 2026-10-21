// gtasf-j7wvv: does Chrome carry the world WebSocket over HTTP/2 (RFC 8441, shared with the page's other requests) or a
// dedicated HTTP/1.1 upgrade? Lane E: 0/8 drops through a Node pipe (HTTP/1.1, own connection) vs 5/14 browser-native.
// Joins prod (or GTASF_URL), logs the world-socket handshake (CDP) and the protocol of the page's API requests.
//   node tools/_ws-h2-probe.mjs
import { chromium } from '@playwright/test';
setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 180_000).unref();
const base = process.env.GTASF_URL ?? 'https://gtasf.com';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); page.setDefaultTimeout(60000);
const cdp = await page.context().newCDPSession(page); await cdp.send('Network.enable');
const sockets = [], protocols = new Map();
cdp.on('Network.webSocketCreated', e => { if (/\/api\/world/.test(e.url)) sockets.push({ id: e.requestId, url: e.url.split('?')[0] }); });
cdp.on('Network.webSocketWillSendHandshakeRequest', e => { const s = sockets.find(x => x.id === e.requestId); if (s) s.request = e.request.headers; });
cdp.on('Network.webSocketHandshakeResponseReceived', e => { const s = sockets.find(x => x.id === e.requestId); if (s) { s.status = e.response.status; s.response = e.response.headers; s.responseText = e.response.headersText?.split('\r\n')[0]; } });
cdp.on('Network.responseReceived', e => { const u = new URL(e.response.url); if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/map/')) protocols.set(e.response.protocol ?? '?', (protocols.get(e.response.protocol ?? '?') ?? 0) + 1); });
try {
  await page.goto(`${base}/?at=37.795570,-122.393900,270&preset=low&bot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 });
  await page.waitForTimeout(3000);
  for (const s of sockets) console.log(`[ws] ${s.url} status ${s.status ?? '?'} ${s.responseText ?? ''}\n  request headers: ${JSON.stringify(s.request ?? {})}\n  response headers: ${JSON.stringify(s.response ?? {})}`);
  console.log(`[http] protocol of /api + /map responses: ${JSON.stringify(Object.fromEntries(protocols))}`);
} catch (e) { console.log(`ABORTED: ${String(e.message).split('\n')[0]}`); }
await browser.close();
