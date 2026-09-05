# PageSpeed Sampler

A single-file browser tool that finds a site's sitemap, samples a representative
set of URLs across its collection types, measures each one with the Google PageSpeed
Insights API, and reports the averages. Add up to four sites and it benchmarks them
against each other.

**Free to use, no API key needed.** A small Cloudflare Worker holds the keys and
meters a daily allowance per visitor, so nobody needs a Google Cloud account. Supply
your own key to go past the allowance and the backend is bypassed entirely.

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

## Instant read

A PageSpeed call is a page load: Google fetches the page, runs the JavaScript, builds a
trace and audits it. That is ten to thirty seconds of real compute on their hardware, and
no batching makes it instant, because the work *is* the page load.

The Chrome UX Report is a lookup. **Instant read** queries it directly for each origin and
returns in about a second regardless of how many sites are in the list, because there is
no page load to wait on. It gives:

- The Core Web Vitals verdict, which passes only when LCP, INP **and** CLS are all inside
  the good band at p75. Two out of three is a fail, which is what a row of nearly-green
  numbers hides.
- p75 and the full distribution per metric, so a p75 that just clears the threshold while
  a third of visits sit in the poor bin is visible as exactly that.
- 25 collection periods of trend, drawn against the good threshold. Direction is an
  argument a lab score cannot make: a site that was fine in March and is not now has a
  cause with a date on it.
- **Phone and desktop assessed separately**, because Google assesses them separately and
  a site can pass on one and fail on the other.
- **What LCP is made of.** CrUX reports LCP's four phases: server response, discovery
  delay, image download and render delay. Naming the dominant one is the difference
  between "your LCP is slow" and "59% of your LCP is server time, so the image work is
  second priority". Those are four different fixes with four different owners, and a lab
  audit can only guess at the split from one synthetic load.
- **What LCP usually is.** If the LCP element is text rather than an image, every image
  recommendation in the report is aimed at the wrong element.
- **Real round-trip time**, which says which of the report's connection bands actually
  describes this site's audience rather than assuming one.
- **Back/forward cache share.** Lighthouse reports whether a page *qualifies*; CrUX
  reports what fraction of real navigations actually got it.

What it cannot do is say *why*. Every opportunity, byte saving, connection-band second
and stack fix comes from Lighthouse and needs the slow lane. **Now run the full audit**
goes straight there.

Origins with too little traffic return no data, which is a fact about traffic volume
rather than about speed, and the card says so rather than leaving a gap.

Four calls per site (current and history, phone and desktop) all fire together, so the
wall clock is one round trip whatever the site count.

Needs the **Chrome UX Report API** enabled on the same Google Cloud project as the
PageSpeed key. Same key, no OAuth. Its quota is separate: 150 queries a minute.

### Two sets of deliverables

The instant lane is not a teaser for the full one. It ships its own complete set, so
there is something client-ready in hand about a second after the key is entered, and a
second, larger set a few minutes later.

| | Instant | Full |
|---|---|---|
| Time to deliverables | About one second | Two to twenty minutes, depending on page count |
| Source | Chrome UX Report, 28 days of real visits | Lighthouse via PageSpeed Insights, one synthetic load per page |
| Level | Origin, all pages combined | Individual URLs, sampled per collection |
| Report | Core Web Vitals PDF, six sections | PageSpeed audit PDF, up to nineteen sections |
| Spreadsheet | CSV, one row per site per form factor | Excel workbook and Google Sheet, nineteen tabs |
| JSON | Every p75, distribution share, LCP subpart and trend | Every audit, opportunity, resource and finding |
| Answers | Whether it is a problem, and what shape the problem is | Which file causes it and what the fix is worth |

The instant report carries a cover, contents and six sections: Method, The verdict, What
LCP is made of, Direction, Findings, and What comes next. Findings come from the same
kind of fixed rule set the full report uses, over the field data rather than over the
audits: a dominant LCP phase, a non-image LCP element, a phone/desktop divergence, a
metric trending the wrong way over 25 periods, a low back/forward cache share, and a
competitor passing where the subject fails. Each names the measurement that triggered it.

