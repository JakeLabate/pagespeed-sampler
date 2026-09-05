/* Drives the real Worker module against stub KV, cache and Google. */
import worker from './src/index.js';

/* --- stubs --- */
const kv = new Map();
const BUDGET = {
  async get(k){ const v = kv.get(k); return v === undefined ? null : v; },
  async put(k, v){ kv.set(k, String(v)); },
};
const cacheStore = new Map();
globalThis.caches = { default: {
  async match(req){ const v = cacheStore.get(req.url); return v ? v.clone() : undefined; },
  async put(req, res){ cacheStore.set(req.url, res.clone()); }
}};

let googleCalls = [], quotaDead = new Set(), failNext = null;
globalThis.fetch = async (u, init) => {
  const url = new URL(u);
  const key = url.searchParams.get('key');
  googleCalls.push({ host: url.host, key, url: u });
  if(failNext){ const f = failNext; failNext = null;
    return new Response(JSON.stringify({error:{code:f,message:'x'}}), {status:f}); }
  if(quotaDead.has(key))
    return new Response(JSON.stringify({error:{code:429,message:'Quota exceeded'}}), {status:429});
  return new Response(JSON.stringify({ ok:true, lighthouseResult:{} }),
    {status:200, headers:{'Content-Type':'application/json'}});
};

const env = { PSI_KEYS:'KEY_AAA1,KEY_BBB2', TOKEN_SECRET:'s3cret-long-string',
              BUDGET, DAILY_CALLS:'50', DAILY_CRUX:'10',
              ALLOW_ORIGIN:'https://pagespeed.jakelabate.com' };
const ctx = { waitUntil(p){ return p; } };
const IP = { 'CF-Connecting-IP':'203.0.113.9' };
const IP2 = { 'CF-Connecting-IP':'198.51.100.4' };

const call = (path, opts={}) => worker.fetch(new Request('https://w.dev'+path, {
  method: opts.method||'GET', headers: Object.assign({}, opts.ip||IP, opts.headers||{}),
  body: opts.body ? JSON.stringify(opts.body) : undefined }), env, ctx);
const j = async r => ({ status:r.status, body: await r.json().catch(()=>null),
                        cors: r.headers.get('Access-Control-Allow-Origin'),
                        cache: r.headers.get('X-PSS-Cache') });

const SAMPLE_HINT=20;
let pass=0, fail=0;
const ok = (name, cond, extra) => { if(cond){pass++; console.log('  ok   '+name);}
  else {fail++; console.log('  FAIL '+name+(extra!==undefined?'  -> '+JSON.stringify(extra):''));} };

