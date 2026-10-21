import { PNG } from 'pngjs';
import type { Bbox, HeightSampler } from './types';
import { unproject, validateBbox } from './settings';

export interface Tile { z: number; x: number; y: number }
export const tileKey = ({z,x,y}: Tile) => `${z}/${x}/${y}`;
export const tileUrl = (tile: Tile) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${tileKey(tile)}.png`;
function validateZoom(zoom: number): void {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 15) throw new Error('Terrarium zoom must be an integer from 0 to 15');
}
export function tilePosition(lon: number, lat: number, zoom: number): [number, number] {
  validateZoom(zoom);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 85.0511287798066)
    throw new Error('Terrain coordinates must be finite WGS84 degrees within Web Mercator coverage');
  const n = 2 ** zoom;
  return [(lon + 180) / 360 * n, (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n];
}
export function tilesForBbox([w,s,e,n]: Bbox, z: number): Tile[] {
  validateBbox([w,s,e,n]);
  const [x0,y0] = tilePosition(w,n,z), [x1,y1] = tilePosition(e,s,z);
  const tiles: Tile[] = [];
  // A pixel of padding supports bilinear samples on outer tile boundaries.
  for (let y = Math.floor(y0-1/256); y <= Math.floor(y1+1/256); y++)
    for (let x = Math.floor(x0-1/256); x <= Math.floor(x1+1/256); x++) tiles.push({z,x,y});
  return tiles;
}
export const terrariumHeight = (r: number,g: number,b: number) => r*256+g+b/256-32768;
export function decodeTerrarium(bytes: Uint8Array): Float32Array {
  const png = PNG.sync.read(Buffer.from(bytes));
  if (png.width !== 256 || png.height !== 256) throw new Error('Terrain tiles must be 256×256');
  const values = new Float32Array(256*256);
  for (let i=0;i<values.length;i++) {
    const p=i*4;
    if (png.data[p+3] !== 255) throw new Error(`Terrain tile has transparent/no-data pixel ${i%256},${Math.floor(i/256)}`);
    const height=terrariumHeight(png.data[p]!,png.data[p+1]!,png.data[p+2]!);
    if (height === -32768) throw new Error(`Terrain tile has no-data elevation at ${i%256},${Math.floor(i/256)}`);
    values[i]=height;
  }
  return values;
}
/** Interpolate decoded elevations, never gamma-correct or interpolate the encoded RGB bytes. */
export class Terrain implements HeightSampler {
  constructor(readonly zoom: number, readonly tiles: ReadonlyMap<string,Float32Array>) {
    validateZoom(zoom);
    for (const [key, tile] of tiles) {
      if (tile.length !== 256*256) throw new Error(`Terrain tile ${key} must contain 256×256 elevations`);
    }
  }
  private pixel(px: number, py: number): number {
    const x=Math.floor(px/256), y=Math.floor(py/256);
    const tile=this.tiles.get(tileKey({z:this.zoom,x,y}));
    if (!tile) throw new Error(`Missing terrain tile ${this.zoom}/${x}/${y}; refresh the source cache`);
    const height=tile[(py-y*256)*256+px-x*256];
    if (height === undefined || !Number.isFinite(height) || height === -32768)
      throw new Error(`Terrain tile ${this.zoom}/${x}/${y} has no-data at pixel ${px-x*256},${py-y*256}`);
    return height;
  }
  sampleLonLat(lon: number,lat: number): number {
    const [tx,ty]=tilePosition(lon,lat,this.zoom);
    // DEM values describe pixel centres, while slippy coordinates describe pixel edges.
    const px=tx*256-0.5, py=ty*256-0.5, x=Math.floor(px),y=Math.floor(py),u=px-x,v=py-y;
    return (this.pixel(x,y)*(1-u)+this.pixel(x+1,y)*u)*(1-v)
      +(this.pixel(x,y+1)*(1-u)+this.pixel(x+1,y+1)*u)*v;
  }
  sample(x: number,z: number): number {
    const p=unproject(x,z);
    return this.sampleLonLat(p.lon,p.lat);
  }
}
