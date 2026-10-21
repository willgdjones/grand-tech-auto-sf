/** Disposable workerd/D1/SQLite integration. Clock/providers are explicit transport fixtures. */
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const out = resolve('artifacts/referrals-native'); await mkdir(out, { recursive: true });
let now = Date.now(), serial = 0, mailProof = '';
const webhookSecret = 'whsec_isolated_referral_smoke', sessions = new Map(), intents = new Map();
const report = { at: new Date(now).toISOString(), scope: 'Disposable native Worker, real D1/SQLite; isolated clock/email/Stripe/Jev/DNS transports; no provider or deployment acceptance', checks: [], providerCalls: 0 };
const entry = `import app,{WorldDO as RealWorld,LedgerDO as RealLedger,LobbyDO} from './worker/src/index.ts';
export {LobbyDO};let fixtureNow=${now};Date.now=()=>fixtureNow;
function clock(r){const n=Number(r.headers.get('X-Fixture-Now'));if(n>0)fixtureNow=n;}
export class WorldDO extends RealWorld {constructor(c,e){super(c,e);this.ticker.manual=true;if(this.ticker.timer)clearInterval(this.ticker.timer);}
async fetch(r){clock(r);const p=new URL(r.url).pathname;if(p==='/__fixture/step'){this.step();return new Response('stepped');}if(p==='/__fixture/world-flush'){await this.referralPlay?.flush(Date.now());return new Response('flushed');}return super.fetch(r);}}
export class LedgerDO extends RealLedger {async fetch(r){clock(r);if(new URL(r.url).pathname==='/__fixture/ledger-flush'){await this.alarm();return new Response('flushed');}return super.fetch(r);}}
export default {async fetch(r,e,c){clock(r);const p=new URL(r.url).pathname;if(p==='/__fixture/step'||p==='/__fixture/world-flush')return e.WORLD.get(e.WORLD.idFromName('sf')).fetch(r);if(p==='/__fixture/ledger-flush')return e.LEDGER.get(e.LEDGER.idFromName('outbid:test')).fetch(r);return app.fetch(r,e,c);}};`;
const bundle = await build({ stdin: { contents: entry, resolveDir: resolve('.'), loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  external: ['cloudflare:workers','node:*'], conditions: ['workerd','worker','browser'], write: false, logLevel: 'error', plugins: [{ name: 'isolated-flags', setup(b) {
    b.onLoad({ filter: /worker\/src\/ledger\/LedgerDO\.ts$/ }, async args => ({ loader: 'ts', contents: (await readFile(args.path,'utf8')).replace("const code = error instanceof Error ? error.message : '';", "console.error('ISOLATED_FIXTURE_LEDGER_ERROR', String(error)); const code = error instanceof Error ? error.message : '';") }));
    b.onLoad({ filter: /shared\/flags\.ts$/ }, async args => ({ loader: 'ts', contents: (await readFile(args.path,'utf8'))
      .replace(/\b(referrals|referralClaims|referralCredit|referralWarmIntro|outbidCheckout): false/g, '$1: true').replace('worldCapacity: true','worldCapacity: false') }));
  } }] });
await writeFile(`${out}/fixture-worker.js`,bundle.outputFiles[0].text);
const json = value => Response.json(value);
async function outbound(request) {
  report.providerCalls++; const url = new URL(request.url);
  if (url.hostname === 'cloudflare-dns.com') return json({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] });
  if (url.hostname === 'example.com') return new Response('<html>Build useful tools for San Francisco.</html>', { headers: { 'Content-Type': 'text/html' } });
  if (url.hostname === 'api.typesafe.ai') return json({ answers: { acceptable: { type: 'noul', noul: 1 } } });
  if (url.hostname !== 'api.stripe.com') throw new Error(`Unexpected external transport: ${url.hostname}`);
  if (url.pathname === '/v1/checkout/sessions' && request.method === 'POST') {
    const body = new URLSearchParams(await request.text()), id = `cs_test_fixture_${++serial}`;
    const metadata = Object.fromEntries([...body].filter(([key]) => key.startsWith('metadata[')).map(([key,value]) => [key.slice(9,-1),value]));
    const cash = Number(body.get('line_items[0][price_data][unit_amount]'));
    const session = { id, object: 'checkout.session', livemode: false, mode: 'payment', currency: 'usd', amount_total: cash, metadata,
      url: `https://checkout.stripe.com/c/pay/${id}`, status: 'open', payment_status: 'unpaid', payment_intent: cash ? `pi_fixture_${serial}` : null,
      customer_details: { email: `buyer${serial}@example.com` }, line_items: { data: [{ quantity: 1, amount_total: cash }], has_more: false } };
    sessions.set(id,session); return json(session);
  }
  if (url.pathname.startsWith('/v1/checkout/sessions/')) return json(sessions.get(url.pathname.split('/').at(-1)));
  if (url.pathname.startsWith('/v1/payment_intents/')) return json(intents.get(url.pathname.split('/').at(-1)));
  throw new Error(`Unexpected Stripe fixture operation ${request.method} ${url.pathname}`);
}
const pool = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false }, workers: [{
  name: 'referral-native-smoke', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-28', compatibilityFlags: ['nodejs_compat'],
  bindings: { ENVIRONMENT: 'local', LAUNCH_MODE: 'open', STRIPE_SECRET_KEY: 'sk_test_isolated_referral_smoke', STRIPE_WEBHOOK_SECRET: webhookSecret, TYPESAFE_API_KEY: 'isolated-fixture' },
  durableObjects: { WORLD: { className: 'WorldDO', useSQLite: true }, LEDGER: { className: 'LedgerDO', useSQLite: true }, LOBBY: { className: 'LobbyDO', useSQLite: true } },
  d1Databases: ['DB'], r2Buckets: ['ASSETS'], queueProducers: { JOBS: 'fixture-jobs' }, outboundService: outbound,
  serviceBindings: { REFERRAL_MAILER: async request => { const message = await request.json(); assert.equal(message.to, 'owner@example.com'); mailProof = /#referral-claim=([a-f0-9.-]+)/.exec(message.text)[1]; return new Response(null,{status:202}); } },
}] }));
const sockets = [];
try {
  const base = String(await pool.ready), origin = new URL(base).origin, db = await pool.getD1Database('DB');
  for (const file of (await readdir('worker/migrations')).filter(name => /^\d.*\.sql$/.test(name)).sort()) {
    for (const sql of (await readFile(`worker/migrations/${file}`,'utf8')).replace(/--[^\n]*/g, '').split(';').filter(sql => sql.trim())) await db.prepare(sql).run();
  }
  function person() { return { cookies: new Map() }; }
  async function request(person, path, body, extra = {}) {
    const headers = { Origin: origin, 'X-Fixture-Now': String(now), Cookie: [...person.cookies].map(([k,v]) => `${k}=${v}`).join('; '), ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await pool.dispatchFetch(new URL(path,base), { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const cookie = response.headers.get('Set-Cookie'); if(cookie) { const [pair] = cookie.split(';'); const at=pair.indexOf('='); person.cookies.set(pair.slice(0,at),pair.slice(at+1)); }
    return response;
  }
  async function api(person,path,body,extra) { const response = await request(person,path,body,extra); const data=await response.json(); assert.equal(response.status,200,`${path}: ${JSON.stringify(data)}`); return data; }
  const owner=person(), buyer=person(), other=person();
  const op=await api(owner,'/api/referrals/profile'), bp=await api(buyer,'/api/referrals/profile'), cp=await api(other,'/api/referrals/profile');
  assert.notEqual(op.code,bp.code); assert.equal(op.claimEnabled,true);
  await api(buyer,'/api/referrals/visit',{code:op.code,visitId:crypto.randomUUID()}); now++;
  await api(buyer,'/api/referrals/visit',{code:cp.code,visitId:crypto.randomUUID()}); now++;
  await api(buyer,'/api/referrals/visit',{code:op.code,visitId:crypto.randomUUID()});
  assert.equal((await api(owner,'/api/referrals/profile')).clicks,2);
  assert.equal((await request(other,'/api/referrals/visit',{code:op.code,visitId:crypto.randomUUID()},{Origin:'https://foreign.example'})).status,403);
  await api(owner,'/api/referrals/claim',{email:'owner@example.com'}); assert.ok(mailProof);
  assert.equal((await request(other,'/api/referrals/verify',{proof:mailProof})).status,400);
  await api(owner,'/api/referrals/verify',{proof:mailProof}); assert.equal((await request(owner,'/api/referrals/verify',{proof:mailProof})).status,400);
  report.checks.push('Real HTTP signed-device identity, last-click attribution, foreign origin rejection, email delivery adapter and one-use same-device verification');
  // Use the normal websocket HELLO and ACTIVITY wire frames. Only the clock/tick driver is isolated.
  const upgrade = await request(buyer,'/api/world',undefined,{Upgrade:'websocket','Sec-WebSocket-Protocol':'gtasf.v2'}); assert.equal(upgrade.status,101);
  const socket=upgrade.webSocket; socket.accept(); sockets.push(socket);
  const welcomes=[]; socket.addEventListener('message',event=>{ const bytes=new Uint8Array(event.data); if(bytes[0]===0x81)welcomes.push(bytes); });
  socket.send(Uint8Array.from([1,2,6,...new TextEncoder().encode('Friend'),0]));
  async function until(read,predicate,label) { for(let i=0;i<60;i++){const value=await read();if(predicate(value))return value;await new Promise(done=>setTimeout(done,20));}throw new Error(`Timed out: ${label}`); }
  await until(()=>api(owner,'/api/referrals/profile'),p=>p.players===1,'accepted referred player'); assert.equal(welcomes.length,1);
  for(let i=0;i<300;i++){ now+=1000; socket.send(Uint8Array.of(0x17)); const response=await request(buyer,'/__fixture/step'); assert.equal(response.status,200); await response.text(); }
  await (await request(buyer,'/__fixture/world-flush')).text();
  const funding=await api(owner,'/api/funding/profile'); assert.equal(funding.totalCents,'10000000');
  report.checks.push('Actual WorldDO websocket acceptance and server-tick path yield one $100k fictional funding bonus at five-minute fixture boundary');
  socket.close();
  await api(buyer,'/api/outbid'); await api(owner,'/api/outbid');
  const bid={name:'SF Builder',message:'Build useful tools',url:'https://example.com/',amountCents:10000};
  const purchase=await api(buyer,'/api/outbid/checkout',bid,{'Idempotency-Key':crypto.randomUUID()});
  assert.deepEqual((await api(buyer,'/api/outbid')).snapshot.entries,[],'Checkout/redirect never ranks unpaid orders');
  const session=[...sessions.values()].find(s=>s.metadata.orderId===purchase.orderId); assert.ok(session);
  session.payment_status='paid';session.status='complete';
  const intent={id:session.payment_intent,object:'payment_intent',livemode:false,status:'succeeded',metadata:session.metadata,currency:'usd',amount:10000,amount_received:10000,
    latest_charge:{id:'ch_fixture_1',livemode:false,paid:true,captured:true,currency:'usd',amount:10000,amount_refunded:0,payment_intent:session.payment_intent,disputed:false,created:Math.floor(now/1000),billing_details:{email:'buyer@example.com'},payment_method_details:{card:{fingerprint:'fixture-buyer-card'}}}};
  intents.set(intent.id,intent);
  async function webhook(eventId,type,object,bad=false){const raw=JSON.stringify({id:eventId,object:'event',type,livemode:false,created:Math.floor(now/1000),data:{object}}),t=Math.floor(now/1000);
    const sig=createHmac('sha256',webhookSecret).update(`${t}.${raw}`).digest('hex');
    const response=await pool.dispatchFetch(new URL('/api/outbid/webhook',base),{method:'POST',headers:{'Content-Type':'application/json','X-Fixture-Now':String(now),'Stripe-Signature':`t=${t},v1=${bad?'0'.repeat(64):sig}`},body:raw});
    const result=await response.json();assert.equal(response.status,bad?400:200,JSON.stringify(result));
  }
  await webhook('evt_paid','checkout.session.completed',{id:session.id},true);
  assert.deepEqual((await api(buyer,'/api/outbid')).snapshot.entries,[]);
  await webhook('evt_paid','checkout.session.completed',{id:session.id}); await webhook('evt_paid','checkout.session.completed',{id:session.id});
  await (await request(buyer,'/__fixture/ledger-flush')).text();
  assert.equal((await api(buyer,'/api/outbid')).snapshot.entries[0].totalCents,'10000');
  const pending=await api(owner,'/api/referrals/profile'); assert.equal(pending.pendingCents,'2000'); assert.equal(pending.availableCents,'0');
  assert.equal((await api(other,'/api/referrals/profile')).pendingCents,'0','Last-click froze owner at checkout');
  now=intent.latest_charge.created*1000+7*86400000;
  assert.equal((await api(owner,'/api/referrals/profile')).availableCents,'2000');
  const quote=await api(owner,'/api/outbid/credit-quote?amountCents=2000'); assert.equal(quote.creditCents,2000);assert.equal(quote.cashCents,0);
  const free=await api(owner,'/api/outbid/checkout',{...bid,name:'Referrer',amountCents:2000,useCredit:true,expectedCreditCents:2000},{'Idempotency-Key':crypto.randomUUID()});
  const freeSession=[...sessions.values()].find(s=>s.metadata.orderId===free.orderId);assert.equal(freeSession.amount_total,0);assert.equal(freeSession.payment_intent,null);
  freeSession.payment_status='no_payment_required';freeSession.status='complete';
  await webhook('evt_credit','checkout.session.completed',{id:freeSession.id});await (await request(owner,'/__fixture/ledger-flush')).text();
  assert.equal((await api(owner,'/api/outbid')).viewer.totalCents,'2000');assert.equal((await api(owner,'/api/referrals/profile')).availableCents,'0');
  now+=1000;intent.latest_charge.amount_refunded=10000;
  await webhook('evt_refund','charge.refunded',{payment_intent:intent.id});await (await request(buyer,'/__fixture/ledger-flush')).text();
  const debt=await api(owner,'/api/referrals/profile');assert.equal(debt.debtCents,'2000');assert.equal(debt.availableCents,'0');
  assert.equal((await api(buyer,'/api/outbid')).viewer.totalCents,'0');
  assert.equal((await request(owner,'/api/referrals/cashout',{})).status,503);
  report.checks.push('Real checkout/provider retrieval + signed webhook reject/replay, exactly20% pending, seven-day maturity, zero-cash credit Checkout, refund debt and disabled cash-out');
  report.passed=true;console.log('TEST_PASSED:NativeReferralFlow '+JSON.stringify(report.checks));
} catch(error){report.failure=String(error);throw error;}
finally{for(const socket of sockets)try{socket.close();}catch{} await pool.dispose();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');}