Both reports print to PDF from the browser, so text stays selectable and the charts stay
vector. Neither is written by a language model.

The instant CSV is one row per site per form factor with 36 columns: the p75, good share
and poor share for all six metrics, the four LCP subparts in milliseconds and as shares,
the LCP resource type, and the back/forward cache share. It is the shape that pivots.

### What is deliberately not here

| Source | Why not |
|---|---|
| CrUX BigQuery | Origin-level percentile ranking against every origin in a country needs a BigQuery project, so it belongs in a separate tool rather than a browser app |
| Search Console | Traffic-weighted sampling would fix this tool's oldest weakness, but it only works for properties you own and needs OAuth per property |
| CrUX Vis | A viewer over the History API. Nothing in it we are not already reading |

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

### What the bytes cost in seconds

A byte figure is an engineering fact. The same figure in seconds, on the connection the
client's customers actually use, is the argument for paying to fix it. Every byte saving
is therefore also expressed as arrival time across four connections:

| Band | Throughput | RTT | Source |
|---|---|---|---|
| Regular 3G | 700 Kbps | 300 ms | Lighthouse `mobileRegular3G`, aligned to the CrUX 3G definition |
| Slow 4G | 1,638 Kbps | 150 ms | Lighthouse `mobileSlow4G`, the PSI **mobile** default, identical to WebPageTest Fast 3G |
| Dense 4G | 10,240 Kbps | 40 ms | Lighthouse `desktopDense4G`, the PSI **desktop** default |
| Fast broadband | 51,200 Kbps | 15 ms | Not a preset. A stated 50 Mbps assumption |

The first three are Lighthouse's own throttling constants, so the figures reconcile with
the tool a client will check the work against instead of contradicting it. The fourth is
labelled an assumption and is included on purpose: a fix worth 8 seconds on a phone and a
tenth of a second at a desk is a more honest story, and a more persuasive one, than a
single number.

The arithmetic is `bytes x 8 / (Kbps x 1024)`, and Kbps is kibibits per second because
that is what Lighthouse means by it. This is **transfer time, not a page-load
simulation**. Bytes on the critical path give back more than the figure shown, because
everything behind them starts sooner; bytes off it can give back less. Every surface that
prints these numbers prints that caveat with them.

Where it appears:

- **App**, four columns on the Opportunities table (the page-by-page table is not on screen: a hundred rows of numbers is a spreadsheet job, and it is in the CSV, JSON, Excel and Sheets in full)
- **Report**, a band strip on every recommendation that removes bytes, plus a Connection bands note in the Method section
- **Excel and Google Sheets**, four columns on the Opportunities tab, documented on the Method and Glossary tabs
- **JSON**, a `connection_bands` block describing the model and an `opportunities` array with `seconds_saved_per_page` per band
- **CSV**, the page's own weight as arrival time per band, per row

`total-byte-weight` reports a page's whole weight rather than a saving, so it gets the
same arithmetic under a different label: how long that weight takes to arrive, not what
removing it gives back.

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

Site and collection figures are the **mean**, always. It used to be a toggle, which meant
the same measurements could be regenerated under a different definition of the headline
number, and a headline number that changes with a dropdown is not one you can defend.

The median is still shown beside it everywhere, and every table header names which is
which, so the case a median guards against stays visible: a mean lets one catastrophic
page pull a collection's figure down, and when the two disagree sharply that is itself
worth reading.

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

The workbook is the data. The **Report** button produces the document you hand a
stakeholder: it opens the report and raises the print dialog, and you set the destination
to Save as PDF.

There is no server to render on, so the browser's own print engine is the renderer, and
that is the better output as well as the only one available: text stays selectable and
searchable and the charts stay vector, neither of which survives a canvas-rasterising PDF
library. The report's own title becomes the suggested filename, and the toolbar inside it
is not printed.

