/** Private enrichment record. Never return founder/email/source through a public API. */
export interface Lead {
  company: string;
  domain: string;
  founder: string;
  email: string;
  office_address: string;
  lat: number | null;
  lon: number | null;
  building_id: string;
  logo_url: string;
  source: string;
  slug: string;
}

export const LEAD_COLUMNS = ['company', 'domain', 'founder', 'email', 'office_address', 'lat', 'lon', 'building_id', 'logo_url', 'source', 'slug'] as const;

export function companyDomain(input: string): string {
  try {
    const u = new URL(input.includes('://') ? input : `https://${input}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return u.protocol === 'https:' && !u.username && !u.password && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(host) ? host : '';
  } catch { return ''; }
}

export function domainEmail(input: string, domain: string): string | null {
  const email = input.trim().toLowerCase();
  const parts = email.split('@');
  if (email.length > 254 || parts.length !== 2 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0] ?? '')) return null;
  return domain && companyDomain(domain) === domain && parts[1] === domain ? email : null;
}
