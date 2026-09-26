# Gutnumber — Implementation Plan

Status: Phases 0–8 implemented and deployed 2026-09-26 (host details in the private repo). Open items are listed under "Not done yet" below. Read `ARCHITECTURE.md` first. Phases are
ordered so that something useful exists after each one; each has a done-when
check that can be verified without the later phases. Tick boxes as work lands.

## Phase 0 — Scaffold (½ day)

- [x] Root `package.json` (D16), `tsconfig.json` with `@gut/*` paths, vitest, tsx.
- [x] Packages created with a stub `index.ts` each: shared, db, fetch, daemon,
      server, client (Vite + Preact), extension (Vite, MV3 manifest), cli.
- [x] `.gitignore`, `.env.example`, `packages/extension/config.example.json`,
      `deploy/*.example`.
- [x] `git init`; first commit; create GitHub repos `gutnumber` (public) and
      `gutnumber_pvt` (private, sibling dir with `.env`, `deploy/`, `helpers/`,
      `seed/`, `notes/`).
- [x] Move the "Reference install" section of `DEPLOY.md` and `PROPOSAL.md` into
      `gutnumber_pvt/notes/` (Q9 decides timing: before first public push at the
      latest).

Done when: `npm run typecheck && npm test` pass on empty packages; `npm run dev`
starts server + client with hot reload.

## Phase 1 — Shared core: selectors, parsing, schedule (1–2 days)

- [x] `shared/text.ts` normalisation; `shared/parse-number.ts` with the table in
      `SELECTORS.md` §4 as tests.
- [x] `shared/selectors/types.ts` (zod), `resolve.ts` (CSS, XPath, TextQuote,
      RegexSource) against any DOM-like `Document`; tests run against linkedom
      *and* jsdom-free happy-dom to catch API drift.
- [x] `shared/selectors/generate.ts`: CSS generator per `SELECTORS.md` §2, XPath,
      TextQuote with prefix/suffix, context HTML capture. Fixture pages: Amazon
      product (both detail layouts), YouTube watch, a simple blog stats page, a
      page with hashed class names.
- [x] `shared/schedule.ts`: `nextDue(frequency, now, {dailyHour, weeklyDay, tz})`,
      jitter, backoff; tests across DST boundaries.
- [x] `shared/schemas/`: VizConfig, DashboardLayout, DashboardOptions,
      PlaylistItem, Bundle, Gutnumber DTOs.

Done when: every fixture resolves to the expected number via the first selector,
and still resolves via TextQuote when the fixture's ids/classes are mangled by a
test helper.

## Phase 2 — DB + fetch + daemon (2 days)

- [x] `db/`: open with pragmas, migration runner, `001_init.sql` from
      `DATA_MODEL.md`, typed query functions, `claimDue` with stale-claim reclaim.
- [x] `fetch/http.ts`: undici fetch, headers, ProxyAgent from
      `PROXY_URL_TEMPLATE` with `{session}` substitution, timeout/retries, bot-wall
      markers, linkedom parse, `resolveBundle`.
- [x] `fetch/browser.ts`: Puppeteer singleton, incognito context per fetch,
      request interception (block image/font/media), proxy per context, wait for
      selector or ceiling, `page.evaluate(resolveBundle)`, screenshot on failure
      to `data/failures/<id>-<ts>.png` (kept 7 days).
- [x] `fetch/helpers/`: registry, param schema validation, built-ins
      `youtube_channel_feed` (RSS, no key; see `TEST_TARGETS.md`), `json_api`,
      `youtube_video_stats`, `youtube_channel_stats`, `hn_topic_count` (Jev via the
      TypeSafe JS SDK; read docs.typesafe.ai's JS SDK and Noul pages first, and
      `~/Development/AI/jev/ask_jev.py` for the working Python shape; per-tick
      source cache so topics share one HN fetch); private helper loader from
      `$GUTNUMBER_PRIVATE_DIR/helpers`.
- [x] `fetch/preview.ts`: run strategies in order, per-selector report.
- [x] Site credentials from `credentials.json` for http, browser and helpers;
      `json_api` aggregation over JSONPath matches (D14).
