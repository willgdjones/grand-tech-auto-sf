import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { checkBudget, editLedger, finite, readLedger } from './ledger.js';
import type { ArtEntry, Limits } from './ledger.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ART = resolve(ROOT, 'tools/art');
const LEDGER = resolve(ART, 'ledger.json');
const API = 'https://api.cloud.scenario.com/v1';
// This executable must not inherit a developer's disabled TLS verification.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
export const MODEL = 'model_bfl-flux-1-schnell';
export const IMAGE_MODELS = new Set([MODEL, 'model_bfl-flux-1-dev', 'model_bfl-flux-1-1-pro']);
export interface Recipe { name: string; prompt: string; seed: number; width: number; height: number; output: string; model?: string }
type Json = Record<string, any>;
const sha = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');

async function config(): Promise<{ limits: Limits; auth: string }> {
  const env = parseEnv(await readFile(resolve(ART, '.env'), 'utf8'));
  const budget = JSON.parse(await readFile(resolve(ART, 'budget.json'), 'utf8')) as Limits;
  const caps = (key: string, hard: number) => {
    if (!env[key]?.trim()) throw new Error(`Missing ${key}; refusing generation`);
    const values = [hard, finite(Number(env[key]), key)];
    if (process.env[key] !== undefined) values.push(finite(Number(process.env[key]), key));
    return Math.min(...values);
  };
  const maxUsd = Math.min(caps('SCENARIO_MAX_USD', 100), finite(budget.maxUsd, 'budget USD cap'));
  const maxGenerations = Math.min(caps('SCENARIO_MAX_GENERATIONS', 3000), finite(budget.maxGenerations, 'budget generation cap'));
  const maxCredits = Math.min(10000, finite(budget.maxCredits, 'budget credit cap'),
    ...(env.SCENARIO_MAX_CREDITS === undefined ? [] : [finite(Number(env.SCENARIO_MAX_CREDITS), 'environment credit cap')]),
    ...(process.env.SCENARIO_MAX_CREDITS === undefined ? [] : [finite(Number(process.env.SCENARIO_MAX_CREDITS), 'process credit cap')]));
  const rate = finite(budget.usdPerCredit, 'USD/credit', true);
  if (rate !== 0.01) throw new Error('Unverified Scenario credit price; check published plan pricing');
  if (!env.SCENARIO_API_KEY || !env.SCENARIO_API_SECRET) throw new Error('Scenario credentials missing');
  return { limits: { maxUsd, maxCredits, maxGenerations, usdPerCredit: rate }, auth: `Basic ${Buffer.from(`${env.SCENARIO_API_KEY}:${env.SCENARIO_API_SECRET}`).toString('base64')}` };
}
async function request(method: string, path: string, auth: string, body?: Json): Promise<Json> {
  // Never print response bodies: errors can echo authorization or signed URLs.
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { method, headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(90_000) });
  } catch { throw new Error(`Scenario ${method} request failed; no automatic submission retry`); }
  if (!response.ok) throw new Error(`Scenario ${method} ${path.split('?')[0]} returned HTTP ${response.status}`);
  return await response.json() as Json;
}
async function verifyPricing(auth: string, limits: Limits): Promise<void> {
  const data = await request('GET', '/oscu/prices', auth);
  if (!Array.isArray(data.prices) || !data.prices.length) throw new Error('Scenario pricing unavailable; refusing generation');
  const rates = data.prices.filter((p: Json) => p.currency?.toLowerCase() === 'usd').map((p: Json) => finite(p.unitAmount, 'pack cents', true) / 100 / finite(p.creativeUnits, 'pack credits', true));
  if (!rates.length || Math.max(...rates) > limits.usdPerCredit + 1e-9) throw new Error('Scenario pricing changed; refuse until USD guard is reconciled');
}
export function bodyFor(recipe: Recipe): Json {
  const model = recipe.model ?? MODEL;
  if (!IMAGE_MODELS.has(model)) throw new Error('Only approved 2D image models are allowed');
  if (!recipe.prompt?.trim() || !Number.isSafeInteger(recipe.seed)) throw new Error('Invalid image recipe');
  if (![recipe.width, recipe.height].every(n => Number.isSafeInteger(n) && n >= 256 && n <= 1024 && n % 64 === 0) || recipe.width * recipe.height > 1_048_576) throw new Error('Image must be <=1 MP, 256–1024px, multiples of 64');
  if (model === 'model_bfl-flux-1-1-pro') {
    // Its documented API selects aspect ratio instead of exact dimensions; square is <=1 MP.
    if (recipe.width !== recipe.height) throw new Error('Flux 1.1 Pro is restricted to square <=1 MP outputs');
    return { prompt: recipe.prompt, aspectRatio: '1:1', numOutputs: 1, seed: recipe.seed, promptUpsampling: false };
  }
  return { prompt: recipe.prompt, width: recipe.width, height: recipe.height, numOutputs: 1, seed: recipe.seed,
    ...(model === 'model_bfl-flux-1-dev' ? { steps: 28, guidance: 3.5 } : {}) };
}
export function jobCost(job: Json): number | undefined {
  const bill = job.billing;
  const main = bill?.cuCost ?? job.cuCost;
  if (main === undefined) return undefined;
  let cost = finite(main, 'job billed credits');
  for (const amount of Object.values(bill?.cuCostDetails ?? {})) cost += finite(amount, 'job add-on credits');
  // Do not subtract cuDiscount twice; cuCost is the billed main action.
  return cost;
}
async function update(id: string, change: Partial<ArtEntry>): Promise<ArtEntry> {
  return editLedger(LEDGER, ledger => {
    const entry = ledger.entries.find(e => e.id === id);
    if (!entry) throw new Error('Ledger entry missing');
    Object.assign(entry, change);
    return structuredClone(entry);
  });
}
async function finish(entry: ArtEntry, auth: string): Promise<ArtEntry> {
  if (!entry.jobId) throw new Error('Ambiguous paid request: inspect Scenario jobs; never resubmit this recipe');
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    const reply = await request('GET', `/jobs/${encodeURIComponent(entry.jobId)}`, auth);
    const job = reply.job ?? reply;
    if (['failure', 'failed', 'canceled', 'cancelled'].includes(job.status)) {
      const actual = jobCost(job);
      await update(entry.id, { status: 'failed', ...(actual === undefined ? {} : { actualCredits: actual, costSource: 'job.billing (conservative before refunds)' }) });
      throw new Error('Scenario generation failed; cost remains counted, no retry');
    }
    if (job.status === 'success') {
      const actual = jobCost(job);
      if (actual === undefined) throw new Error('Completed job has no actual credit cost; reservation retained pending reconciliation');
      entry = await update(entry.id, { status: 'generated', actualCredits: actual, costSource: 'job.billing.cuCost + add-ons', assetId: job.metadata?.assetIds?.[0] });
      if (!entry.assetId) throw new Error('Scenario produced no image asset');
      const { asset } = await request('GET', `/assets/${encodeURIComponent(entry.assetId)}`, auth);
      if (asset?.kind !== 'image' || !asset.url?.startsWith('https://')) throw new Error('Scenario output is not an HTTPS image');
      // CDN never receives API credentials. Native fetch strips auth entirely here.
      const response = await fetch(asset.url, { signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw new Error('Scenario image download failed; rerun resumes this job');
      const raw = new Uint8Array(await response.arrayBuffer());
      if (raw.length > 25_000_000) throw new Error('Expected image <=25 MB');
      const decoded = sharp(raw, { limitInputPixels: 1_048_576 });
      const info = await decoded.metadata();
      if (!['png', 'jpeg', 'webp'].includes(info.format ?? '') || !info.width || !info.height || info.width * info.height > 1_048_576) throw new Error('Downloaded image format/size is outside the <=1 MP limit');
      const bytes = info.format === 'png' ? raw : new Uint8Array(await decoded.png().toBuffer());
      const output = resolve(ROOT, entry.output);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(`${output}.tmp`, bytes); await rename(`${output}.tmp`, output);
      return update(entry.id, { status: 'complete', sha256: sha(bytes), bytes: bytes.length });
    }
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  throw new Error('Scenario job still running; rerun this exact recipe to resume without paying again');
}
export async function generate(recipe: Recipe, dryRun = false): Promise<ArtEntry | Json> {
  const body = bodyFor(recipe);
  const model = recipe.model ?? MODEL;
  const output = relative(ROOT, resolve(ROOT, recipe.output));
  if (!output.startsWith('web/public/art/') || !output.endsWith('.png') || output.includes('..')) throw new Error('Output must be a PNG under web/public/art/');
  const key = sha(JSON.stringify([model, body]));
  const ledger = await readLedger(LEDGER);
  const prior = ledger.entries.find(e => e.key === key);
  const { auth, limits } = await config();
  if (prior) {
    if (prior.output !== output) throw new Error('Recipe already has another output; copy its cached asset locally');
    if (dryRun) return { cached: true, entry: prior.id, totals: ledger.totals };
    if (prior.status === 'complete') {
      try { if (sha(await readFile(resolve(ROOT, prior.output))) === prior.sha256) return prior; } catch { /* redownload existing job */ }
    }
    return finish(prior, auth);
  }
  await verifyPricing(auth, limits);
  const estimate = await request('POST', `/generate/custom/${model}?dryRun=true`, auth, body);
  const estimatedCredits = finite(estimate.creativeUnitsCost, 'dry-run credit cost', true);
  // Headroom protects against postprocessing/provider price changes between quote and submission.
  const reservedCredits = Math.ceil(estimatedCredits * 2 + 2);
  if (dryRun) { checkBudget(ledger, limits, reservedCredits); return { name: recipe.name, estimatedCredits, estimatedUsd: estimatedCredits * limits.usdPerCredit, reservedCredits, limits, totals: ledger.totals }; }
  const entry = await editLedger(LEDGER, async current => {
    // Re-read founder caps while holding the cross-process lock, immediately before submission.
    const fresh = await config(); checkBudget(current, fresh.limits, reservedCredits);
    if (current.entries.some(e => e.key === key)) throw new Error('Recipe already reserved by another process; rerun to resume');
    const next: ArtEntry = { id: randomUUID(), key, createdAt: new Date().toISOString(), prompt: recipe.prompt, model, body, output, estimatedCredits, reservedCredits, usdPerCredit: fresh.limits.usdPerCredit, status: 'submitting' };
    current.entries.push(next); return structuredClone(next);
  });
  let reply: Json;
  try { reply = await request('POST', `/generate/custom/${model}`, auth, body); }
  catch (e) { await update(entry.id, { status: 'ambiguous' }); throw e; }
  if (!reply.job?.jobId) { await update(entry.id, { status: 'ambiguous' }); throw new Error('Scenario returned no job ID; reservation retained, do not resubmit'); }
  const submitted = await update(entry.id, { jobId: reply.job.jobId, status: 'submitted' });
  console.log(`${recipe.name}: submitted; reserved ${reservedCredits} CU ($${(reservedCredits * limits.usdPerCredit).toFixed(2)})`);
  return finish(submitted, auth);
}
export async function status(): Promise<Json> { const { limits } = await config(); return { limits, ...(await readLedger(LEDGER)) }; }
