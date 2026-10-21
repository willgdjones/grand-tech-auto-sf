// Native authority smoke only; never selected by a game or deployment build.
import { flags as base } from '../../../shared/flags';
export const flags = Object.freeze({ ...base, fundingLoop: true, multiplayer: true, deepLinkSpawns: true,
  worldCapacity: false, driving: false, robotaxi: false, traffic: false, outbidBanner: false, outbidCrown: false });