- [x] `daemon/`: loop, concurrency limiter, per-host gap, job runner writing
      samples/poll_log/gutnumber state, heartbeat, nightly prune + backup hook,
      http→browser fallback on `bot_wall`/`selector_miss` once per cycle,
      `suspect` flag on 1000× jumps, `drifted` status rule.
- [x] Same-URL grouping within a tick (one fetch, many bundles) and retention of
      the last fetched page per number in `data/pages/` (D12).
- [x] `cli/`: `gut poll <id|slug>`, `gut add --url --label --frequency` (uses
      preview to build a bundle from a TextQuote prefix you type), `gut backup`,
      `gut export` / `gut import`.
- [x] `scripts/fixture-site.ts`: a local Fastify serving the fixture pages with
      knobs (`?fail=captcha`, `?drift=1`, `?value=N`) for e2e.
- [x] `npm run e2e`: temp DB, fixture site, one daemon tick, assert samples and
      poll_log rows including a bot-wall retry and a drift.

Done when: `gut add` + `gut poll` records a real value from the fixture site
through both http and browser strategies; e2e passes; daemon runs for an hour
against fixtures without leaking Chromium processes (check `ps`).

## Phase 3 — Server API + auth (1–2 days)

- [x] Fastify app, zod validation, error envelope, request logging.
- [x] No app-level auth (D11): read `X-Forwarded-User` for logs; refuse to start
      bound to anything but 127.0.0.1 unless `GUTNUMBER_DEV=1`.
- [x] Routes from `API.md`: gutnumbers (incl. `/page`), preview, helpers, log,
      health, settings, export/import.
- [x] Cascade rules on delete (viz series, playlists, dashboards) as functions in
      `db/` with tests.
- [x] Serve built client from `/`, viewer shell from `/view/*`.

Done when: `curl` walkthrough in `API.md` works end to end against a temp DB;
the extension's create call and the CLI both work through a local Apache (or
Caddy) basic-auth proxy in front of the dev server.

## Phase 4 — Chrome extension (2 days)

- [x] MV3 manifest generated at build from `config.json` (API origin → host
      permission), `activeTab`, `scripting`, `storage`.
- [x] Service worker: inject picker on action click; message bridge; API calls
      with stored basic-auth header; preview call.
- [x] YouTube special case: when the clicked number is also present in the page
      source as `"viewCount":"N"`, offer the `RegexSource` and the
      `youtube_channel_feed` helper as alternatives in the dialog.
- [x] Picker content script: overlay + hover highlight, number badge, parent/child
      widening with arrow keys, Esc, click → bundle generation via `shared`.
- [x] Dialog in shadow DOM: label, URL, parsed value + raw + parser picker,
      frequency, proxy, server preview panel with recommended fetcher, Create /
      Cancel, success state with link to editor.
- [x] Options page: API URL, basic-auth username/password, default frequency,
      "test connection".
- [x] Bookmarklet build (`picker.iife.js`) + `/bookmarklet` page (optional, Q3).
- [x] Manual test script in `packages/extension/TESTING.md`: Amazon product page,
      YouTube watch page, one of your own pages, a page with strict CSP.

Done when: the starter video in `TEST_TARGETS.md` is created with one click and
polls hourly; on a live Amazon product page, one click + Create yields a
gutnumber whose daemon poll returns the same rank within a minute (with proxy).

## Phase 5 — Web UI: Numbers tab + Log tab (2 days)

- [x] App shell: tabs, login page, toasts, confirm dialogs, keyboard-friendly.
- [x] Numbers table with inline enable toggle, frequency dropdown, colour swatch,
      sparkline, status badge, poll-now, search/filter/sort, host grouping.
- [x] Edit modal: all fields incl. unit/decimals; per-selector "test on server";
      repair view with stored context HTML vs the retained last page; slug rename
      with uniqueness check.
- [x] "New from helper" form generated from `params`, with "test" before save.
- [x] Per-number log drawer; Log tab with failures across numbers; daemon
      heartbeat indicator; health banner if the daemon is stale.

