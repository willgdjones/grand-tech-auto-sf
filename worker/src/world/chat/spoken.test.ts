import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { S2CMessage } from '@gtasf/shared/protocol/types';
import { WorldChat, type ChatPeer } from './world';

// Minimal Durable Object SQL storage over node:sqlite (exec + toArray, transactionSync).
function storage() {
  const db = new DatabaseSync(':memory:');
  return { sql: { exec<T>(query: string, ...bindings: unknown[]) {
    if (!bindings.length && query.trim().split(';').filter(part => part.trim()).length > 1) { db.exec(query); return { toArray: () => [] as T[] }; }
    const rows = query.trim().toUpperCase().startsWith('SELECT') ? db.prepare(query).all(...bindings as never[]) : (db.prepare(query).run(...bindings as never[]), []);
    return { toArray: () => rows as T[] };
  } }, transactionSync<T>(fn: () => T) { return fn(); } } as never;
}
function peer(id: number, x: number, inbox: S2CMessage[], spokenBubbles = true): ChatPeer {
  return { id, generation: 1, name: `P${id}`, pose: { x: x * 100, y: 0, z: 0, yaw: 0, flags: 0 } as never, onFoot: true, deviceId: `d${id}`, spokenBubbles, send: m => inbox.push(m) };
}

describe('spoken bubbles (WorldChat.spoken)', () => {
  it('broadcasts an approved transcript as a spoken CHAT_BROADCAST to chat range only, and refuses a rejected one', async () => {
    const near: S2CMessage[] = [], far: S2CMessage[] = [], me: S2CMessage[] = [], legacy: S2CMessage[] = [];
    const peers = [peer(1, 0, me), peer(2, 10, near), peer(3, 60, far), peer(4, 12, legacy, false)];
    const chat = new WorldChat(storage(), { DB: undefined as never, TYPESAFE_API_KEY: undefined }, () => peers,
      async text => text.includes('bad') ? null : text);
    expect(await chat.spoken(peers[0]!, 'what is up guys')).toBe('sent');
    expect(near).toHaveLength(1); expect(me).toHaveLength(1); expect(far).toHaveLength(0); // 40 m chat range
    expect(near[0]).toMatchObject({ type: 'CHAT_BROADCAST', senderId: 1, text: 'what is up guys', spoken: true, eventId: 0 });
    // An older client (no ?caps=spoken) closes its socket on CHAT_SPOKEN, so it gets the same text as plain chat.
    expect(legacy).toHaveLength(1); expect(legacy[0]).toMatchObject({ type: 'CHAT_BROADCAST', text: 'what is up guys' });
    expect('spoken' in legacy[0]!).toBe(false);
    expect(await chat.spoken(peers[0]!, 'something bad')).toBe('rejected');
    expect(near).toHaveLength(1); // nothing sent for a rejected transcript
  });
});
