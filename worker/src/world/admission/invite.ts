import { launchMode } from '@gtasf/shared/admission';
import { admissionJson, smallJson } from './http';

type InviteEnv = { LAUNCH_MODE?: string; INVITE_CODE?: string };
const COOKIE = 'gtasf_invite', encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
async function signature(secret: string, expiry: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`gtasf-invite:v1:${expiry}`)));
}
function equal(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
export async function launchAllowed(request: Request, env: InviteEnv): Promise<boolean> {
  const mode = launchMode(env);
  if (mode === 'open') return true;
  if (mode !== 'invite' || !env.INVITE_CODE) return false;
  const cookie = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const match = /^v1\.(\d{10})\.([a-f0-9]{64})$/.exec(cookie ?? '');
  if (!match) return false;
  const expiry = Number(match[1]);
  if (expiry <= Math.floor(Date.now() / 1000) || expiry > Math.floor(Date.now() / 1000) + 8 * 86400) return false;
  return equal(match[2]!, await signature(env.INVITE_CODE, expiry));
}
export async function acceptInvite(request: Request, env: InviteEnv): Promise<Response> {
  const body = await smallJson(request);
  if (request.method !== 'POST' || !body || typeof body.code !== 'string' || body.code.length > 128 || !env.INVITE_CODE)
    return admissionJson({ accepted: false }, 400);
  const hashes = await Promise.all([body.code, env.INVITE_CODE].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value)).then(hex)));
  if (!equal(hashes[0]!, hashes[1]!)) return admissionJson({ accepted: false }, 403);
  const expiry = Math.floor(Date.now() / 1000) + 7 * 86400;
  const cookie = `${COOKIE}=v1.${expiry}.${await signature(env.INVITE_CODE, expiry)}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
  return Response.json({ accepted: true }, { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': cookie } });
}