Done when: every gutnumber operation in the proposal's editor section is
possible without the CLI.

## Phase 6 — Visualizations (2 days)

- [x] Data endpoint: bucketing, transforms (raw, delta, running_avg, bucket agg),
      `invert`, `points` cap; tests on synthetic series.
- [x] Chart component (Chart.js): line/bar/area/step/stat, dual axis, legend,
      latest-value overlay, theme-aware palette incl. `eink`.
- [x] Viz list + editor modal with live preview; duplicate; add-to-playlist.
- [x] `/view/viz/:id` viewer.

Done when: a viz mixing a daily Amazon rank (inverted) and hourly YouTube views
(delta) renders sensibly over 7 d and 90 d, in light and eink themes.

## Phase 7 — Dashboards, playlists, viewers (2–3 days)

- [x] Dashboard editor on gridstack: add viz / carousel / clock / text / image
      widgets, move/resize, options, save; list with reorder/delete/view.
- [x] Playlist editor: ordered items with seconds, drag reorder; list with
      reorder/delete.
- [x] Server cycle check (409 with path) + tests; render depth limit in viewer.
- [x] `/view/dashboard/:id`: grid render, carousels advancing, data refresh
      interval, `theme`/`w`/`h`/`k` params, no layout shift on refresh.
- [x] `/view/playlist/:id`: full-screen slideshow of viz and dashboards,
      preloading the next item, clock/progress optional.
- [x] "Save dashboard as playlist item" and "add viz to playlist" shortcuts.

Done when: a dashboard containing a carousel of a playlist that contains another
dashboard renders and cycles; trying to add the first dashboard to that playlist
is refused with a readable path.

## Phase 8 — Deploy to the server (1 day)

- [x] `deploy/` templates + `deploy.sh`; systemd units; Apache vhost with basic
      auth (`htpasswd`); certbot; DNS record; Chromium libs; `MemoryMax=1200M`.
- [x] Private repo populated: `.env`, real deploy files, `seed/` export, notes.
- [x] Nightly backup timer; `SERVER_CHANGES.md` entry on the host.
- [x] Extension pointed at the production URL; first real numbers created: the
      starter video and the test channels in `TEST_TARGETS.md`, your own site's
      traffic via `json_api` against its stats endpoint (needs `credentials.json`), Hacker News front-page topic counts for "AI",
      "Anthropic" and "Security breach" (daily), Amazon ranks (proxy).
- [x] Pushover alert on `failing` transitions and stale daemon heartbeat (Q8: yes).
- [x] One week of unattended polling; review Log tab; tune per-host gaps.

Done when: `https://gut.<host>/view/dashboard/1` shows a week of real data on a
browser left open on a spare screen.

## Not done yet

Open items and future work now live in `BACKLOG.md`.

## Phase 9 — Polish and roadmap candidates (as wanted)

- `clicky_stats`, `amazon_salesrank` helpers (the latter wraps http/browser with
  ASIN input and category pick; cheaper to set up than the picker for many books).
- `/render/dashboard/:id.png` via Puppeteer for eInk Pis without a browser;
  `theme=eink` refinements against a real panel's size and dithering.
- API-backed store for the daemon so the poller can run on another machine or Lambda (D6).
- Cookie jar per host exported from the extension for logged-in pages.
- Value alert rules (threshold crossed, no change in N days).
- CSV export from the Numbers tab; sample editing (delete a bad point).
- Import history from an existing scraper's JSON as seed data.

Considered on 2026-09-26 as gaps in the proposal; none are in v1 unless pulled in:

- **Events / annotations**: a dated note ("video posted", "book launched",
  "newsletter went out") drawn as a vertical marker on charts. A small `events`
  table and a marker layer in the chart component. High value for a personal
  dashboard, low cost.
