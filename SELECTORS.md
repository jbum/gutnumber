# Gutnumber — Capturing and Resolving Numbers

How the picker describes "this number on this page", how the daemon finds it
again, and how text becomes a number. This is the part most likely to break as
sites change, so it gets its own document.

## 1. Selector bundle

A gutnumber stores a **bundle**: an ordered list of W3C Web Annotation selectors
plus one non-standard type, tried in order until one yields parseable text.

```jsonc
{
  "version": 1,
  "selectors": [
    { "type": "CssSelector",       "value": "#detailBullets_feature_div li:nth-of-type(3) span.a-list-item" },
    { "type": "XPathSelector",     "value": "//*[@id='detailBullets_feature_div']/ul/li[3]/span" },
    { "type": "TextQuoteSelector", "exact": "#12,345 in Books", "prefix": "Best Sellers Rank: ", "suffix": " (See Top 100 in Books)" },
    { "type": "RegexSource",       "pattern": "Best Sellers Rank:\\s*#([\\d,]+)", "group": 1 }
  ],
  "parser": { "pick": "first", "thousands": ",", "decimal": ".", "suffixes": true },
  "context_html": "<li><span class=\"a-list-item\"><span class=\"a-text-bold\">Best Sellers Rank: </span> #12,345 in Books …",
  "captured_text": "Best Sellers Rank: #12,345 in Books (See Top 100 in Books)",
  "captured_value": 12345,
  "captured_at": "2026-09-26T13:02:11Z"
}
```

Selector types (all in `packages/shared/src/selectors/`):

| Type | Spec | Generated how | Resolved how |
|---|---|---|---|
| `CssSelector` | W3C | See §2. | `document.querySelector`; text = `textContent` normalised. |
| `XPathSelector` | W3C | Absolute path with `@id` anchor when available, positional otherwise. | `document.evaluate` (browser + linkedom both support it). |
| `TextQuoteSelector` | W3C | `exact` = the element's normalised text; `prefix`/`suffix` = up to 48 chars of surrounding normalised body text. | Find `prefix` in the page's normalised text; take the run after it up to `suffix` (or up to 64 chars). Tolerant to digits changing: `exact` is not required to match, only prefix (and suffix if present). |
| `RegexSource` | Gutnumber extension | Only when the picker detects the number also appears in inline JSON/script (`"viewCount":"…"`), or added by hand in the editor. | Regex over the raw response body (http) or `document.documentElement.outerHTML` (browser). |

The bundle also keeps `context_html` (the clicked element and up to 3 ancestors,
capped at 16 KB) so a broken selector can be repaired later against the original
markup without revisiting the page.

`TextPositionSelector` and `RangeSelector` are deliberately not used: character
offsets drift on every page change, and ranges add nothing for single-element
targets.

## 2. Generating a good CSS selector

Goal: shortest selector that is unique on the page today and likely to survive
re-rendering. Order of preference, walking from the target up to the root:

1. **Stable id** on the element or an ancestor: `#id`. An id is rejected if it
   looks generated: contains 6+ consecutive digits, a UUID, or matches
   `/^(ember|react|:r|radix|mui|css-|sc-|_)/`.
2. **Semantic attributes**: `[data-testid=…]`, `[itemprop=…]`, `[aria-label=…]`,
   `[name=…]`, `[data-asin]`, `[id^=…]` for prefixed ids (`div[id^="p13n-asin"]`
   already works on Amazon).
3. **Stable classes**: classes are kept only if they do not look hashed
   (`/[a-z]+-[a-f0-9]{5,}/`, `/^css-/`, `/^sc-/`, `/^_/`, all-caps hashes).
   Amazon's `a-*` utility classes are kept; they are stable.
4. **Positional**: `:nth-of-type(n)` only where needed to make the selector
   unique.

The generator checks `querySelectorAll(candidate).length === 1` at each step and
stops as soon as it is unique. The result plus an XPath of the same path go into
the bundle.

## 3. Text normalisation

