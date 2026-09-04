# PageSpeed Sampler

A single-file, front-end-only tool that finds a site's sitemap, samples a representative
set of URLs across its collection types, measures each one with the Google PageSpeed
Insights API, and reports the averages. Add up to four sites and it benchmarks them
against each other.

**Live: https://pagespeed.jakelabate.com/**
**Full pipeline: https://pagespeed.jakelabate.com/flow.html**

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

## Opportunities

Every PageSpeed call returns the whole Lighthouse audit set, not just the metrics. The
tool keeps the part that names a cause: `render-blocking-resources`,
`unused-javascript`, `modern-image-formats`, `largest-contentful-paint-element`,
`third-party-summary` and about twenty more, each with the specific files responsible
and the bytes and milliseconds attached to them.

Those are rolled up across the whole sample, so one slow asset on forty pages is one
finding rather than forty. The results carry three sections and the workbook four tabs:

- **Opportunities**, ranked by total impact, with the files responsible under each row
  and a one-line fix.
- **Offending resources**, every file a finding names, with its own size and how many
  sampled pages it appears on. This is where "the hero image is 1.1 MB and it is on 36
  pages" comes from.
- **LCP elements**, the element Lighthouse actually timed, grouped by CSS selector. One
  element carrying LCP across a whole template is one fix with wide reach.
- **Third parties**, what each vendor costs in blocking time and bytes on a typical
  page.

Figures are reported **per page**, deliberately. Lighthouse's savings estimates summed
across a sample produce numbers like "90 seconds wasted", which is not time anyone can
save and reads as nonsense to a client. Per-page is what a fix actually returns. The
across-sample totals are kept in the workbook as a breadth signal and are labelled as
such, and the ranking uses them so that a small saving on every page outranks a large
one on a single page.

The LCP element parser walks the audit details tree rather than indexing a fixed path,
because the node moved between Lighthouse versions and will move again.

## Charts

The same three charts appear in the app, the document, the Excel workbook and the Google
Sheet. They are drawn once as SVG string builders with no library, so the app, the print
document and the rasteriser all render identical output.

**Dot plot by metric.** The default analytical view. Seven metrics on one shared 0 to
100 scale, a dot per site, with a connector marking the gap between best and worst on
each row and the extremes direct-labelled. Position on a common scale is the most
accurately read encoding there is, and nothing about it depends on the order the metrics
are listed in.

**Radar (star) profile.** The same numbers as a shape. Seven metrics per site on one
polygon. The scoring is anchored
to Google's thresholds, never to the range of sites in the run: min-max scaling would
mean adding a competitor silently redraws everyone else's shape, so a profile would
belong to the comparison set rather than to the site. 100 is at or better than good, 90
is the good boundary, 50 is needs-work. Further from the centre is better on every axis.

A radar is a weak form for reading exact values: its area grows with the square of the
radius so it overstates differences, and the outline changes if the axes are reordered,
which is a decision with no meaning behind it. It is kept because recognising the *shape*
of a weakness is fast and it does real work in a client conversation, not because it is
the more accurate of the two. The dot plot leads; the radar sits beside it; a table of
the same numbers ships with both.

Capped at three overlaid polygons. Four sites render as small multiples instead, because
a fourth categorical hue fails the all-pairs colour separation checks the first three
pass, and four overlapping polygons are unreadable regardless.

**Spread.** Every measured page as a dot with the mean marked. A mean of 72 can be every
page at 72 or half the site at 45 and half at 99; those are different problems and the
stat tiles cannot tell them apart.

**Weakest collections.** Score by collection, worst first, coloured by band.

### Central tendency

Site and collection figures use the **median** by default, and the mean is available as a
toggle. A mean lets one catastrophic page decide which collection gets named the weakest,
which is the wrong claim to put in front of a client. Whichever is chosen, the other is
shown beside it and every table header names which was used.

### Locale prefixes

Grouping on the first path segment turns a multilingual site into one collection per
language, which is meaningless and used to fail silently. A first segment is now treated
as a locale on evidence: either several locale-shaped segments exist, or one covers at
least 70% of the site. Collections are then formed from the segment beneath it, and the
detected prefixes are shown in the sample summary so the decision is visible.

### Repeat runs

A single Lighthouse run swings several points between identical executions, so a per-page
number from one sample cannot survive a client re-running it. **Runs per URL** can be set
to 2 or 3; each metric folds to the median of its samples and the spread between runs is
reported. Where the spread is wide, a rule fires saying so, because that is a caveat the
report should carry rather than a number it should assert.

