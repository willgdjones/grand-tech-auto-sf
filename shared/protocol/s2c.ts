import { Reader, Writer } from './bytes';
import { QUEST_JSON_MAX_BYTES, S2C, S2C_MAX_BYTES, SNAPSHOT_ENTRY_BYTES, SNAPSHOT_MAX_ENTRIES, VEHICLE_ENTRY_BYTES, VEHICLE_MAX_ENTRIES, VEHICLE_KINDS, PLAYER_MODES, ROBOTAXI_STATES, NICKNAME_MAX_BYTES, CHAT_MAX_BYTES, ROBOTAXI_TITLE_BYTES, VOICE_ID, VOICE_ID_MAX_BYTES, VOICE_PEERS_MAX, VOICE_STATES, OFFICERS_MAX } from './constants';
import { readPose, writePose } from './pose';
import { readBool, writeBool, readEnum, writeEnum, readPoint, writePoint, readString, readToken, writeToken } from './fields';
import type { DecodeResult, S2CMessage } from './types';
/** [-1, 1] → a byte (POLICE_RAM direction). */
const unitByte = (v: number) => Math.max(0, Math.min(255, Math.round((Math.max(-1, Math.min(1, v)) + 1) * 127.5)));

export function encodeS2C(m: S2CMessage): Uint8Array {
  // Native100 exposed >100 MB/s of 64 KiB scratch buffers for ~1 KiB frames.
  // Validate counts before allocating and size hot snapshots to their exact wire
  // length. CHAT_BROADCAST is the largest bounded control frame (392 bytes).
  let capacity = 24 + NICKNAME_MAX_BYTES + CHAT_MAX_BYTES;
  if (m.type === 'SNAPSHOT') {
    if (m.entries.length > SNAPSHOT_MAX_ENTRIES) throw new RangeError('SNAPSHOT_COUNT');
    capacity = 15 + m.entries.length * SNAPSHOT_ENTRY_BYTES;
  } else if (m.type === 'VEHICLE_SNAPSHOT') {
    if (m.entries.length > VEHICLE_MAX_ENTRIES) throw new RangeError('VEHICLE_COUNT');
    capacity = 15 + m.entries.length * VEHICLE_ENTRY_BYTES;
  } else if (m.type === 'VOICE_PEERS') {
    if (m.peers.length > VOICE_PEERS_MAX) throw new RangeError('VOICE_PEERS_COUNT');
    capacity = 2 + m.peers.length * (4 + 2 * (1 + VOICE_ID_MAX_BYTES) + 1);
  }
  const w = new Writer(capacity);
  switch (m.type) {
    case 'OUTBID_CHANGED':
      if (!Number.isSafeInteger(m.revision) || m.revision < 0) throw new RangeError('OUTBID_REVISION');
      w.u8(S2C.OUTBID_CHANGED).f64(m.revision); break;
    case 'WELCOME':
      w.u8(S2C.WELCOME).u32(m.id).f64(m.serverT).str8(m.name, NICKNAME_MAX_BYTES);
      writePose(w, m.pose); writeToken(w, m.resumeToken); w.u16(m.lastMoveSeq); writeBool(w, m.resumed); break;
    case 'PLAYER_JOIN':
      w.u8(S2C.PLAYER_JOIN).u32(m.id).str8(m.name, NICKNAME_MAX_BYTES); writePose(w, m.pose); break;
    case 'SNAPSHOT':
      w.u8(S2C.SNAPSHOT).u32(m.tick).f64(m.serverT).u16(m.entries.length);
      for (const e of m.entries) { w.u32(e.id); writePose(w, e); } break;
    case 'PLAYER_LEAVE': w.u8(S2C.PLAYER_LEAVE).u32(m.id); break;
    case 'CORRECTION': w.u8(S2C.CORRECTION); writePose(w, m.pose); break;
    case 'PONG': w.u8(S2C.PONG).u32(m.nonce).f64(m.clientT).f64(m.serverT); break;
    case 'VEHICLE_SNAPSHOT':
      w.u8(S2C.VEHICLE_SNAPSHOT).u32(m.tick).f64(m.serverT).u16(m.entries.length);
      for (const e of m.entries) {
        w.u32(e.id); writePose(w, e); writeEnum(w, e.kind, VEHICLE_KINDS); w.u32(e.driverId).i16(e.speedCmps);
      }
      break;
    case 'VEHICLE_STATE':
      w.u8(S2C.VEHICLE_STATE).u32(m.vehicleId).u32(m.playerId); writeEnum(w, m.mode, PLAYER_MODES); break;
    case 'ROBOTAXI_STATE':
      w.u8(m.quick ? S2C.ROBOTAXI_QUICK_STATE : S2C.ROBOTAXI_STATE).u32(m.requestId).u32(m.vehicleId); writeEnum(w, m.state, ROBOTAXI_STATES);
      writePose(w, m.pose); writePoint(w, m.destination); w.u16(m.etaSeconds);
      if (m.quick) w.str8(m.quick.title, ROBOTAXI_TITLE_BYTES).str8(m.quick.fareCents, 16).u8(m.quick.freeRidesLeft).u16(m.quick.durationMs);
      break;
    case 'ROBOTAXI_FRIEND_NOTICE': w.u8(S2C.ROBOTAXI_FRIEND_NOTICE).str8(m.name, NICKNAME_MAX_BYTES); break;
    case 'EVENT_STATE': w.u8(S2C.EVENT_STATE).u32(m.eventId).u32(m.playerId); writeBool(w, m.present); break;
    case 'CHAT_BROADCAST':
      w.u8(m.spoken ? S2C.CHAT_SPOKEN : S2C.CHAT_BROADCAST).u32(m.messageId).u32(m.senderId).u32(m.eventId).f64(m.serverT)
        .str8(m.name, NICKNAME_MAX_BYTES).str16(m.text, CHAT_MAX_BYTES); break;
    case 'APPEARANCE': w.u8(S2C.APPEARANCE).u32(m.id).u32(m.appearance); break;
    case 'MAYHEM_FIRE':
      w.u8(S2C.MAYHEM_FIRE).u32(m.senderId).u8(m.item).f64(m.at[0]).f64(m.at[1]).f64(m.at[2]).u32(m.colour).u8(m.normal ? 1 : 0);
      if (m.normal) w.f64(m.normal[0]).f64(m.normal[1]).f64(m.normal[2]);
      break;
    case 'COMBAT_HIT':
      w.u8(S2C.COMBAT_HIT).u32(m.shooterId).u8(m.weapon)
        .f64(m.origin[0]).f64(m.origin[1]).f64(m.origin[2]).f64(m.to[0]).f64(m.to[1]).f64(m.to[2])
        .u32(m.targetId).u16(m.damage).u8(m.killed ? 1 : 0);
      break;
    case 'WANTED': w.u8(S2C.WANTED).u8(m.level); break;
    case 'BUSTED': w.u8(S2C.BUSTED); break;
    case 'EXPLOSION': w.u8(S2C.EXPLOSION).i32(m.x).i32(m.y).i32(m.z); break;
    case 'COMBAT_VITALS': w.u8(S2C.COMBAT_VITALS).u8(Math.max(0, Math.min(255, Math.round(m.health)))).u8(Math.max(0, Math.min(255, Math.round(m.armour)))); break;
    case 'PICKUP_STATE': w.u8(S2C.PICKUP_STATE).u8(m.index).u8(m.available ? 1 : 0); break;
    case 'POLICE_RAM': w.u8(S2C.POLICE_RAM).u8(unitByte(m.dirX)).u8(unitByte(m.dirZ)); break;
    case 'WANTED_SIGHT': w.u8(S2C.WANTED_SIGHT).u8(m.seen ? 1 : 0).i32(m.x).i32(m.z); break;
    case 'WANTED_ESCAPE': {
      const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
      w.u8(S2C.WANTED_ESCAPE).u8(Math.max(0, Math.min(2, Math.round(m.phase)))).u8(byte(m.progress))
        .u16(Math.max(0, Math.min(65_535, Math.round(m.remainingDs)))).u8(byte(m.cover)); break;
    }
    case 'QUEST': w.u8(S2C.QUEST).str16(m.json, QUEST_JSON_MAX_BYTES, 'quest'); break;
    case 'OFFICERS':
      if (m.entries.length > OFFICERS_MAX) throw new RangeError('OFFICERS_TOO_MANY');
      w.u8(S2C.OFFICERS).u8(m.entries.length);
      for (const o of m.entries) w.u32(o.id).i32(o.x).i32(o.y).i32(o.z).u8(o.yaw).u8(o.moving ? 1 : 0);
      break;
    case 'ZONE_HANDOFF': w.u8(S2C.ZONE_HANDOFF); writeToken(w, m.token); w.u16(m.cx).u16(m.cy); break;
    case 'ZONE_LAYOUT': w.u8(S2C.ZONE_LAYOUT).u32(m.splitMask).u16(m.cx).u16(m.cy); break;
    case 'VOICE_PEERS':
      w.u8(S2C.VOICE_PEERS).u8(m.peers.length);
      for (const p of m.peers) {
        if (!Number.isInteger(p.gain) || p.gain < 0 || p.gain > 255) throw new RangeError('VOICE_GAIN');
        w.u32(p.playerId).str8(p.sessionId, VOICE_ID_MAX_BYTES).str8(p.trackName, VOICE_ID_MAX_BYTES).u8(p.gain);
      }
      break;
    case 'VOICE_STATE': w.u8(S2C.VOICE_STATE).u32(m.playerId); writeEnum(w, m.state, VOICE_STATES); break;
  }
  return w.toBytes();
}
export function decodeS2C(bytes: Uint8Array): DecodeResult<S2CMessage> {
  if (bytes.length > S2C_MAX_BYTES) return { ok: false, err: 'OUT_OF_RANGE' };
  const r = new Reader(bytes), op = r.u8();
  let msg: S2CMessage;
  switch (op) {
    case S2C.OUTBID_CHANGED:
      msg = { type: 'OUTBID_CHANGED', revision: r.f64() };
      if (!Number.isSafeInteger(msg.revision) || msg.revision < 0) r.fail('OUT_OF_RANGE'); break;
    case S2C.WELCOME:
      msg = { type: 'WELCOME', id: r.u32(), serverT: r.f64(), name: readString(r, NICKNAME_MAX_BYTES), pose: readPose(r), resumeToken: readToken(r), lastMoveSeq: r.u16(), resumed: readBool(r) }; break;
    case S2C.PLAYER_JOIN:
      msg = { type: 'PLAYER_JOIN', id: r.u32(), name: readString(r, NICKNAME_MAX_BYTES), pose: readPose(r) }; break;
    case S2C.SNAPSHOT: {
      const tick = r.u32(), serverT = r.f64(), count = r.u16();
      if (count > SNAPSHOT_MAX_ENTRIES) return { ok: false, err: 'BAD_COUNT' };
      if (r.remaining !== count * SNAPSHOT_ENTRY_BYTES) return { ok: false, err: r.remaining < count * SNAPSHOT_ENTRY_BYTES ? 'TRUNCATED' : 'TRAILING_BYTES' };
      const entries = Array.from({ length: count }, () => ({ id: r.u32(), ...readPose(r) }));
      msg = { type: 'SNAPSHOT', tick, serverT, entries }; break;
    }
    case S2C.PLAYER_LEAVE: msg = { type: 'PLAYER_LEAVE', id: r.u32() }; break;
    case S2C.CORRECTION: msg = { type: 'CORRECTION', pose: readPose(r) }; break;
    case S2C.PONG: msg = { type: 'PONG', nonce: r.u32(), clientT: r.f64(), serverT: r.f64() }; break;
    case S2C.VEHICLE_SNAPSHOT: {
      const tick = r.u32(), serverT = r.f64(), count = r.u16();
      if (count > VEHICLE_MAX_ENTRIES) return { ok: false, err: 'BAD_COUNT' };
      if (r.remaining !== count * VEHICLE_ENTRY_BYTES) return { ok: false, err: r.remaining < count * VEHICLE_ENTRY_BYTES ? 'TRUNCATED' : 'TRAILING_BYTES' };
      const entries = Array.from({ length: count }, () => ({ id: r.u32(), ...readPose(r), kind: readEnum(r, VEHICLE_KINDS), driverId: r.u32(), speedCmps: r.i16() }));
      msg = { type: 'VEHICLE_SNAPSHOT', tick, serverT, entries }; break;
    }
    case S2C.VEHICLE_STATE: msg = { type: 'VEHICLE_STATE', vehicleId: r.u32(), playerId: r.u32(), mode: readEnum(r, PLAYER_MODES) }; break;
    case S2C.ROBOTAXI_STATE: case S2C.ROBOTAXI_QUICK_STATE: {
      const base = { type: 'ROBOTAXI_STATE' as const, requestId: r.u32(), vehicleId: r.u32(), state: readEnum(r, ROBOTAXI_STATES), pose: readPose(r), destination: readPoint(r), etaSeconds: r.u16() };
      if (op === S2C.ROBOTAXI_QUICK_STATE) {
        const quick = { title: readString(r, ROBOTAXI_TITLE_BYTES), fareCents: readString(r, 16), freeRidesLeft: r.u8(), durationMs: r.u16() };
        if (!/^(0|[1-9]\d{0,8})$/.test(quick.fareCents) || quick.freeRidesLeft > 3 || quick.durationMs > 6000) r.fail('OUT_OF_RANGE');
        msg = { ...base, quick };
      } else msg = base;
      break;
    }
    case S2C.ROBOTAXI_FRIEND_NOTICE: msg = { type: 'ROBOTAXI_FRIEND_NOTICE', name: readString(r, NICKNAME_MAX_BYTES) }; break;
    case S2C.EVENT_STATE: msg = { type: 'EVENT_STATE', eventId: r.u32(), playerId: r.u32(), present: readBool(r) }; break;
    case S2C.CHAT_BROADCAST: case S2C.CHAT_SPOKEN:
      msg = { type: 'CHAT_BROADCAST', messageId: r.u32(), senderId: r.u32(), eventId: r.u32(), serverT: r.f64(), name: readString(r, NICKNAME_MAX_BYTES), text: readString(r, CHAT_MAX_BYTES, true),
        ...(op === S2C.CHAT_SPOKEN ? { spoken: true as const } : {}) }; break;
    case S2C.APPEARANCE: msg = { type: 'APPEARANCE', id: r.u32(), appearance: r.u32() }; break;
    case S2C.MAYHEM_FIRE: {
      const senderId = r.u32(), item = r.u8(), at: [number, number, number] = [r.f64(), r.f64(), r.f64()], colour = r.u32();
      const normal = r.u8() ? [r.f64(), r.f64(), r.f64()] as [number, number, number] : null;
      msg = { type: 'MAYHEM_FIRE', senderId, item, at, colour, normal }; break;
    }
    case S2C.COMBAT_HIT: {
      const shooterId = r.u32(), weapon = r.u8();
      const origin: [number, number, number] = [r.f64(), r.f64(), r.f64()];
      const to: [number, number, number] = [r.f64(), r.f64(), r.f64()];
      const targetId = r.u32(), damage = r.u16(), killed = readBool(r);
      msg = { type: 'COMBAT_HIT', shooterId, weapon, origin, to, targetId, damage, killed }; break;
    }
    case S2C.WANTED: msg = { type: 'WANTED', level: r.u8() }; break;
    case S2C.BUSTED: msg = { type: 'BUSTED' }; break;
    case S2C.EXPLOSION: msg = { type: 'EXPLOSION', x: r.i32(), y: r.i32(), z: r.i32() }; break;
    case S2C.COMBAT_VITALS: msg = { type: 'COMBAT_VITALS', health: r.u8(), armour: r.u8() }; break;
    case S2C.PICKUP_STATE: msg = { type: 'PICKUP_STATE', index: r.u8(), available: r.u8() === 1 }; break;
    case S2C.POLICE_RAM: msg = { type: 'POLICE_RAM', dirX: r.u8() / 127.5 - 1, dirZ: r.u8() / 127.5 - 1 }; break;
    case S2C.WANTED_SIGHT: msg = { type: 'WANTED_SIGHT', seen: r.u8() === 1, x: r.i32(), z: r.i32() }; break;
    case S2C.WANTED_ESCAPE: {
      const phase = r.u8(), progress = r.u8(), remainingDs = r.u16(), cover = r.u8();
      if (phase > 2) r.fail('OUT_OF_RANGE');
      msg = { type: 'WANTED_ESCAPE', phase, progress, remainingDs, cover }; break;
    }
    case S2C.QUEST: msg = { type: 'QUEST', json: readString(r, QUEST_JSON_MAX_BYTES, true) }; break;
    case S2C.OFFICERS: {
      const count = r.u8(); if (count > OFFICERS_MAX) r.fail('OUT_OF_RANGE');
      const entries = [];
      for (let i = 0; i < count; i++) entries.push({ id: r.u32(), x: r.i32(), y: r.i32(), z: r.i32(), yaw: r.u8(), moving: r.u8() === 1 });
      msg = { type: 'OFFICERS', entries }; break;
    }
    case S2C.ZONE_HANDOFF: msg = { type: 'ZONE_HANDOFF', token: readToken(r), cx: r.u16(), cy: r.u16() }; break;
    case S2C.ZONE_LAYOUT: msg = { type: 'ZONE_LAYOUT', splitMask: r.u32(), cx: r.u16(), cy: r.u16() }; break;
    case S2C.VOICE_PEERS: {
      const count = r.u8();
      if (count > VOICE_PEERS_MAX) return { ok: false, err: 'BAD_COUNT' };
      const peers = [];
      for (let i = 0; i < count && !r.error; i++) {
        const peer = { playerId: r.u32(), sessionId: readString(r, VOICE_ID_MAX_BYTES), trackName: readString(r, VOICE_ID_MAX_BYTES), gain: r.u8() };
        if (!r.error && (!VOICE_ID.test(peer.sessionId) || !VOICE_ID.test(peer.trackName))) r.fail('OUT_OF_RANGE');
        peers.push(peer);
      }
      msg = { type: 'VOICE_PEERS', peers }; break;
    }
    case S2C.VOICE_STATE: msg = { type: 'VOICE_STATE', playerId: r.u32(), state: readEnum(r, VOICE_STATES) }; break;
    default: return { ok: false, err: r.error ?? 'UNKNOWN_TYPE' };
  }
  if ('serverT' in msg && !Number.isFinite(msg.serverT)) r.fail('OUT_OF_RANGE');
  if (msg.type === 'PONG' && !Number.isFinite(msg.clientT)) r.fail('OUT_OF_RANGE');
  if (r.error) return { ok: false, err: r.error, at: r.errorAt };
  return r.remaining ? { ok: false, err: 'TRAILING_BYTES' } : { ok: true, msg };
}
