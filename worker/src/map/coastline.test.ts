import { expect, it, vi } from 'vitest';
import { serveMapAsset } from './assets';

vi.mock('@gtasf/shared/flags',()=>({flags:{mapStreaming:true}}));

it('serves only the published coastline key through the existing map route',async()=>{
  const key=`map/releases/${'a'.repeat(64)}/coastline.json`,body=JSON.stringify({version:1,rings:[]});
  const get=vi.fn(async()=>({body:new Response(body).body,httpEtag:'"coast"',httpMetadata:{},size:body.length,
    writeHttpMetadata(headers:Headers){headers.set('Content-Type','application/json');}}));
  const bucket={get} as unknown as R2Bucket;
  const response=await serveMapAsset(new Request(`https://gtasf.test/${key}`),bucket);
  expect(response?.status).toBe(200);
  expect(await response?.json()).toEqual({version:1,rings:[]});
  expect(get).toHaveBeenCalledWith(key);
  get.mockClear();
  expect((await serveMapAsset(new Request(`https://gtasf.test/${key.replace('coastline.json','sources.json')}`),bucket))?.status).toBe(404);
  expect(get).not.toHaveBeenCalled();
});
