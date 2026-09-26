# Gutnumber — Architecture

Status: planning draft, 2026-09-26. Numbered decisions (D1, D2 …) are logged in
`PLAN.md`; open questions (Q1, Q2 …) are listed there too. Companion docs:
`DATA_MODEL.md` (schema), `API.md` (REST surface), `SELECTORS.md` (capture and
resolution of numbers on pages), `DEPLOY.md` (hosting).

## 1. Purpose

Gutnumber tracks "interesting numbers" that live on public web pages (Amazon
sales rank, YouTube view counts, site traffic, keyword frequencies) and shows them
on dashboards and slideshows, eventually on eInk displays driven by a Raspberry Pi.

Three moving parts, as in the original Digisynd system:

1. **Capture tool** in the browser: point at a number on a page, name it, pick a
   polling frequency, done.
2. **Daemon** that re-fetches every tracked number on schedule and records
   (timestamp, value) pairs.
3. **Web app** at `gut.example.com`: editors for numbers, visualizations,
   dashboards and playlists, plus chrome-less viewer pages.

## 2. Component map

```
 your laptop                         server                                    the web
 ┌───────────────────┐  HTTPS/JSON  ┌────────────────────────────────────────┐
 │ Chrome extension  │─────────────▶│ gutnumber-web   (Node, 127.0.0.1:3100) │
 │  picker + dialog  │ POST /api/.. │  REST API · auth · serves client UI    │
 └───────────────────┘              │  preview fetch (same fetch library)    │
                                    │                  │                     │
 ┌───────────────────┐   HTML+JSON  │        data/gutnumber.sqlite (WAL)     │
 │ browser / Pi      │◀─────────────│                  ▲                     │      ┌─────────────┐
 │  viewer pages     │              │ gutnumber-daemon (Node, systemd)       │─────▶│ amazon.com  │
 └───────────────────┘              │  scheduler → fetchers → samples        │ http │ youtube.com │
                                    │  http · headless chromium · helpers    │proxy │ your sites  │
                                    └────────────────────────────────────────┘      └─────────────┘
                                          Apache :443  →  ProxyPass  →  :3100
```

Two long-running processes share one SQLite file. The web process never scrapes
on a schedule; the daemon never serves HTTP. A crash in headless Chromium cannot
take the site down, and either can be restarted independently.

## 3. Stack (D1–D4)

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript on Node 22, one repo, one root `package.json`, source packages wired by tsconfig paths (D16) | Matches the author's other Node services. The capture tool must be JS anyway, and the **selector-resolution code is shared verbatim** between the browser (at capture time) and the daemon (at poll time). One runtime on the server. |
| Storage | SQLite via `better-sqlite3`, WAL mode, file outside the repo | Zero-config, single-file backup, trivially portable for anyone installing the public repo. 100 numbers at 5-minute polling is ~10M rows/year, well within SQLite's comfort. MariaDB could be swapped in later behind the same query module, but nothing needs it yet. |
| Web server | Fastify | Small, fast, typed; static serving plugin for the client. |
| Client UI | Vite + Preact + TypeScript | Editors need tables, modals, drag/resize; Preact gives components without a heavy framework. |
| Charts | Chart.js 4 (+ date adapter) | Line, bar, area, mixed; easy per-series colour; renders fine in high-contrast mode for eInk. |
| Dashboard grid | gridstack.js | Move/resize widgets on a 12-column grid, serialises to JSON. |
| Plain fetch | undici `fetch` + `ProxyAgent`, HTML parsed with `linkedom` | linkedom gives a real DOM, so the shared resolver runs unchanged. |
| Browser fetch | Puppeteer (bundled Chromium) | Same tool as the existing Amazon scraper; runs the shared resolver via `page.evaluate`. |
| Capture tool | Chrome MV3 extension, loaded unpacked; optional bookmarklet build | See §5. |
| Tests | vitest; HTML fixtures; a tiny local fixture site for end-to-end poll tests | |
| Process mgmt | systemd units, Apache reverse proxy, certbot | The usual shape for a small Node service behind Apache. |

