/** Disposable native D1/SQLite scenario. Never imported by the production Worker. */
import { WorldChat, type ChatPeer } from './world';
import { locallyApproved, moderateChat } from './moderation';
import { chatEventId } from '@gtasf/shared/chat/constants';
import { normalizeEvent } from '../../events/normalize';
import { storeEvents } from '../../events/store';
import { fundingAnchor } from '../../funding/anchors';
import type { S2CMessage } from '@gtasf/shared/protocol/types';

function check(ok: unknown, why: string): asserts ok { if (!ok) throw new Error(why); }
export class ChatSmoke {
  constructor(private readonly ctx: DurableObjectState, private readonly env: { DB: D1Database }) {}
  async fetch(): Promise<Response> {
    const checks: string[] = [];
    for (const value of ['Hello San Francisco!', 'Scunthorpe classic meetup', 'Café 👩🏽‍💻 — 你好', 'Meet me by the ferry']) check(locallyApproved(value) === value, `Benign text rejected: ${value}`);
    for (const value of ['f.u.c.k', 'sh1t', 'b i t c h', 'kill yourself', 'go die', '\u202e', 'x'.repeat(161)]) check(locallyApproved(value) === null, `Unsafe/invalid text accepted: ${value}`);
    let calls = 0;
    const noProvider = (async () => { calls++; throw new Error('No provider allowed'); }) as typeof fetch;
    check(await moderateChat('Hello friends', undefined, noProvider) === 'Hello friends' && calls === 0, 'No-key local moderation called a provider');
    const provider = (probability: number) => (async () => { calls++; return Response.json({ answers: { acceptable: { type: 'noul', noul: probability } } }); }) as typeof fetch;
    check(await moderateChat('Hello friends', 'fixture-only', provider(.99)) === 'Hello friends', 'Configured approval rejected');
    check(await moderateChat('Hello friends', 'fixture-only', provider(.94)) === null, 'Configured rejection accepted');
    check(await moderateChat('sh1t', 'fixture-only', noProvider) === null && Number(calls) === 2, 'Local rejection reached provider');
    check(await moderateChat('Hello friends', 'fixture-only', noProvider) === null, 'Provider failure accepted');
    checks.push('Unicode/bounded local filter, benign word boundaries, punctuation/leet evasions, zero no-key requests, optional Jev approval/rejection/failure');

    const event = normalizeEvent({ title: 'Fixture founders at the Ferry', start: '2026-10-05T16:00:00Z', end: '2026-10-05T18:00:00Z', lat: 37.7955, lon: -122.3937, url: 'https://lu.ma/gtasf-chat-fixture', source: 'luma' });
    check(event, 'Invalid event fixture'); await storeEvents(this.env.DB, [event], '2026-10-03T08:00:00Z');
    const anchor = fundingAnchor(event); check(anchor, 'No source-lane event anchor'); const room = chatEventId(event.id);
    const peers = new Map<number, ChatPeer>(), inbox = new Map<number, S2CMessage[]>();
    function make(id: number, offset: number, onFoot = true) {
      inbox.set(id, []);
      const peer: ChatPeer = { id, generation: 1, name: `Player ${id}`, deviceId: `fixture-device-${id}`, onFoot,
        pose: { x: Math.round((anchor!.x + offset) * 100), y: Math.round(anchor!.y * 100), z: Math.round(anchor!.z * 100), yaw: 0, flags: 0 },
        send: message => inbox.get(id)!.push(message) };
      peers.set(id, peer); return peer;
    }
    const a = make(1, 0), b = make(2, 3), far = make(3, 50), driver = make(4, 1, false);
    let chat = new WorldChat(this.ctx.storage, this.env, () => peers.values());
    let now = Date.now(), serial = 0;
    const message = (text: string, eventId = 0) => ({ type: 'CHAT' as const, text, eventId, clientMsgId: ++serial });
    const count = (id: number) => inbox.get(id)!.filter(m => m.type === 'CHAT_BROADCAST').length;
    const say = async (peer: ChatPeer, text: string, eventId = 0) => { now += 2100; await chat.handle(peer, message(text, eventId), now); };
    await say(a, 'Hello nearby'); check(count(1) === 1 && count(2) === 1 && count(3) === 0, 'Proximity leakage/missing delivery');
    await say(a, 'sh1t'); check(count(1) === 1 && count(2) === 1, 'Blocked word broadcast');
    await chat.handle(far, { type: 'EVENT_JOIN', eventId: room }, now);
    await chat.handle(driver, { type: 'EVENT_JOIN', eventId: room }, now);
    check(!inbox.get(3)!.some(m => m.type === 'EVENT_STATE' && m.present) && !inbox.get(4)!.some(m => m.type === 'EVENT_STATE' && m.present), 'Far/vehicle joined event');
    await chat.handle(a, { type: 'EVENT_JOIN', eventId: room }, now);
    await chat.handle(b, { type: 'EVENT_JOIN', eventId: room }, now);
    check(inbox.get(1)!.some(m => m.type === 'EVENT_STATE' && m.playerId === 2 && m.present), 'Missing room presence');
    await say(a, 'Hello event', room); check(count(1) === 2 && count(2) === 2 && count(3) === 0 && count(4) === 1, 'Event delivery leaked');
    b.pose.x += 1200; chat.presenceChanged(b.id);
    await say(a, 'Still at event', room); check(count(2) === 2, 'Player outside room still hears chat');
    await say(b, 'Spoof room', room); check(count(1) === 3, 'Unjoined sender injected room chat');
    chat = new WorldChat(this.ctx.storage, this.env, () => peers.values());
    await say(a, 'After hibernation', room); check(count(1) === 4, 'Valid room membership lost on rehydrate');
    checks.push('Authoritative 40m proximity; D1 room lookup; on-foot/source-anchor joins; leave pruning; no outside sender/recipient; SQLite room rehydrate');

    now += 10_000; const replay = message('Only once'); await chat.handle(a, replay, now);
    const before = count(1); chat = new WorldChat(this.ctx.storage, this.env, () => peers.values());
    await chat.handle(a, replay, now + 10_000); check(count(1) === before, 'Replay delivered after rehydrate');
    now += 20_000; const burstBefore = count(1);
    for (let i = 0; i < 5; i++) await chat.handle(a, message('Bounded burst'), now);
    check(count(1) === burstBefore + 3, 'Rate limit failed');
    const last = inbox.get(1)!.filter(m => m.type === 'CHAT_BROADCAST').at(-1)!;
    check(last.type === 'CHAT_BROADCAST' && last.messageId === count(1), 'Durable message sequence not unique');
    let resolve!: (value: string | null) => void;
    chat = new WorldChat(this.ctx.storage, this.env, () => peers.values(), () => new Promise(done => { resolve = done; }));
    now += 10_000;
    const old = { ...a, pose: { ...a.pose } }; const pending2 = chat.handle(old, message('Old generation'), now);
    peers.set(a.id, { ...a, generation: a.generation + 1 }); resolve('Old generation'); await pending2;
    check(count(1) === burstBefore + 3, 'Replaced socket accepted stale moderation result');
    checks.push('Durable replay dedup, three-message burst/rate recovery, monotonic IDs, async old-generation rejection');
    return Response.json({ passed: true, scope: 'Isolated native D1/SQLite; optional provider responses are fixtures', checks });
  }
}
export default { fetch(request: Request, env: { CHAT: DurableObjectNamespace }) { return env.CHAT.get(env.CHAT.idFromName('smoke')).fetch(request); } };
