import { districtAt, type BuildingUse } from '../../../tools/map/src/districts';

export const FRONT_STYLES = ['vic', 'edw', 'mix', 'brk', 'apt', 'shop', 'office', 'tower'] as const;
export type FrontStyle = typeof FRONT_STYLES[number];
export type SideStyle = 'stucco' | 'brick' | 'siding' | 'concrete';

export interface FacadeStyleInput {
  id: string;
  x: number; z: number;
  height: number; footprint: number; frontage: number;
  /** Optional source tags take precedence; existing compact maps retain colours instead. */
  levels?: number;
  use?: BuildingUse;
  colour?: readonly [number, number, number];
  streetName?: string;
}

export function facadeSeed(id: string): number {
  let value = 2166136261;
  for (const character of id) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

/** These are the pipeline's linear land-use colour ratios, not invented OSM tags. */
function colourUse(colour?: readonly [number, number, number]): BuildingUse | undefined {
  if (!colour) return undefined;
  const [r, g, b] = colour;
  if (b > r * 1.03) return 'commercial';
  if (Math.abs(r - g) < 0.012 && g > b * 1.025) return 'industrial';
  if (r > g * 1.10 && r < g * 1.17 && g > b * 1.18) return 'retail';
  return undefined;
}

const VICTORIAN = new Set(['mission', 'castro', 'haight-ashbury', 'western-addition', 'hayes-valley', 'pacific-heights', 'noe-valley']);
const BRICK = new Set(['soma', 'dogpatch', 'potrero-hill', 'bayview']);
const SHOP_STREETS = /^(Mission|Valencia|Castro|Haight|Clement|Geary|Irving|Judah|Fillmore|Chestnut|Union|Columbus|Market|24th|Divisadero) (Street|Boulevard|Avenue)$/i;

/** One deterministic choice per source building, shared by every street face and every reload. */
export function assignFacadeStyle(input: FacadeStyleInput): {
  style: FrontStyle; side: SideStyle; floors: number; seed: number; district: string | undefined; use: BuildingUse | undefined;
} {
  const profile = districtAt(input.x, input.z), district = profile?.id;
  const use = input.use ?? colourUse(input.colour) ?? profile?.defaultBuildingUse;
  const seed = facadeSeed(input.id), variant = seed % 100;
  const floors = Number.isFinite(input.levels) && input.levels! > 0
    ? Math.min(100, Math.max(1, Math.round(input.levels!))) : Math.min(100, Math.max(1, Math.round(input.height / 3.2)));
  // FiDi is roughly 1 km north-east of the local frame origin. A distance fallback covers
  // high-rises just outside its art-region boundary without turning outer apartments into glass.
  const downtown = district === 'fidi' || district === 'soma' || Math.hypot(input.x - 500, input.z + 800) < 1100;
  const commercialStreet = Boolean(input.streetName && SHOP_STREETS.test(input.streetName));
  let style: FrontStyle;
  if (input.height >= 60 && (downtown || use === 'commercial' || input.height >= 90)) style = 'tower';
  else if (input.height <= 22 && input.footprint >= 450 && (use === 'industrial' || Boolean(district && BRICK.has(district)) || input.footprint >= 1500)) style = use === 'retail' ? 'mix' : 'brk';
  else if ((downtown && floors >= 5) || (use === 'commercial' && floors >= 4)) style = 'office';
  else if ((use === 'retail' || commercialStreet) && floors <= 2) style = 'shop';
  else if (use === 'retail' || commercialStreet) style = 'mix';
  else if (use === 'industrial' || (district && BRICK.has(district) && (input.footprint > 350 || variant < 35))) style = 'brk';
  // Big low-rise footprints (warehouses, garages, halls) read as brick lofts, not a stretched apartment front.
  else if (floors <= 3 && input.footprint > 600) style = 'brk';
  else if (floors >= 5 || input.frontage > 21 || input.footprint > 700) style = 'apt';
  else if (district && VICTORIAN.has(district) && floors >= 2 && floors <= 4) style = variant < 58 ? 'vic' : 'edw';
  else if (floors <= 1) style = variant < 70 ? 'edw' : 'brk';
  else style = variant < 65 ? 'edw' : variant < 85 ? 'apt' : 'vic';
  const side: SideStyle = style === 'brk' ? 'brick' : style === 'vic' || style === 'edw' ? 'siding'
    : style === 'tower' || style === 'office' ? 'concrete' : 'stucco';
  return { style, side, floors, seed, district, use };
}
