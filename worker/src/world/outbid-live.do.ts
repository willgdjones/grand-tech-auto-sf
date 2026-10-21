/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach,expect,it } from 'vitest';
import { env } from 'cloudflare:workers';
import { abortAllDurableObjects } from 'cloudflare:test';
import { encodeC2S } from '@gtasf/shared/protocol/c2s';
import { decodeS2C } from '@gtasf/shared/protocol/s2c';
import { PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import type { C2SMessage,S2CMessage } from '@gtasf/shared/protocol/types';
import type { Env } from '../env';

const bindings=env as unknown as Env,sockets:WebSocket[]=[];
afterEach(async()=>{for(const socket of sockets.splice(0))try{socket.close();}catch{/* Already closed. */}await abortAllDurableObjects();});

it('notifies two peers with bounded canonical revisions and retains the latest across restart',async()=>{
  const id=bindings.WORLD.idFromName('outbid-native-smoke');
  let world=bindings.WORLD.get(id);
  const notice=(revision:unknown)=>world.fetch('https://world.internal/internal/outbid/changed',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision}),
  });
  async function open(name:string){
    const response=await world.fetch('https://world.internal/api/world',{headers:{Upgrade:'websocket','Sec-WebSocket-Protocol':PROTOCOL_SUBPROTOCOL}});
    expect(response.status).toBe(101);
    const socket=response.webSocket!;socket.binaryType='arraybuffer';socket.accept();sockets.push(socket);
    const messages:S2CMessage[]=[],errors:string[]=[],noticeBytes:number[]=[];
    socket.addEventListener('message',event=>{
      if(typeof event.data==='string'){errors.push('Unexpected text frame');return;}
      const bytes=new Uint8Array(event.data),decoded=decodeS2C(bytes);
      if(!decoded.ok){errors.push(decoded.err);return;}
      messages.push(decoded.msg);if(decoded.msg.type==='OUTBID_CHANGED')noticeBytes.push(bytes.byteLength);
    });
    const send=(message:C2SMessage)=>socket.send(encodeC2S(message));
    async function next<T extends S2CMessage['type']>(type:T,after=0){
      await expect.poll(()=>messages.slice(after).some(message=>message.type===type)).toBe(true);
      expect(errors).toEqual([]);
      return messages.slice(after).find(message=>message.type===type) as Extract<S2CMessage,{type:T}>;
    }
    const revisions=()=>messages.filter(message=>message.type==='OUTBID_CHANGED').map(message=>message.revision);
    const barrier=async()=>{const after=messages.length;send({type:'PING',nonce:after,clientT:0});await next('PONG',after);};
    send({type:'HELLO',name});await next('WELCOME');await next('OUTBID_CHANGED');
    return {socket,messages,next,revisions,noticeBytes,barrier};
  }
  const a=await open('First peer'),b=await open('Second peer');
  expect(a.revisions()).toEqual([0]);expect(b.revisions()).toEqual([0]);
  expect((await notice(7)).ok).toBe(true);
  await a.barrier();await b.barrier();
  expect(a.revisions()).toEqual([0,7]);expect(b.revisions()).toEqual([0,7]);
  expect((await notice(7)).ok).toBe(true);expect((await notice(3)).ok).toBe(true);
  for(const revision of [-1,1.5,Number.MAX_SAFE_INTEGER+1,null])expect((await notice(revision)).status).toBe(400);
  await a.barrier();await b.barrier();
  expect(a.revisions()).toEqual([0,7]);expect(b.revisions()).toEqual([0,7]);
  const large=Number.MAX_SAFE_INTEGER;
  expect((await notice(large)).ok).toBe(true);
  await a.barrier();await b.barrier();
  expect(a.revisions()).toEqual([0,7,large]);expect(b.revisions()).toEqual([0,7,large]);
  expect(a.noticeBytes).toEqual([9,9,9]);expect(b.noticeBytes).toEqual([9,9,9]);
  a.socket.close();b.socket.close();await abortAllDurableObjects();
  world=bindings.WORLD.get(id);
  const rejoined=await open('After restart');
  expect(rejoined.revisions()).toEqual([large]);expect(rejoined.noticeBytes).toEqual([9]);
});
