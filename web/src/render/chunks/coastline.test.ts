import { expect, it, vi } from 'vitest';
import { COASTLINE_MAX_BYTES } from '@gtasf/shared/coastline';
import { loadMapCoastline } from './coastline';

const switches=vi.hoisted(()=>({radar:true,saMapStyle:true}));
vi.mock('@gtasf/shared/flags',()=>({flags:switches}));

it('loads a bounded same-frame coastline and preserves old/failed/flag-off map loading',async()=>{
  const frame={origin:{lat:37.7842,lon:-122.4078},gridRotationDeg:0};
  const data={version:1,frame,units:'metres',bounds:[0,0,100,100],toleranceM:2,source:{label:'OSM fixture',sha256:'a'.repeat(64),ways:1},
    rings:[[[0,0],[100,0],[100,100],[0,100],[0,0]],[[40,40],[40,60],[60,60],[60,40],[40,40]]]};
  const raw=JSON.stringify(data),coastline={path:'/map/releases/source/coastline.json',bytes:new TextEncoder().encode(raw).length};
  const fetcher=vi.fn(async(_url:unknown,_options?:unknown)=>new Response(raw));
  vi.stubGlobal('location',{href:'https://example.test/go/fidi'});vi.stubGlobal('fetch',fetcher);
  try {
    expect(await loadMapCoastline({frame,coastline})).toEqual(data.rings);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://example.test/map/releases/source/coastline.json');
    fetcher.mockClear();
    expect(await loadMapCoastline({frame})).toBeUndefined();
    switches.saMapStyle=false;
    expect(await loadMapCoastline({frame,coastline})).toBeUndefined();
    switches.saMapStyle=true;
    expect(await loadMapCoastline({frame,coastline:{...coastline,bytes:COASTLINE_MAX_BYTES+1}})).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(new Response(' '.repeat(COASTLINE_MAX_BYTES+1)));
    expect(await loadMapCoastline({frame,coastline})).toBeUndefined();
    expect(await loadMapCoastline({frame:{...frame,gridRotationDeg:10},coastline})).toBeUndefined();
    fetcher.mockRejectedValueOnce(new Error('overlay unavailable'));
    expect(await loadMapCoastline({frame,coastline})).toBeUndefined();
  } finally {switches.saMapStyle=true;vi.unstubAllGlobals();}
});
