/**
 * Email-capture D1 store (emailCapture, gtasf-1aon). One row per funding device/profile. Stores the raw
 * address (needed to send, for the Tech Week recap, and for the account-recovery link) alongside HASHED
 * code and link tokens — never the plaintext code. The 6-digit code hash is salted by device; the magic
 * link is a 256-bit random whose hash is stored. Reward is idempotent one-per-profile AND one-per-address.
 * Nothing in this module is ever logged (founder constraint).
 */
import { EMAIL_CODE_DIGITS, EMAIL_MAX_ATTEMPTS, EMAIL_RESEND_SEC } from '@gtasf/shared/email/contract';

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
/** Address hash for per-address dedupe/reward (the lowercased address is salted with a domain tag). */
export const hashEmail = (email: string): Promise<string> => sha256Hex(`gtasf-email:${email}`);
/** 6-digit code hash, salted by device so the same code on two devices hashes differently. */
export const hashCode = (deviceId: string, code: string): Promise<string> => sha256Hex(`gtasf-code:${deviceId}:${code}`);
/** Magic-link token hash. */
export const hashLinkToken = (token: string): Promise<string> => sha256Hex(`gtasf-link:${token}`);

/** A cryptographically-random zero-padded 6-digit code. */
export function generateEmailCode(): string {
  const span = 10 ** EMAIL_CODE_DIGITS;
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % span;
  return String(n).padStart(EMAIL_CODE_DIGITS, '0');
}
/** A 256-bit hex magic-link token (unguessable; only its hash is stored). */
export function generateLinkToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}

export interface EmailCaptureRow {
  device_id: string; email: string; email_hash: string;
  code_hash: string | null; link_hash: string | null;
  expires_at: number | null; attempts: number; last_sent_at: number;
  verified_at: number | null; rewarded_at: number | null; created_at: number;
}

export async function getCapture(db: D1Database, deviceId: string): Promise<EmailCaptureRow | null> {
  return await db.prepare('SELECT * FROM email_captures WHERE device_id = ?').bind(deviceId).first<EmailCaptureRow>();
}

/** Claim the send slot atomically. A concurrent start cannot overwrite the winning
 * challenge, and verification prevents a late start from replacing its address. */
export async function startCapture(db: D1Database, input: {
  deviceId: string; email: string; emailHash: string; codeHash: string; linkHash: string; expiresAt: number; now: number;
}): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO email_captures(device_id,email,email_hash,code_hash,link_hash,expires_at,attempts,last_sent_at,verified_at,rewarded_at,created_at)
     VALUES(?,?,?,?,?,?,0,?,NULL,NULL,?)
     ON CONFLICT(device_id) DO UPDATE SET
       email=excluded.email, email_hash=excluded.email_hash, code_hash=excluded.code_hash,
       link_hash=excluded.link_hash, expires_at=excluded.expires_at, attempts=0, last_sent_at=excluded.last_sent_at
     WHERE email_captures.verified_at IS NULL AND email_captures.last_sent_at<=?`)
    .bind(input.deviceId, input.email, input.emailHash, input.codeHash, input.linkHash, input.expiresAt, input.now, input.now,
      input.now - EMAIL_RESEND_SEC * 1000).run();
  return result.meta.changes === 1;
}

/** A stale failed request must not consume attempts on a replacement challenge. */
export async function bumpAttempts(db: D1Database, deviceId: string, challenge: EmailCaptureRow, now: number): Promise<number> {
  const row = await db.prepare(`UPDATE email_captures SET attempts=attempts+1
    WHERE device_id=? AND code_hash=? AND link_hash IS ? AND verified_at IS NULL
      AND expires_at>? AND attempts<? RETURNING attempts`)
    .bind(deviceId, challenge.code_hash, challenge.link_hash, now, EMAIL_MAX_ATTEMPTS).first<{ attempts: number }>();
  return row?.attempts ?? EMAIL_MAX_ATTEMPTS;
}

/** Consume only the exact challenge whose code the caller checked. The random
 * link hash also distinguishes resends that happen to generate the same code. */
export async function markVerified(db: D1Database, deviceId: string, challenge: EmailCaptureRow, now: number): Promise<boolean> {
  const result = await db.prepare(`UPDATE email_captures SET verified_at=?,code_hash=NULL,link_hash=NULL
    WHERE device_id=? AND code_hash=? AND link_hash IS ? AND verified_at IS NULL
      AND expires_at>? AND attempts<?`)
    .bind(now, deviceId, challenge.code_hash, challenge.link_hash, now, EMAIL_MAX_ATTEMPTS).run();
  return result.meta.changes === 1;
}

/** True when this address has already earned the reward on ANY device (one reward per address). */
export async function emailAlreadyRewarded(db: D1Database, emailHash: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM email_captures WHERE email_hash = ? AND rewarded_at IS NOT NULL LIMIT 1').bind(emailHash).first();
  return row != null;
}

/** Record the reward as granted to this device (one per profile). No-op if already rewarded. */
export async function markRewarded(db: D1Database, deviceId: string, now: number): Promise<void> {
  await db.prepare('UPDATE email_captures SET rewarded_at = ? WHERE device_id = ? AND rewarded_at IS NULL').bind(now, deviceId).run();
}

/** Verify and consume a magic link in one statement, without a stale lookup/write gap. */
export async function verifyLinkToken(db: D1Database, linkHash: string, now: number): Promise<string | null> {
  const row = await db.prepare(`UPDATE email_captures SET verified_at=?,code_hash=NULL,link_hash=NULL
    WHERE link_hash=? AND expires_at>? AND verified_at IS NULL RETURNING device_id`)
    .bind(now, linkHash, now).first<{ device_id: string }>();
  return row?.device_id ?? null;
}
