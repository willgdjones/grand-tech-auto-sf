import { flags } from '@gtasf/shared/flags';
import { chatEventId, CHAT_RADIUS_M } from '@gtasf/shared/chat/constants';
import { ROOM_HEIGHT_M, ROOM_RADIUS_M } from '@gtasf/shared/funding';
import type { C2SMessage, Pose, S2CMessage } from '@gtasf/shared/protocol/types';
import type { Env } from '../../env';
import { listEvents } from '../../events/store';
import type { TechWeekEvent } from '../../events/types';
import { fundingAnchor, type FundingAnchorResolver } from '../../funding/anchors';
import { locallyApproved, moderateChat, moderateChatVerdict, SPOKEN_SHOW_AT } from './moderation';

export interface ChatPeer {
  id: number; generation: number; name: string; pose: Pose; onFoot: boolean; deviceId?: string;
  /** Client advertised ?caps=spoken (understands CHAT_SPOKEN). Others get spoken bubbles as plain chat (gtasf-6ef9). */
  spokenBubbles?: boolean;
  send(message: S2CMessage): void;
}
export type ChatCommand = Extract<C2SMessage, { type: 'CHAT' | 'EVENT_JOIN' | 'EVENT_LEAVE' }>;
type Member = { player_id: number; generation: number; event_id: number; x: number; y: number; z: number };
type ChatStorage = Pick<DurableObjectStorage, 'sql' | 'transactionSync'>;

