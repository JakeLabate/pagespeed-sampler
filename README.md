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
4. **Measures** each URL through the PageSpeed Insights v5 API, mobile and/or desktop.
   Every call is fired in the same tick by default, so a 100-URL two-strategy run is 200
   requests in flight at once rather than a queue. A rolling 230-requests-per-minute
   guard keeps that under Google's 240/min project quota, and a shared circuit breaker
   pauses the whole run for seven seconds the moment any call comes back 429, then
   retries. Batching can be dialled down to 32 / 16 / 8 / 4 at a time if you would
   rather trickle.
5. **Reports** site-wide mean and median for Performance, LCP, CLS, TBT, FCP, TTFB and
   Speed Index, plus a per-collection breakdown, a sortable per-page table, real-user
   CrUX field data where Google has it, and CSV / JSON export.

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
