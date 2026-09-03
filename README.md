# PageSpeed Sampler

A single-file, front-end-only tool that finds a site's sitemap, samples a representative
set of URLs across its collection types, measures each one with the Google PageSpeed
Insights API, and reports the averages.

**Live: https://jakelabate.github.io/pagespeed-sampler/**

## What it does

1. **Finds the sitemap.** Reads `robots.txt` for a `Sitemap:` directive first. If there
   isn't one, it probes 22 common sitemap paths in parallel (`/sitemap.xml`,
   `/sitemap_index.xml`, `/wp-sitemap.xml`, `/sitemap-0.xml`, `/page-sitemap.xml`, and
   so on), then walks any sitemap index down to its child sitemaps.
2. **Groups URLs into collection types** by first path segment, so `/blog/*` becomes
   "blog" and `/products/*` becomes "products". One-off root-level pages (`/about`,
   `/contact`, `/pricing`) collapse into a single "top-level pages" group. The homepage
   gets its own group.
3. **Samples** up to 10 URLs per collection and 100 in total. Key pages (home, about,
   contact, services, pricing, blog, FAQ, team, careers, locations, privacy, terms and
   similar) are pinned first; the remainder is an even, deterministic spread across the
   collection rather than the first N URLs. The homepage is always included. Allocation
   is round-robin so one huge collection cannot eat the entire budget.
4. **Measures** each URL through the PageSpeed Insights v5 API, mobile and/or desktop,
   concurrently. See [Concurrency](#concurrency) below for how wide it actually goes and
   why.
5. **Reports** site-wide mean and median for Performance, LCP, CLS, TBT, FCP, TTFB and
   Speed Index, plus a per-collection breakdown, a sortable per-page table, real-user
   CrUX field data where Google has it, and CSV / JSON export.

## Concurrency

The 240-queries-per-minute project quota is not the binding constraint. Each PSI call
holds a Lighthouse run on Google's side for 10 to 30 seconds, and one project's share of
that pool is far narrower than 240. Firing 200 calls in one tick saturates it, and the
overflow comes back as `500 Lighthouse returned error: ERRORED_DOCUMENT_REQUEST`, not as
`429`. Those failed calls still count against the daily quota, so the naive burst is both
slower and more expensive than it looks.

So the runner treats concurrency as something to discover rather than declare:

- Opens at **40 in flight** and climbs 1.4x every 8 consecutive successes, up to the
  batching width you picked.
- **Halves the ceiling** after 3 clustered errors, down to a floor of 5, then climbs
  again. Additive increase, multiplicative decrease.
- A **429 pauses the entire batch** for 7 seconds. A cluster of 5xx pauses it for 3.
- A rolling **230-requests-per-minute** admission guard sits underneath all of it.
- Up to **4 attempts per call**, then **3 retry sweeps** over whatever still failed, each
  sweep running 4 at a time. Retryable causes only: a permanent error like `NO_FCP` or an
  invalid URL is not swept.
- Anything still failing is grouped by cause in the results with a **Retry** button.

Against a mock that 500s above 20 concurrent, this converges on the real ceiling and
completes 76 of 76 calls, wasting 28 requests learning where the wall is.

## API key

The PageSpeed Insights API is free but rate limited. Without a key Google allows only a
trickle of requests and most of a 100-URL run will fail, so get one from the
[PSI getting-started guide](https://developers.google.com/speed/docs/insights/v5/get-started#key)
(enable the "PageSpeed Insights API" in a Google Cloud project). With a key you get
25,000 requests/day and 240/minute.

The key is stored in `localStorage` in your own browser and is sent only to
`pagespeedonline.googleapis.com`. There is no backend.

## CORS

Browsers cannot read a cross-origin `sitemap.xml` unless the site sends
`Access-Control-Allow-Origin`. Most sites do not. The app tries a direct fetch first and
falls back to a public CORS proxy (allorigins, codetabs, corsproxy.io, isomorphic-git)
only when direct access is blocked. It probes once per site to pick a working transport
instead of paying the fallback chain on every request.

If every transport fails, paste a URL list into the manual field under
**Sampling and run options** and press **Use manual list only**. Grouping, sampling and
measurement all work the same way on a pasted list.

Proxies can be disabled entirely with the "Allow public CORS proxies" checkbox.

## Running it

It is one HTML file with no build step and no dependencies. Open `index.html` directly,
or serve the folder with anything.

## Limits

- Gzipped sitemaps (`.xml.gz`) are skipped; browsers cannot decompress them from `fetch`.
- 20,000 discovered URLs and 30 child sitemaps by default (both configurable).
- PageSpeed Insights takes roughly 10 to 30 seconds per URL server-side. Because the
  calls run concurrently, a full 200-call run finishes in about the time of the slowest
  handful rather than the sum of all of them. The progress bar shows live in-flight count
  and an ETA.
- Browsers cap concurrent HTTP/2 streams to one host at around 100, so past that the
  browser queues the remainder itself. That is fine and needs no configuration.