## 4. Repo layout

```
gutnumber/
  package.json              all dependencies + root scripts (build, test, typecheck, dev)
  CLAUDE.md                 conventions for anyone (or any model) working in the repo
  ARCHITECTURE.md PLAN.md DATA_MODEL.md API.md SELECTORS.md DEPLOY.md
  packages/
    shared/     types, W3C selector engine (resolve + generate), number parser,
                schedule math. No Node-only or browser-only imports: runs in both.
    db/         SQLite open/migrate, typed query functions. Used by server and daemon.
    fetch/      fetch strategies (http, browser), proxy config, bot-wall detection,
                helper plugin registry + built-in helpers, `previewFetch()`.
    daemon/     the scheduler loop; systemd entrypoint. Thin: db + fetch + timing.
    server/     Fastify app: REST API, auth, static client, viewer HTML. Entrypoint.
    client/     Vite/Preact SPA: editor tabs + viewer routes.
    extension/  MV3 extension: picker content script, dialog (shadow DOM), options
                page, service worker (does the API calls). Also emits the bookmarklet.
    cli/        `gut` command: poll <id>, add, export/import, backup, add-helper-number.
  deploy/       *.service and Apache vhost templates with placeholders, deploy.sh
  scripts/      dev helpers (fixture site, seed data)
  test-fixtures/ saved HTML pages for selector tests (Amazon product, YouTube watch, …)
```

The private repo (`gutnumber_pvt`, §13) is a sibling directory, never nested.

## 5. Capture: the extension

**Why an extension, not a bookmarklet (D5).** A 2008-style bookmarklet injects a
`<script src=https://gut…/picker.js>` into the page. Today most target sites
(Amazon, YouTube, anything with a CSP `script-src`) block that outright. An MV3
extension with `activeTab` + `scripting` permissions injects a content script
regardless of page CSP, and its service worker can call the API with the stored
basic-auth credentials without any CORS dance. Loading it unpacked from the repo is a one-time
step in `chrome://extensions`. The same picker module is also built as an IIFE
served at `/bookmarklet/picker.js` for CSP-free pages, so the bookmarklet path
costs almost nothing extra and stays available for browsers without the
extension installed (Q3).

**Flow.**

1. Click the toolbar icon. The service worker injects `picker.js` into the tab.
2. Picker mode: hovering outlines the innermost element under the cursor; elements
   whose own text contains a number get a stronger outline and a parsed-value
   badge. `Esc` cancels. Arrow keys widen/narrow to parent/child.
3. Click: the picker builds a **selector bundle** (`SELECTORS.md`): CSS, XPath,
   TextQuote with prefix/suffix, plus the ancestor HTML snippet and the raw text.
   It parses the number and shows a dialog (shadow DOM, immune to page CSS):
   - label (pre-filled from page title / nearby heading), editable
   - URL (canonical URL if the page declares one)
   - current value as parsed, next to the raw text, with a parser dropdown
     (first number / last / largest, thousands separators, K/M suffixes)
   - frequency: weekly · daily · hourly · 5 min
   - a **server preview**: the dialog asks `POST /api/v1/preview` to fetch the
     page from the server with the same bundle. Result shows "http: 12,345 ✓",
     or "http failed (bot wall); browser: 12,345 ✓", or both failed. This decides
     the `fetcher` field before the number is ever saved and makes the failure
     visible while you are still on the page.
   - proxy: none / residential (pre-checked when the host is amazon.*)
   - Create / Cancel
4. On Create the service worker POSTs `/api/v1/gutnumbers`; the dialog shows the
   assigned slug and a link to the editor.

Options page: API base URL, the site's basic-auth username and password, default
frequency. Stored in `chrome.storage.local`; the service worker sends them as an
`Authorization: Basic` header on every API call (D11).

