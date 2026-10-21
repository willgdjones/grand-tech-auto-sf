import { expect, it } from 'vitest';
import { coastlineRings } from '../src/pipeline/coastline';
import { containsRing } from '../src/pipeline/geometry';

it('keeps a sourced inlet and island dry, joins split ways, and refuses missing interior coastline',()=>{
  const rings=coastlineRings([
    [[60,120],[60,80],[80,80]],
    [[80,80],[80,20],[60,20],[60,-20]],
    [[90,40],[90,60],[95,60],[95,40],[90,40]],
  ],[0,0,100,100],.1);
  const water=(x:number,z:number)=>rings.reduce((wet,r)=>containsRing(r,[x,z])?!wet:wet,false);
  expect(water(50,50)).toBe(false);
  expect(water(70,50)).toBe(false);
  expect(water(70,10)).toBe(true);
  expect(water(85,50)).toBe(true);
  expect(water(92,50)).toBe(false);
  expect(rings.every(r=>r.every(([x,z])=>x>=0&&x<=100&&z>=0&&z<=100))).toBe(true);
  expect(()=>coastlineRings([[[60,120],[60,50]]],[0,0,100,100])).toThrow('Incomplete coastline');
});
