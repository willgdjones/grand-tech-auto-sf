// Native analytics smoke only; never selected by the game or deployment configs.
import { flags as base } from '../../../shared/flags';
export const flags = Object.freeze({ ...base, multiplayer: true, posthogAnalytics: true, xAdsPixel: true,
  fundingLoop: false, worldCapacity: false, traffic: false, driving: false, robotaxi: false, outbidBanner: false, outbidCrown: false });
