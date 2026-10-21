import { expect,it,vi } from 'vitest';
import { createEventFeed,EVENT_FEED_INTERVAL_MS } from './feed';

it('shares requests, refreshes one calendar, retains good data on failure and resumes a stale tab',async()=>{
  vi.useFakeTimers();
  const visibility=Object.assign(new EventTarget(),{hidden:false});vi.stubGlobal('document',visibility);
  const event={id:'public-event',title:'Original title',start:'2026-10-05T16:00:00Z',end:null,lat:37.79,lon:-122.4,approx:true,url:'https://www.tech-week.com/calendar/sf'};
  const onEvents=vi.fn(),onError=vi.fn();let title=event.title,fail=false,release:(()=>void)|undefined;
  const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
    if(release!==undefined)await new Promise<void>((resolve,reject)=>{release=resolve;init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')));});
    return fail?new Response('',{status:503}):Response.json({events:[{...event,title}]});
  }) as unknown as typeof fetch;
  const feed=createEventFeed({enabled:true,refreshEnabled:true,fetcher,onEvents,onError})!;
  try{
    await feed.ready;expect(fetcher).toHaveBeenCalledTimes(1);expect(onEvents).toHaveBeenCalledTimes(1);
    fail=true;await vi.advanceTimersByTimeAsync(EVENT_FEED_INTERVAL_MS);
    expect(feed.events[0]?.title).toBe('Original title');expect(onEvents).toHaveBeenCalledTimes(1);expect(onError).toHaveBeenCalledTimes(1);
    fail=false;title='Updated by the real feed';await vi.advanceTimersByTimeAsync(60_000);
    expect(feed.events[0]?.title).toBe(title);expect(onEvents).toHaveBeenCalledTimes(2);
    visibility.hidden=true;const before=vi.mocked(fetcher).mock.calls.length;await vi.advanceTimersByTimeAsync(EVENT_FEED_INTERVAL_MS+60_000);
    expect(fetcher).toHaveBeenCalledTimes(before);
    visibility.hidden=false;visibility.dispatchEvent(new Event('visibilitychange'));await feed.refresh();expect(fetcher).toHaveBeenCalledTimes(before+1);
    release=()=>{};const first=feed.refresh(),second=feed.refresh();expect(first).toBe(second);
    await Promise.resolve();
    const calls=vi.mocked(fetcher).mock.calls.length;feed.destroy();await first;await vi.advanceTimersByTimeAsync(EVENT_FEED_INTERVAL_MS*2);
    expect(fetcher).toHaveBeenCalledTimes(calls);expect(onError).toHaveBeenCalledTimes(1);
  }finally{feed.destroy();vi.unstubAllGlobals();vi.useRealTimers();}
});
