import { flags } from '@gtasf/shared/flags';
import { AD_CATALOGUE } from '@gtasf/shared/gtm/catalogue';
import { validCompanySlug } from '@gtasf/shared/gtm/spawn';
import { getOffer, requestVerification, verifiedOffer, verifyEmail } from './claims';
import { tokenHash,tokenPattern } from './tokens';

interface GtmEnv {DB:D1Database;ENVIRONMENT:string}
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function page(title:string,body:string,status=200):Response {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)} · GTASF</title><style>body{font:18px system-ui;max-width:680px;margin:8vh auto;padding:24px;background:#101722;color:#f7f1dd}a{color:#ffd278}input,button{font:inherit;padding:12px;margin:8px 0}input{width:95%}button{background:#ffd278;border:0;border-radius:4px}small{display:block;margin-top:30px;color:#bec8d3}</style><h1>${escape(title)}</h1>${body}</html>`,{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
}
function sameOrigin(request:Request):boolean {const origin=request.headers.get('Origin');return origin===new URL(request.url).origin;}
async function emailBody(request:Request):Promise<string> {
  if(Number(request.headers.get('content-length')??0)>4096)throw new Error('Body too large');
  const reader=request.body?.getReader();if(!reader)return '';let n=0;let text='';const decoder=new TextDecoder();
  try{while(true){const {value,done}=await reader.read();if(done)break;n+=value.byteLength;if(n>4096){await reader.cancel();throw new Error('Body too large');}text+=decoder.decode(value,{stream:true});}}finally{reader.releaseLock();}
  text+=decoder.decode();
  if(request.headers.get('content-type')?.includes('application/json')){const v:unknown=JSON.parse(text);return v&&typeof v==='object'&&'email' in v&&typeof v.email==='string'?v.email:'';}
  return new URLSearchParams(text).get('email')??'';
}

/** null means another Worker route owns the request. Delivery never happens here. */
export async function handleGtmRequest(request:Request,env:GtmEnv):Promise<Response|null> {
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith('/api/gtm/')&&!path.startsWith('/claim/')&&!path.startsWith('/unsubscribe/'))return null;
  try {
    if(path==='/api/gtm/catalogue')return request.method==='GET'&&flags.gtmCatalogue?json({products:AD_CATALOGUE,checkoutEnabled:false}):json({error:'Unavailable'},404);
    const spawn=/^\/api\/gtm\/spawns\/([^/]+)$/.exec(path);
    if(spawn) {
      if(!flags.gtmSpawns||request.method!=='GET'||!validCompanySlug(spawn[1]!))return json({error:'Not found'},404);
      const row=await env.DB.prepare('SELECT slug,lat,lon,heading,building_id FROM gtm_spawns WHERE slug=?').bind(spawn[1]).first();
      return row?json({...row,headingUnit:'degrees'}):json({error:'Office spawn pending address/map review'},404);
    }
    const unsubscribe=/^\/unsubscribe\/([a-f0-9]{64})$/.exec(path);
    // Opt-outs never depend on marketing/claim flags: old links must remain functional.
    if(unsubscribe&&(request.method==='GET'||request.method==='POST')) {
      const result=await env.DB.prepare(`INSERT INTO gtm_suppressions(email,suppressed_at,reason) SELECT email,?,'one-click unsubscribe' FROM gtm_unsubscribe_tokens WHERE token_hash=? ON CONFLICT(email) DO NOTHING`).bind(Date.now(),await tokenHash(unsubscribe[1]!)).run();
      if(!result.meta.changes&&!await env.DB.prepare('SELECT email FROM gtm_unsubscribe_tokens WHERE token_hash=?').bind(await tokenHash(unsubscribe[1]!)).first())return page('Link not found','<p>This unsubscribe link is not valid. Reply to the sender to opt out.</p>',404);
      return page('You are unsubscribed','<p>You will receive no more GTASF marketing emails. No sign-in or additional information is needed.</p>');
    }
    if(path.startsWith('/claim/')&&!flags.officeClaims)return page('Office wraps are in preview','<p>The $100/week office-wrap offer is being prepared. Company verification and checkout are not open yet.</p>',503);
    const magic=/^\/claim\/verify\/([a-f0-9]{64})$/.exec(path);
    if(magic) {
      if(request.method==='GET')return page('Confirm your company email',`<p>Confirm this verification request. Nothing will be purchased or published.</p><form method="post" action="${escape(path)}"><button>Verify my company email</button></form>`);
      if(request.method!=='POST'||!sameOrigin(request))return json({error:'Same-origin POST required'},403);
      const session=await verifyEmail(env.DB,magic[1]!);if(!session)return page('Verification link expired','<p>Request a new link from your original claim page.</p>',410);
      const response=page('Company email verified','<p>Return to your original claim link. Upload, payment and moderation are the next steps; checkout remains in preview.</p>');
      response.headers.set('Set-Cookie',`gtasf_office_session=${session}; HttpOnly; Secure; SameSite=Strict; Path=/claim; Max-Age=3600`);return response;
    }
    const match=/^\/claim\/([a-f0-9]{64})(?:\/(verify|checkout))?$/.exec(path);if(!match)return json({error:'Not found'},404);
    const token=match[1]!;const offer=await getOffer(env.DB,token);if(!offer)return page('Offer expired or unavailable','<p>This offer link is no longer available.</p>',410);
    if(match[2]==='verify'&&request.method==='POST') {
      if(!sameOrigin(request))return json({error:'Same-origin POST required'},403);
      if(flags.officeClaimDelivery)return json({error:'Delivery adapter not configured'},503);
      const result=await requestVerification(env.DB,offer,await emailBody(request),url.origin);
      if(result==='domain-mismatch')return page('Use your company email',`<p>Verification requires an address ending exactly in @${escape(offer.domain)}.</p>`,400);
      if(result==='rate-limited')return json({error:'Please wait before requesting another verification'},429);
      return page('Verification draft prepared','<p>This preview stores a verification email draft for founder approval. No email has been sent. A request does not reserve an ad slot.</p>',202);
    }
    const cookie=request.headers.get('Cookie')?.match(/(?:^|;\s*)gtasf_office_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const verified=cookie&&tokenPattern.test(cookie)?await verifiedOffer(env.DB,cookie):null;
    const ownsOffer=verified?.token_hash===offer.token_hash;
    if(match[2]==='checkout'&&request.method==='POST') {
      if(!sameOrigin(request))return json({error:'Same-origin POST required'},403);
      return ownsOffer?json({error:'Upload, Stripe and moderation are not enabled; no charge or reservation created'},503):json({error:'Verify your company email first'},401);
    }
    if(match[2]||request.method!=='GET')return json({error:'Method not allowed'},405);
    return page(`${offer.company}'s office in GTASF`,`<p>Office wrap: <strong>$100/week</strong>. One slot per building per week, subject to current availability and review.</p><p><a href="/go/${escape(offer.lead_slug)}">See your office in GTASF</a></p><p>Building: ${escape(offer.building_id)}</p>${ownsOffer?'<p>Your company email is verified.</p>':`<form method="post" action="/claim/${token}/verify"><label for="email">Company email (@${escape(offer.domain)})</label><input id="email" type="email" name="email" required maxlength="254" autocomplete="email"><button>Prepare verification email</button></form>`}<p>Next: upload → payment → moderation → publication. These steps are in preview. Verification alone does not reserve the building.</p><small>Your logo will not appear publicly before payment and moderation approval.</small>`);
  } catch {return json({error:'GTM service unavailable; no message sent'},503);}
}
