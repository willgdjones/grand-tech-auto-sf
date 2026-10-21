// LANE E: no-browser check that every asset the live client can lazy-load actually serves (the post-deploy
// "chunk 404 → stuck loading" class). Fetches index.html, then crawls the JS graph: each /assets/*.js|css|wasm
// referenced from index or from a fetched JS file must return 200 with a sane content-type.
//   node tools/qa-prod-chunks.mjs            # https://gtasf.com
//   GTASF_QA_URL=https://<host> node tools/qa-prod-chunks.mjs
const BASE = (process.env.GTASF_QA_URL ?? 'https://gtasf.com').replace(/\/$/, '');
const seen = new Map(); const queue = [];
const ref = /(?:["'`(]|\/)(assets\/[A-Za-z0-9._\-]+\.(?:js|css|wasm))/g;
const rel = /["'`]\.\/([A-Za-z0-9._\-]+\.(?:js|css|wasm))["'`]/g; // Vite chunks import siblings as "./x.js"
const add = (p, from) => { if (!seen.has(p)) { seen.set(p, { from }); queue.push(p); } };
const enqueue = (body, from) => {
  for (const m of body.matchAll(ref)) add('/' + m[1], from);
  if (from.startsWith('/assets/')) for (const m of body.matchAll(rel)) add('/assets/' + m[1], from);
};
const html = await (await fetch(BASE + '/', { redirect: 'follow' })).text();
enqueue(html, '/');
const bad = [];
while (queue.length) {
  const batch = queue.splice(0, 12);
  await Promise.all(batch.map(async p => {
    try {
      const r = await fetch(BASE + p, { redirect: 'follow' });
      const ct = r.headers.get('content-type') ?? '';
      const ext = p.split('.').pop();
      const okType = ext === 'js' ? /javascript/.test(ct) : ext === 'css' ? /css/.test(ct) : /wasm|octet/.test(ct);
      seen.get(p).status = r.status;
      if (r.status !== 200 || !okType) bad.push(`${r.status} ${ct || '-'} ${p} (from ${seen.get(p).from})`);
      if (r.ok && ext === 'js') enqueue(await r.text(), p);
    } catch (e) { bad.push(`ERR ${p}: ${e.message}`); }
  }));
}
console.log(`${BASE}: ${seen.size} assets crawled, ${bad.length} bad`);
for (const b of bad) console.log('  ' + b);
process.exit(bad.length ? 1 : 0);
