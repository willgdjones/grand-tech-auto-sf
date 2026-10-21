import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ACCOUNT = 'YOUR_CLOUDFLARE_ACCOUNT_ID';
// Use the explicitly authorized Wrangler login. Never copy credentials from another project.
async function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const config = await readFile(join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  const match = /^oauth_token\s*=\s*"([^"\r\n]+)"/m.exec(config);
  if (!match) throw new Error('Wrangler OAuth login unavailable; run wrangler login.');
  return match[1];
}
export async function cloudflare(path, options = {}) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid Cloudflare API path');
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: options.method ?? 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(`Cloudflare ${response.status}: ${(result.errors ?? []).map(error => `${error.code}: ${error.message}`).join('; ')}`);
  return result.result;
}
