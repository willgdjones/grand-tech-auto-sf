import { expect,it } from 'vitest';
import { signalGreen } from './signals';

it('keeps opposing approaches together and both axes red between green phases',()=>{
  for(const junction of ['osm:65376509','junction-with-lane-aliases','b']){
    let northSouth=0,eastWest=0,allRed=0;
    for(let now=-28000;now<0;now+=100){
      const north=signalGreen(now,junction,0),east=signalGreen(now,junction,Math.PI/2);
      expect(signalGreen(now,junction,Math.PI)).toBe(north);
      expect(signalGreen(now,junction,-Math.PI/2)).toBe(east);
      expect(signalGreen(now+28000,junction,0)).toBe(north);
      expect(north&&east).toBe(false);
      if(north)northSouth+=100;
      if(east)eastWest+=100;
      if(!north&&!east)allRed+=100;
    }
    expect({northSouth,eastWest,allRed}).toEqual({northSouth:13000,eastWest:13000,allRed:2000});
  }
});
