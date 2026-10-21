/**
 * Per-IP rate-limit keys without keeping a lasting per-IP record (gtasf-6mve9, gtasf-cnjpc, gtasf-6z5zi). The client IP
 * is hashed with env.IP_HASH_SECRET + the UTC day. The SECRET is what makes a key non-reversible: label and day are
 * public, so without it a 2^32 IPv4 brute force recovers the IP. The day makes keys unlinkable across days, and rows
 * under these prefixes idle for over a day are pruned (every IP limiter's window is <= 1 h), so even without the secret
 * at most ~a day of keys exists. The day boundary at most grants one fresh window per day. Device/email/account
 * limiters (visit:, claim-*, email-addr:, caption:...) are not IP-keyed and are left alone.
 */
export const IP_LIMIT_PREFIXES = ['lbeacon:', 'nbeacon:', 'otrack:', 'recover-ip:', 'email-ip:', 'voice-caption-ip:', 'voice-ice-ip:', 'submit-ip:'] as const;
/** Old raw-IP prefixes nothing writes any more: the sweep deletes whatever is left under them. */
const LEGACY_RAW_IP_PREFIXES = ['submit:ip:'] as const;
export type IpLimitPrefix = typeof IP_LIMIT_PREFIXES[number];
const DAY_MS = 86_400_000;

/** 96 bits of SHA-256(secret, label, UTC day, ip), hex. `secret` = env.IP_HASH_SECRET (see the header). */
export async function hashedIp(label: string, ip: string, now: number, secret = ''): Promise<string> {
  const day = new Date(now).toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}\u0000${label}\u0000${day}\u0000${ip}`));
  return [...new Uint8Array(digest).slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** `prefix` + hashedIp(...). `label` keeps two limiters with the same prefix apart. */
export async function hashedIpKey(prefix: IpLimitPrefix, label: string, ip: string, now: number, secret = ''): Promise<string> {
  return prefix + await hashedIp(label, ip, now, secret);
}

/** Delete IP-limiter rows idle for over a day. Cheap and occasional: callers run it with a small probability. */
export async function pruneIpLimits(db: D1Database, now: number): Promise<void> {
  for (const prefix of IP_LIMIT_PREFIXES) // [prefix, prefix with its ':' -> ';') = every key that starts with prefix
    await db.prepare(`DELETE FROM referral_limits WHERE key >= ? AND key < ? AND window_at < ?`).bind(prefix, prefix.slice(0, -1) + ';', now - DAY_MS).run();
  for (const prefix of LEGACY_RAW_IP_PREFIXES)
    await db.prepare(`DELETE FROM referral_limits WHERE key >= ? AND key < ?`).bind(prefix, prefix.slice(0, -1) + ';').run();
}
/** ~1 in 50 beacon requests sweeps (the beacons fire on every page load, so they make a good sweeper for all prefixes). */
export const PRUNE_SHARE = 0.02;
