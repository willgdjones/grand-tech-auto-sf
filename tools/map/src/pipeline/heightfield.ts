import type { Bounds, HeightSampler } from './types';

export interface Heightfield {size:number;step:number;offsetCm:number;x:number;z:number;values:Uint16Array}
export function createHeightfield(bounds:Bounds,terrain:HeightSampler,step=4):Heightfield {
  const span=bounds[2]-bounds[0],size=span/step+1;
  if(!Number.isInteger(size)||size<2||bounds[3]-bounds[1]!==span)throw new Error('Heightfield must be a square grid');
  const raw:number[]=[];
  for(let z=0;z<size;z++)for(let x=0;x<size;x++)raw.push(Math.round(terrain.sample(bounds[0]+x*step,bounds[1]+z*step)*100));
  const offsetCm=Math.min(...raw),max=Math.max(...raw);
  if(!Number.isFinite(offsetCm)||max-offsetCm>65535)throw new Error('Heightfield exceeds uint16 centimetre range');
  return {size,step,offsetCm,x:bounds[0]/span,z:bounds[1]/span,values:Uint16Array.from(raw,n=>n-offsetCm)};
}
export function encodeHeightfield(field:Heightfield):Uint8Array {
  const bytes=Buffer.alloc(32+field.values.length*2);bytes.write('GTHF');bytes.writeUInt16LE(1,4);bytes.writeUInt16LE(field.size,6);
  bytes.writeFloatLE(field.step,8);bytes.writeInt32LE(field.offsetCm,12);bytes.writeInt32LE(field.x,16);bytes.writeInt32LE(field.z,20);bytes.writeFloatLE(0.01,24);
  for(let i=0;i<field.values.length;i++)bytes.writeUInt16LE(field.values[i]!,32+i*2);return bytes;
}
export function decodeHeightfield(raw:Uint8Array):Heightfield {
  const bytes=Buffer.from(raw);
  if(bytes.length<32||bytes.toString('ascii',0,4)!=='GTHF'||bytes.readUInt16LE(4)!==1)throw new Error('Invalid heightfield header');
  const size=bytes.readUInt16LE(6),step=bytes.readFloatLE(8);
  if(size<2||bytes.length!==32+size*size*2||step<=0||!Number.isFinite(step)||Math.abs(bytes.readFloatLE(24)-0.01)>1e-8)throw new Error('Invalid heightfield dimensions');
  const values=new Uint16Array(size*size);for(let i=0;i<values.length;i++)values[i]=bytes.readUInt16LE(32+i*2);
  return {size,step,offsetCm:bytes.readInt32LE(12),x:bytes.readInt32LE(16),z:bytes.readInt32LE(20),values};
}
