import { flags } from '@gtasf/shared/flags';
import type { RadarEvent } from '../radar/radar';

export const EVENT_FEED_INTERVAL_MS=5*60_000;
const RETRY_MS=60_000;

/** One calendar request fans out to every view. Errors never replace the last valid data. */
export function createEventFeed(options:{
  onEvents(events:readonly RadarEvent[]):void;
  onError?(message:string):void;
  url?:string;fetcher?:typeof fetch;enabled?:boolean;refreshEnabled?:boolean;
}){
  if(!(options.enabled??(flags.eventsApi||flags.events||flags.localEventSnapshot)))return null;
  const fetcher=options.fetcher??fetch,refreshEnabled=options.refreshEnabled??flags.eventsRefresh;
  const visibility=typeof document==='undefined'?undefined:document;
  let disposed=false,events:readonly RadarEvent[]=[],lastAttempt=-Infinity;
  let pending:Promise<void>|undefined,controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  function schedule(delay:number){
    clearTimeout(timer);if(disposed||!refreshEnabled)return;
    timer=setTimeout(()=>{if(visibility?.hidden)schedule(RETRY_MS);else void refresh();},delay);
  }
  function refresh():Promise<void>{
    if(disposed)return Promise.resolve();if(pending)return pending;
    lastAttempt=Date.now();controller=new AbortController();
    const active=controller,signal=active.signal,timeout=setTimeout(()=>active.abort(),8000);
    pending=(async()=>{
      let delay=EVENT_FEED_INTERVAL_MS;
      try{
        // Even a synchronous fetch failure must settle after pending has been assigned.
        await Promise.resolve();if(disposed)return;
        const response=await fetcher(options.url??'/api/events',{signal,credentials:'same-origin',cache:'no-cache'});
        if(!response.ok)throw new Error(`Events HTTP ${response.status}`);
        const text=await response.text();if(text.length>3_000_000)throw new Error('Calendar response is too large');
        const data=JSON.parse(text) as {events?:RadarEvent[]};
        if(!Array.isArray(data.events)||data.events.length>5000||!data.events.every(event=>event&&typeof event.id==='string'
          &&typeof event.title==='string'&&typeof event.url==='string'&&Number.isFinite(Date.parse(event.start))
          &&((event.lat===null&&event.lon===null)||(Number.isFinite(event.lat)&&Number.isFinite(event.lon)))))
          throw new Error('Calendar response is invalid');
        if(!disposed){events=data.events;options.onEvents(events);}
      }catch{
        delay=RETRY_MS;if(!disposed)options.onError?.(events.length?'Calendar refresh unavailable. Showing the last loaded events.':'Events could not load. Retrying shortly.');
      }finally{clearTimeout(timeout);controller=undefined;pending=undefined;schedule(delay);}
    })();
    return pending;
  }
  function visible(){if(!visibility?.hidden&&Date.now()-lastAttempt>=EVENT_FEED_INTERVAL_MS)void refresh();}
  if(refreshEnabled)visibility?.addEventListener('visibilitychange',visible);
  const ready=refresh();
  return {ready,refresh,get events(){return events;},destroy(){if(disposed)return;disposed=true;clearTimeout(timer);controller?.abort();visibility?.removeEventListener('visibilitychange',visible);}};
}