/** Ephemeral messages; durable rate/dedup and room membership survive object hibernation. */
export class WorldChat {
  private readonly members = new Map<number, Member>();
  private readonly joining = new Map<number, object>();
  private readonly pending = new Set<string>();
  private events: Map<number, TechWeekEvent | null> | undefined;
  private eventsAt = 0;
  private eventLoad?: Promise<void>;
  private readonly anchors = new Map<string, ReturnType<typeof fundingAnchor>>();
  private sweptAt = 0;
  constructor(private readonly storage: ChatStorage, private readonly env: Pick<Env, 'DB' | 'TYPESAFE_API_KEY'>,
    private readonly peers: () => Iterable<ChatPeer>, private readonly moderate = moderateChat,
    private readonly anchorForEvent: FundingAnchorResolver = fundingAnchor,
    // Zoned world only: fan an accepted broadcast out to the sender's border-neighbour cells so
    // listeners across a cell boundary (within chat/event range) hear it. Unset = single-world (no-op).
    private readonly relay?: (broadcast: S2CMessage, senderPose: Pose, eventId: number) => void) {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS world_chat_members (
      player_id INTEGER PRIMARY KEY,generation INTEGER NOT NULL,event_id INTEGER NOT NULL,
      x REAL NOT NULL,y REAL NOT NULL,z REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS world_chat_budget (owner TEXT PRIMARY KEY,credit REAL NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS world_chat_seen (owner TEXT NOT NULL,client_id INTEGER NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(owner,client_id));
      CREATE INDEX IF NOT EXISTS world_chat_seen_at ON world_chat_seen(at);
      CREATE TABLE IF NOT EXISTS world_chat_sequence (id INTEGER PRIMARY KEY CHECK(id=1),value INTEGER NOT NULL)`);
    for (const member of storage.sql.exec<Member>('SELECT * FROM world_chat_members').toArray()) this.members.set(member.player_id, member);
  }
  private peer(id: number): ChatPeer | undefined { return [...this.peers()].find(peer => peer.id === id); }
  private owner(peer: ChatPeer): string { return peer.deviceId ? `device:${peer.deviceId}` : `player:${peer.id}`; }
  private inside(peer: ChatPeer, room: Pick<Member, 'x' | 'y' | 'z'>): boolean {
    return peer.onFoot && Math.hypot(peer.pose.x / 100 - room.x, peer.pose.z / 100 - room.z) <= ROOM_RADIUS_M
      && Math.abs(peer.pose.y / 100 - room.y) <= ROOM_HEIGHT_M;
  }
  /** The event room this peer is currently inside (chatEventId), or 0. Proximity voice uses it. */
  roomOf(peer: ChatPeer): number {
    const member = this.members.get(peer.id);
    return member && this.currentMember(peer, member.event_id) ? member.event_id : 0;
  }
  private currentMember(peer: ChatPeer, eventId: number): boolean {
    const member = this.members.get(peer.id);
    return Boolean(member && member.generation === peer.generation && member.event_id === eventId && this.inside(peer, member));
  }
  private takeBudget(peer: ChatPeer, now: number, clientId?: number): boolean {
    const owner = this.owner(peer);
    return this.storage.transactionSync(() => {
      if (clientId !== undefined && this.storage.sql.exec('SELECT 1 FROM world_chat_seen WHERE owner=? AND client_id=?', owner, clientId).toArray().length) return false;
      const old = this.storage.sql.exec<{ credit: number; at: number }>('SELECT credit,at FROM world_chat_budget WHERE owner=?', owner).toArray()[0];
      const credit = old ? Math.min(3, old.credit + Math.max(0, now - old.at) / 2000) : 3;
      if (credit < 1) return false;
      this.storage.sql.exec('INSERT INTO world_chat_budget VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET credit=excluded.credit,at=excluded.at', owner, credit - 1, now);
      if (clientId !== undefined) this.storage.sql.exec('INSERT INTO world_chat_seen VALUES(?,?,?)', owner, clientId, now);
      return true;
    });
  }
  private async room(id: number): Promise<Pick<Member, 'x' | 'y' | 'z'> | null> {
    if (!this.events || Date.now() - this.eventsAt > 300_000) {
      this.eventLoad ??= listEvents(this.env.DB).then(values => {
        const index = new Map<number, TechWeekEvent | null>();
        for (const event of values) { const key = chatEventId(event.id); index.set(key, index.has(key) ? null : event); }
        this.events = index; this.anchors.clear(); this.eventsAt = Date.now();
      }).finally(() => { this.eventLoad = undefined; });
      await this.eventLoad;
    }
    const event = this.events?.get(id); if (!event) return null;
    if (!this.anchors.has(event.id)) this.anchors.set(event.id, this.anchorForEvent(event));
    return this.anchors.get(event.id) ?? null;
  }
  private leave(playerId: number): void {
    const member = this.members.get(playerId); if (!member) return;
    this.members.delete(playerId); this.storage.sql.exec('DELETE FROM world_chat_members WHERE player_id=?', playerId);
    const message = { type: 'EVENT_STATE', eventId: member.event_id, playerId, present: false } as const;
    for (const peer of this.peers()) if (peer.id === playerId || this.currentMember(peer, member.event_id)) peer.send(message);
  }
  /** Call after accepted movement, mode changes and peer installation. */
  presenceChanged(playerId: number): void {
    const member = this.members.get(playerId); if (!member) return;
    const peer = this.peer(playerId);
    if (!peer || !this.currentMember(peer, member.event_id)) this.leave(playerId);
  }
  disconnect(playerId: number): void { this.joining.delete(playerId); this.leave(playerId); }
  /** A cheap periodic sweep; does not fetch D1 or call a provider. */
  tick(now: number): void {
    if (now - this.sweptAt < 1000) return;
    for (const id of this.members.keys()) this.presenceChanged(id);
    if (now - this.sweptAt > 60_000 || Math.floor(now / 60_000) !== Math.floor(this.sweptAt / 60_000)) {
      this.storage.sql.exec('DELETE FROM world_chat_seen WHERE at<?', now - 600_000);
      this.storage.sql.exec('DELETE FROM world_chat_budget WHERE at<?', now - 86400_000);
    }
    this.sweptAt = now;
  }
  async handle(peer: ChatPeer, message: ChatCommand, now: number): Promise<void> {
    if (!flags.chat) return;
    const generation = peer.generation;
    if (message.type === 'EVENT_LEAVE') {
      this.joining.delete(peer.id);
      if (this.members.get(peer.id)?.event_id === message.eventId) this.leave(peer.id);
      return;
    }
    if (message.type === 'EVENT_JOIN') {
      if (!flags.eventChat || !message.eventId) return;
      if (this.currentMember(peer, message.eventId)) {
        peer.send({ type: 'EVENT_STATE', eventId: message.eventId, playerId: peer.id, present: true }); return;
      }
      if (!this.takeBudget(peer, now)) return;
      const attempt = {}; this.joining.set(peer.id, attempt);
      try {
        const anchor = await this.room(message.eventId), current = this.peer(peer.id);
        if (this.joining.get(peer.id) !== attempt || !current || current.generation !== generation || !anchor || !this.inside(current, anchor)) return;
        this.leave(peer.id);
        const member: Member = { player_id: peer.id, generation: peer.generation, event_id: message.eventId, ...anchor };
        this.members.set(peer.id, member);
        this.storage.sql.exec('INSERT OR REPLACE INTO world_chat_members VALUES(?,?,?,?,?,?)', member.player_id, member.generation, member.event_id, member.x, member.y, member.z);
        for (const other of this.peers()) if (this.currentMember(other, message.eventId)) {
          other.send({ type: 'EVENT_STATE', eventId: message.eventId, playerId: peer.id, present: true });
          if (other.id !== peer.id) current.send({ type: 'EVENT_STATE', eventId: message.eventId, playerId: other.id, present: true });
        }
      } finally { if (this.joining.get(peer.id) === attempt) this.joining.delete(peer.id); }
      return;
    }
    if (message.type !== 'CHAT') return;
    if (message.eventId && (!flags.eventChat || !this.currentMember(peer, message.eventId))) return;
    if (!this.takeBudget(peer, now, message.clientMsgId)) return;
    const owner = this.owner(peer); if (this.pending.has(owner)) return;
    this.pending.add(owner);
    try {
      const text = await this.moderate(message.text, this.env.TYPESAFE_API_KEY);
      const current = this.peer(peer.id);
      if (!text || !current || current.generation !== generation) return;
      if (message.eventId && !this.currentMember(current, message.eventId)) return;
      const row = this.storage.sql.exec<{ value: number }>('SELECT value FROM world_chat_sequence WHERE id=1').toArray()[0];
      const messageId = ((row?.value ?? 0) + 1) >>> 0 || 1;
      this.storage.sql.exec('INSERT INTO world_chat_sequence VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', messageId);
      const broadcast: S2CMessage = { type: 'CHAT_BROADCAST', messageId, senderId: peer.id, eventId: message.eventId,
        serverT: Date.now(), name: locallyApproved(current.name) ?? 'Founder', text };
      this.broadcastLocal(broadcast, current.pose, message.eventId);
      // Zoned: carry it across any nearby cell borders. The sibling cell re-applies the same visibility.
      this.relay?.(broadcast, current.pose, message.eventId);
    } finally { this.pending.delete(owner); }
  }

  /**
   * Spoken bubble (flag voiceCaptions, gtasf-qjja): a server-side transcript of the peer's push-to-talk clip goes
   * through exactly the same moderation (blocklist + jev) as typed chat, then reaches the same audience (the
   * peer's event room, else chat range) as a CHAT_BROADCAST with spoken:true. 'rejected' = moderation refused it.
   */
  async spoken(peer: ChatPeer, transcript: string, info: { score?: number } = {}): Promise<'sent' | 'rejected' | 'dropped' | 'unavailable' | 'gone'> {
    if (!flags.chat) return 'gone';
    const generation = peer.generation;
    // Default moderator: distinguish a real refusal (strike) from the provider being unavailable (no strike).
    // Spoken captions show from SPOKEN_SHOW_AT (casual speech scores mid-range); typed chat keeps .95.
    const verdict = this.moderate === moderateChat ? await moderateChatVerdict(transcript, this.env.TYPESAFE_API_KEY, fetch, SPOKEN_SHOW_AT)
      : await this.moderate(transcript, this.env.TYPESAFE_API_KEY).then(text => text ? { verdict: 'approved' as const, text } : { verdict: 'blocked' as const, text: null });
    info.score = 'score' in verdict ? verdict.score : undefined;
    if (verdict.verdict === 'unavailable') return 'unavailable';
    if (verdict.verdict === 'borderline') return 'dropped'; // not shown, but not a strike (gtasf-ned3)
    const text = verdict.text;
    if (!text) return 'rejected';
    const current = this.peer(peer.id);
    if (!current || current.generation !== generation) return 'gone';
    const eventId = flags.eventChat ? this.roomOf(current) : 0;
    const row = this.storage.sql.exec<{ value: number }>('SELECT value FROM world_chat_sequence WHERE id=1').toArray()[0];
    const messageId = ((row?.value ?? 0) + 1) >>> 0 || 1;
    this.storage.sql.exec('INSERT INTO world_chat_sequence VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', messageId);
    const broadcast: S2CMessage = { type: 'CHAT_BROADCAST', messageId, senderId: peer.id, eventId,
      serverT: Date.now(), name: locallyApproved(current.name) ?? 'Founder', text, spoken: true };
    this.broadcastLocal(broadcast, current.pose, eventId);
    this.relay?.(broadcast, current.pose, eventId);
    return 'sent';
  }

  /** Send an accepted broadcast to the peers that should see it: event members, or those within chat
   *  range of `senderPose` for proximity chat. Used for both local delivery and relayed cross-border delivery. */
  private broadcastLocal(broadcast: S2CMessage, senderPose: Pose, eventId: number): void {
    for (const other of this.peers()) {
      const visible = eventId ? this.currentMember(other, eventId)
        : Math.hypot(other.pose.x - senderPose.x, other.pose.y - senderPose.y, other.pose.z - senderPose.z) <= CHAT_RADIUS_M * 100;
      if (!visible) continue;
      // Older client builds close the socket on the CHAT_SPOKEN opcode: send them the same text as ordinary chat.
      if (broadcast.type === 'CHAT_BROADCAST' && broadcast.spoken && !other.spokenBubbles) { const { spoken: _spoken, ...plain } = broadcast; other.send(plain); }
      else other.send(broadcast);
    }
  }

  /** A broadcast relayed from the sender's cell (zoned world). Already moderated/rate-limited/sequenced
   *  at the origin — just deliver to this cell's matching peers. */
  relayIncoming(broadcast: S2CMessage, senderPose: Pose, eventId: number): void {
    if (!flags.chat) return;
    this.broadcastLocal(broadcast, senderPose, eventId);
  }
}