Nothing in it is written by a language model, and nothing is written by hand at
generation time. A fixed rule set is applied to the measurements. Each rule declares a
condition, a severity, a fix risk, an effort level, an evidence set and a fix, and its
prose is a template filled from the same numbers its evidence table shows, so the
narrative and the data cannot disagree.

**Determinism, precisely.** The *rendering* is reproducible: the same measurements
produce an identical document, the only varying input being the report date, which is
read from the clock in your own time zone. The *measurements* are not
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

## Subject and competitors

Each site is entered as a **name and a URL**. The name is what every deliverable leads
with, so `jakelabate.com` reads as *Jake Labate*; leave it blank and the domain is used.
Anywhere a site is identified for the record rather than just charted, both appear: the
cover, the method scope, the inventory, the stack table, the workbook's site comparison,
and the JSON, which carries `name`, `host` and `role` per site. The CSV gains
`site_host` and `site_role` columns.

The first site in the list is the **primary** one, and it cannot be removed, because a
run needs a site to be about. The row says so, and so does every
deliverable: the cover names it as Subject and the others as Compared against, the
inventory tags each site subject or competitor, and the method page states in bold that
every figure, band and finding is about the subject unless a section says otherwise.

This is not only labelling. The rules engine used to run over every site's measurements
pooled together, so a two-site audit produced a median belonging to neither site and then
printed it on the cover as the client's score. Findings are now computed from the
subject's rows alone. Competitor rows still feed the sections that exist to compare:
the profile and spread charts, the site comparison, the paired collections, and the
competitor-gap finding.

The report says "the site averages" only when there is one site. With competitors it
names the subject and adds "measured against N competitors".

## Page equivalents

Sites almost never share URL structure, so a like-for-like comparison has to be told what
counts as the same kind of page: your `/case-studies` may be their `/work`. That mapping
gets its own step in the app rather than a panel buried inside sampling. Pairings are
proposed automatically from names and a synonym table, and can be renamed, added to, or
set to "not comparable" per site.

Editing a pairing re-renders the comparison without spending quota, because pairings
decide how results are grouped, not which pages get measured.

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

The client ID is set in `CONFIG` in the source rather than typed into a field, since it
is a property of the deployment and not of a run. A client ID is a public identifier, not
a secret. To point a fork at your own Google Cloud project:

1. In the same project as your PageSpeed key, enable the **Google Sheets API**.
2. Create an OAuth 2.0 Client ID of type **Web application**.
3. Add the origin you serve the app from to its **Authorised JavaScript origins**.
4. Set `CONFIG.googleClientId` in `index.html`.

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
- There is no batching field. Concurrency is derived, halved on clustered errors and
  climbed back on success, so a number chosen by hand could only be worse than the one
  the run measures for itself.
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

**You do not need one.** The key field is optional and blank by default. Runs go
through a Cloudflare Worker that holds the keys, meters what each visitor spends
per day, and never lets a key reach a browser. The setup card says how much is
left before anything is spent. `worker/` holds that Worker, its tests and its
deploy steps; `CONFIG.apiBase` points the app at it, and setting that to `''`
reverts the app to requiring every visitor to bring their own key.

