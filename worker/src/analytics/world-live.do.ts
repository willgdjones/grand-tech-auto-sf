/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, expect, test, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects } from 'cloudflare:test';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import type { AnalyticsContext } from '@gtasf/shared/analytics';
import type { C2SMessage, S2CMessage } from '@gtasf/shared/protocol/types';
import type { Env } from '../env';
const bindings = env as unknown as Env, sockets: WebSocket[] = [];
afterEach(async () => { for (const socket of sockets.splice(0)) try { socket.close(); } catch {} await abortAllDurableObjects(); vi.restoreAllMocks(); });

test('only accepted consented joins convert; late consent and reconnect retain exact conversion UUID', async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(null, { status: 200 });
  });
  const id = bindings.WORLD.idFromName('analytics-native-smoke');
  let world = bindings.WORLD.get(id);
  const context: AnalyticsContext = { permitted: true, distinctId: crypto.randomUUID(), playConversionId: crypto.randomUUID(), attribution: { twclid: 'click_fixture' } };
  async function open(name: string, analytics?: AnalyticsContext, resumeToken?: string, dnt = false) {
    const response = await world.fetch('https://world.internal/api/world', { headers: {
      Upgrade: 'websocket', 'Sec-WebSocket-Protocol': PROTOCOL_SUBPROTOCOL,
      'cf-connecting-ip': '192.0.2.10', 'user-agent': 'Native analytics smoke', ...(dnt ? { dnt: '1' } : {}),
    } });
    expect(response.status).toBe(101);
    const socket = response.webSocket!; socket.binaryType = 'arraybuffer'; socket.accept(); sockets.push(socket);
    const messages: S2CMessage[] = []; let closed = false;
    socket.addEventListener('close', () => { closed = true; });
    socket.addEventListener('message', event => { if (typeof event.data !== 'string') { const result = decodeS2C(new Uint8Array(event.data)); if (result.ok) messages.push(result.msg); } });
    const send = (message: C2SMessage) => socket.send(encodeC2S(message));
    send({ type: 'HELLO', name, ...(analytics ? { analytics } : {}), ...(resumeToken ? { resumeToken } : {}) });
    if (!name) { await expect.poll(() => closed).toBe(true); return { socket, send, token: '' }; }
    await expect.poll(() => messages.some(message => message.type === 'WELCOME')).toBe(true);
    const welcome = messages.find(message => message.type === 'WELCOME')! as Extract<S2CMessage, { type: 'WELCOME' }>;
    const barrier = async () => { const nonce = messages.length; send({ type: 'PING', nonce, clientT: 0 }); await expect.poll(() => messages.some(message => message.type === 'PONG' && message.nonce === nonce)).toBe(true); };
    return { socket, send, token: welcome.resumeToken, barrier };
  }
  await open('', context); expect(requests).toHaveLength(0);
  const legacy = await open('Legacy'); expect(requests).toHaveLength(0);
  legacy.send({ type: 'ANALYTICS', analytics: context });
  await expect.poll(() => requests.length).toBe(2);
  const x = requests.find(request => request.url.includes('ads-api.x.com'))!;
  expect(x.body).toMatchObject({ conversions: [{ event_id: 'tw-rgc75-rgc7f', conversion_id: context.playConversionId, identifiers: [{ twclid: 'click_fixture' }] }] });
  legacy.send({ type: 'ANALYTICS', analytics: context });
  legacy.send({ type: 'ANALYTICS', analytics: { ...context, playConversionId: crypto.randomUUID() } });
  await legacy.barrier!(); expect(requests).toHaveLength(2);
  legacy.socket.close(); await abortAllDurableObjects(); world = bindings.WORLD.get(id);
  const resumed = await open('Legacy', context, legacy.token);
  await resumed.barrier!(); expect(requests).toHaveLength(2);
  await open('Opted out', { ...context, playConversionId: crypto.randomUUID() }, undefined, true);
  expect(requests).toHaveLength(2);
  const fallback = { ...context, playConversionId: crypto.randomUUID(), attribution: {} };
  const newcomer = await open('New player', fallback);
  await newcomer.barrier!(); await expect.poll(() => requests.length).toBe(3);
  expect(requests.at(-1)!.body).toMatchObject({ event: 'play_start', uuid: fallback.playConversionId });
  expect(JSON.stringify(requests)).not.toMatch(/ip_address|user_agent|hashed_email|192\.0\.2/);
});
