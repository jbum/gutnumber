# Gutnumber — HTTP API

Base path `/api/v1`. JSON in, JSON out. Times are unix seconds in the DB and ISO
8601 strings on the wire. Every route is schema-validated (Fastify + zod).

## Auth (D11)

The whole site is behind **HTTP basic auth at the reverse proxy**. The app itself
has no login, sessions or tokens; it trusts anything that reaches 127.0.0.1.

| Client | How |
|---|---|
| Browser (editors, viewers, kiosk) | Apache prompts once; credentials are cached. Kiosks may embed them in the URL or a header. |
| Extension, `gut` CLI, scripts | `Authorization: Basic base64(user:pass)` on every request. |

The proxy forwards `X-Forwarded-User`; the app logs it. Unauthenticated
requests never reach the app in production. `/health` is the one route the
vhost may exempt from auth for uptime checks (Location override).

Errors: `{ error: { code, message, details? } }` with 400/404/409/422/500.
## Gutnumbers

```
GET    /gutnumbers                  ?status=&host=&q=&sort=     list (includes last_value, sparkline[] of ≤50 points, status)
POST   /gutnumbers                  create (from extension, editor, or helper form)
GET    /gutnumbers/:id              full record incl. bundle
PATCH  /gutnumbers/:id              partial update (inline frequency/enabled/color/label/slug, or full edit)
DELETE /gutnumbers/:id              also removes it from viz series; response lists affected viz ids
POST   /gutnumbers/:id/poll        sets poll_now; returns 202
GET    /gutnumbers/:id/samples      ?from=&to=&points=&agg=   raw or bucketed samples
GET    /gutnumbers/:id/log          ?limit=  recent poll_log rows
POST   /gutnumbers/:id/repair-test  { bundle } → runs preview against the live URL and returns per-selector results
GET    /gutnumbers/:id/page         last fetched page (gzipped HTML from data/pages), for the repair view
DELETE /gutnumbers/:id/samples/:ts  delete one bad sample; last_value is recomputed
```

`:id` accepts the integer id or the slug.

Create body (extension):

```jsonc
{
  "label": "Sudoku Vol 1 — Amazon rank",
  "url": "https://www.amazon.com/dp/B0…",
  "fetcher": "http",               // chosen from the preview result
  "proxy": "residential",
  "frequency": "daily",
  "bundle": { /* SELECTORS.md §1 */ },
  "unit": "#", "decimals": 0,     // optional display formatting
  "color": "#e4572e"               // optional; server assigns from palette if absent
}
```

Create body (helper): `{ label, fetcher: "helper", helper_name, helper_params, frequency, color? }`.

Response `201 { id, slug, ...record }`. Slug is generated from label (`sudoku-vol-1-amazon-rank`), de-duplicated with a numeric suffix.

## Preview (server-side test fetch)

```
POST /preview
{ "url": "...", "bundle": {...}, "proxy": "none|residential", "strategies": ["http","browser"] }
→ 200 {
  "results": [
    { "strategy": "http",    "ok": true,  "value": 12345, "raw": "#12,345 in Books", "selector": "TextQuoteSelector", "duration_ms": 812, "http_status": 200 },
    { "strategy": "browser", "ok": false, "error_class": "timeout", "message": "..." }
  ],
  "per_selector": { "CssSelector": "miss", "XPathSelector": "miss", "TextQuoteSelector": "#12,345 in Books", "RegexSource": "12,345" },
  "recommended_fetcher": "http"
}
```

Runs strategies in order and stops early when `stop_on_success` (default true).
Rate-limited (a preview can cost proxy bandwidth). Timeout 45 s total; the
extension shows a spinner and lets you save without a preview if it is slow.

## Helpers

```
GET /helpers                → [{ name, title, description, params: [...] }]
POST /helpers/:name/test    { params } → { ok, value, raw } | error   (used by the "New from helper" form)
```

## Visualizations

```
GET    /visualizations
POST   /visualizations            { title, config, carousel_seconds }
GET    /visualizations/:id
PUT    /visualizations/:id
DELETE /visualizations/:id        removes from playlists/dashboards; response lists them
POST   /visualizations/:id/duplicate
GET    /visualizations/:id/data   ?points=&from=&to=  (overrides config.range when given)
   → { series: [{ gutnumber_id, label, color, points: [[ts, value], ...], latest: { ts, value }, unit? }], range: { from, to }, bucket_seconds }
POST   /visualizations/preview-data  { config } → same shape as /data, for the live preview in the editor
```

## Dashboards

```
GET    /dashboards                 ordered by sort_order
POST   /dashboards                 { title, layout, options }
GET    /dashboards/:id             includes resolved viz titles for the editor
PUT    /dashboards/:id             409 { code: "cycle", path: [...] } if the layout's carousels would create a loop
DELETE /dashboards/:id             removes from playlists; response lists them
POST   /dashboards/reorder         { ids: [...] }
```

## Playlists

```
GET    /playlists
POST   /playlists                  { title, items }
GET    /playlists/:id
PUT    /playlists/:id              409 cycle check as above
DELETE /playlists/:id              removes carousels that used it from dashboards; response lists them
POST   /playlists/reorder          { ids: [...] }
```

## Viewer data (same basic auth; read-only routes the viewer SPA uses)

```
GET /view/dashboard/:id            → { dashboard, visualizations: {...}, playlists: {...} } everything the viewer needs in one call, depth-limited
GET /view/playlist/:id             → { playlist, items resolved (viz configs, dashboard layouts to depth 1) }
GET /view/viz/:id                  → { visualization }
GET /view/viz/:id/data             same as /visualizations/:id/data, read-only, viewer auth
```

The viewer HTML routes (`/view/dashboard/:id` etc., no `/api` prefix) return the
SPA shell; the SPA calls the routes above.

## Log, health, settings

```
GET  /log                          ?ok=0&since=&gutnumber_id=&limit=     poll_log across numbers
GET  /health                       { ok, db: true, daemon_heartbeat_age_s, failing: n, version }
GET  /settings                     daily_hour, weekly_day, palette
PUT  /settings                     same keys
GET  /whoami                       { user } from X-Forwarded-User
GET  /export                       { gutnumbers, visualizations, dashboards, playlists } definitions only, no samples
POST /import                       same shape; upserts by slug/title; dry_run=1 reports what would change
```

## Bookmarklet endpoint (optional, D5)

```
GET /bookmarklet/picker.js         built IIFE of the picker
GET /bookmarklet                   page with the drag-to-bookmarks link
```

The bookmarklet's API calls use `fetch(..., { credentials: 'include' })`; the
browser attaches the cached basic-auth credentials, and the server answers CORS
preflights for `POST /gutnumbers` and `POST /preview` by echoing the page's
origin with `Access-Control-Allow-Credentials: true`.
