/**
 * GTASF billboard placement candidates, not an inventory of existing/leased signs.
 * 140 SF faces anchor to real DataSF street segments; 10 Oakland toll-area faces
 * are manually approximated. Offsets, headings, sizes, mounts and prices are game
 * design. Inspect footprints, road clearance, terrain and sightlines in A10
 * (gtasf-gy8) before enabling flags.billboards; rentals need their own acceptance.
 * Keep flags.billboards / impressions / rentals off until their owning beads pass.
 *
 * Source: SF Public Works / DataSF, Streets – Active and Retired, 3psu-pn9h,
 * https://data.sf.gov/d/3psu-pn9h (active segments retrieved 2026-10-02 PT).
 * Public Domain Dedication and License: https://opendatacommons.org/licenses/pddl/1.0/
 * Source CNNs are retained per face. Positions are sampled along centerlines and
 * offset onto candidate roadside/roof locations; the source does NOT locate ads.
 * Toll-area reference: https://tiremeetsroad.com/2022/05/09/how-to-get-san-francisco-oakland-bay-bridge-toll-plaza-pedestrian-walkway-tunnel-entrance/
 * No source ad text, creative, logos or commercial price quotes are reused.
 */

export const BILLBOARD_PRICE_TIERS = {
  neighborhood: { label: 'Neighborhood', baseWeeklyCents: 2_500 },
  corridor: { label: 'City corridor', baseWeeklyCents: 7_500 },
  gateway: { label: 'Freeway gateway', baseWeeklyCents: 15_000 },
  landmark: { label: 'Landmark approach', baseWeeklyCents: 25_000 },
} as const;

/** Authored starting prices in USD cents; demand pricing is a separate system. */
export type BillboardPriceTier = keyof typeof BILLBOARD_PRICE_TIERS;
export type BillboardDistrict =
  | 'us-101' | 'i-80' | 'bay-bridge-toll' | 'market' | 'soma' | 'embarcadero' | 'mission';

/** Minimum founder billboard-tier rank (shared/founder/ladder.ts BILLBOARD_TIER_RANK, 0..4) a startup must
 *  have reached to earn a billboard in each district — the "billboard upgrade per stage" ladder: local
 *  waterfront/neighbourhood faces take any stage; Market St needs Seed (rank 1); the Bay Bridge / freeway
 *  approaches need Series A (rank 2); the US-101 skyline needs Unicorn (rank 3). Slots with no eligible
 *  startup fall back to the full list so the city never goes blank (web/src/founder/cityBillboards.ts). */
export const DISTRICT_BILLBOARD_RANK: Readonly<Record<BillboardDistrict, number>> = Object.freeze({
  embarcadero: 0, soma: 0, mission: 0, market: 1, 'bay-bridge-toll': 2, 'i-80': 2, 'us-101': 3,
});

export interface BillboardSurface {
  /** Persist this ID for rentals/impressions. Never derive identity from array order. */
  readonly id: string;
  readonly name: string;
  readonly district: BillboardDistrict;
  /** WGS84 degrees of the face center's ground projection. */
  readonly lat: number;
  readonly lon: number;
  /** Outward face normal, clockwise from true north: N=0 E=90 S=180 W=270.
   * With theta = headingDeg * PI / 180, its world normal is (sin(theta), 0, -cos(theta)).
   * This is not vehicle yaw or the direction a viewing vehicle travels.
   */
  readonly headingDeg: number;
  readonly widthMetres: number;
  readonly heightMetres: number;
  /** Face-center height above sampled ground; never an absolute elevation. */
  readonly centerHeightAboveGroundMetres: number;
  readonly mount: 'rooftop' | 'wall' | 'roadside';
  readonly baseWeeklyPriceTier: BillboardPriceTier;
  /** The Oakland toll plaza is outside the current SF_BBOX. Never clamp it into SF.
   * Regional faces require explicit map extension/coverage before runtime use.
   */
  readonly coverage: 'sf' | 'regional-backdrop';
  /** DataSF centerline network number. Null only for authored Oakland positions. */
  readonly sourceStreetCnn: string | null;
}