### Per surface

| Surface | How |
|---|---|
| App | Inline SVG, theme-aware, with the table beside it |
| Report document | Inline SVG, sized in millimetres, prints without a rasteriser |
| Excel | The same SVGs rasterised to PNG through canvas and embedded on a Charts tab, with the legend drawn inside the SVG since an HTML legend does not survive rasterisation |
| Google Sheets | Native `addChart` columns anchored to a Chart data tab. **Sheets has no radar chart type**, so the profile is grouped columns there; the radar form appears in the app and the PDF |

## What comes out of one API call

PSI returns far more than a score. The app reads:

| Field | Used for |
|---|---|
| `lighthouseResult.categories` | Performance, and SEO, accessibility and best practices when enabled |
| `lighthouseResult.audits` | 24 opportunity audits, 12 SEO checks, 9 quality checks, resource summary, diagnostics, LCP element, layout-shift elements, third parties |
| `lighthouseResult.stackPacks` | Platform-specific remediation |
| `lighthouseResult.runtimeError` | **Discards the run.** Documented as "serious enough that this result may need to be discarded", so it fails the call rather than averaging a bad number in |
| `lighthouseResult.runWarnings` | Surfaced as run validity, not discarded |
| `lighthouseResult.requestedUrl` vs `mainDocumentUrl` | Sitemap URLs that redirect, detected at no extra cost |
| `lighthouseResult.configSettings`, `timing` | Provenance on the method tab |
| `loadingExperience` | Page-level CrUX, where the URL has enough traffic |
| `originLoadingExperience` | **Origin-level CrUX**, which exists for almost any site with real traffic |
| `metrics[].distributions` | Share of real users in the good band, which is what the assessment uses |
| `captchaResult` | Warns when Google treated the run as automated |

### Field data

Page-level CrUX is missing for most URLs, because most pages do not have enough
traffic to produce a sample. In a typical run only a handful of sampled pages have it.
Origin-level almost always exists. Reporting "no field data" while the origin block sits
unread in the same response was throwing away the only measurement here that correlates
with ranking.

Both are shown, labelled by scope, and never averaged together. The share of users in
the good band is reported alongside the p75, because a p75 that just clears the
threshold while two thirds of users are inside it still means a third having a bad time.

### SEO checks

The SEO category is on by default and costs nothing extra per call. Across a hundred
sampled pages it returns crawlability, canonical, hreflang, titles, meta descriptions,
link text, structured data and image alt text: a technical crawl the run already paid
for. Crawlability failures are ranked critical, above every performance finding, because
a page that cannot be indexed does not benefit from being fast.

## Platform-aware fixes

A finding says *what* is wrong. What a client can act on is *where the switch is on their
platform*. "Serve WebP" and "turn on Compress images under Site settings, Publishing"
are the same finding and very different instructions.

### Why not BuiltWith

BuiltWith was the obvious candidate and is the wrong tool here. It starts at **$295 a
month**, authenticates with a static UUID key that cannot safely sit in a browser, and
does not document CORS, so a front-end-only app would need a server in front of it. The
same answer is available for nothing:

1. **Lighthouse stack packs.** Every PSI response already carries `stackPacks`: detected
   platforms with per-audit advice keyed by audit id. It was being discarded, the same
   way the opportunity audits were.
2. **Homepage fingerprinting.** The site's own markup, fetched through the transport
   already negotiated for the sitemap, identifies 20 platforms, the image CDN in front of
   them, and on WordPress the **installed plugin and theme slugs**, which is the
   plugin-level detail BuiltWith is otherwise sold for.

Lighthouse has no stack pack for Webflow, Framer, Duda or Squarespace, which is exactly
where a consultant most needs the answer, so those are covered by the curated playbook.

### The playbook

Platform by audit id, giving the specific setting rather than the general principle.
Covers Webflow, WordPress, Shopify, Squarespace, Wix, Next.js, Nuxt, Drupal, Ghost,
Framer, Duda, Magento, BigCommerce and HubSpot.

Resolution order per finding, per site: the curated entry first, then Lighthouse's own
stack pack, then nothing. It never invents advice for a platform it does not have an
entry for, and Lighthouse-sourced text is labelled as such.

Plugin slugs that change the answer get their own note. If ShortPixel is already
installed, the image finding is a bulk-optimise run in a plugin they own, not a
purchasing decision.

