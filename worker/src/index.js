/* PageSpeed Sampler backend.
 *
 * The app is still a static page with no server of its own. This Worker exists
 * for one reason: so a visitor does not need a Google Cloud project to use it.
 * It holds the API keys, meters what each visitor spends, and never lets a key
 * reach the browser.
 *
 * Routes
 *   GET  /?url=            the original sitemap CORS proxy, unchanged
 *   GET  /budget           what this IP has left today, spends nothing
 *   POST /reserve          claim a slice of today's allowance, returns a token
 *   GET  /psi?...&t=       one PageSpeed call against a pooled key
 *   POST /crux?...&t=      one Chrome UX Report call against a pooled key
 *
 * Bindings
 *   PSI_KEYS      secret, comma separated. One per Google Cloud project.
 *   TOKEN_SECRET  secret, any long random string. Signs reservation tokens.
 *   BUDGET        KV namespace.
 *   DAILY_CALLS   var, PageSpeed calls one IP may spend per day.
 *   DAILY_CRUX    var, Chrome UX Report calls one IP may spend per day.
 *   ALLOW_ORIGIN  var, the site allowed to call this.
 */

const DEFAULTS = {
  DAILY_CALLS: 200,
  DAILY_CRUX: 60,
  ALLOW_ORIGIN: 'https://pagespeed.jakelabate.com'
};

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CRUX_ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
const CRUX_HISTORY = 'https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord';

/* PageSpeed results are cached because the same URL measured twice in an hour is
   two identical numbers and one wasted call. Lighthouse is noisy run to run, so
   this also makes a re-run reproducible for as long as the entry lives, which is
   a property the report already documents. */
const PSI_CACHE_S = 6 * 60 * 60;
/* CrUX is a 28 day rolling window that updates daily. An hour is plenty. */
const CRUX_CACHE_S = 6 * 60 * 60;

const num = (v, d) => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : d; };
const cfg = (env, k) => k === 'ALLOW_ORIGIN' ? (env[k] || DEFAULTS[k]) : num(env[k], DEFAULTS[k]);

function corsHeaders(env, extra){
  return Object.assign({
    'Access-Control-Allow-Origin': cfg(env, 'ALLOW_ORIGIN'),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  }, extra || {});
}
function json(env, body, status, extra){
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: corsHeaders(env, Object.assign({ 'Content-Type': 'application/json' }, extra || {}))
  });
}

/* Quotas reset at midnight Pacific, which is when Google resets them, so a day
   here is a Google day rather than the visitor's. */
