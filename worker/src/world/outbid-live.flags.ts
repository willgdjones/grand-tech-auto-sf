// Native smoke only. Never selected by the game or either deployment config.
import { flags as base } from '../../../shared/flags';
export const flags=Object.freeze({...base,multiplayer:true,outbidBanner:true,outbidCrown:true,
  worldCapacity:false,traffic:false,driving:false,robotaxi:false});
