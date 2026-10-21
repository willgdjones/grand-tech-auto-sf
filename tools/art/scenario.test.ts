import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBudget, editLedger, readLedger, totals } from './ledger.js';
import type { ArtEntry } from './ledger.js';
import { bodyFor, jobCost } from './scenario.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const entry = (id: string): ArtEntry => ({ id, key: id, createdAt: '2026-10-03', prompt: 'original facade', model: '2d', body: {}, output: 'a.png', estimatedCredits: 1, reservedCredits: 1, usdPerCredit: 0.01, status: 'submitted' });
describe('paid art safeguards', () => {
  it('serializes competing reservations so only one fits the shared USD cap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gtasf-art-')); dirs.push(dir); const path = join(dir, 'ledger.json');
    const attempts = await Promise.allSettled(['one', 'two'].map(id => editLedger(path, ledger => { checkBudget(ledger, { maxUsd: 0.01, maxCredits: 10000, maxGenerations: 3000, usdPerCredit: 0.01 }, 1); ledger.entries.push(entry(id)); })));
    expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await readLedger(path)).totals.budgetCountedUsd).toBe(0.01);
  });
  it('counts reservations, actual costs and secondary cap, and blocks ambiguous submissions', () => {
    const a = entry('a'); a.actualCredits = 2;
    const b = entry('b');
    const data = { version: 1 as const, entries: [a, b], totals: totals([a, b]) };
    expect(data.totals).toMatchObject({ actualCredits: 2, actualUsd: 0.02, pendingReservedUsd: 0.01, budgetCountedUsd: 0.03 });
    expect(data.totals.budgetCountedCredits).toBe(3);
    expect(() => checkBudget(data, { maxUsd: 100, maxCredits: 10000, maxGenerations: 2, usdPerCredit: 0.01 }, 1)).toThrow('generation cap');
    expect(() => checkBudget(data, { maxUsd: 100, maxCredits: 3, maxGenerations: 3000, usdPerCredit: 0.01 }, 1)).toThrow('credit cap');
    b.status = 'ambiguous'; expect(() => checkBudget(data, { maxUsd: 100, maxCredits: 10000, maxGenerations: 3000, usdPerCredit: 0.01 }, 1)).toThrow('Unresolved');
    b.reservedCredits = NaN; expect(() => totals([b])).toThrow('Invalid');
  });
  it('records job main and addon charges; refuses unknown/negative cost and nonimage models', () => {
    expect(jobCost({ billing: { cuCost: 3, cuDiscount: 2, cuCostDetails: { 'quality-gate': 0.5 } } })).toBe(3.5);
    expect(jobCost({})).toBeUndefined(); expect(() => jobCost({ billing: { cuCost: -1 } })).toThrow();
    const recipe = { name: 'test', prompt: 'texture', width: 1024, height: 1024, seed: 12, output: 'web/public/art/test.png' };
    expect(bodyFor(recipe).numOutputs).toBe(1);
    expect(() => bodyFor({ ...recipe, model: 'model_meshy' })).toThrow('2D');
    expect(bodyFor({ ...recipe, model: 'model_bfl-flux-1-dev' }).steps).toBe(28);
    expect(bodyFor({ ...recipe, model: 'model_bfl-flux-1-1-pro' }).aspectRatio).toBe('1:1');
    expect(() => bodyFor({ ...recipe, height: 2048 })).toThrow('1 MP');
  });
});
