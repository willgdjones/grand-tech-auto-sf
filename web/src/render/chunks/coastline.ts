import { flags } from '@gtasf/shared/flags';
import { takeEarlyAsset } from './world';
import { COASTLINE_MAX_BYTES, validCoastline, type CoastlineData } from '@gtasf/shared/coastline';

interface CoastlineManifest {
  frame: CoastlineData['frame'];
  coastline?: { path: string; bytes: number };
}

/** Optional map decoration. Old manifests, missing assets and invalid overlays never block spawn. */
export async function loadMapCoastline(manifest: CoastlineManifest, baseUrl='/map/lombard/'): Promise<CoastlineData['rings']|undefined> {
  const asset=manifest.coastline;
  if(!flags.radar||!flags.saMapStyle||!asset||!Number.isFinite(asset.bytes)||asset.bytes<=0||asset.bytes>COASTLINE_MAX_BYTES)return;
  try {
    const base=new URL(baseUrl,location.href);
    const url=new URL(asset.path,base),early=takeEarlyAsset(url.href); // started at boot by prefetchMapCore
    // The early fetch has no timeout of its own: give it the same 3 s, then fall back (never hang HUD setup).
    const response=(early?await Promise.race([early.catch(()=>undefined),new Promise<undefined>(resolve=>setTimeout(resolve,3000))]):undefined)??await fetch(url,{signal:AbortSignal.timeout(3000)});
    if(!response.ok||!response.body)return;
    // Response streams contain decoded bytes, even when R2 serves gzip. Enforce the actual cap too.
    const reader=response.body.getReader(),parts:Uint8Array[]=[];let total=0;
    for(;;) {
      const {value,done}=await reader.read();if(done)break;
      total+=value.byteLength;
      if(total>COASTLINE_MAX_BYTES){await reader.cancel();return;}
      parts.push(value);
    }
    if(total!==asset.bytes)return;
    const bytes=new Uint8Array(total);let offset=0;
    for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    const data:unknown=JSON.parse(new TextDecoder().decode(bytes));
    if(validCoastline(data,manifest.frame))return data.rings;
  } catch { /* This overlay is optional; the graph, chunks and radar remain usable. */ }
}
