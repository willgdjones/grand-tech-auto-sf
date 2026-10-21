import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { refreshOfficialEvents } from './refresh';
import { fetchOfficialEvents } from './official-feed';

it('publishes a complete polite feed, removes retired official rows, and preserves the calendar on partial failure',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  for(const name of ['0001_initial.sql','0002_events.sql','0017_community_events.sql'])sqlite.exec(readFileSync(new URL(`../../migrations/${name}`,import.meta.url),'utf8'));
  let writes=0;
  function prepare(query:string){let params:(string|number|null)[]=[];return {bind(...values:(string|number|null)[]){params=values;return this;},async run(){writes++;sqlite.prepare(query).run(...params);return {success:true};}};}
  const db={prepare,async batch(statements:ReturnType<typeof prepare>[]){return Promise.all(statements.map(statement=>statement.run()));}} as unknown as D1Database;
  const event=(id:string)=>({citySlug:'sf',name:`Public event ${id}`,hosts:['Community'],eventUrl:`https://www.tech-week.com/go/event/${id}`,startsAt:'2026-10-05T16:00:00Z',endsAt:'2026-10-05T18:00:00Z',timeZone:'America/Los_Angeles',venue:'Embarcadero',neighborhoods:['Embarcadero'],themes:['AI'],formats:['Meetup']});
  const calls:number[]=[],pauses:number[]=[];
  const options=(pages:unknown[][],now:number,total=pages.flat().length)=>({now:()=>now,pause:async(ms:number)=>{pauses.push(ms);},fetcher:(async(_url:unknown,init?:RequestInit)=>{
    const page=JSON.parse(String(init?.body)).params.arguments.page;calls.push(page);
    return Response.json({result:{structuredContent:{events:pages[page-1]??[],total,hasMore:page<pages.length}}});
  }) as typeof fetch});
  try{
    const first=await refreshOfficialEvents(db,options([[event('retired')],[event('retained')]],Date.parse('2026-10-03T08:00:00Z')));
    expect(first.stored).toBe(2);expect(calls).toEqual([1,2]);expect(pauses).toEqual([1100]);
    const count=writes;
    await expect(refreshOfficialEvents(db,options([[event('retained')]],Date.parse('2026-10-03T09:00:00Z'),2))).rejects.toThrow('Partial');
    expect(writes).toBe(count);expect(sqlite.prepare('SELECT COUNT(*) n FROM events').get()!.n).toBe(2);
    const refreshed=await refreshOfficialEvents(db,options([[event('retained')]],Date.parse('2026-10-03T10:00:00Z')));
    expect(refreshed.stored).toBe(1);expect(sqlite.prepare('SELECT title FROM events').all()).toEqual([{title:'Public event retained'}]);
    const virtual=await fetchOfficialEvents(options([[{...event('online'),venue:'Online',neighborhoods:['Online']}]],Date.now()));
    expect(virtual.events[0]?.lat).toBeNull();expect(virtual.events[0]?.address).toBeNull();
  }finally{sqlite.close();}
});