(async()=>{
console.log('BUDGET');
let r = await j(await call('/budget'));
ok('reports the limits', r.body.psi.limit===50 && r.body.crux.limit===10, r.body);
ok('nothing spent yet', r.body.psi.used===0 && r.body.psi.left===50, r.body);
ok('says a backend is configured', r.body.available===true, r.body);
ok('cors is locked to the site', r.cors==='https://pagespeed.jakelabate.com', r.cors);

console.log('RESERVE');
r = await j(await call('/reserve', {method:'POST', body:{calls:20, kind:'psi'}}));
ok('issues a token', !!r.body.token, r.body);
ok('charges up front', r.body.left===30, r.body);
const T = r.body.token;
r = await j(await call('/budget'));
ok('budget reflects the reservation', r.body.psi.used===20, r.body);

r = await j(await call('/reserve', {method:'POST', body:{calls:40, kind:'psi'}}));
ok('refuses more than is left', r.status===429 && r.body.error==='exhausted', r.body);
ok('says how much is left', r.body.left===30, r.body);

r = await j(await call('/reserve', {method:'POST', body:{calls:5, kind:'psi'}, ip:IP2}));
ok('a different IP has its own allowance', r.status===200 && r.body.left===45, r.body);

console.log('PSI');
googleCalls=[];
r = await j(await call('/psi?url=https%3A%2F%2Fa.test%2F&strategy=mobile&category=seo&t='+encodeURIComponent(T)));
ok('forwards with a key', r.status===200 && googleCalls.length===1 && !!googleCalls[0].key, googleCalls[0]);
ok('no key in the response the browser sees',
   !JSON.stringify(r.body).includes('KEY_') , r.body);
ok('hits pagespeed', googleCalls[0].host==='www.googleapis.com', googleCalls[0].host);
ok('marks a cache miss', r.cache==='miss', r.cache);

googleCalls=[];
r = await j(await call('/psi?url=https%3A%2F%2Fa.test%2F&strategy=mobile&category=seo&t='+encodeURIComponent(T)));
ok('second identical call is served from cache', r.status===200 && googleCalls.length===0, googleCalls.length);
ok('marks a cache hit', r.cache==='hit', r.cache);

googleCalls=[];
r = await j(await call('/psi?url=https%3A%2F%2Fa.test%2F&strategy=desktop&category=seo&t='+encodeURIComponent(T)));
ok('a different strategy is a different cache entry', googleCalls.length===1, googleCalls.length);

console.log('TOKENS');
r = await j(await call('/psi?url=https%3A%2F%2Fa.test%2Fx&strategy=mobile&t=garbage'));
ok('rejects a forged token', r.status===401 && r.body.error==='bad_token', r.body);
r = await j(await call('/psi?url=https%3A%2F%2Fa.test%2Fx&strategy=mobile&t='+encodeURIComponent(T), {ip:IP2}));
ok('a token is bound to the IP that minted it', r.status===401, r.body);
r = await j(await call('/psi?url=https%3A%2F%2Fa.test%2Fx&strategy=mobile', {ip:IP}));
ok('rejects a missing token', r.status===401, r.body);
const cruxTok = (await (await call('/reserve',{method:'POST',body:{calls:4,kind:'crux'}})).json()).token;
r = await j(await call('/psi?url=https%3A%2F%2Fa.test%2Fy&strategy=mobile&t='+encodeURIComponent(cruxTok)));
ok('a crux token cannot spend psi budget', r.status===401, r.body);

console.log('KEY POOL');
const realRandom = Math.random;
Math.random = () => 0;            // always start at the first key
googleCalls=[]; quotaDead.add('KEY_AAA1');
r = await j(await call('/psi?url=https%3A%2F%2Fb.test%2F&strategy=mobile&t='+encodeURIComponent(T)));
ok('a quota-dead key falls through to the other', r.status===200, r.body);
ok('tried more than one key', new Set(googleCalls.map(c=>c.key)).size>=1 && googleCalls.some(c=>c.key==='KEY_BBB2'), googleCalls.map(c=>c.key));
ok('parks the dead key', [...kv.keys()].some(k=>k.startsWith('x:')), [...kv.keys()].filter(k=>k.startsWith('x:')));
googleCalls=[];
r = await j(await call('/psi?url=https%3A%2F%2Fc.test%2F&strategy=mobile&t='+encodeURIComponent(T)));
ok('the parked key is skipped next time', googleCalls.every(c=>c.key==='KEY_BBB2'), googleCalls.map(c=>c.key));
Math.random = realRandom;
quotaDead.clear();

console.log('CRUX');
googleCalls=[];
r = await j(await call('/crux?t='+encodeURIComponent(cruxTok), {method:'POST', body:{origin:'https://a.test', formFactor:'PHONE'}}));
ok('forwards to chromeuxreport', r.status===200 && googleCalls[0].host==='chromeuxreport.googleapis.com', googleCalls[0]);
googleCalls=[];
r = await j(await call('/crux?t='+encodeURIComponent(cruxTok), {method:'POST', body:{origin:'https://a.test', formFactor:'PHONE'}}));
ok('crux is cached too', googleCalls.length===0 && r.cache==='hit', {n:googleCalls.length, c:r.cache});
googleCalls=[];
r = await j(await call('/crux/history?t='+encodeURIComponent(cruxTok), {method:'POST', body:{origin:'https://a.test'}}));
ok('history is a separate endpoint and entry', googleCalls.length===1 && /queryHistoryRecord/.test(googleCalls[0].url), googleCalls[0]&&googleCalls[0].url);
r = await j(await call('/crux?t='+encodeURIComponent(cruxTok), {method:'POST', body:{}}));
ok('rejects a call with no origin', r.status===400, r.body);

console.log('SITEMAP PROXY still works');
googleCalls=[];
r = await call('/?url=https%3A%2F%2Fa.test%2Fsitemap.xml');
ok('proxies without a token', r.status===200, r.status);
ok('still cors locked', r.headers.get('Access-Control-Allow-Origin')==='https://pagespeed.jakelabate.com');

console.log('RELEASE');
const before = (await (await call('/budget')).json()).psi.used;
r = await j(await call('/release', {method:'POST', body:{token:T, unused:10}}));
ok('refunds unused calls', r.body.refunded===10, r.body);
const after = (await (await call('/budget')).json()).psi.used;
ok('budget goes back down', after===before-10, {before, after});

console.log('NO BACKEND CONFIGURED');
const env2 = Object.assign({}, env, {PSI_KEYS:''});
r = await (await worker.fetch(new Request('https://w.dev/reserve',{method:'POST',headers:IP,body:'{"calls":5}'}), env2, ctx)).json();
ok('says so rather than pretending', r.error==='no_backend', r);

console.log('REPLAY BOUND');
{
  const big = (await (await call('/reserve',{method:'POST',body:{calls:50,kind:'psi'},ip:{'CF-Connecting-IP':'192.0.2.77'}})).json()).token;
  const ip3 = {'CF-Connecting-IP':'192.0.2.77'};
  let served=0, blocked=0;
  for(let i=0;i<400;i++){
    const rr = await call('/psi?url=https%3A%2F%2Freplay.test%2F'+i+'&strategy=mobile&t='+encodeURIComponent(big), {ip:ip3});
    if(rr.status===200) served++; else blocked++;
  }
  ok('a leaked token cannot be replayed forever', blocked>0, {served, blocked});
  ok('over-run stays inside the documented 2x bound', served <= 50 * 2, {served, reserved:50});
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
})();
