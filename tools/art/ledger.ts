import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Limits { maxUsd: number; maxCredits: number; maxGenerations: number; usdPerCredit: number }
export interface ArtEntry {
  id: string; key: string; createdAt: string; prompt: string; model: string;
  body: Record<string, unknown>; output: string; estimatedCredits: number;
  reservedCredits: number; usdPerCredit: number; status: string;
  jobId?: string; assetId?: string; actualCredits?: number; costSource?: string;
  sha256?: string; bytes?: number;
}
export interface Ledger {
  version: 1; entries: ArtEntry[];
  totals: { generations: number; actualCredits: number; actualUsd: number; pendingReservedCredits: number; budgetCountedCredits: number; pendingReservedUsd: number; budgetCountedUsd: number; unresolved: number };
}
export function finite(value: unknown, label: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) throw new Error(`Invalid ${label}; refusing generation`);
  return value;
}
const round = (n: number) => Math.round(n * 1e6) / 1e6;
export function totals(entries: ArtEntry[]): Ledger['totals'] {
  let actualCredits = 0, actualUsd = 0, pendingReservedCredits = 0, pendingReservedUsd = 0, unresolved = 0;
  for (const e of entries) {
    const rate = finite(e.usdPerCredit, 'ledger credit price', true);
    const reserve = finite(e.reservedCredits, 'ledger reservation');
    if (e.actualCredits === undefined) { unresolved++; pendingReservedCredits += reserve; pendingReservedUsd += reserve * rate; }
    else { actualCredits += finite(e.actualCredits, 'ledger actual cost'); actualUsd += e.actualCredits * rate; }
  }
  return { generations: entries.length, actualCredits: round(actualCredits), actualUsd: round(actualUsd), pendingReservedCredits: round(pendingReservedCredits), budgetCountedCredits: round(actualCredits + pendingReservedCredits), pendingReservedUsd: round(pendingReservedUsd), budgetCountedUsd: round(actualUsd + pendingReservedUsd), unresolved };
}
export async function readLedger(path: string): Promise<Ledger> {
  let raw: string;
  try { raw = await readFile(path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; return { version: 1, entries: [], totals: totals([]) }; }
  const data = JSON.parse(raw) as Ledger;
  if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error('Malformed art ledger; refusing generation');
  data.totals = totals(data.entries);
  return data;
}
export async function editLedger<T>(path: string, edit: (ledger: Ledger) => T | Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  // No stale-lock guessing: a crashed owner must be reconciled before more paid work.
  for (let attempt = 0; ; attempt++) {
    try { await mkdir(lock); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 100) throw new Error('Art ledger locked; no generation submitted');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  try {
    const data = await readLedger(path);
    const result = await edit(data);
    data.totals = totals(data.entries);
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
    await rename(temp, path);
    return result;
  } finally { await rm(lock, { recursive: true }); }
}
export function checkBudget(data: Ledger, limits: Limits, reservedCredits: number): void {
  finite(limits.maxUsd, 'USD cap'); finite(limits.maxCredits, 'credit cap'); finite(limits.maxGenerations, 'generation cap');
  finite(limits.usdPerCredit, 'credit price', true); finite(reservedCredits, 'estimate');
  const spent = totals(data.entries);
  if (spent.generations + 1 > limits.maxGenerations) throw new Error(`Scenario generation cap ${limits.maxGenerations} reached`);
  if (spent.budgetCountedCredits + reservedCredits > limits.maxCredits + 1e-9) throw new Error(`Scenario credit cap ${limits.maxCredits} CU would be exceeded (counted ${spent.budgetCountedCredits} CU)`);
  if (spent.budgetCountedUsd + reservedCredits * limits.usdPerCredit > limits.maxUsd + 1e-9) throw new Error(`Scenario USD cap $${limits.maxUsd} would be exceeded (counted $${spent.budgetCountedUsd.toFixed(4)})`);
  if (data.entries.some(e => e.status === 'submitting' || e.status === 'ambiguous')) throw new Error('Unresolved Scenario submission; reconcile its job before more paid work');
}