### Where it surfaces

A Stack table and per-finding routing in the app, a Stack section and an "On this stack"
block on every recommendation card in the document, an "On this stack" column on the
Opportunities tab and a Stack tab in both workbooks.

## The deterministic report

The workbook is the data. The report is the document you hand a stakeholder.

**Report PDF** opens it and raises the print dialog: set the destination to Save as PDF.
There is no server to render on, so the browser's own print engine is the renderer, and
that is the better output as well as the only one available: text stays selectable and
searchable, and the charts stay vector, neither of which survives a canvas-rasterising
PDF library. The toolbar in the report is not printed, so the saved PDF matches the file
the quoted hash describes.

**Report HTML** downloads the file instead, for archiving or for sending on. It carries
the same Save as PDF button at the top.

Nothing in it is written by a language model, and nothing is written by hand at
generation time. A fixed rule set is applied to the measurements. Each rule declares a
condition, a severity, a fix risk, an effort level, an evidence set and a fix, and its
prose is a template filled from the same numbers its evidence table shows, so the
narrative and the data cannot disagree.

**Determinism, precisely.** The *rendering* is reproducible: the same measurements and
the same report date always produce a byte-identical document, and the app prints its
SHA-256 so a client copy can be proved unaltered. The *measurements* are not
reproducible, because Lighthouse returns different numbers for identical requests.
Re-running an audit produces different figures and may produce a different set of
findings. The document says so on its method page rather than leaving the distinction to
be misread.

### What the rules add over the Opportunities tab

The workbook lists every audit that returned data. The rules decide what counts as a
finding, which is a different job:

- **Thresholds.** A rule fires or stays silent. A client sees nine findings rather than
  twenty-four rows.
- **Severity and fix risk.** Each recommendation carries what it costs to leave alone
  *and* how likely the fix is to break something, rather than keeping risk in a separate
  register.
- **Cross-signal findings.** "The LCP element is an image AND the image audits fire"
  collapses into one recommendation naming the specific file. A spreadsheet row cannot
  join two signals. Same for the collection outlier and the competitor gap.
- **Sequencing.** Now, Next and Later, with server response pinned ahead of front-end
  work because it caps the benefit of everything after it.

### Sections

Cover, contents, then: Method, Inventory, Findings, What is working, Recommendations,
Roadmap, Rubric and glossary, and **How this was generated** which lists every rule
evaluated including those that did not fire, so a silence can be told apart from an
omission.

Set in the house palette: indigo `#191A3E` and `#2B2C63`, teal `#0E8C8B`, cream
`#F5F0E6`, Space Grotesk headings, IBM Plex Sans body, IBM Plex Mono for eyebrows and
labels.

## Comparing sites

Enter up to four domains. Each is discovered, grouped and sampled on its own, then every
URL across every site runs in one measurement pass. The first domain is treated as yours
and everything is reported relative to it.

Competitor URL sets never line up page for page, so the comparison works at three
levels:

- **Site comparison.** One row per site with mean Performance, LCP, CLS, TBT and TTFB,
  ranked, with deltas against your site. Green means that site is ahead of you.
- **Key pages, like for like.** Home against home, about against about, contact against
  contact, using the page-role detector. A role only appears when at least two of the
  sites have it; a site missing that role reads "not found".
- **Paired collections.** Your `/case-studies` against their `/work` against a third
  site's `/portfolio`, averaged per collection with deltas, and expandable to every
  measured page in the pairing side by side.

### Pairing collections

Two sites rarely name the same thing the same way, so pairings are seeded automatically
from exact names plus a synonym table (blog / news / articles / insights, products /
shop / store / collections, case-studies / work / portfolio / projects, and so on) with
naive plural stripping. A pairing is only proposed when at least two sites have a
matching collection.

The automatic guess is a starting point, not the answer. Step 3 shows a **Comparable
collections** panel: one row per pairing, one dropdown per site listing that site's
collections with their page counts. Rename a pairing, repoint any site, set a site to
"not comparable" to drop it from that row, or add a pairing from scratch to line up two
collections the synonym table would never have connected.

Editing a pairing re-samples immediately. Key pages are seeded into the sample first,
then every paired collection, then the round-robin budget fills the rest, so a role or a
paired collection is never dropped for lack of budget.

Sample sizes will differ between sites, because a 4,000-page site and a 40-page site do
not sample alike. The pages count is shown on every row; treat a site with a handful of
measured pages accordingly.

