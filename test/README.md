# Tests

The app is a single static file with no build step, so the tests drive it in a real
browser (Playwright + Chromium) with the network mocked, rather than importing modules.

- **Sitemap discovery, grouping, sampling, comparison** run against mock sites whose
  collections deliberately share no names, so the synonym pairing is actually exercised.
- **Concurrency** is checked by counting simultaneous in-flight requests at the mock, and
  by forcing 500s above a threshold to confirm the adaptive ceiling converges and the
  retry sweeps recover the run.
- **Excel output** is inspected with openpyxl for tab set, freeze panes, number formats,
  fonts, banding and conditional rules, then rendered through LibreOffice to eyeball
  layout.

## validate_sheets.js

A mock that returns HTTP 200 will accept anything, including enum values that do not
exist. It shipped `NUMBER_LESS_THAN` and `NUMBER_GREATER_THAN` once; the real API
rejects both, because the enum is `NUMBER_LESS` and `NUMBER_GREATER` while the inclusive
forms are `NUMBER_LESS_THAN_EQ` and `NUMBER_GREATER_THAN_EQ`.

So the captured Sheets API payload is validated against the reference enums before it is
ever sent:

    node test/validate_sheets.js sheetcalls.json

It checks condition types, dimensions, alignments, wrap strategies, number format types,
merge types and request kinds against allowlists; asserts every `repeatCell` carries
`fields`; asserts colour channels are 0..1; and asserts every conditional format range
sits inside its sheet's declared grid.
