/** Admission is HTTP until a bounded WorldDO slot is reserved; game traffic stays binary. */
export const DEFAULT_WORLD_CAPACITY = 150;
export const INPUT_IDLE_MS = 5 * 60_000;
export const QUEUE_LIMIT = 5_000;
export const ADMISSION_PROTOCOL_PREFIX = 'gtasf.admit.';
export type LaunchMode = 'open' | 'waitlist' | 'invite';
export interface AdmissionConfig { launchMode: LaunchMode; allowed: boolean; capacity: number; enabled: boolean; waitlist: boolean }
export type AdmissionResponse =
  | { status: 'admitted'; ticket?: string; grant?: string; expiresAt: number | null; nextPollS: number }
  | { status: 'queued'; ticket: string; position: number; queueLength: number; population: number; capacity: number; etaSeconds: number | null; nextPollS: number }
  | { status: 'waitlist'; nextPollS: number }
  | { status: 'full' | 'expired'; nextPollS: number };
export const validAdmissionToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function worldCapacity(env: { WORLD_CAPACITY?: string }): number {
  const value = Number(env.WORLD_CAPACITY ?? DEFAULT_WORLD_CAPACITY);
  return Number.isInteger(value) && value >= 1 && value <= 500 ? value : DEFAULT_WORLD_CAPACITY;
}
export const launchMode = (env: { LAUNCH_MODE?: string }): LaunchMode => env.LAUNCH_MODE === 'waitlist' || env.LAUNCH_MODE === 'invite' ? env.LAUNCH_MODE : 'open';