Add your own key to go past the free allowance, or to measure a site large
enough to exceed it. A key in the field always wins: the run goes straight to
Google, skips the Worker and the metering entirely, and spends the visitor's own
quota rather than the shared one. Get one from the
[PSI getting-started guide](https://developers.google.com/speed/docs/insights/v5/get-started#key)
(enable the "PageSpeed Insights API" in a Google Cloud project) for 25,000
requests a day and 240 a minute. It is stored in `localStorage` in your own
browser and sent only to `pagespeedonline.googleapis.com`.

### When the free allowance runs out

The run stops before it measures anything, rather than halfway through, and says
how much is left, when it resets, and that pasting a key in the field above
carries on now.

### Why a reservation rather than counting calls

A sweep asks for its whole call count up front and gets a signed, short-lived,
IP-bound token. That is one write per sweep instead of one per call, which
matters because Cloudflare's free KV plan allows 1,000 writes a day. It also
means a visitor is refused before the run starts rather than mid-sweep.

### The cache is the real capacity

The Worker caches PageSpeed responses for six hours, keyed without the API key,
so every visitor shares one cache. A site one person measured is free for the
next, and competitor analysis measures popular sites repeatedly, so real
capacity is higher than dividing the daily quota by the per-visitor cap
suggests. It also makes a re-run inside that window reproducible, which is
otherwise not true of Lighthouse.

## CORS

Browsers cannot read a cross-origin `sitemap.xml` unless the site sends
`Access-Control-Allow-Origin`. Most sites do not. The app tries a direct fetch first and
falls back to a public CORS proxy (allorigins, codetabs, corsproxy.io, isomorphic-git,
thingproxy) only when direct access is blocked. It probes once per site to pick a working
transport instead of paying the fallback chain on every request, racing all six at once
and preferring direct whenever it works. See **Speed** above for hedging and rotation.

### Public proxies are always on

There is no checkbox. A site that blocks direct browser access cannot be read any other
way, so refusing to try only produced an empty inventory and a question the operator had
no basis to answer. Direct fetch is still tried first on every site.

### This deployment's own backend

The one discovery failure that cannot be engineered around is a WAF blocking the public
proxies by address. This build ships its own Cloudflare Worker, set as
`CONFIG.proxyTemplate` in the source. It is tried straight after direct fetch, ahead of
the public pool, and sends the audited URLs to a server this deployment runs rather than
a stranger's. The same Worker holds the API keys, which is what makes the tool usable
without a Google Cloud account.

Forking: the Worker's source, its test suite and its deploy steps are in `worker/`.
Point `CONFIG.proxyTemplate` and `CONFIG.apiBase` at your own deployment. Lock its
allow-origin to your own page rather than `*`, or you have deployed an open proxy.

Two things a browser-only tool cannot get around without one:

- A site behind a WAF (Cloudflare and friends) often blocks the proxies' datacentre
  addresses. The proxy connects, the site returns 403, and no amount of retrying changes
  that. The run reports what each transport came back with rather than claiming the site
  published no sitemap, because those are different problems.
- A site with no `robots.txt` at all is fine. The transport probe tries `/` as well, so a
  404 on `robots.txt` no longer reads as "unreachable", and the 22 known sitemap paths are
  still tried.

In either case the run reports the site with no pages found rather than failing, and the
other sites in the comparison are unaffected.


## Running it

Enter a site. You do not need an API key.

The setup screen offers three entry points. **Instant read** returns the Core Web Vitals
verdict and its own deliverables in about a second, from field data, without measuring
anything. **Find pages and run** goes from URLs to finished results without stopping.
**Find sitemaps only** stops after sampling so you can edit the selection and the page
equivalents first, then press **Measure the selected pages**. The measure button belongs
to a sample, so it does not exist until there is one.

It is one HTML file with no build step and no dependencies. Open `index.html` directly,
or serve the folder with anything. Runs need either the backend in `worker/` deployed and
`CONFIG.apiBase` pointed at it, or an API key typed into the field.

## Configuration

These settings are fixed in `CONFIG` at the top of the script rather than exposed as
fields, because each is a property of the deployment rather than of a run:

| Setting | Value |
|---|---|
| `googleClientId` | The OAuth client for the Sheets export |
| `proxyTemplate` | The Worker used ahead of the public proxy pool |
| `apiBase` | The same Worker, holding the API keys. Set to `''` to turn the free allowance off and require every visitor to bring a key |
| `strategies` | Always `mobile` and `desktop` |
| `categories` | Always SEO, accessibility and best practices, alongside performance |
| `CENTRAL.mode` | Always the mean. A report whose headline number can be regenerated under a different definition has no headline number |
| `DISCOVERY_CEILING_MS` | Six minutes a site. A safety stop against a sitemap index that never resolves, not a budget |

There is no client-name field either: the subject site's own name is the client name, and
asking twice invited the two to disagree. There is no theme toggle: the app is dark.

The report date is no longer a field either: it is read from the clock in the viewer's
own time zone, not UTC, so a late-evening run does not carry tomorrow's date.

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