Sites requiring login are out of scope for v1; the design leaves room for a
"cookie jar" per host that the extension can export later (roadmap in PLAN.md).

## 6. Fetching a number

A gutnumber record says *where* (URL), *what* (selector bundle + parser) and *how*
(`fetcher`: `http` | `browser` | `helper`), plus `proxy` and `frequency`.

### 6.1 Strategies

- **http**: `fetch()` with browser-like headers (UA, Accept-Language, no
  compression surprises), optional residential proxy via `ProxyAgent`, 20 s
  timeout, 3 tries. Body parsed with linkedom; the shared resolver runs over the
  DOM. Also applies `RegexSource` selectors to the raw body (useful for numbers
  embedded in inline JSON, e.g. YouTube's `"viewCount":"…"`).
- **browser**: Puppeteer, one shared Chromium (recycled every 100 pages), a fresh
  browser context per fetch. Request interception blocks images/fonts/media (saves
  proxy bandwidth, which is billed per GB). Waits for network idle, the primary CSS
  selector, or a ceiling, then returns the rendered HTML; resolution runs in Node
  with the same resolver as the http path (D17). A JPEG screenshot is kept when a
  browser fetch fails.
- **helper**: a named plugin with typed params (§6.4). No selectors involved.

Every fetch returns `{ value, raw, strategy, http_status, duration_ms }` or a
typed error (`timeout`, `http_error`, `bot_wall`, `selector_miss`, `parse_fail`,
`helper_error`).

### 6.2 Resolution order

Try CSS → XPath → TextQuote → RegexSource, stop at the first that yields text
that parses to a number. Record which one succeeded in the sample (`strategy`).
When the primary CSS selector starts failing but TextQuote still works, the
editor shows a "drifted" badge: the number is still being tracked, but the page
changed and the selector deserves a look. This is the main robustness mechanism;
details in `SELECTORS.md`.

### 6.3 Bot walls and proxies

Amazon serves a captcha page (markers: `api-services-support@amazon.com`,
`/errors/validateCaptcha`) instead of a 4xx. Each fetcher checks a small marker
list and reports `bot_wall`; the scheduler retries with a fresh proxy session, then
falls back from `http` to `browser` once before giving up for this cycle.

Proxy config follows common residential-proxy practice: a new
session id per request, optional country rotation. Credentials live in `.env`
(`PROXY_URL_TEMPLATE`), never in the DB or repo. Per-host politeness: a minimum
gap between requests to the same host (default 5 s, 15 s for amazon.*).

### 6.4 Helpers

For numbers not readable from a page (or readable more cheaply via an API):

```ts
interface Helper {
  name: string;            // "youtube_video_stats"
  title: string;           // shown in the editor's "New from helper" menu
  params: HelperParam[];   // [{ key, label, type: 'string'|'number'|'select'|'secret', required, help, options? }]
  fetch(params: Record<string, unknown>, ctx: FetchContext): Promise<{ value: number; raw: string }>;
}
```

Built-ins planned: `youtube_channel_feed` (the public per-channel RSS feed
carries a view count for each of the channel's last 15 uploads: no key, no
scraping; the natural first helper), `youtube_video_stats` (Data API: views/likes/
comments for any video id, 1 quota unit), `youtube_channel_stats` (subs/views), `clicky_stats` (visitors for a
site over a period), `json_api` (URL + JSONPath + optional aggregation `sum|last|first|max|min|count`
over the matched values + headers; the general escape hatch, and the right tool
for your own sites' stats endpoints), `hn_topic_count` (below), `amazon_salesrank` (ASIN → overall or per-category rank, through the
proxy, with http→browser fallback). Personal helpers load from
`$GUTNUMBER_PRIVATE_DIR/helpers/*.js` at startup. The editor renders a form from
`params` so helper-based numbers are created in the UI, not by hand.

**Judgment helpers (D15).** Some numbers are counts of things that satisfy a
semantic test, which no selector can express: "how many Hacker News front-page
stories are about AI today?" These use TypeSafe's Jev model through its JS SDK:
one `systemOne` request whose `state` holds the topic and whose `questions` are
one Noul per item, each embedding that item's title.
All Nouls run in parallel inside that single call and each returns a probability
of yes. Code does the rest: count items with `p ≥ threshold` (default 0.5) and
store the count as the value, with the matched titles and probabilities in
`raw` so the number's drawer shows *which* stories counted. First instance:
`hn_topic_count` (params: `topic`, `threshold`, `list` top or new, `stories` 30,
60 or 100). *top* is HN's ranked `topstories` ids plus one Algolia request for their
titles; *new* is one Algolia `search_by_date` request. Tracking both shows what is
being submitted against what scores high. Each Noul carries its own story title
(D18); 100 stories judge in about half a second. Per tick, the item
list is fetched once and shared by every topic number, so ten topics cost ten
Jev calls and one HN fetch. The same two-layer shape (a `source` that lists
items, a `countYes(items, question)` utility) will serve Reddit, Bluesky or
YouTube-trending topic counts later. `TYPESAFE_API_KEY` lives in `.env`.

### 6.5 Site credentials and URL fragments (D14)

Some of your own pages sit behind HTTP basic auth (often with a home-IP allowlist,
so they work in your browser but return 401 to the server). Per-host credentials live
in `$GUTNUMBER_PRIVATE_DIR/credentials.json`:

```json
{ "stats.example.com": { "type": "basic", "user": "…", "pass": "…" } }
```

The http fetcher adds `Authorization: Basic` when the URL's host (or a parent
domain) matches; the browser fetcher calls `page.authenticate()`; helpers get the
same lookup through `ctx.credentialsFor(url)`. Credentials never enter the DB, the
API or the extension; the extension's preview simply reports `401` and the dialog
says "add credentials for this host in the private config". This is also the hook
where cookie-based logins would plug in later.

