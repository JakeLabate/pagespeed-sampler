# The backend

The app is a static page. This Worker exists for one reason: so a visitor does
not need a Google Cloud project to use it. It holds the API keys, meters what
each visitor spends, caches what it can, and never lets a key reach a browser.

It is the same Worker that already proxies sitemap fetches, so deploying this
replaces `pss-proxy` rather than adding a second one. The `/?url=` route is
unchanged.

## Deploy

From this directory.

```
npx wrangler kv namespace create BUDGET
```

Paste the id it prints into `wrangler.jsonc`, replacing `PASTE_KV_NAMESPACE_ID_HERE`.

```
npx wrangler secret put PSI_KEYS
```

Paste your PageSpeed key. If you have keys on more than one Google Cloud
project, paste them comma separated: quota is per project, so each one adds a
full 25,000 calls a day. Keys on the same project add nothing.

```
npx wrangler secret put TOKEN_SECRET
```

Any long random string. It signs reservation tokens and salts the IP hash.
`openssl rand -base64 32` is fine.

```
npx wrangler deploy
```

Then enable both APIs on the project the keys belong to, if they are not
already: **PageSpeed Insights API** and **Chrome UX Report API**.

## Check it

```
curl https://pss-proxy.jake-a-labate.workers.dev/budget
```

Should return `available: true` and today's remaining allowance. If it returns
`available: false` the keys are not set.

## Routes

| Route | What it does |
|---|---|
| `GET /?url=` | The sitemap CORS proxy. No token, no metering, unchanged |
| `GET /budget` | What this IP has left today. Spends nothing |
| `POST /reserve` | Claims a slice of the allowance, returns a signed token |
| `POST /release` | Gives back what a cancelled sweep did not use |
| `GET /psi` | One PageSpeed call against a pooled key |
| `POST /crux`, `POST /crux/history` | One Chrome UX Report call against a pooled key |

## The dials

Set in `wrangler.jsonc` under `vars`.

| Var | Default | What it means |
|---|---|---|
| `DAILY_CALLS` | 200 | PageSpeed calls one IP may spend per day |
| `DAILY_CRUX` | 60 | Chrome UX Report calls one IP may spend per day |
| `ALLOW_ORIGIN` | the app's URL | The only site allowed to call this |

### Sizing them

One Google Cloud project gives 25,000 PageSpeed calls a day. At `DAILY_CALLS`
of 200 that is 125 visitors a day before the pool is dry, and one visitor can
measure 100 pages on mobile and desktop, or 200 pages on mobile alone.

The lever with the best return is not raising the cap, it is the response
cache. A site measured by one visitor is free for the next for six hours, and
competitor analysis means popular sites get measured repeatedly. Real capacity
is therefore higher than the arithmetic above, by however much the cache hits.

If you want more headroom, add a second project's key to `PSI_KEYS` before
raising `DAILY_CALLS`. It doubles the pool without making any single visitor
more expensive.

## What it does not defend against

Metering is per IP, and IPs are shared and easy to rotate. This stops casual
over-use of your quota, not a determined attacker. If it becomes a problem the
next step is Cloudflare Turnstile in front of `/reserve`, which needs no
account and adds one interaction.

Reservations are charged up front, so one KV write covers a whole sweep. The
per-token counter that stops a leaked token being replayed is sampled rather
than exact, because Cloudflare's free KV plan allows 1,000 writes a day and
counting every call would cap the service at a handful of sweeps. Measured over
repeated runs, a token replayed as hard as possible serves up to about twice
what it reserved before it is refused. Tokens are bound to the IP that minted
them and expire in minutes, so the exposure is a visitor exceeding their own
allowance, not a stranger spending it.

Raw IPs are never stored. The metering key is a salted hash.

## Test

```
node test.mjs
```

Runs the Worker's own logic against stub KV, cache and Google. No network, no
deploy, no keys needed.