export const BILLBOARD_SURFACES = [
  // us-101
  {
    id: "sf-bb-us-101-01", name: "US 101 Northbound: US 101 N Off Ramp to US 101 N On Ramp / approach 01", district: "us-101",
    lat: 37.716128, lon: -122.398001, headingDeg: 174.2,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19224000",
  },
  {
    id: "sf-bb-us-101-02", name: "US 101 Northbound: US 101 N Off Ramp to US 101 N On Ramp / approach 02", district: "us-101",
    lat: 37.718612, lon: -122.398804, headingDeg: 153.1,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19224000",
  },
  {
    id: "sf-bb-us-101-03", name: "US 101 Northbound: US 101 N On Ramp to US 101 To I-280 Ramp / approach 03", district: "us-101",
    lat: 37.721206, lon: -122.399553, headingDeg: 178.8,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19223000",
  },
  {
    id: "sf-bb-us-101-04", name: "US 101 Northbound: US 101 N On Ramp to US 101 To I-280 Ramp / approach 04", district: "us-101",
    lat: 37.723733, lon: -122.400531, headingDeg: 147.4,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19223000",
  },
  {
    id: "sf-bb-us-101-05", name: "US 101 Northbound: US 101 To I-280 Ramp to US 101 N Off Ramp / approach 05", district: "us-101",
    lat: 37.726248, lon: -122.401497, headingDeg: 177.8,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19222001",
  },
  {
    id: "sf-bb-us-101-06", name: "US 101 Northbound: US 101 To I-280 Ramp to US 101 N Off Ramp / approach 06", district: "us-101",
    lat: 37.72878, lon: -122.402474, headingDeg: 145.6,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19222001",
  },
  {
    id: "sf-bb-us-101-07", name: "US 101 Northbound: US 101 N Off Ramp to US 101 N On Ramp / approach 07", district: "us-101",
    lat: 37.731205, lon: -122.403816, headingDeg: 172.9,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19222002",
  },
  {
    id: "sf-bb-us-101-08", name: "US 101 Northbound: US 101 N Off Ramp to US 101 N On Ramp / approach 08", district: "us-101",
    lat: 37.733652, lon: -122.405133, headingDeg: 138.9,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19222002",
  },
  {
    id: "sf-bb-us-101-09", name: "US 101 Northbound: US 101 N Off Ramp to US 101 N On Ramp / approach 09", district: "us-101",
    lat: 37.736027, lon: -122.406594, headingDeg: 167.6,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19222002",
  },
  {
    id: "sf-bb-us-101-10", name: "US 101 Northbound: US 101 N Off Ramp to US 101 N On Ramp / approach 10", district: "us-101",
    lat: 37.738397, lon: -122.40743, headingDeg: 159.6,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19222002",
  },
  {
    id: "sf-bb-us-101-11", name: "US 101 Northbound: I-280 To US 101 Ramp to US 101 N Off Ramp / approach 11", district: "us-101",
    lat: 37.740845, lon: -122.40712, headingDeg: 211.5,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19220000",
  },
  {
    id: "sf-bb-us-101-12", name: "US 101 Northbound: I-280 To US 101 Ramp to US 101 N Off Ramp / approach 12", district: "us-101",
    lat: 37.743069, lon: -122.405658, headingDeg: 196.8,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19220000",
  },
  {
    id: "sf-bb-us-101-13", name: "US 101 Northbound: US 101 N Off Ramp to US 101 N On Ramp / approach 13", district: "us-101",
    lat: 37.745583, lon: -122.404244, headingDeg: 207.2,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19218000",
  },
  {
    id: "sf-bb-us-101-14", name: "US 101 Northbound: US 101 N Off Ramp to US 101 N On Ramp / approach 14", district: "us-101",
    lat: 37.74813, lon: -122.403461, headingDeg: 178.7,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19218000",
  },
  {
    id: "sf-bb-us-101-15", name: "US 101 Northbound: US 101 N Off Ramp to US 101 N On Ramp / approach 15", district: "us-101",
    lat: 37.750677, lon: -122.402652, headingDeg: 209.5,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19218000",
  },
  {
    id: "sf-bb-us-101-16", name: "US 101 Northbound: US 101 N On Ramp to US 101 N Off Ramp / approach 16", district: "us-101",
    lat: 37.753413, lon: -122.402305, headingDeg: 160.8,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19215000",
  },
  {
    id: "sf-bb-us-101-17", name: "US 101 Northbound: US 101 N On Ramp to US 101 N Off Ramp / approach 17", district: "us-101",
    lat: 37.756055, lon: -122.402562, headingDeg: 188.3,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19215000",
  },
  {
    id: "sf-bb-us-101-18", name: "US 101 Northbound: US 101 N On Ramp to US 101 N Off Ramp / approach 18", district: "us-101",
    lat: 37.758491, lon: -122.404404, headingDeg: 117.7,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19215000",
  },
  {
    id: "sf-bb-us-101-19", name: "US 101 Northbound: US 101 N On Ramp to US 101 N Off Ramp / approach 19", district: "us-101",
    lat: 37.760427, lon: -122.40577, headingDeg: 195.0,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19215000",
  },
  {
    id: "sf-bb-us-101-20", name: "US 101 Northbound: US 101 N Off Ramp to I-80 To US 101 Ramp / approach 20", district: "us-101",
    lat: 37.762759, lon: -122.404755, headingDeg: 185.5,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19214000",
  },
  {
    id: "sf-bb-us-101-21", name: "US 101 Northbound: I-80 To US 101 Ramp to US 101 N Off Ramp / approach 21", district: "us-101",
    lat: 37.765539, lon: -122.404371, headingDeg: 187.8,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19207000",
  },
  {
    id: "sf-bb-us-101-22", name: "US 101 Northbound: I-80 To US 101 Ramp to US 101 N Off Ramp / approach 22", district: "us-101",
    lat: 37.768261, lon: -122.405186, headingDeg: 127.7,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19207000",
  },
  {
    id: "sf-bb-us-101-23", name: "US 101 Northbound: I-80 To US 101 Ramp to US 101 Northbound / approach 23", district: "us-101",
    lat: 37.769922, lon: -122.411595, headingDeg: 113.0,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19217000",
  },
  {
    id: "sf-bb-us-101-24", name: "US 101 Northbound: I-80 To US 101 Ramp to US 101 Northbound / approach 24", district: "us-101",
    lat: 37.770021, lon: -122.414978, headingDeg: 76.7,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19217000",
  },
  {
    id: "sf-bb-us-101-25", name: "US 101 Northbound: US 101 N Off Ramp to I-80 To US 101 Ramp / approach 25", district: "us-101",
    lat: 37.769297, lon: -122.409011, headingDeg: 248.0,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19206000",
  },
  {
    id: "sf-bb-us-101-26", name: "US 101 Northbound: US 101 Northbound to US 101 Northbound / approach 26", district: "us-101",
    lat: 37.770373, lon: -122.417682, headingDeg: 85.7,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19208000",
  },
  // i-80
  {
    id: "sf-bb-i-80-01", name: "I-80 Eastbound: I-80 To US 101 Ramp to I-80 E Off Ramp / approach 01", district: "i-80",
    lat: 37.770896, lon: -122.405181, headingDeg: 172.6,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19370000",
  },
  {
    id: "sf-bb-i-80-02", name: "I-80 Eastbound: I-80 To US 101 Ramp to I-80 E Off Ramp / approach 02", district: "i-80",
    lat: 37.771652, lon: -122.405682, headingDeg: 140.6,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19370000",
  },
  {
    id: "sf-bb-i-80-03", name: "I-80 Eastbound: I-80 To US 101 Ramp to I-80 E Off Ramp / approach 03", district: "i-80",
    lat: 37.772395, lon: -122.406036, headingDeg: 177.8,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19370000",
  },
  {
    id: "sf-bb-i-80-04", name: "I-80 Eastbound: I-80 E Off Ramp to I-80 E On Ramp / approach 04", district: "i-80",
    lat: 37.773117, lon: -122.40605, headingDeg: 166.1,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19369000",
  },
  {
    id: "sf-bb-i-80-05", name: "I-80 Eastbound: I-80 E Off Ramp to I-80 E On Ramp / approach 05", district: "i-80",
    lat: 37.773855, lon: -122.405898, headingDeg: 210.0,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19369000",
  },
  {
    id: "sf-bb-i-80-06", name: "I-80 Eastbound: I-80 E Off Ramp to I-80 E On Ramp / approach 06", district: "i-80",
    lat: 37.774545, lon: -122.405526, headingDeg: 194.2,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19369000",
  },
  {
    id: "sf-bb-i-80-07", name: "I-80 Eastbound: I-80 E Off Ramp to I-80 E On Ramp / approach 07", district: "i-80",
    lat: 37.775203, lon: -122.404983, headingDeg: 232.7,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19369000",
  },
  {
    id: "sf-bb-i-80-08", name: "I-80 Eastbound: I-80 E Off Ramp to I-80 E On Ramp / approach 08", district: "i-80",
    lat: 37.775819, lon: -122.40432, headingDeg: 207.7,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19369000",
  },
  {
    id: "sf-bb-i-80-09", name: "I-80 Eastbound: I-80 E On Ramp to I-80 E Off Ramp / approach 09", district: "i-80",
    lat: 37.776328, lon: -122.403607, headingDeg: 250.1,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19368000",
  },
  {
    id: "sf-bb-i-80-10", name: "I-80 Eastbound: I-80 E On Ramp to I-80 E Off Ramp / approach 10", district: "i-80",
    lat: 37.776809, lon: -122.402734, headingDeg: 220.1,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19368000",
  },
  {
    id: "sf-bb-i-80-11", name: "I-80 Eastbound: I-80 E On Ramp to I-80 E Off Ramp / approach 11", district: "i-80",
    lat: 37.777252, lon: -122.401853, headingDeg: 252.6,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19368000",
  },
  {
    id: "sf-bb-i-80-12", name: "I-80 Eastbound: I-80 E On Ramp to I-80 E Off Ramp / approach 12", district: "i-80",
    lat: 37.777721, lon: -122.400956, headingDeg: 221.3,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19368000",
  },
  {
    id: "sf-bb-i-80-13", name: "I-80 Eastbound: I-80 E Off Ramp to I-80 E On Ramp / approach 13", district: "i-80",
    lat: 37.778339, lon: -122.400105, headingDeg: 239.2,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19367000",
  },
  {
    id: "sf-bb-i-80-14", name: "I-80 Eastbound: I-80 E Off Ramp to I-80 E On Ramp / approach 14", district: "i-80",
    lat: 37.778942, lon: -122.399362, headingDeg: 209.2,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19367000",
  },
  {
    id: "sf-bb-i-80-15", name: "I-80 Eastbound: I-80 E Off Ramp to I-80 E On Ramp / approach 15", district: "i-80",
    lat: 37.779545, lon: -122.39862, headingDeg: 239.2,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19367000",
  },
  {
    id: "sf-bb-i-80-16", name: "I-80 Eastbound: I-80 E Off Ramp to I-80 E On Ramp / approach 16", district: "i-80",
    lat: 37.780148, lon: -122.397878, headingDeg: 209.2,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19367000",
  },
  {
    id: "sf-bb-i-80-17", name: "I-80 Eastbound: I-80 E On Ramp to I-80 E On Ramp / approach 17", district: "i-80",
    lat: 37.780751, lon: -122.397136, headingDeg: 239.2,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19366000",
  },
  {
    id: "sf-bb-i-80-18", name: "I-80 Eastbound: I-80 E On Ramp to I-80 E On Ramp / approach 18", district: "i-80",
    lat: 37.781354, lon: -122.396393, headingDeg: 209.2,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19366000",
  },
  {
    id: "sf-bb-i-80-19", name: "I-80 Eastbound: I-80 E On Ramp to I-80 E On Ramp / approach 19", district: "i-80",
    lat: 37.782013, lon: -122.395637, headingDeg: 231.3,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19366000",
  },
  {
    id: "sf-bb-i-80-20", name: "I-80 Eastbound: I-80 E On Ramp to I-80 E On Ramp / approach 20", district: "i-80",
    lat: 37.782692, lon: -122.395008, headingDeg: 201.3,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19366000",
  },
  {
    id: "sf-bb-i-80-21", name: "I-80 Eastbound: I-80 E On Ramp to I-80 E On Ramp / approach 21", district: "i-80",
    lat: 37.783257, lon: -122.394318, headingDeg: 240.1,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19366000",
  },
  {
    id: "sf-bb-i-80-22", name: "I-80 Eastbound: I-80 E On Ramp to I-80 E On Ramp / approach 22", district: "i-80",
    lat: 37.783851, lon: -122.393565, headingDeg: 210.1,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19366000",
  },
  {
    id: "sf-bb-i-80-23", name: "I-80 Eastbound: I-80 E On Ramp to I-80 E On Ramp / approach 23", district: "i-80",
    lat: 37.784367, lon: -122.392821, headingDeg: 249.2,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19365000",
  },
  {
    id: "sf-bb-i-80-24", name: "I-80 Eastbound: I-80 E On Ramp to I-80 E On Ramp / approach 24", district: "i-80",
    lat: 37.784859, lon: -122.391958, headingDeg: 219.2,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: "19365000",
  },
  // market
  {
    id: "sf-bb-market-01", name: "Market St: Page St to Franklin St", district: "market",
    lat: 37.773998, lon: -122.420243, headingDeg: 314.9,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8756101",
  },
  {
    id: "sf-bb-market-02", name: "Market St: Van Ness Ave to Page St", district: "market",
    lat: 37.774874, lon: -122.419909, headingDeg: 134.9,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8755101",
  },
  {
    id: "sf-bb-market-03", name: "Market St: 11th St to Van Ness Ave", district: "market",
    lat: 37.77518, lon: -122.41875, headingDeg: 314.9,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8754102",
  },
  {
    id: "sf-bb-market-04", name: "Market St: Polk St to Van Ness Ave", district: "market",
    lat: 37.776025, lon: -122.418608, headingDeg: 135.0,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8754201",
  },
  {
    id: "sf-bb-market-05", name: "Market St: Larkin St to Polk St", district: "market",
    lat: 37.776832, lon: -122.416663, headingDeg: 315.0,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8753101",
  },
  {
    id: "sf-bb-market-06", name: "Market St: Hayes St to Larkin St", district: "market",
    lat: 37.777795, lon: -122.416366, headingDeg: 134.7,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8752202",
  },
  {
    id: "sf-bb-market-07", name: "Market St: Hyde St to Larkin St", district: "market",
    lat: 37.777923, lon: -122.415284, headingDeg: 314.9,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8752101",
  },
  {
    id: "sf-bb-market-08", name: "Market St: 7th St to Hyde St", district: "market",
    lat: 37.779723, lon: -122.413785, headingDeg: 135.0,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8751101",
  },
  {
    id: "sf-bb-market-09", name: "Market St: Jones St to 7th St", district: "market",
    lat: 37.780573, lon: -122.412079, headingDeg: 315.0,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8750203",
  },
  {
    id: "sf-bb-market-10", name: "Market St: Taylor St to 7th St", district: "market",
    lat: 37.78148, lon: -122.411559, headingDeg: 135.1,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8750101",
  },
  {
    id: "sf-bb-market-11", name: "Market St: Mason St to Taylor St", district: "market",
    lat: 37.782636, lon: -122.409467, headingDeg: 315.0,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8749201",
  },
  {
    id: "sf-bb-market-12", name: "Market St: 5th St to Mason St", district: "market",
    lat: 37.783762, lon: -122.408663, headingDeg: 135.1,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8748101",
  },
  {
    id: "sf-bb-market-13", name: "Market St: Stockton St to Powell St", district: "market",
    lat: 37.784092, lon: -122.407469, headingDeg: 315.2,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8747103",
  },
  {
    id: "sf-bb-market-14", name: "Market St: Stockton St to Powell St", district: "market",
    lat: 37.785273, lon: -122.406739, headingDeg: 135.2,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8747102",
  },
  {
    id: "sf-bb-market-15", name: "Market St: Grant Ave to Stockton St", district: "market",
    lat: 37.786116, lon: -122.405053, headingDeg: 315.0,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8746201",
  },
  {
    id: "sf-bb-market-16", name: "Market St: 3rd St to Grant Ave", district: "market",
    lat: 37.787308, lon: -122.404161, headingDeg: 135.0,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8745101",
  },
  {
    id: "sf-bb-market-17", name: "Market St: Annie St to 3rd St", district: "market",
    lat: 37.787673, lon: -122.402927, headingDeg: 315.0,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8744102",
  },
  {
    id: "sf-bb-market-18", name: "Market St: Montgomery St to Annie St", district: "market",
    lat: 37.788527, lon: -122.402619, headingDeg: 135.0,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8744101",
  },
  {
    id: "sf-bb-market-19", name: "Market St: 2nd St to Montgomery St", district: "market",
    lat: 37.788809, lon: -122.401489, headingDeg: 315.2,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8743101",
  },
  {
    id: "sf-bb-market-20", name: "Market St: Bush St to 2nd St", district: "market",
    lat: 37.790262, lon: -122.400414, headingDeg: 135.2,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8742101",
  },
  {
    id: "sf-bb-market-21", name: "Market St: Bush St to Battery St", district: "market",
    lat: 37.790777, lon: -122.39915, headingDeg: 315.8,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8742201",
  },
  {
    id: "sf-bb-market-22", name: "Market St: Front St to Bush St", district: "market",
    lat: 37.791485, lon: -122.398856, headingDeg: 135.0,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8741101",
  },
  {
    id: "sf-bb-market-23", name: "Market St: Pine St to Front St", district: "market",
    lat: 37.791873, lon: -122.39759, headingDeg: 315.2,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8740101",
  },
  {
    id: "sf-bb-market-24", name: "Market St: Main St to Pine St", district: "market",
    lat: 37.792871, lon: -122.397095, headingDeg: 135.2,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8739101",
  },
  {
    id: "sf-bb-market-25", name: "Market St: Drumm St to Main St", district: "market",
    lat: 37.793057, lon: -122.396252, headingDeg: 315.1,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8738201",
  },
  {
    id: "sf-bb-market-26", name: "Market St: Steuart St to Drumm St", district: "market",
    lat: 37.794054, lon: -122.39576, headingDeg: 135.1,
    widthMetres: 8, heightMetres: 4, centerHeightAboveGroundMetres: 10,
    mount: "wall", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "8737201",
  },
  // soma
  {
    id: "sf-bb-soma-01", name: "Harrison St: 10th St to 11th St", district: "soma",
    lat: 37.770964, lon: -122.411702, headingDeg: 315.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "6736000",
  },
  {
    id: "sf-bb-soma-02", name: "Harrison St: Sherman St to 7th St", district: "soma",
    lat: 37.775978, lon: -122.406063, headingDeg: 135.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "6727000",
  },
  {
    id: "sf-bb-soma-03", name: "Harrison St: 4th St to 5th St", district: "soma",
    lat: 37.779772, lon: -122.400553, headingDeg: 315.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "6719000",
  },
  {
    id: "sf-bb-soma-04", name: "Harrison St: I-80 E On Ramp to 2nd St", district: "soma",
    lat: 37.78487, lon: -122.394807, headingDeg: 135.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "6713000",
  },
  {
    id: "sf-bb-soma-05", name: "Folsom St: 11th St to Norfolk St", district: "soma",
    lat: 37.771505, lon: -122.414087, headingDeg: 310.7,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "5683000",
  },
  {
    id: "sf-bb-soma-06", name: "Folsom St: Rausch St to Rodgers St", district: "soma",
    lat: 37.775802, lon: -122.409391, headingDeg: 135.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "5676000",
  },
  {
    id: "sf-bb-soma-07", name: "Folsom St: 5th St to Falmouth St", district: "soma",
    lat: 37.779713, lon: -122.403732, headingDeg: 315.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "5665000",
  },
  {
    id: "sf-bb-soma-08", name: "Folsom St: Ecker St to Essex St", district: "soma",
    lat: 37.786669, lon: -122.395633, headingDeg: 135.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "5658000",
  },
  {
    id: "sf-bb-soma-09", name: "Howard St: 10th St to 11th St", district: "soma",
    lat: 37.773432, lon: -122.414788, headingDeg: 315.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "7056000",
  },
  {
    id: "sf-bb-soma-10", name: "Howard St: Langton St to Rausch St", district: "soma",
    lat: 37.777463, lon: -122.410391, headingDeg: 135.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "7048000",
  },
  {
    id: "sf-bb-soma-11", name: "Howard St: Mary St to 6th St", district: "soma",
    lat: 37.780169, lon: -122.406262, headingDeg: 315.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "7042000",
  },
  {
    id: "sf-bb-soma-12", name: "Howard St: 2nd St to New Montgomery St", district: "soma",
    lat: 37.786634, lon: -122.398794, headingDeg: 135.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "7035000",
  },
  {
    id: "sf-bb-soma-13", name: "Bryant St: Dore St to 10th St", district: "soma",
    lat: 37.770444, lon: -122.409259, headingDeg: 315.2,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "3300000",
  },
  {
    id: "sf-bb-soma-14", name: "Bryant St: 7th St to Langton St", district: "soma",
    lat: 37.774209, lon: -122.405194, headingDeg: 135.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "3293000",
  },
  {
    id: "sf-bb-soma-15", name: "Bryant St: Oak Grove St to Morris St", district: "soma",
    lat: 37.776555, lon: -122.401517, headingDeg: 315.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "3287000",
  },
  {
    id: "sf-bb-soma-16", name: "Bryant St: 2nd St to Jack London Aly", district: "soma",
    lat: 37.782779, lon: -122.394351, headingDeg: 135.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "3280000",
  },
  {
    id: "sf-bb-soma-17", name: "Brannan St: 8th St to 9th St", district: "soma",
    lat: 37.770533, lon: -122.406036, headingDeg: 315.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "3089000",
  },
  {
    id: "sf-bb-soma-18", name: "Brannan St: Harriet St to Lucerne St", district: "soma",
    lat: 37.774316, lon: -122.401959, headingDeg: 135.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "3083000",
  },
  {
    id: "sf-bb-soma-19", name: "Brannan St: Zoe St to 4th St", district: "soma",
    lat: 37.778672, lon: -122.39574, headingDeg: 315.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "3079000",
  },
  {
    id: "sf-bb-soma-20", name: "Brannan St: 2nd St to Stanford St", district: "soma",
    lat: 37.781774, lon: -122.392522, headingDeg: 135.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "3074000",
  },
  {
    id: "sf-bb-soma-21", name: "Townsend St: 7th St to 8th St", district: "soma",
    lat: 37.7708, lon: -122.40259, headingDeg: 315.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "12666000",
  },
  {
    id: "sf-bb-soma-22", name: "Townsend St: 5th St to 6th St", district: "soma",
    lat: 37.774593, lon: -122.398497, headingDeg: 135.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "12664000",
  },
  {
    id: "sf-bb-soma-23", name: "Townsend St: Clyde St to Lusk St", district: "soma",
    lat: 37.777964, lon: -122.39352, headingDeg: 315.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "12661000",
  },
  {
    id: "sf-bb-soma-24", name: "Townsend St: Clarence Pl to 3rd St", district: "soma",
    lat: 37.779205, lon: -122.392657, headingDeg: 135.0,
    widthMetres: 12, heightMetres: 6, centerHeightAboveGroundMetres: 22,
    mount: "rooftop", baseWeeklyPriceTier: "corridor", coverage: "sf", sourceStreetCnn: "12658000",
  },
  // embarcadero
  {
    id: "sf-bb-embarcadero-01", name: "The Embarcadero: Townsend St to Brannan St", district: "embarcadero",
    lat: 37.782542, lon: -122.388699, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12547101",
  },
  {
    id: "sf-bb-embarcadero-02", name: "The Embarcadero: Townsend St to Brannan St", district: "embarcadero",
    lat: 37.784391, lon: -122.388556, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12547101",
  },
  {
    id: "sf-bb-embarcadero-03", name: "The Embarcadero: Brannan St to Bryant St", district: "embarcadero",
    lat: 37.786119, lon: -122.388417, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12548101",
  },
  {
    id: "sf-bb-embarcadero-04", name: "The Embarcadero: Bryant St to Harrison St", district: "embarcadero",
    lat: 37.787784, lon: -122.38834, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12549101",
  },
  {
    id: "sf-bb-embarcadero-05", name: "The Embarcadero: Harrison St to Folsom St", district: "embarcadero",
    lat: 37.789423, lon: -122.389024, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12550102",
  },
  {
    id: "sf-bb-embarcadero-06", name: "The Embarcadero: Folsom St to Howard St", district: "embarcadero",
    lat: 37.790636, lon: -122.390556, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12551102",
  },
  {
    id: "sf-bb-embarcadero-07", name: "The Embarcadero: Howard St to Mission St", district: "embarcadero",
    lat: 37.792274, lon: -122.391438, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12552101",
  },
  {
    id: "sf-bb-embarcadero-08", name: "The Embarcadero: Mission St to Don Chee Way", district: "embarcadero",
    lat: 37.793624, lon: -122.392912, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12553102",
  },
  {
    id: "sf-bb-embarcadero-09", name: "The Embarcadero: Don Chee Way to Washington St", district: "embarcadero",
    lat: 37.794832, lon: -122.394663, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12553103",
  },
  {
    id: "sf-bb-embarcadero-10", name: "The Embarcadero: Don Chee Way to Washington St", district: "embarcadero",
    lat: 37.796434, lon: -122.395776, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12553103",
  },
  {
    id: "sf-bb-embarcadero-11", name: "The Embarcadero: Washington St to Broadway", district: "embarcadero",
    lat: 37.797863, lon: -122.397101, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12554101",
  },
  {
    id: "sf-bb-embarcadero-12", name: "The Embarcadero: Broadway to Green St", district: "embarcadero",
    lat: 37.799307, lon: -122.398387, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12555102",
  },
  {
    id: "sf-bb-embarcadero-13", name: "The Embarcadero: Green St to Lombard St", district: "embarcadero",
    lat: 37.800748, lon: -122.399652, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12556102",
  },
  {
    id: "sf-bb-embarcadero-14", name: "The Embarcadero: Green St to Lombard St", district: "embarcadero",
    lat: 37.802259, lon: -122.401001, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12556102",
  },
  {
    id: "sf-bb-embarcadero-15", name: "The Embarcadero: Green St to Lombard St", district: "embarcadero",
    lat: 37.803795, lon: -122.40229, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12556102",
  },
  {
    id: "sf-bb-embarcadero-16", name: "The Embarcadero: Chestnut St to Bay St", district: "embarcadero",
    lat: 37.805035, lon: -122.403873, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12559101",
  },
  {
    id: "sf-bb-embarcadero-17", name: "The Embarcadero: Chestnut St to Bay St", district: "embarcadero",
    lat: 37.806151, lon: -122.405714, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12559101",
  },
  {
    id: "sf-bb-embarcadero-18", name: "The Embarcadero: Bay St to Kearny St", district: "embarcadero",
    lat: 37.807034, lon: -122.407448, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12560101",
  },
  {
    id: "sf-bb-embarcadero-19", name: "The Embarcadero: Grant Ave to Powell St", district: "embarcadero",
    lat: 37.807945, lon: -122.409433, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12562101",
  },
  {
    id: "sf-bb-embarcadero-20", name: "The Embarcadero: Grant Ave to Powell St", district: "embarcadero",
    lat: 37.808233, lon: -122.411744, headingDeg: 59.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 9,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: "12562101",
  },
  // mission
  {
    id: "sf-bb-mission-01", name: "Mission St: 25th St to 26th St", district: "mission",
    lat: 37.749853, lon: -122.418007, headingDeg: 265.7,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "9127000",
  },
  {
    id: "sf-bb-mission-02", name: "Mission St: 23rd St to 24th St", district: "mission",
    lat: 37.753026, lon: -122.418724, headingDeg: 85.8,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "9125000",
  },
  {
    id: "sf-bb-mission-03", name: "Mission St: 21st St to 22nd St", district: "mission",
    lat: 37.756248, lon: -122.41862, headingDeg: 265.7,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "9123000",
  },
  {
    id: "sf-bb-mission-04", name: "Mission St: 20th St to Catherine Ct", district: "mission",
    lat: 37.758404, lon: -122.419236, headingDeg: 85.7,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "9122001",
  },
  {
    id: "sf-bb-mission-05", name: "Mission St: 18th St to 19th St", district: "mission",
    lat: 37.761048, lon: -122.419078, headingDeg: 265.7,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "9120000",
  },
  {
    id: "sf-bb-mission-06", name: "Mission St: 17th St to Clarion Aly", district: "mission",
    lat: 37.763228, lon: -122.419699, headingDeg: 85.6,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "9117000",
  },
  {
    id: "sf-bb-mission-07", name: "Mission St: 15th St to 16th St", district: "mission",
    lat: 37.765875, lon: -122.419543, headingDeg: 265.6,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "9115000",
  },
  {
    id: "sf-bb-mission-08", name: "Mission St: Erie St to 14th St", district: "mission",
    lat: 37.768651, lon: -122.420211, headingDeg: 87.0,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "9113000",
  },
  {
    id: "sf-bb-mission-09", name: "Valencia St: 25th St to 26th St", district: "mission",
    lat: 37.749718, lon: -122.420226, headingDeg: 265.7,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "13074000",
  },
  {
    id: "sf-bb-mission-10", name: "Valencia St: Hill St to 22nd St", district: "mission",
    lat: 37.755686, lon: -122.421207, headingDeg: 85.7,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "13070000",
  },
  {
    id: "sf-bb-mission-11", name: "Valencia St: 20th St to Liberty St", district: "mission",
    lat: 37.758112, lon: -122.421029, headingDeg: 265.6,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "13067000",
  },
  {
    id: "sf-bb-mission-12", name: "Valencia St: Sycamore St to 18th St", district: "mission",
    lat: 37.762128, lon: -122.421825, headingDeg: 85.7,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "13063000",
  },
  {
    id: "sf-bb-mission-13", name: "Valencia St: Sparrow St to 16th St", district: "mission",
    lat: 37.765331, lon: -122.421721, headingDeg: 265.6,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "13059000",
  },
  {
    id: "sf-bb-mission-14", name: "Valencia St: Brosnan St to 14th St", district: "mission",
    lat: 37.768435, lon: -122.422433, headingDeg: 85.7,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "13056000",
  },
  {
    id: "sf-bb-mission-15", name: "South Van Ness Ave: 25th St to 26th St", district: "mission",
    lat: 37.749984, lon: -122.415827, headingDeg: 265.7,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "12032000",
  },
  {
    id: "sf-bb-mission-16", name: "South Van Ness Ave: 23rd St to 24th St", district: "mission",
    lat: 37.753158, lon: -122.416544, headingDeg: 85.8,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "12030000",
  },
  {
    id: "sf-bb-mission-17", name: "South Van Ness Ave: 20th St to 21st St", district: "mission",
    lat: 37.757978, lon: -122.416592, headingDeg: 265.7,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "12027000",
  },
  {
    id: "sf-bb-mission-18", name: "South Van Ness Ave: 18th St to 19th St", district: "mission",
    lat: 37.761155, lon: -122.417307, headingDeg: 85.7,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "12025000",
  },
  {
    id: "sf-bb-mission-19", name: "South Van Ness Ave: Adair St to 16th St", district: "mission",
    lat: 37.76548, lon: -122.41731, headingDeg: 265.6,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "12022000",
  },
  {
    id: "sf-bb-mission-20", name: "South Van Ness Ave: 14th St to 15th St", district: "mission",
    lat: 37.767593, lon: -122.417928, headingDeg: 85.6,
    widthMetres: 6, heightMetres: 3, centerHeightAboveGroundMetres: 8,
    mount: "wall", baseWeeklyPriceTier: "neighborhood", coverage: "sf", sourceStreetCnn: "12020000",
  },
  // bay-bridge-toll
  {
    id: "sf-bb-bay-bridge-toll-01", name: "West Grand approach north shoulder", district: "bay-bridge-toll",
    lat: 37.82608, lon: -122.30885, headingDeg: 120,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "landmark", coverage: "regional-backdrop", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-bay-bridge-toll-02", name: "West Grand approach south shoulder", district: "bay-bridge-toll",
    lat: 37.82513, lon: -122.3093, headingDeg: 110,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "landmark", coverage: "regional-backdrop", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-bay-bridge-toll-03", name: "Toll approach north embankment east", district: "bay-bridge-toll",
    lat: 37.82635, lon: -122.3105, headingDeg: 105,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "landmark", coverage: "regional-backdrop", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-bay-bridge-toll-04", name: "Toll approach south embankment east", district: "bay-bridge-toll",
    lat: 37.82505, lon: -122.3107, headingDeg: 95,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "landmark", coverage: "regional-backdrop", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-bay-bridge-toll-05", name: "Toll plaza north perimeter east", district: "bay-bridge-toll",
    lat: 37.82645, lon: -122.3121, headingDeg: 100,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "landmark", coverage: "regional-backdrop", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-bay-bridge-toll-06", name: "Toll plaza south perimeter east", district: "bay-bridge-toll",
    lat: 37.82495, lon: -122.31225, headingDeg: 85,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "landmark", coverage: "regional-backdrop", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-bay-bridge-toll-07", name: "Toll plaza north perimeter west", district: "bay-bridge-toll",
    lat: 37.8266, lon: -122.3138, headingDeg: 95,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "landmark", coverage: "regional-backdrop", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-bay-bridge-toll-08", name: "Toll plaza south perimeter west", district: "bay-bridge-toll",
    lat: 37.8249, lon: -122.3138, headingDeg: 80,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "landmark", coverage: "regional-backdrop", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-bay-bridge-toll-09", name: "Bridge Yard approach roadside east", district: "bay-bridge-toll",
    lat: 37.82458, lon: -122.31485, headingDeg: 60,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "landmark", coverage: "regional-backdrop", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-bay-bridge-toll-10", name: "Bridge Yard approach roadside west", district: "bay-bridge-toll",
    lat: 37.82453, lon: -122.3159, headingDeg: 70,
    widthMetres: 14.63, heightMetres: 4.27, centerHeightAboveGroundMetres: 12,
    mount: "roadside", baseWeeklyPriceTier: "landmark", coverage: "regional-backdrop", sourceStreetCnn: null,
  },
  // Founder playtest feedback (gtasf-more-billboards-sky-ads-hyvs): authored ad candidates at the
  // named prime spots (Union Square, Moscone/SoMa, FiDi rooftops). Candidates, not a survey; the
  // renderer snaps along the face normal and skips any without clear ground.
  {
    id: "sf-bb-union-sq-01", name: "Union Square digital screen 01", district: "market",
    lat: 37.78605, lon: -122.4107, headingDeg: 53,
    widthMetres: 8.0, heightMetres: 5.0, centerHeightAboveGroundMetres: 11,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-union-sq-02", name: "Union Square digital screen 02", district: "market",
    lat: 37.78605, lon: -122.4091, headingDeg: 106,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-union-sq-03", name: "Union Square digital screen 03", district: "market",
    lat: 37.78605, lon: -122.4075, headingDeg: 159,
    widthMetres: 8.0, heightMetres: 5.0, centerHeightAboveGroundMetres: 11,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-union-sq-04", name: "Union Square digital screen 04", district: "market",
    lat: 37.78605, lon: -122.4059, headingDeg: 212,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-union-sq-05", name: "Union Square digital screen 05", district: "market",
    lat: 37.78735, lon: -122.4107, headingDeg: 265,
    widthMetres: 8.0, heightMetres: 5.0, centerHeightAboveGroundMetres: 11,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-union-sq-06", name: "Union Square digital screen 06", district: "market",
    lat: 37.78735, lon: -122.4091, headingDeg: 318,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-union-sq-07", name: "Union Square digital screen 07", district: "market",
    lat: 37.78735, lon: -122.4075, headingDeg: 11,
    widthMetres: 8.0, heightMetres: 5.0, centerHeightAboveGroundMetres: 11,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-union-sq-08", name: "Union Square digital screen 08", district: "market",
    lat: 37.78735, lon: -122.4059, headingDeg: 64,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-union-sq-09", name: "Union Square digital screen 09", district: "market",
    lat: 37.78865, lon: -122.4107, headingDeg: 117,
    widthMetres: 8.0, heightMetres: 5.0, centerHeightAboveGroundMetres: 11,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-union-sq-10", name: "Union Square digital screen 10", district: "market",
    lat: 37.78865, lon: -122.4091, headingDeg: 170,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-union-sq-11", name: "Union Square digital screen 11", district: "market",
    lat: 37.78865, lon: -122.4075, headingDeg: 223,
    widthMetres: 8.0, heightMetres: 5.0, centerHeightAboveGroundMetres: 11,
    mount: "wall", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-union-sq-12", name: "Union Square digital screen 12", district: "market",
    lat: 37.78865, lon: -122.4059, headingDeg: 276,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "landmark", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-moscone-01", name: "Moscone / SoMa screen 01", district: "soma",
    lat: 37.78155, lon: -122.4047, headingDeg: 53,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-moscone-02", name: "Moscone / SoMa screen 02", district: "soma",
    lat: 37.78155, lon: -122.4031, headingDeg: 106,
    widthMetres: 8.0, heightMetres: 4.0, centerHeightAboveGroundMetres: 12,
    mount: "wall", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-moscone-03", name: "Moscone / SoMa screen 03", district: "soma",
    lat: 37.78155, lon: -122.4015, headingDeg: 159,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-moscone-04", name: "Moscone / SoMa screen 04", district: "soma",
    lat: 37.78155, lon: -122.3999, headingDeg: 212,
    widthMetres: 8.0, heightMetres: 4.0, centerHeightAboveGroundMetres: 12,
    mount: "wall", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-moscone-05", name: "Moscone / SoMa screen 05", district: "soma",
    lat: 37.78285, lon: -122.4047, headingDeg: 265,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-moscone-06", name: "Moscone / SoMa screen 06", district: "soma",
    lat: 37.78285, lon: -122.4031, headingDeg: 318,
    widthMetres: 8.0, heightMetres: 4.0, centerHeightAboveGroundMetres: 12,
    mount: "wall", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-moscone-07", name: "Moscone / SoMa screen 07", district: "soma",
    lat: 37.78285, lon: -122.4015, headingDeg: 11,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-moscone-08", name: "Moscone / SoMa screen 08", district: "soma",
    lat: 37.78285, lon: -122.3999, headingDeg: 64,
    widthMetres: 8.0, heightMetres: 4.0, centerHeightAboveGroundMetres: 12,
    mount: "wall", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-moscone-09", name: "Moscone / SoMa screen 09", district: "soma",
    lat: 37.78415, lon: -122.4047, headingDeg: 117,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-moscone-10", name: "Moscone / SoMa screen 10", district: "soma",
    lat: 37.78415, lon: -122.4031, headingDeg: 170,
    widthMetres: 8.0, heightMetres: 4.0, centerHeightAboveGroundMetres: 12,
    mount: "wall", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-moscone-11", name: "Moscone / SoMa screen 11", district: "soma",
    lat: 37.78415, lon: -122.4015, headingDeg: 223,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 24,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-moscone-12", name: "Moscone / SoMa screen 12", district: "soma",
    lat: 37.78415, lon: -122.3999, headingDeg: 276,
    widthMetres: 8.0, heightMetres: 4.0, centerHeightAboveGroundMetres: 12,
    mount: "wall", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-fidi-roof-01", name: "Financial District rooftop 01", district: "market",
    lat: 37.7912, lon: -122.4037, headingDeg: 53,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 30,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-fidi-roof-02", name: "Financial District rooftop 02", district: "market",
    lat: 37.7912, lon: -122.4021, headingDeg: 106,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 30,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-fidi-roof-03", name: "Financial District rooftop 03", district: "market",
    lat: 37.7912, lon: -122.4005, headingDeg: 159,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 30,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-fidi-roof-04", name: "Financial District rooftop 04", district: "market",
    lat: 37.7912, lon: -122.3989, headingDeg: 212,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 30,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-fidi-roof-05", name: "Financial District rooftop 05", district: "market",
    lat: 37.7925, lon: -122.4037, headingDeg: 265,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 30,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-fidi-roof-06", name: "Financial District rooftop 06", district: "market",
    lat: 37.7925, lon: -122.4021, headingDeg: 318,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 30,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-fidi-roof-07", name: "Financial District rooftop 07", district: "market",
    lat: 37.7925, lon: -122.4005, headingDeg: 11,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 30,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
  {
    id: "sf-bb-fidi-roof-08", name: "Financial District rooftop 08", district: "market",
    lat: 37.7925, lon: -122.3989, headingDeg: 64,
    widthMetres: 12.0, heightMetres: 6.0, centerHeightAboveGroundMetres: 30,
    mount: "rooftop", baseWeeklyPriceTier: "gateway", coverage: "sf", sourceStreetCnn: null,
  },
] as const satisfies readonly BillboardSurface[];
