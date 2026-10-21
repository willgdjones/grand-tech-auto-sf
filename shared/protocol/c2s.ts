import { readAnalytics, writeAnalytics } from './analytics';
import { Reader, Writer } from './bytes';
import { C2S, C2S_MAX_BYTES, PROTOCOL_VERSION, NICKNAME_MAX_BYTES, CHAT_MAX_BYTES, ROBOTAXI_TITLE_BYTES, VOICE_ID, VOICE_ID_MAX_BYTES } from './constants';
import { readPose, writePose } from './pose';
import { readBool, readPoint, writePoint, readString, readToken, writeToken } from './fields';
import type { C2SMessage, DecodeResult } from './types';
export function encodeC2S(m: C2SMessage): Uint8Array {
  const w = new Writer(C2S_MAX_BYTES);
  switch (m.type) {
    case 'HELLO':
      w.u8(m.analytics ? C2S.HELLO_ANALYTICS : C2S.HELLO).u8(PROTOCOL_VERSION).str8(m.name, NICKNAME_MAX_BYTES);
      writeToken(w, m.resumeToken ?? '', true);
      if (m.analytics) writeAnalytics(w, m.analytics); break;
    case 'ANALYTICS': w.u8(C2S.ANALYTICS); writeAnalytics(w, m.analytics); break;
    case 'MOVE': w.u8(C2S.MOVE).u16(m.seq); writePose(w, m); break;
    case 'PING': w.u8(C2S.PING).u32(m.nonce).f64(m.clientT); break;
    case 'ACTIVITY': w.u8(C2S.ACTIVITY); break;
    case 'ROAD_RESPAWN': w.u8(C2S.ROAD_RESPAWN); break;
    case 'CHAT': w.u8(C2S.CHAT).u32(m.clientMsgId).u32(m.eventId).str16(m.text, CHAT_MAX_BYTES); break;
    case 'VEHICLE_ENTER': case 'VEHICLE_EXIT': w.u8(C2S[m.type]).u32(m.vehicleId); break;
    case 'VEHICLE_MOVE': w.u8(C2S.VEHICLE_MOVE).u32(m.vehicleId).u16(m.seq); writePose(w, m); break;
    case 'ROBOTAXI_HAIL': case 'ROBOTAXI_QUOTE':
      w.u8(m.type === 'ROBOTAXI_QUOTE' ? C2S.ROBOTAXI_QUOTE : m.quick ? C2S.ROBOTAXI_QUICK_HAIL : C2S.ROBOTAXI_HAIL).u32(m.requestId);
      writePoint(w, m.destination);
      if (m.quick) w.str8(m.quick.title, ROBOTAXI_TITLE_BYTES).str8(m.quick.eventId, 128).str8(m.quick.friend, NICKNAME_MAX_BYTES).str8(m.quick.maxFareCents, 16);
      break;
    case 'ROBOTAXI_READY': w.u8(C2S.ROBOTAXI_READY).u32(m.requestId); break;
    case 'ROBOTAXI_CANCEL': w.u8(C2S.ROBOTAXI_CANCEL).u32(m.requestId); break;
    case 'EVENT_JOIN': case 'EVENT_LEAVE': w.u8(C2S[m.type]).u32(m.eventId); break;
    case 'SET_APPEARANCE': w.u8(C2S.SET_APPEARANCE).u32(m.appearance); break;
    case 'MAYHEM_FIRE':
      w.u8(C2S.MAYHEM_FIRE).u8(m.item).f64(m.at[0]).f64(m.at[1]).f64(m.at[2]).u32(m.colour).u8(m.normal ? 1 : 0);
      if (m.normal) w.f64(m.normal[0]).f64(m.normal[1]).f64(m.normal[2]);
      break;
    case 'COMBAT_FIRE':
      w.u8(C2S.COMBAT_FIRE).u8(m.weapon).f64(m.dir[0]).f64(m.dir[1]).f64(m.dir[2]);
      break;
    case 'COMBAT_READY': w.u8(C2S.COMBAT_READY); break;
    case 'COMBAT_CRIME': w.u8(C2S.COMBAT_CRIME).u8(m.kind); break;
    case 'VEHICLE_CRASH': w.u8(C2S.VEHICLE_CRASH).u8(Math.max(0, Math.min(255, Math.round(m.closing)))); break;
    case 'PED_PUNCH': w.u8(C2S.PED_PUNCH); break;
    case 'KERB_CAR_TAKE': w.u8(C2S.KERB_CAR_TAKE).i32(m.x).i32(m.z).u8(((Math.round(m.yaw) % 256) + 256) % 256).u8(m.kind); break;
    case 'OPENING_CAR': w.u8(C2S.OPENING_CAR).u8(((Math.round(m.yaw) % 256) + 256) % 256); break;
    case 'VOICE_PUBLISH': w.u8(C2S.VOICE_PUBLISH).str8(m.sessionId, VOICE_ID_MAX_BYTES).str8(m.trackName, VOICE_ID_MAX_BYTES); break;
    case 'VOICE_STOP': w.u8(C2S.VOICE_STOP); break;
    case 'VOICE_MUTE': w.u8(C2S.VOICE_MUTE).u32(m.target).u8(m.muted ? 1 : 0); break;
  }
  return w.toBytes();
}
/** Bound lengths before decoding/allocating, reject trailing bytes, never throw on arbitrary input. */
export function decodeC2S(bytes: Uint8Array): DecodeResult<C2SMessage> {
  if (bytes.length > C2S_MAX_BYTES) return { ok: false, err: 'OUT_OF_RANGE' };
  const r = new Reader(bytes), op = r.u8();
  let msg: C2SMessage;
  switch (op) {
    case C2S.HELLO: case C2S.HELLO_ANALYTICS: {
      if (r.u8() !== PROTOCOL_VERSION) r.fail('BAD_VERSION');
      const name = readString(r, NICKNAME_MAX_BYTES), resumeToken = readToken(r, true);
      const analytics = op === C2S.HELLO_ANALYTICS ? readAnalytics(r) : undefined;
      msg = { type: 'HELLO', name, ...(resumeToken ? { resumeToken } : {}), ...(analytics ? { analytics } : {}) }; break;
    }
    case C2S.ANALYTICS: { const analytics = readAnalytics(r); msg = { type: 'ANALYTICS', ...(analytics ? { analytics } : {}) }; break; }
    case C2S.MOVE: msg = { type: 'MOVE', seq: r.u16(), ...readPose(r) }; break;
    case C2S.ACTIVITY: msg = { type: 'ACTIVITY' }; break;
    case C2S.ROAD_RESPAWN: msg = { type: 'ROAD_RESPAWN' }; break;
    case C2S.PING: msg = { type: 'PING', nonce: r.u32(), clientT: r.f64() }; if (!Number.isFinite(msg.clientT)) r.fail('OUT_OF_RANGE'); break;
    case C2S.CHAT: msg = { type: 'CHAT', clientMsgId: r.u32(), eventId: r.u32(), text: readString(r, CHAT_MAX_BYTES, true) }; break;
    case C2S.VEHICLE_ENTER: case C2S.VEHICLE_EXIT:
      msg = { type: op === C2S.VEHICLE_ENTER ? 'VEHICLE_ENTER' : 'VEHICLE_EXIT', vehicleId: r.u32() }; break;
    case C2S.VEHICLE_MOVE: msg = { type: 'VEHICLE_MOVE', vehicleId: r.u32(), seq: r.u16(), ...readPose(r) }; break;
    case C2S.ROBOTAXI_HAIL: msg = { type: 'ROBOTAXI_HAIL', requestId: r.u32(), destination: readPoint(r) }; break;
    case C2S.ROBOTAXI_QUICK_HAIL: case C2S.ROBOTAXI_QUOTE: {
      const requestId = r.u32(), destination = readPoint(r);
      const quick = { title: readString(r, ROBOTAXI_TITLE_BYTES), eventId: readString(r, 128), friend: readString(r, NICKNAME_MAX_BYTES), maxFareCents: readString(r, 16) };
      if (quick.maxFareCents && !/^(0|[1-9]\d{0,8})$/.test(quick.maxFareCents)) r.fail('OUT_OF_RANGE');
      msg = { type: op === C2S.ROBOTAXI_QUOTE ? 'ROBOTAXI_QUOTE' : 'ROBOTAXI_HAIL', requestId, destination, quick }; break;
    }
    case C2S.ROBOTAXI_READY: msg = { type: 'ROBOTAXI_READY', requestId: r.u32() }; break;
    case C2S.ROBOTAXI_CANCEL: msg = { type: 'ROBOTAXI_CANCEL', requestId: r.u32() }; break;
    case C2S.EVENT_JOIN: case C2S.EVENT_LEAVE:
      msg = { type: op === C2S.EVENT_JOIN ? 'EVENT_JOIN' : 'EVENT_LEAVE', eventId: r.u32() }; break;
    case C2S.SET_APPEARANCE: msg = { type: 'SET_APPEARANCE', appearance: r.u32() }; break;
    case C2S.MAYHEM_FIRE: {
      const item = r.u8(), at: [number, number, number] = [r.f64(), r.f64(), r.f64()], colour = r.u32();
      const normal = readBool(r) ? [r.f64(), r.f64(), r.f64()] as [number, number, number] : null; // 0/1 only (canonical)
      msg = { type: 'MAYHEM_FIRE', item, at, colour, normal }; break;
    }
    case C2S.COMBAT_FIRE: {
      const weapon = r.u8(), dir: [number, number, number] = [r.f64(), r.f64(), r.f64()];
      msg = { type: 'COMBAT_FIRE', weapon, dir }; break;
    }
    case C2S.COMBAT_READY: msg = { type: 'COMBAT_READY' }; break;
    case C2S.VEHICLE_CRASH: msg = { type: 'VEHICLE_CRASH', closing: r.u8() }; break;
    case C2S.COMBAT_CRIME: { const kind = r.u8(); if (kind > 3) r.fail('OUT_OF_RANGE'); msg = { type: 'COMBAT_CRIME', kind: kind as 0 | 1 | 2 | 3 }; break; }
    case C2S.PED_PUNCH: msg = { type: 'PED_PUNCH' }; break;
    case C2S.KERB_CAR_TAKE: { const x = r.i32(), z = r.i32(), yaw = r.u8(), kind = r.u8(); if (kind > 1) r.fail('OUT_OF_RANGE'); msg = { type: 'KERB_CAR_TAKE', x, z, yaw, kind: kind as 0 | 1 }; break; }
    case C2S.OPENING_CAR: msg = { type: 'OPENING_CAR', yaw: r.u8() }; break;
    case C2S.VOICE_PUBLISH: {
      const sessionId = readString(r, VOICE_ID_MAX_BYTES), trackName = readString(r, VOICE_ID_MAX_BYTES);
      if (!VOICE_ID.test(sessionId) || !VOICE_ID.test(trackName)) r.fail('OUT_OF_RANGE');
      msg = { type: 'VOICE_PUBLISH', sessionId, trackName }; break;
    }
    case C2S.VOICE_STOP: msg = { type: 'VOICE_STOP' }; break;
    case C2S.VOICE_MUTE: {
      const target = r.u32(), muted = r.u8();
      if (muted > 1) r.fail('OUT_OF_RANGE');
      msg = { type: 'VOICE_MUTE', target, muted: muted === 1 }; break;
    }
    default: return { ok: false, err: r.error ?? 'UNKNOWN_TYPE' };
  }
  if (r.error) return { ok: false, err: r.error, at: r.errorAt };
  return r.remaining ? { ok: false, err: 'TRAILING_BYTES' } : { ok: true, msg };
}