function today(){
  return new Date(Date.now() - 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function midnightSecondsLeft(){
  const d = new Date(Date.now() - 8 * 3600 * 1000);
  return 86400 - (d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds());
}

async function sha256hex(s){
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
/* The raw IP is never stored. A salted hash is enough to meter against and is
   not a record of who visited. */
async function ipKey(request, env){
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  return (await sha256hex(ip + '|' + (env.TOKEN_SECRET || ''))).slice(0, 24);
}

async function hmac(secret, msg){
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, c => ({'+':'-','/':'_','=':''}[c]));
}
async function mintToken(env, who, kind, calls){
  /* Short lived on purpose. The token is the only thing standing between a
     reservation and a replay of it, so it should not outlive the sweep it was
     minted for. A PageSpeed call takes 10 to 30 seconds and the app runs them
     tens at a time, so a couple of seconds per reserved call is generous. */
  const ttl = Math.min(1800, Math.max(180, Math.round(calls * 2)));
  const body = [who, kind, calls, Math.floor(Date.now() / 1000) + ttl,
                crypto.randomUUID().slice(0, 8)].join('.');
  return body + '.' + await hmac(env.TOKEN_SECRET, body);
}
async function readToken(env, t){
  if(!t) return null;
  const i = t.lastIndexOf('.');
  if(i < 0) return null;
  const body = t.slice(0, i), sig = t.slice(i + 1);
  if(await hmac(env.TOKEN_SECRET, body) !== sig) return null;
  const [who, kind, calls, exp, nonce] = body.split('.');
  if(!who || !exp) return null;
  if(parseInt(exp, 10) < Math.floor(Date.now() / 1000)) return null;
  return { who, kind, calls: parseInt(calls, 10), nonce };
}

async function spent(env, who, kind){
  const v = await env.BUDGET.get('d:' + today() + ':' + kind + ':' + who);
  return parseInt(v || '0', 10) || 0;
}
async function charge(env, who, kind, n){
  const k = 'd:' + today() + ':' + kind + ':' + who;
  const cur = parseInt((await env.BUDGET.get(k)) || '0', 10) || 0;
  await env.BUDGET.put(k, String(cur + n), { expirationTtl: midnightSecondsLeft() + 3600 });
  return cur + n;
}

/* A reservation is charged up front and metered again, loosely, per call. The
   up-front charge is one KV write per sweep instead of one per call, which is
   what makes this affordable; the loose per-token counter exists only so a
   leaked token cannot be replayed indefinitely. Sampling it every SAMPLE calls
   keeps the write rate sane, and the resulting over-run is bounded by SAMPLE. */
/* KV on the free plan allows 1,000 writes a day, which is the scarcest resource
   here, so the per-token counter is sampled rather than exact. The step scales
   with the reservation so the cost is about ten writes per sweep whatever its
   size, and the over-run a leaked token can produce stays proportional to what
   was reserved instead of growing with it.

   The real control is the daily per-IP charge taken at reservation time, which
   costs one write. This counter only exists so a token cannot be replayed
   indefinitely. Sampling makes the cut-off point noisy: measured over repeated
   runs, a token replayed as hard as possible serves up to about twice what it
   reserved before it is refused. That is the accepted bound. Closing it would
   mean counting every call, which at 1,000 KV writes a day would cap the whole
   service at a handful of sweeps, and the exposure it buys back is small: the
   token is bound to the IP that minted it, so replaying it is only useful to
   the visitor who has already been charged. */
function sampleStep(calls){ return Math.max(1, Math.round(calls / 10)); }
async function tokenOverspent(env, tok){
  if(!tok.nonce) return false;
  const step = sampleStep(tok.calls);
  const k = 't:' + tok.nonce;
  const used = parseInt((await env.BUDGET.get(k)) || '0', 10) || 0;
  if(used > tok.calls + step) return true;
  if(step === 1 || Math.random() < 1 / step){
    await env.BUDGET.put(k, String(used + step), { expirationTtl: 3600 });
  }
  return false;
}

/* One key per Google Cloud project. A key that has hit its daily quota is
   parked until the quota resets rather than retried on every call. */
function allKeys(env){
  return String(env.PSI_KEYS || '').split(/[\s,;]+/).filter(Boolean);
}
async function liveKeys(env){
  const ks = allKeys(env);
  if(ks.length < 2) return ks;
  const out = [];
  for(const k of ks){
    const dead = await env.BUDGET.get('x:' + today() + ':' + k.slice(-8));
    if(!dead) out.push(k);
  }
  return out.length ? out : ks;
}
async function parkKey(env, key){
  await env.BUDGET.put('x:' + today() + ':' + key.slice(-8), '1',
    { expirationTtl: midnightSecondsLeft() + 60 });
}

/* Cache key deliberately excludes the API key, so every visitor shares one
   cache and a site that has already been measured costs nothing to measure
   again. */
async function cached(cacheUrl, run, ttl, ctx){
  const cache = caches.default;
  const req = new Request(cacheUrl, { method: 'GET' });
  const hit = await cache.match(req);
  if(hit) return { res: hit, hit: true };
  const res = await run();
  if(res.status === 200){
    const copy = new Response(res.clone().body, res);
    copy.headers.set('Cache-Control', 'public, max-age=' + ttl);
    if(ctx && ctx.waitUntil) ctx.waitUntil(cache.put(req, copy));
    else await cache.put(req, copy);
  }
  return { res, hit: false };
}

async function callGoogle(env, build, ctx, cacheUrl, ttl){
  const keys = await liveKeys(env);
  if(!keys.length) return { status: 503, body: { error: 'no key configured' } };
  let last = null;
  /* Pick the starting key at random so load spreads across projects, then walk
     the list in order. Re-rolling the die on each retry would let a key that
     just returned 429 be chosen again, which is the one thing a retry must not
     do. */
  const start = Math.floor(Math.random() * keys.length);
  for(let i = 0; i < Math.min(keys.length, 3); i++){
    const key = keys[(start + i) % keys.length];
    const { res, hit } = await cached(cacheUrl, () => build(key), ttl, ctx);
    if(res.status === 200) return { status: 200, res, hit };
    if(res.status === 429 || res.status === 403){
      /* Quota on this project is gone for the day. Park it and try another. */
      if(keys.length > 1) await parkKey(env, key);
      last = res; continue;
    }
    return { status: res.status, res, hit };
  }
  return { status: last ? last.status : 502, res: last };
}

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if(request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env) });

    /* ---- the original sitemap proxy, untouched behaviour ---- */
    if(path === '/' && url.searchParams.get('url')){
      const target = url.searchParams.get('url');
      if(request.method !== 'GET') return new Response('GET only', { status: 405 });
      const upstream = await fetch(target, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PageSpeedSampler/1.0; +https://pagespeed.jakelabate.com)',
          'Accept': 'application/xml,text/xml,text/plain,text/html;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        redirect: 'follow'
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: corsHeaders(env, { 'Content-Type': upstream.headers.get('content-type') || 'text/plain' })
      });
    }

    const who = await ipKey(request, env);

    /* ---- what is left today ---- */
    if(path === '/budget'){
      const psi = await spent(env, who, 'psi'), crux = await spent(env, who, 'crux');
      return json(env, {
        available: allKeys(env).length > 0,
        psi:  { used: psi,  limit: cfg(env, 'DAILY_CALLS'), left: Math.max(0, cfg(env, 'DAILY_CALLS') - psi) },
        crux: { used: crux, limit: cfg(env, 'DAILY_CRUX'),  left: Math.max(0, cfg(env, 'DAILY_CRUX')  - crux) },
        resets_in_s: midnightSecondsLeft()
      });
    }

    /* ---- claim a slice of the allowance ---- */
    if(path === '/reserve'){
      if(request.method !== 'POST') return json(env, { error: 'POST only' }, 405);
      if(!allKeys(env).length) return json(env, { error: 'no_backend' }, 503);
      const body = await request.json().catch(() => ({}));
      const kind = body.kind === 'crux' ? 'crux' : 'psi';
      const want = Math.max(1, Math.min(2000, parseInt(body.calls, 10) || 1));
      const limit = cfg(env, kind === 'crux' ? 'DAILY_CRUX' : 'DAILY_CALLS');
      const used = await spent(env, who, kind);
      const left = Math.max(0, limit - used);
      if(want > left){
        return json(env, { error: 'exhausted', left, limit, want,
                           resets_in_s: midnightSecondsLeft() }, 429);
      }
      await charge(env, who, kind, want);
      return json(env, { token: await mintToken(env, who, kind, want),
                         calls: want, left: left - want, limit });
    }

    /* ---- give back what a cancelled sweep did not spend ---- */
    if(path === '/release'){
      if(request.method !== 'POST') return json(env, { error: 'POST only' }, 405);
      const body = await request.json().catch(() => ({}));
      const tok = await readToken(env, body.token);
      if(!tok || tok.who !== who) return json(env, { ok: false }, 200);
      const back = Math.max(0, Math.min(tok.calls, parseInt(body.unused, 10) || 0));
      if(back) await charge(env, who, tok.kind, -back);
      return json(env, { ok: true, refunded: back });
    }

    /* ---- metered PageSpeed ---- */
    if(path === '/psi'){
      const tok = await readToken(env, url.searchParams.get('t'));
      if(!tok || tok.who !== who || tok.kind !== 'psi')
        return json(env, { error: 'bad_token' }, 401);
      if(await tokenOverspent(env, tok)) return json(env, { error: 'exhausted' }, 429);

      const target = url.searchParams.get('url');
      if(!target) return json(env, { error: 'missing url' }, 400);
      const strategy = url.searchParams.get('strategy') === 'desktop' ? 'desktop' : 'mobile';
      const cats = url.searchParams.getAll('category').filter(c => /^[a-z-]+$/.test(c));

      const base = new URLSearchParams();
      base.set('url', target); base.set('strategy', strategy);
      cats.forEach(c => base.append('category', c));
      const cacheUrl = 'https://cache.pss/psi?' + base.toString();

      const out = await callGoogle(env, key => {
        const p = new URLSearchParams(base); p.set('key', key);
        return fetch(PSI_ENDPOINT + '?' + p.toString());
      }, ctx, cacheUrl, PSI_CACHE_S);

      if(!out.res) return json(env, { error: 'upstream unavailable' }, out.status || 502);
      return new Response(out.res.body, {
        status: out.res.status,
        headers: corsHeaders(env, {
          'Content-Type': 'application/json',
          'X-PSS-Cache': out.hit ? 'hit' : 'miss'
        })
      });
    }

    /* ---- metered Chrome UX Report ---- */
    if(path === '/crux' || path === '/crux/history'){
      if(request.method !== 'POST') return json(env, { error: 'POST only' }, 405);
      const tok = await readToken(env, url.searchParams.get('t'));
      if(!tok || tok.who !== who || tok.kind !== 'crux')
        return json(env, { error: 'bad_token' }, 401);
      if(await tokenOverspent(env, tok)) return json(env, { error: 'exhausted' }, 429);

      const body = await request.json().catch(() => null);
      if(!body || !body.origin) return json(env, { error: 'missing origin' }, 400);
      const clean = { origin: String(body.origin).slice(0, 300) };
      if(body.formFactor) clean.formFactor = String(body.formFactor).slice(0, 16);
      if(body.collectionPeriodCount) clean.collectionPeriodCount = Math.min(40, parseInt(body.collectionPeriodCount, 10) || 25);
      const endpoint = path === '/crux/history' ? CRUX_HISTORY : CRUX_ENDPOINT;
      const cacheUrl = 'https://cache.pss' + path + '?' + new URLSearchParams(clean).toString();

      const out = await callGoogle(env, key =>
        fetch(endpoint + '?key=' + encodeURIComponent(key), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clean)
        }), ctx, cacheUrl, CRUX_CACHE_S);

      if(!out.res) return json(env, { error: 'upstream unavailable' }, out.status || 502);
      return new Response(out.res.body, {
        status: out.res.status,
        headers: corsHeaders(env, {
          'Content-Type': 'application/json',
          'X-PSS-Cache': out.hit ? 'hit' : 'miss'
        })
      });
    }

    return json(env, { error: 'not found' }, 404);
  }
};