The per-collection and per-page tables gain a site column, and both exports carry a
`site` field. The JSON export nests everything under `summary.<strategy>.by_site` with
per-site averages, per-collection averages and the key-page roles, and records the
pairings themselves under `paired_collections`.

Quota note: four sites at 100 URLs across both strategies is 800 calls. The daily
allowance is 25,000.

## Reports

Beyond the CSV and JSON dumps there are two report exports, both built from the same
model so the tabs, copy and thresholds are identical between them.

**Excel** needs no setup. It builds the workbook in the browser with ExcelJS and
downloads it. Drop it into Drive and open with Google Sheets and the fills, fonts,
number formats, frozen headers, banding and conditional formatting come across.

**Google Sheet** creates a real spreadsheet in your Drive and hands you the link. It
uses Google Identity Services with the `drive.file` scope, so the app can only ever see
files it created itself, never the rest of your Drive. Setup, once:

1. In the same Google Cloud project as your PageSpeed key, enable the **Google Sheets
   API**.
2. Create an OAuth 2.0 Client ID of type **Web application**.
3. Add the origin the app is served from to its **Authorised JavaScript origins**. The
   app prints the exact string to paste, under the client ID field.
4. Paste the client ID into the app. It is kept in `localStorage` in your browser.

### Tabs

Numbered without leading zeros, renumbered so they stay contiguous when a section does
not apply. A single-site run drops the three comparison tabs.

| Tab | What it holds |
|---|---|
| Method | Context, Sources, Scope, Assumptions, Prepared by. Scope lists every run parameter including the collection pairings |
| Summary | Headline mean and median per metric, split into what is working and what needs work |
| Site comparison | One row per site per strategy (multi-site only) |
| Key pages | Page roles lined up across sites (multi-site only) |
| Paired collections | Each pairing, per site, per strategy (multi-site only) |
| Collections | Every collection on every site |
| All pages | Every measurement, filterable |
| Failures | Anything that never succeeded, with Google's own error text |
| Glossary and rubric | What each metric means and the exact threshold bands |

### Formatting

Deep indigo `#191A3E` header bands with a Space Grotesk face, IBM Plex Sans body, IBM
Plex Mono for paths and URLs, teal `#0E8C8B` tab colours. Millisecond metrics over a
second are written as seconds with a `0.00" s"` format so they read as durations rather
than raw numbers; conditional formatting thresholds are converted with them. Every
metric column carries three rules matching the Core Web Vitals bands, green then amber
then red, applied in that order so the first match wins. Header rows are frozen, tables
carry a filter, rows are banded, and print setup is fit-to-width with repeating header
rows.

## Speed

A sweep is a pipeline, and its wall clock is set by whichever lane is serial. Four lanes
were, and each is now parallel with a stated ceiling.

**Sites discover together.** Sites are independent: different hosts, different sitemaps,
different proxies. They used to share one module-level transport, which is the only
reason they had to run one after another, so a four-site sweep paid four discovery
budgets end to end before a single PageSpeed call went out. Each site now carries its own
transport context and its own block in the log, and up to 4 run at once (6 when every
site allows direct access).

**Transports are raced, not tried in turn.** All six are fired at `/robots.txt`
simultaneously. Direct fetch gets a 1.2 second head start and 0.8 seconds of grace if a
proxy answers first, because direct is faster and is the only transport that does not
hand every audited URL to a third party. The probe keeps the body, so `robots.txt` is not
fetched twice.

**Slow requests are hedged.** Sequential fallback lets the slowest proxy set the wall
clock: you wait a full timeout to learn nothing, then start again somewhere else. A
second transport is now started while the first is still outstanding and whichever
answers first wins, so a stalled proxy costs the hedge delay instead of the timeout.

**Proxies earn their place.** The probe winner starts as the only proxy in the rotation.
An alternate joins by answering, and three failures drops it for that site. Sitemap
concurrency follows how many are genuinely working, at 3 requests per working proxy.
Latency and failure scores are shared across sites and kept between runs in
`localStorage`, so ordering starts from what was actually fast last time.

**Sweep mode removes the human gate.** The sample is fully determined by the settings, so
**Run the whole sweep** goes from URLs to finished results without stopping to be told to
continue. **Find sitemaps only** keeps the old behaviour when you want to inspect or edit
the sample first.

