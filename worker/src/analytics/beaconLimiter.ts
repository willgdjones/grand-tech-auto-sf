/** Rate-limit keys for the consent-free beacons (loading + net): see referrals/ipLimiter.ts (secret + per-day salt, pruning). */
import { hashedIpKey, type IpLimitPrefix } from '../referrals/ipLimiter';
export { pruneIpLimits as pruneBeaconLimits, PRUNE_SHARE } from '../referrals/ipLimiter';

export async function beaconLimiterKey(prefix: IpLimitPrefix, label: string, request: Request, now: number, secret?: string): Promise<string> {
  return hashedIpKey(prefix, label, request.headers.get('cf-connecting-ip') ?? 'unknown', now, secret);
}
