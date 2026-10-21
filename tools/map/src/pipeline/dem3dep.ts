import type { Bbox, HeightSampler } from './types';
import { unproject } from './settings';

/** USGS 3DEP bare-earth DEM (public domain), fetched as uncompressed Float32 GeoTIFF tiles in
 * EPSG:4326 from the official ImageServer. Opt-in with MAP_DEM=3dep; Terrarium remains the fallback
 * for no-data pixels (Bay water, gaps). Elevations are NAVD88 metres.
 */
export const DEM_SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
export const DEM_PIXELS = 1024;
const NODATA = -9999;

export interface DemTile { i: number; j: number; bbox: Bbox }
export function demTiles([w,s,e,n]: Bbox, degrees: number): DemTile[] {
  const tiles: DemTile[] = [];
  for (let j=Math.floor(s/degrees);j<=Math.floor(n/degrees);j++)
    for (let i=Math.floor(w/degrees);i<=Math.floor(e/degrees);i++)
      tiles.push({i,j,bbox:[i*degrees,j*degrees,(i+1)*degrees,(j+1)*degrees]});
  return tiles;
}
export function demTileUrl({bbox}: DemTile): string {
  const params=new URLSearchParams({bbox:bbox.join(','),bboxSR:'4326',imageSR:'4326',size:`${DEM_PIXELS},${DEM_PIXELS}`,
    format:'tiff',pixelType:'F32',noData:String(NODATA),compression:'None',interpolation:'RSP_BilinearInterpolation',f:'image'});
  return `${DEM_SERVICE}?${params}`;
}

/** Minimal baseline-TIFF reader: little/big endian, uncompressed, one Float32 sample, strips or tiles. */
export function decodeFloatTiff(bytes: Uint8Array): { width: number; height: number; values: Float32Array } {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const le=view.getUint16(0)===0x4949;
  if (view.getUint16(2,le)!==42) throw new Error('Not a classic TIFF');
  const ifd=view.getUint32(4,le),count=view.getUint16(ifd,le),tags=new Map<number,number[]>();
  const size=[0,1,1,2,4,8,1,1,2,4,8,4,8];
  for (let k=0;k<count;k++) {
    const at=ifd+2+k*12,tag=view.getUint16(at,le),type=view.getUint16(at+2,le),n=view.getUint32(at+4,le);
    const bytesPer=size[type]??1,base=n*bytesPer<=4?at+8:view.getUint32(at+8,le),list:number[]=[];
    for (let m=0;m<n&&m<1<<20;m++) {
      const p=base+m*bytesPer;
      list.push(type===3?view.getUint16(p,le):type===4?view.getUint32(p,le):type===16?Number(view.getBigUint64(p,le)):view.getUint8(p));
    }
    tags.set(tag,list);
  }
  const one=(t:number,d?:number)=>{const v=tags.get(t)?.[0]??d;if(v===undefined)throw new Error(`TIFF tag ${t} missing`);return v;};
  const width=one(256),height=one(257);
  if (one(259,1)!==1||one(258)!==32||one(339,1)!==3||one(277,1)!==1) throw new Error('DEM TIFF must be uncompressed single-band Float32');
  const values=new Float32Array(width*height);
  const read=(offset:number,x0:number,y0:number,w:number,h:number,stride:number)=>{
    for (let y=0;y<h&&y0+y<height;y++)for (let x=0;x<w&&x0+x<width;x++)values[(y0+y)*width+x0+x]=view.getFloat32(offset+(y*stride+x)*4,le);
  };
  if (tags.has(324)) {
    const tw=one(322),th=one(323),offsets=tags.get(324)!,across=Math.ceil(width/tw);
    offsets.forEach((o,k)=>read(o,(k%across)*tw,Math.floor(k/across)*th,tw,th,tw));
  } else {
    const rows=one(278,height);
    tags.get(273)!.forEach((o,k)=>read(o,0,k*rows,width,rows,width));
  }
  return {width,height,values};
}

export class Dem3dep implements HeightSampler {
  stats={samples:0,fallbacks:0};
  constructor(readonly degrees:number,readonly tiles:ReadonlyMap<string,Float32Array>,readonly fallback:HeightSampler){}
  private pixel(px:number,py:number):number|undefined {
    // py counts north to south from the top edge of the tile grid row j.
    const i=Math.floor(px/DEM_PIXELS),j=Math.floor(py/DEM_PIXELS);
    const tile=this.tiles.get(`${i},${-j-1}`);if(!tile)return undefined;
    const v=tile[(py-j*DEM_PIXELS)*DEM_PIXELS+px-i*DEM_PIXELS];
    return v===undefined||!Number.isFinite(v)||v<=NODATA+1?undefined:v;
  }
  sample(x:number,z:number):number {
    this.stats.samples++;
    const {lon,lat}=unproject(x,z),scale=DEM_PIXELS/this.degrees;
    // Pixel centres; rows run from north (top) so negate latitude.
    const px=lon*scale-.5,py=-lat*scale-.5,x0=Math.floor(px),y0=Math.floor(py),u=px-x0,v=py-y0;
    const a=this.pixel(x0,y0),b=this.pixel(x0+1,y0),c=this.pixel(x0,y0+1),d=this.pixel(x0+1,y0+1);
    if (a===undefined||b===undefined||c===undefined||d===undefined){this.stats.fallbacks++;return this.fallback.sample(x,z);}
    return (a*(1-u)+b*u)*(1-v)+(c*(1-u)+d*u)*v;
  }
}