**Every phase is clocked.** A ledger under the progress bar reports discovery time, the
slowest site, measurement time, throughput in calls per minute, peak concurrency and the
total. Without it there is no way to tell whether a change made a run faster or just
moved the waiting somewhere less visible.

Measured on a three-site mock with 900 ms of latency per request:

| | before | after |
|---|---|---|
| discovery | 11.4 s | 3.2 s |
| end to end | 17.9 s | 8.9 s |

And on a site whose winning proxy stalls partway through a ten-child sitemap index:
39.1 s for 72 URLs and 4 lost children, against 3.4 s for all 123 URLs and none lost.

## Concurrency

The 240-queries-per-minute project quota is not the binding constraint. Each PSI call
holds a Lighthouse run on Google's side for 10 to 30 seconds, and one project's share of
that pool is far narrower than 240. Firing 200 calls in one tick saturates it, and the
overflow comes back as `500 Lighthouse returned error: ERRORED_DOCUMENT_REQUEST`, not as
`429`. Those failed calls still count against the daily quota, so the naive burst is both
slower and more expensive than it looks.

So the runner treats concurrency as something to discover rather than declare:

- The right in-flight number is not a constant, it is whatever holds the admission rate
  at the quota given how long a call currently takes: **concurrency = rate x latency**.
  At 230/min and 20 s a call that is 76; if Google speeds up to 12 s it is 46, and holding
  76 would just buy 429s. A rolling median of the last 40 successful calls sets the
  target, and the ceiling climbs toward it in steps of at most 1.5x.
- Opens at the ceiling the **last run settled on**, carried in `localStorage`, instead of
  relearning the same number from 40 on every run.
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
falls back to a public CORS proxy (allorigins, codetabs, corsproxy.io, isomorphic-git,
thingproxy) only when direct access is blocked. It probes once per site to pick a working
transport instead of paying the fallback chain on every request, racing all six at once
and preferring direct whenever it works. See **Speed** above for hedging and rotation.

### Your own proxy

The one discovery failure that cannot be engineered around is a WAF blocking the public
proxies by address. Set **Your own CORS proxy** under Sampling and run options to a
template like `https://your-worker.workers.dev/?url={url}` and it is tried straight after
direct fetch, ahead of the public pool, works with public proxies switched off, and sends
the audited URLs to your server rather than a stranger's. A Cloudflare Worker takes about
a minute to stand up; the code is on the
[How it works page](https://pagespeed.jakelabate.com/flow.html#your-own-proxy). Lock its
allow-origin to your own page rather than `*`, or you have deployed an open proxy.

Two things a browser-only tool cannot get around without one:

- A site behind a WAF (Cloudflare and friends) often blocks the proxies' datacentre
  addresses. The proxy connects, the site returns 403, and no amount of retrying changes
  that. The run reports what each transport came back with rather than claiming the site
  published no sitemap, because those are different problems.
- A site with no `robots.txt` at all is fine. The transport probe tries `/` as well, so a
  404 on `robots.txt` no longer reads as "unreachable", and the 22 known sitemap paths are
  still tried.

In either case, paste that site's URLs into the manual field under **Sampling and run
options** and run again. The list applies **per site**: each site keeps only the pasted
URLs on its own host, so one blocked competitor does not cost you the comparison.
Grouping, sampling and measurement all work the same way on a pasted list.

Proxies can be disabled entirely with the "Allow public CORS proxies" checkbox.

## Running it

It is one HTML file with no build step and no dependencies. Open `index.html` directly,
or serve the folder with anything.

## Limits


URLs are measured exactly as the sitemap publishes them, trailing slash included. The
slash-stripped form is used only as a de-duplication key. This matters more than it sounds:
on a site whose sitemap ends in slashes and whose server canonicalises to them, stripping the
slash makes every measured URL a redirect, inflating TTFB and LCP across the entire run and
producing a redirect report that blames the site for redirects the tool caused.
- Gzipped sitemaps (`.xml.gz`) are skipped; browsers cannot decompress them from `fetch`.
- 20,000 discovered URLs and 30 child sitemaps by default (both configurable).
- PageSpeed Insights takes roughly 10 to 30 seconds per URL server-side. Because the
  calls run concurrently, a full 200-call run finishes in about the time of the slowest
  handful rather than the sum of all of them. The progress bar shows live in-flight count
  and an ETA.
- Browsers cap concurrent HTTP/2 streams to one host at around 100, so past that the
  browser queues the remainder itself. That is fine and needs no configuration.
