/**
 * Apollo top SF-HQ companies for the living map (gtasf-jcxw), through the tools/gtm/apollo.ts credit gate.
 *   tools/map/node_modules/.bin/tsx tools/places/apollo-orgs.mts                # plan only: prints planId + credits, spends 0
 *   tools/map/node_modules/.bin/tsx tools/places/apollo-orgs.mts --approve <planId>   # spend <= PLAN.maxCredits, journaled
 * Phase 1: organization search, SF headquarters, 201+ employees, 100 per page (1 credit per page, docs.apollo.io).
 * Phase 2: organization enrich (1 credit each) for the largest not-yet-curated orgs, to get a street address.
 * Writes tools/places/apollo-orgs.json (places rows for build.mts). Firmographics only: no people, no emails.
 * The plan digest covers every request parameter; any change needs a new approval. Requests are journaled in
 * tools/places/cache/apollo-spend.json before I/O and never repeated, so a crash can't double-charge.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { APOLLO_PATHS, apolloRequest, type CreditApproval } from '../gtm/apollo';
import type { SourcePlace } from './build.mts';

const ROOT = 'tools/places', JOURNAL = join(ROOT, 'cache', 'apollo-spend.json');
export const PLAN = Object.freeze({
  maxCredits: 200, searchPages: 5, perPage: 100, enrichMax: 190,
  search: { organization_locations: ['San Francisco, California, United States'],
    organization_num_employees_ranges: ['201,500', '501,1000', '1001,2000', '2001,5000', '5001,10000', '10001,20000', '20001,50000', '50001,1000000'] },
});
export const planCredits = (p = PLAN) => p.searchPages + p.enrichMax;
export const planId = (p = PLAN) => createHash('sha256').update(JSON.stringify(p)).digest('hex');

type Org = { id?: string; name?: string; primary_domain?: string; website_url?: string; estimated_num_employees?: number; short_description?: string; street_address?: string; city?: string; state?: string };
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const domainOf = (url?: string) => (url ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** One-line blurb from Apollo's description: first sentence, <= 90 chars. */
export function blurbOf(description: string | undefined, name: string): string {
  const first = (description ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
  if (!first) return `${name}, headquartered in San Francisco.`;
  return first.length <= 90 ? first : `${first.slice(0, 87).replace(/\s+\S*$/, '')}...`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = planId(), approved = process.argv[process.argv.indexOf('--approve') + 1];
  console.log(JSON.stringify({ planId: id, maxCredits: PLAN.maxCredits, plannedCredits: planCredits(), plan: PLAN }));
  if (planCredits() > PLAN.maxCredits) throw new Error('Plan exceeds its own credit cap');
  if (!process.argv.includes('--approve')) process.exit(0);
  if (approved !== id) throw new Error('Approved digest does not match current plan');
  await mkdir(join(ROOT, 'cache'), { recursive: true });
  type Receipt = { key: string; path: string; at: string };
  const receipts: Receipt[] = existsSync(JOURNAL) ? JSON.parse(await readFile(JOURNAL, 'utf8')) : [];
  const approval: CreditApproval = { planId: id, approvedPlanId: approved, maxCredits: PLAN.maxCredits, chargedUpperBound: receipts.length,
    reserve: async (path, params) => {
      const key = createHash('sha256').update(path + JSON.stringify(params)).digest('hex');
      if (receipts.some(r => r.key === key)) throw new Error('Request already attempted; no repeat charge');
      receipts.push({ key, path, at: new Date().toISOString() }); await writeFile(JOURNAL, JSON.stringify(receipts, null, 1));
    } };
  const curated = (JSON.parse(await readFile(join(ROOT, 'curated.json'), 'utf8')) as { places: SourcePlace[] }).places;
  const known = new Set(curated.map(p => domainOf(p.website)));
  const orgs: Org[] = [];
  for (let page = 1; page <= PLAN.searchPages; page++) {
    const r = await apolloRequest(APOLLO_PATHS.organizationSearch, { ...PLAN.search, page, per_page: PLAN.perPage }, approval);
    const list = [...(Array.isArray(r.organizations) ? r.organizations : []), ...(Array.isArray(r.accounts) ? r.accounts : [])].map(o => obj(o) as Org);
    orgs.push(...list); if (list.length < PLAN.perPage) break;
  }
  const ranked = [...new Map(orgs.filter(o => o.primary_domain).map(o => [o.primary_domain!, o])).values()]
    .filter(o => !known.has(domainOf(o.primary_domain))).sort((a, b) => (b.estimated_num_employees ?? 0) - (a.estimated_num_employees ?? 0));
  const places: SourcePlace[] = []; let skipped = 0;
  for (const [i, o] of ranked.slice(0, PLAN.enrichMax).entries()) {
    const e = obj((await apolloRequest(APOLLO_PATHS.organizationEnrich, { domain: o.primary_domain }, approval)).organization) as Org;
    if (!e.street_address || String(e.city).toLowerCase() !== 'san francisco') { skipped++; continue; }
    const employees = e.estimated_num_employees ?? o.estimated_num_employees ?? 0, name = e.name ?? o.name ?? o.primary_domain!;
    places.push({ id: slug(name), name, kind: employees >= 1000 ? 'bigtech' : 'startup', address: e.street_address,
      website: e.website_url ?? `https://${o.primary_domain}`, blurb: blurbOf(e.short_description, name), source: 'apollo', rank: i + 1 });
  }
  await writeFile(join(ROOT, 'apollo-orgs.json'), JSON.stringify({ planId: id, credits: receipts.length, searched: orgs.length, places }, null, 1) + '\n');
  console.log(JSON.stringify({ creditsReserved: receipts.length, searched: orgs.length, ranked: ranked.length, placed: places.length, skipped }));
}