Before matching or parsing: collapse whitespace to single spaces, trim, replace
NBSP and thin spaces, strip zero-width characters, NFC-normalise. The same
function runs in the picker and the daemon (`shared/text.ts`), so what you saw at
capture is what the daemon compares against.

## 4. Parsing text into a number

`parseNumber(text, opts)`:

1. Find all numeric tokens: `[-+]?\d[\d,.\s']*(?:\.\d+)?\s*[KMBkmb%]?` (locale
   aware: `thousands`/`decimal` options; defaults `,` and `.`).
2. `pick`: `first` (default) · `last` · `largest` · `nth:<i>`.
3. Strip thousands separators, apply `K`/`M`/`B` multipliers if `suffixes` is on
   (`1.2K views` → 1200; `3.4M` → 3,400,000), strip `%`.
4. Return `{ value: number, token: string }` or `parse_fail`.

Examples the test suite pins down:

| Text | Options | Value |
|---|---|---|
| `#12,345 in Books (See Top 100 in Books)` | first | 12345 |
| `1,234,567 views` | first | 1234567 |
| `1.2K views` | first, suffixes | 1200 |
| `Rank 3 of 42` | last | 42 |
| `€ 1.234,56` | thousands `.`, decimal `,` | 1234.56 |
| `No reviews yet` | | parse_fail |

The picker shows the parsed value next to the raw text and lets you change
`pick` before saving, so an ambiguous string gets fixed at capture time, not
after a week of wrong data.

## 5. Resolution and drift

```
for selector in bundle.selectors:
    text = resolve(selector, dom_or_body)
    if text is None: continue
    parsed = parseNumber(text, bundle.parser)
    if parsed.ok: return { value, raw: text, strategy: selector.type }
return selector_miss (or parse_fail if some selector matched but nothing parsed)
```

- `strategy` is stored on every sample.
- A gutnumber's status becomes `drifted` when its last 3 successes all came from
  a selector later in the list than the first one (i.e. the CSS selector is
  dead but TextQuote or Regex carry on). The editor shows an amber badge with a
  "repair" action: opens the edit modal with the stored `context_html` and the
  latest fetched HTML side by side, and a "test on server" button.
- A value that jumps by more than 1000× versus the previous sample is stored but
  flagged `suspect` in `poll_log`; the Log tab lists these. (Cheap guard against
  a fallback selector grabbing the wrong number.)

## 6. Site notes

- **Amazon product page.** Sales rank lives in `#detailBullets_feature_div` (list
  layout) or `#productDetails_detailBullets_sections1` (table layout), varies by
  category. TextQuote with prefix `Best Sellers Rank:` is the robust one; CSS is
  a nice-to-have. Needs residential proxy from a server IP; plain `http` usually
  works through the proxy, `browser` is the fallback. Block images in the browser
  fetcher (proxy is metered).
- **YouTube watch page.** The DOM view count is rendered client-side; plain http
  gets a page whose inline JSON contains `"viewCount":{"videoViewCountRenderer":
  {"viewCount":{"simpleText":"1,234,567 views"}}}`. The picker offers a
  `RegexSource` for that automatically when the clicked number is also found in
  the page source. Better still: use the `youtube_video_stats` helper (Data API,
  1 quota unit per call) and skip the page entirely. YouTube blocks proxied
  browser fetches with "confirm you're not a bot"; the server's own IP is fine
  for occasional http.
- **Your own sites.** Straight http, no proxy. Consider the `json_api` helper if
  the site can expose a tiny JSON endpoint; that is far more stable than DOM.
- **Social keyword frequencies.** Site-specific; most will end up as helpers.

## 7. Where the code lives

- `packages/shared/src/selectors/{generate,resolve,types}.ts`
- `packages/shared/src/parse-number.ts`, `text.ts`
- `packages/extension/src/picker/` (overlay, hover, dialog) imports from shared
- `packages/fetch/src/{http,browser}.ts` call `resolveBundle()` from shared
- `test-fixtures/*.html` + `packages/shared/test/*.test.ts` pin the examples above