URL fragments (`#range=week&metric=uniq`) are never sent to a server. The picker
records the full URL, and the preview flags a fragment-bearing URL whose http
fetch misses the number: the fix is the browser fetcher (which navigates with the
fragment and lets the page's JS apply it) or, better, the JSON endpoint that page
calls, via `json_api`.

## 7. The daemon

A single loop, every 15 s:

1. `SELECT` enabled gutnumbers with `next_due_at <= now` and not currently
   running, ordered by `poll_now` flag then `next_due_at`.
2. Dispatch under concurrency limits: 4 http/helper, 1 browser (2 if RAM allows),
   honouring per-host gaps. Numbers that share the same URL, fetcher and proxy setting
   are grouped: the page is fetched once and every bundle resolves against that
   one DOM (an Amazon product page carries several ranks; this halves proxy
   spend) (D12).
3. Each job: fetch → insert `samples` row (on success) → insert `poll_log` row
   (always) → update the gutnumber's `last_*`, `consecutive_failures`,
   `next_due_at`.
4. Write a heartbeat to `settings.daemon_heartbeat` so the UI can show "daemon
   last seen 12 s ago".

**Scheduling.** `5m` and `hourly` align to the clock plus a few seconds of jitter
so a hundred numbers do not fire in the same instant. `daily` fires at
`DAILY_HOUR` (default 06:00 local, `TZ` from env) and `weekly` at `WEEKLY_DAY`
+ `DAILY_HOUR`. On failure, retry after `min(frequency, 15 min × 2^n)`. After 10
consecutive failures the number is flagged `failing` (red in the editor; optional
Pushover notification, Q8) but keeps being retried at its normal frequency.

"Poll now" from the UI sets `poll_now = 1`; the daemon picks it up within one
loop. The web process never fetches on its own except for `/api/v1/preview`.

**Store interface (D6).** The daemon talks to storage through a small interface
(`claimDue`, `recordSample`, `recordFailure`, `heartbeat`). v1 ships the direct
SQLite implementation. A second implementation speaking to the server's API
would let the poller run on another machine (one that already has Chromium and the
proxy set up) or on Lambda, without touching the scheduler. Not built in v1; designed for.

## 8. Storage

SQLite, WAL, `synchronous=NORMAL`, foreign keys on. Schema in `DATA_MODEL.md`.
Highlights:

- `gutnumbers` has an integer PK plus a unique, editable `slug` (the "uniq id"
  from the proposal). Everything else references the integer, so renaming a slug
  is a one-column update.
- `samples (gutnumber_id, ts, value, raw, strategy)` with an index on
  `(gutnumber_id, ts)`. Raw samples are kept forever; charts downsample on read
  (Q6). Rollup tables can be added later if a query ever gets slow.
- `poll_log` keeps every attempt for 30 days (pruned by the daemon nightly).
- The last successfully fetched page of each number is kept gzipped at
  `data/pages/<id>.html.gz` (one file per number, overwritten each poll) so a
  broken selector can be repaired against the real current markup without a live
  refetch (D12). Failure screenshots from the browser fetcher sit beside it.
- `unit` and `decimals` on a gutnumber drive display formatting everywhere
  (\"233,368 views\", \"#1,204\", \"$12.50\", \"3.2%\").
- `visualizations`, `dashboards`, `playlists` store their config as JSON columns
  validated by zod schemas in `shared/`. They change shape often; a JSON column
  plus a schema version is the right amount of structure here.
- `settings` key/value for daemon heartbeat, poll hours, palette. No
  credentials in the DB (§11).

Migrations: numbered SQL files in `packages/db/migrations`, applied at startup by
both processes (idempotent, `PRAGMA user_version`).

## 9. Web app

### 9.1 Server

Fastify with plugins: static (built client) and JSON schema validation on every
route. The app has no login of its own: Apache basic auth protects the whole
site (§11). In development it listens unauthenticated on 127.0.0.1. API detail in
`API.md`. It also serves viewer HTML at `/view/...` (same SPA bundle, different
route) so the Pi only needs a URL.

### 9.2 Client tabs

- **Numbers** (the gutnumber editor). Table: enable toggle (red/green), colour
  swatch, label, slug, host, frequency dropdown (inline, saves on change), last
  value + sparkline of the last ~50 samples, last polled, status badge (ok /
  drifted / failing / disabled), "poll now", edit. Edit modal: label, slug, URL,
  selector bundle (each selector editable, with a "test on server" button that
  calls `/preview`), parser options, fetcher, proxy, colour, notes. "New from
  helper" opens a form generated from the helper's `params`. A drawer shows the
  number's recent `poll_log`.
- **Visualizations.** List with edit/delete/duplicate. Modal: pick one or more
  gutnumbers (search), chart type (line · bar · area · step · stat tile),
  per-series transform (raw · delta between samples · running average(n) ·
  daily min/max/avg), range (24 h · 7 d · 30 d · 90 d · 1 y · all · custom),
  options (title, subtitle, legend, y from zero, log scale, show latest value),
  per-series colour (defaults from the gutnumber), default carousel seconds,
  "add to playlist…". Live preview in the modal.
- **Dashboards.** List with view link, reorder, delete, edit, create. Editor is
  a gridstack canvas: add visualization / add carousel (choose playlist, seconds
  override) / add a clock, text (Markdown) or image widget, move/resize, dashboard options (title bar, theme light/dark/eink,
  data refresh interval), "save as playlist item".
- **Playlists.** List; editor is an ordered list of items (visualization or
  dashboard, seconds each) with drag reorder, add, remove.
- **Log.** Recent poll failures across all numbers, filterable; daemon heartbeat.

### 9.3 Viewers

`/view/dashboard/:id`, `/view/playlist/:id`, `/view/viz/:id`. No chrome. Query
params: `theme=eink` (monochrome, no animation, thick strokes, large type),
`w`/`h` to fix the viewport for screenshotting. A Pi or kiosk sends the same
basic-auth credentials a browser would (D11). Data refreshes on the dashboard's interval; playlist items
advance on their seconds. A future `/render/dashboard/:id.png` endpoint
(Puppeteer screenshot) would let a Pi Zero fetch a ready-made image instead of
running a browser; noted in the roadmap.

### 9.4 Data for charts

`GET /api/v1/visualizations/:id/data` returns one series per configured
gutnumber, downsampled to at most `points` (default 600) buckets over the
requested range, using bucketed `avg`/`last`/`min`/`max` in SQL. Transforms
(delta, running average) run server-side so viewers stay dumb.

## 10. Playlists, dashboards, carousels, and loops

Dashboards may contain carousels that play playlists; playlists may contain
dashboards. Two rules keep this finite (D7):

1. **Save-time cycle check.** The server builds the reference graph
   (dashboard → playlist via its carousels; playlist → dashboard via its items)
   and rejects a save that would create a cycle with `409` and the offending path
   (`dashboard "Office" → playlist "Morning" → dashboard "Office"`).
2. **Render-time depth limit.** A dashboard rendered inside a playlist plays its
   carousels normally (depth 1). A dashboard rendered inside a carousel inside a
   dashboard renders its own carousels frozen on their first item (depth 2 stops
   animating). The cycle check makes this a belt-and-braces measure, not the
   primary defence.

## 11. Auth and exposure (D11)

- The whole site, editors and viewers alike, sits behind **HTTP basic auth at
  Apache** (`AuthType Basic`, one user in an `htpasswd` file). The Node app never
  sees a password and has no sessions, tokens or login page. This mirrors the
  fail2ban dashboard already on the host and keeps the app code smaller.
- The extension, the `gut` CLI and any kiosk send `Authorization: Basic …`;
  browsers cache the credentials after the first prompt. Credentials live only in
  Apache's `htpasswd` and in `gutnumber_pvt`; never in this repo or its docs.
- The app binds to 127.0.0.1 only, so nothing bypasses Apache. Apache passes
  `X-Forwarded-User` so logs can show who did what if a second user is ever
  added.
- Viewer routes still never expose selectors, tracked-page URLs beyond what a
  viz shows, or helper params (API keys).
- If a chart ever needs to be shared without credentials, add a per-dashboard
  signed share link later (roadmap); the basic-auth wall is the default.
## 12. Failure handling and observability

- Every poll attempt is a `poll_log` row with error class and message; the Log
  tab and the per-number drawer read from it.
- Daemon logs structured JSON lines to stdout → journald.
- `GET /api/v1/health` reports DB reachability, daemon heartbeat age, counts of
  failing numbers.
- Optional Pushover notification when a number enters `failing` or the daemon
  heartbeat goes stale (Q8).
- Nightly `gut backup` (SQLite online backup API) to `data/backups/`, keep 14.

## 13. Public and private repos (D8)

- **`gutnumber` (public):** everything in §4. No secrets, hostnames, IPs, SSH
  users or personal ids. Every per-install file has a tracked `.example`.
- **`gutnumber_pvt` (private):** a sibling checkout; `GUTNUMBER_PRIVATE_DIR`
  points at it. Contains `.env` (proxy URL, API keys), `credentials.json` (per-host
  site logins, §6.5), `deploy/`
  (real vhost + units with real paths, the `htpasswd` file), `helpers/` (personal helper plugins),
  `seed/gutnumbers.json` (export of number definitions so the setup is
  reproducible), `notes/` (server-specific notes such as the current DEPLOY.md
  reference section).
- The public code reads the private dir for `.env`, helpers and nothing else; the
  private repo has no code of its own beyond helper plugins. No git submodules.
- `gut export` / `gut import` move definitions (not samples) as JSON.

## 14. Non-goals for v1

Multi-user accounts, logged-in-site scraping, Lambda fan-out, alert rules on
values (thresholds), CSV export UI, eInk rendering endpoint, mobile layout for
editors. All are sketched in the roadmap section of `PLAN.md` and none are
blocked by the v1 design.