- **Derived numbers**: a gutnumber computed from others (sum of views across a
  channel's videos, ratio, difference, rank of a rank). A `formula` fetcher that
  runs on the daemon over the latest samples of its inputs.
- **Value alert rules**: "notify when rank < 1000", "when no change for 3 days",
  "when delta > X"; Pushover delivery already planned for failures.
- **Sample editing**: delete or correct a bad point from the number's drawer.
- **Time-of-day playlist scheduling**: different dashboards morning vs evening on
  the eInk panel.
- **Per-dashboard share link**: a signed URL that bypasses basic auth for one
  read-only viewer, if a chart ever needs to be shown to someone else.
- **Text tracking**: track a string (price, "in stock", headline) for change
  detection rather than a number; a `kind` column and a diff view.
- **Mobile layout** for viewers (editors stay desktop-only).
- **More judgment helpers** on the `hn_topic_count` shape: Reddit front page,
  Bluesky search, YouTube trending, your own comment queues; also Score-based
  variants (average sentiment of front-page titles about X).

## Estimates

Roughly 12–15 focused days for Phases 0–8 with an agentic implementer and you
reviewing at phase boundaries. Phases 1–2 and 4 carry the technical risk
(selector robustness, Chromium on the server, extension permissions); everything
after is conventional CRUD + charting.

## Decision log

| # | Decision | Why | Date |
|---|---|---|---|
| D1 | TypeScript/Node 22 monorepo for everything | Capture tool is JS regardless; selector code shared browser↔daemon; matches the author's other Node services; one runtime on the server. Python was considered for the daemon (author preference for readability) and rejected because it would duplicate the resolver. | 2026-09-26 |
| D2 | SQLite (better-sqlite3, WAL) | Zero-config, single-file backup, portable for public-repo users; volume fits. MariaDB swap possible behind `db/` if ever needed. | 2026-09-26 |
| D3 | Fastify + Vite/Preact + Chart.js + gridstack | Small, well-trodden; no framework lock-in on the client beyond Preact. | 2026-09-26 |
| D4 | Two processes (web, daemon) sharing the DB | Chromium crashes cannot take down the site; independent restarts; same shape as other services on the host. | 2026-09-26 |
| D5 | Chrome MV3 extension is the capture tool; bookmarklet is a cheap optional build of the same picker | Page CSPs block script-injecting bookmarklets on the very sites we care about; extension content scripts are immune and the service worker avoids CORS. | 2026-09-26 |
| D6 | Daemon storage behind a `Store` interface; direct SQLite in v1 | Keeps the door open to running the poller on another machine or Lambda via the API without rewriting the scheduler. | 2026-09-26 |
| D7 | Loops prevented by save-time cycle check (409) plus render-time depth limit | Reject the bad state early with a readable path; depth limit as a backstop. | 2026-09-26 |
| D8 | Private repo is a sibling directory referenced by `GUTNUMBER_PRIVATE_DIR`; no submodules | Simple mental model: public code, private config/helpers/seed. Definitions exported as JSON become versioned config. | 2026-09-26 |
| D9 | Integer PK + editable unique slug for gutnumbers | The proposal wants the "uniq id" editable; references use the integer so renames are cheap. | 2026-09-26 |
| D10 | Raw samples kept forever; downsample on read | Simplest correct thing; rollups only if a query gets slow. | 2026-09-26 |
| D11 | HTTP basic auth at Apache for the whole site; no app-level login, sessions or tokens | User's call; matches the fail2ban dashboard on the host; extension/CLI/kiosk send a Basic header; smaller app. Credentials live only in `htpasswd` and the private repo. | 2026-09-26 |
| D12 | Same-URL fetch grouping; retain last fetched page per number | Amazon pages carry several ranks (proxy is metered); repair without refetch. | 2026-09-26 |
| D13 | `unit`/`decimals` on gutnumbers; clock/text/image dashboard widgets; `youtube_channel_feed` RSS helper first | Cheap, and the eInk dashboard needs a clock and labels anyway; RSS gives YouTube views with no key. | 2026-09-26 |
| D14 | Per-host site credentials in the private `credentials.json`, applied by all fetchers; `json_api` gains aggregation | the author's own stats pages use basic auth (401 from the server); their data endpoint is JSON with hourly buckets that need summing. Keeps secrets out of DB/API/extension. | 2026-09-26 |
| D15 | Judgment helpers: Jev Nouls over a fetched item list, counted in code (`hn_topic_count` first) | One HN fetch + one Jev call per topic gives a daily number no selector could; raw keeps the matched titles for inspection. | 2026-09-26 |
| D16 | One root `package.json` instead of npm workspaces; `@gut/*` aliases via tsconfig paths; esbuild bundles the Node entrypoints (server, daemon, cli) with only native/heavy deps external | Removes workspace build-order plumbing; deploy is `npm ci --omit=dev` + three bundles. | 2026-09-26 |
| D17 | Browser fetcher returns rendered HTML; the selector resolver runs in Node for both fetchers | One code path for resolution, previews and page retention; no `page.evaluate` bundle to keep in sync. | 2026-09-26 |
| D18 | `hn_topic_count`: each Noul embeds its story title; lists `top` (official ranking) and `new` (latest submissions), 30/60/100 | Live A/B on 30 stories: indexed `items[i]` references confused neighbours (atomic clock scored 0.77 for AI); embedded titles did not. 99 questions in one call took ~0.3 s. | 2026-09-26 |
| D19 | Apache: `<RequireAny>` (OPTIONS or valid-user) with explicit exemptions for `/api/v1/health` and `/.well-known/acme-challenge/` | `<If>/<Else>` merge after `<Location>` and silently overrode the exemptions, which failed the first certbot run. | 2026-09-26 |

## Questions answered 2026-09-26

All defaults accepted except Q4, which became D11 (basic auth for everything):
Q1 Node · Q2 SQLite · Q3 build the bookmarklet · Q4 whole site behind Apache
basic auth, one user · Q5 06:00 local, Monday · Q6 keep all raw samples ·
Q7 the server has 3.9 GB RAM / ~2.5 GB free / 2 CPUs, one Chromium is fine ·
Q8 Pushover alerts in Phase 8 · Q9 repos in Phase 0 · Q10 names as proposed ·
Q11 starter number is the Waveform video in `TEST_TARGETS.md`, plus the listed
test channels; Amazon ranks and own-site traffic next · Q12 Preact/Chart.js/gridstack.

Original questions, kept for the record:


- **Q1 Stack.** Confirm TypeScript/Node for the daemon too (D1). If you would
  rather have Python for the daemon, the cost is a second implementation of the
  selector resolver (Python + lxml/Playwright) kept in sync with the browser one.
- **Q2 Database.** SQLite (D2) or MariaDB since it is already running on the host?
- **Q3 Bookmarklet.** Build the optional bookmarklet path in Phase 4, or skip it
  and rely on the extension only?
- **Q4 Viewer exposure.** Viewer pages public by default (a Pi loads a plain URL),
  or require a key from day one?
- **Q5 Poll timing.** Daily/weekly polls at 06:00 local, weekly on Monday? Any
  numbers that need a different hour (e.g. Amazon after its daily rank refresh)?
- **Q6 Retention.** Keep all raw samples (D10), or prune 5-minute samples after a
  year?
- **Q7 Poller host.** Daemon on the web server (proposal) is the plan. Is its RAM
  comfortable with one headless Chromium (~400–800 MB)? If not, prioritise the
  API-backed store so the poller can sit on another machine beside an existing scraper.
- **Q8 Alerts.** Add Pushover notifications for failing numbers / stale daemon in
  Phase 8, or leave for later?
- **Q9 Public repo timing.** Create both GitHub repos in Phase 0 (private
  material moved out immediately), or keep everything local until Phase 8?
- **Q10 Names.** Private repo is `gutnumber_pvt` (the proposal says
  `getnumber_pvt`, assumed a typo). Web process name `gutnumber-web`, daemon
  `gutnumber-daemon`, CLI `gut`.
- **Q11 First numbers.** Which concrete numbers do you want tracked in week one?
  Knowing them shapes which helpers get built first (YouTube Data API key exists
  from kdmentions; Clicky credentials exist from the 2017 scripts).
- **Q12 UI framework.** Preact + Chart.js + gridstack are defaults, not
  convictions. Any preference (plain TS, Svelte, uPlot)?
