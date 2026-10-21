import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const source = parseEnv(await readFile('worker/.dev.vars','utf8'));
const directory = 'worker/.wrangler/production'; await mkdir(directory,{recursive:true});
let invite;
try { invite = (await readFile(`${directory}/invite-code.txt`,'utf8')).trim(); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  invite = randomBytes(24).toString('base64url');
  await writeFile(`${directory}/invite-code.txt`, invite + '\n', { mode: 0o600, flag: 'wx' });
}
async function putSecret(name, value) {
  await new Promise((done,fail) => {
    const child = spawn(resolve('node_modules/.bin/wrangler'), ['secret','put',name,'--config','worker/wrangler.production.jsonc'], {
      stdio:['pipe','inherit','inherit'], env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'YOUR_CLOUDFLARE_ACCOUNT_ID',NODE_TLS_REJECT_UNAUTHORIZED:'1'},
    });
    child.once('error',fail); child.once('exit',code=>code===0?done():fail(new Error(`Secret upload failed for ${name}: ${code}`)));
    child.stdin.end(value);
  });
}
// Required for every production deploy.
const required = { INVITE_CODE: invite, X_PIXEL_TOKEN: source.X_PIXEL_TOKEN, POSTHOG_SECRET_KEY: source.POSTHOG_SECRET_KEY };
for (const [name,value] of Object.entries(required)) {
  if (!value) throw new Error(`Missing required secret ${name}; no value was printed.`);
  await putSecret(name, value);
}
// Optional secrets gate features: TYPESAFE_API_KEY → Jev chat/event moderation (gtasf-a366);
// ADMIN_TOKEN → event + feedback admin endpoints; OPENROUTER_API_KEY → all LLM calls (event-link
// extraction, image prescreen) via OpenRouter; STRIPE_* → paid checkout. Absent values are skipped
// so existing no-key deploys keep working. (GTASF has no Anthropic key; ANTHROPIC_API_KEY is retired.)
const optional = { TYPESAFE_API_KEY: source.TYPESAFE_API_KEY, ADMIN_TOKEN: source.ADMIN_TOKEN,
  OPENROUTER_API_KEY: source.OPENROUTER_API_KEY, STRIPE_SECRET_KEY: source.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: source.STRIPE_WEBHOOK_SECRET,
  // RECOVERY_PEPPER: server-side pepper for GTASF-XXXX recovery-code hashes (accountRecovery). Recovery
  // 503s in prod without it. Random, non-founder-specific; must stay STABLE once set (changing it
  // invalidates existing codes). Value lives only in gitignored worker/.dev.vars.
  RECOVERY_PEPPER: source.RECOVERY_PEPPER };
const uploadedOptional = [];
for (const [name,value] of Object.entries(optional)) {
  if (value && value.trim()) { await putSecret(name, value); uploadedOptional.push(name); }
}
console.log(`Uploaded ${Object.keys(required).length} required secrets`
  + (uploadedOptional.length ? ` and optional: ${uploadedOptional.join(', ')}` : ' (no optional secrets set)')
  + '. Values were not logged.');
