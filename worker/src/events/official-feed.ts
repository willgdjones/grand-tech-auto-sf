import { normalizeFeedEvents, type EventSnapshot } from './feed';

export const OFFICIAL_EVENT_FEED = 'https://www.tech-week.com/api/mcp';
export const EVENT_REFRESH_MS = 3 * 60 * 60_000;
export type FeedOptions = {
  fetcher?: typeof fetch;
  pause?(ms: number): Promise<void>;
  now?(): number;
  onPage?(page: number, received: number, total: number): void;
};

/** Public fields only, polite sequential pagination, complete snapshot or failure. */
export async function fetchOfficialEvents(options: FeedOptions = {}): Promise<EventSnapshot> {
  const fetcher=options.fetcher??fetch,pause=options.pause??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  const capturedAt=new Date((options.now??Date.now)()).toISOString(),raw:unknown[]=[];
  let total:number|undefined,complete=false;
  for(let page=1;page<=32;page++){
    if(page>1)await pause(1100);
    const response=await fetcher(OFFICIAL_EVENT_FEED,{
      method:'POST',credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(20_000),
      headers:{'content-type':'application/json',accept:'application/json, text/event-stream','user-agent':'GTASFEvents/0.1 (+https://gtasf.com)'},
      body:JSON.stringify({jsonrpc:'2.0',id:page,method:'tools/call',params:{name:'search_events',arguments:{city:['sf'],limit:75,page,sort:'time',direction:'asc'}}}),
    });
    if(!response.ok||!response.body)throw new Error(`Official event feed HTTP ${response.status}; existing events retained`);
    const reader=response.body.getReader(),decoder=new TextDecoder();let body='',bytes=0;
    while(true){
      const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;
      if(bytes>2_000_000){await reader.cancel();throw new Error('Official event feed response too large');}
      body+=decoder.decode(chunk.value,{stream:true});
    }
    const result=JSON.parse(body+decoder.decode()).result,data=result?.structuredContent;
    if(result?.isError||!Array.isArray(data?.events)||data.events.length>75||typeof data.hasMore!=='boolean'
      ||!Number.isSafeInteger(data.total)||data.total<1||data.total>2400||(total!==undefined&&total!==data.total))
      throw new Error('Official event feed changed or returned an invalid page; existing events retained');
    total=data.total;raw.push(...data.events);options.onPage?.(page,raw.length,total!);
    if(!data.hasMore){complete=true;break;}
  }
  if(!complete||raw.length!==total)throw new Error('Partial official event feed; existing events retained');
  const events=await normalizeFeedEvents(raw);
  if(!events.length)throw new Error('Official event feed has no valid SF events; existing events retained');
  return {capturedAt,source:OFFICIAL_EVENT_FEED,sourceTotal:total,complete:true,events};
}
