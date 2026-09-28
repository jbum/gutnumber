# Gutnumber — Data Model

SQLite, WAL mode. Migrations in `packages/db/migrations/NNN_*.sql`, applied at
startup by server and daemon using `PRAGMA user_version`. JSON columns are
validated by zod schemas in `packages/shared/src/schemas/` (the single source of
truth for shapes; TypeScript types are inferred from them).

## Tables

```sql
CREATE TABLE gutnumbers (
  id                    INTEGER PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,          -- "amz-rank-sudoku-vol1"; auto, editable
  label                 TEXT NOT NULL,
  url                   TEXT,                          -- NULL for helper-based numbers
  host                  TEXT,                          -- derived from url, for politeness + grouping
  fetcher               TEXT NOT NULL CHECK (fetcher IN ('http','browser','helper')),
  bundle_json           TEXT,                          -- SELECTORS.md §1; NULL for helpers
  helper_name           TEXT,                          -- when fetcher='helper'
  helper_params_json    TEXT,                          -- validated against the helper's params
  proxy                 TEXT NOT NULL DEFAULT 'none' CHECK (proxy IN ('none','residential')),
  frequency             TEXT NOT NULL CHECK (frequency IN ('5m','hourly','daily','weekly')),
  enabled               INTEGER NOT NULL DEFAULT 1,
  color                 TEXT NOT NULL,                 -- "#RRGGBB", assigned from palette at creation
  unit                  TEXT,                          -- display suffix/prefix: \"views\", \"#\", \"$\", \"%\"
  decimals              INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT,
  -- runtime state (written by daemon)
  next_due_at           INTEGER,                       -- unix seconds
  poll_now              INTEGER NOT NULL DEFAULT 0,
  running_since         INTEGER,                       -- claim marker; cleared on finish; stale claims (>10 min) are reclaimed
  last_polled_at        INTEGER,
  last_value            REAL,
  last_raw              TEXT,
  last_strategy         TEXT,
  last_error            TEXT,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','ok','drifted','failing','disabled')),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX gutnumbers_due ON gutnumbers (enabled, next_due_at);

CREATE TABLE samples (
  id            INTEGER PRIMARY KEY,
  gutnumber_id  INTEGER NOT NULL REFERENCES gutnumbers(id) ON DELETE CASCADE,
  ts            INTEGER NOT NULL,                      -- unix seconds
  value         REAL NOT NULL,
  raw           TEXT,                                  -- text the value was parsed from (helpers: JSON snippet)
  strategy      TEXT                                   -- CssSelector | XPathSelector | TextQuoteSelector | RegexSource | helper
);
CREATE INDEX samples_by_number_ts ON samples (gutnumber_id, ts);

CREATE TABLE poll_log (
  id            INTEGER PRIMARY KEY,
  gutnumber_id  INTEGER NOT NULL REFERENCES gutnumbers(id) ON DELETE CASCADE,
  ts            INTEGER NOT NULL,
  ok            INTEGER NOT NULL,
  error_class   TEXT,                                  -- timeout | http_error | bot_wall | selector_miss | parse_fail | helper_error | suspect
  message       TEXT,
  http_status   INTEGER,
  strategy      TEXT,
  fetcher       TEXT,                                  -- which strategy actually ran (after fallback)
  duration_ms   INTEGER,
  proxy_used    INTEGER
);
CREATE INDEX poll_log_ts ON poll_log (ts);
CREATE INDEX poll_log_by_number ON poll_log (gutnumber_id, ts);
-- pruned nightly: DELETE FROM poll_log WHERE ts < now - 30d

CREATE TABLE visualizations (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  config_json   TEXT NOT NULL,                         -- VizConfig, below
  carousel_seconds INTEGER NOT NULL DEFAULT 20,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE dashboards (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  layout_json   TEXT NOT NULL,                         -- DashboardLayout, below
  options_json  TEXT NOT NULL DEFAULT '{}',            -- DashboardOptions
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE playlists (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  items_json    TEXT NOT NULL,                         -- PlaylistItem[]
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);
-- keys: daemon_heartbeat (unix seconds), daily_hour, weekly_day, palette.
-- No credentials live in the DB: auth is Apache basic auth (ARCHITECTURE §11).
```

Referential integrity between JSON configs and rows (a viz referring to a
deleted gutnumber, a playlist to a deleted dashboard) is handled in the app
layer: deleting a gutnumber removes it from every viz's `series`; deleting a viz
or dashboard removes it from playlists and dashboards. Deletes confirm in the UI
and list what else will be touched.

## JSON shapes (zod in `shared/src/schemas/`)

```ts
type Frequency = '5m' | 'hourly' | 'daily' | 'weekly';

interface VizConfig {
  v: 1;
  type: 'line' | 'bar' | 'area' | 'step' | 'stat';   // 'stat' = big latest value + delta
  range: { preset: '24h'|'7d'|'30d'|'90d'|'1y'|'all' } | { from: string; to?: string };
  series: Array<{
    gutnumber_id: number;
    label?: string;                                   // defaults to gutnumber label
    color?: string;                                   // defaults to gutnumber color
    transform: { kind: 'raw' }
             | { kind: 'delta' }                      // change since previous sample (counters → rate)
             | { kind: 'running_avg'; window: number }
             | { kind: 'bucket'; unit: 'hour'|'day'|'week'; agg: 'avg'|'min'|'max'|'last'|'sum' };
    axis?: 'left' | 'right';
    invert?: boolean;                                 // sales rank: lower is better, draw it upward
  }>;
  annotations: Array<{                              // dated notes drawn as dashed vertical lines (default [])
    at: string;                                     // 'YYYY-MM-DD' (local midnight) or 'YYYY-MM-DDTHH:MM' (local time)
    label: string;                                  // 1-120 chars, e.g. 'Scraper: top 100 from here'
  }>;
  options: {
    subtitle?: string;
    legend: boolean;
    y_from_zero: boolean;
    log_scale: boolean;
    show_latest: boolean;                             // overlay latest value(s)
    points: number;                                   // max points per series after downsampling (default 600)
  };
}

interface DashboardLayout {
  v: 1;
  columns: 12;
  items: Array<
    | { id: string; kind: 'viz';      viz_id: number;      x: number; y: number; w: number; h: number }
    | { id: string; kind: 'carousel'; playlist_id: number; x: number; y: number; w: number; h: number; seconds?: number }
    | { id: string; kind: 'clock';    format: '12h'|'24h'; show_date: boolean; x: number; y: number; w: number; h: number }
    | { id: string; kind: 'text';     markdown: string;  x: number; y: number; w: number; h: number }
    | { id: string; kind: 'image';    url: string; fit: 'contain'|'cover'; x: number; y: number; w: number; h: number }
  >;
}

interface DashboardOptions {
  theme: 'light' | 'dark' | 'eink';
  show_title: boolean;
  refresh_seconds: number;                            // data refresh in the viewer (default 300)
}

type PlaylistItem =
  | { kind: 'viz';       viz_id: number;       seconds?: number }   // defaults to viz.carousel_seconds
  | { kind: 'dashboard'; dashboard_id: number; seconds: number };
```

## Files beside the DB (`$GUTNUMBER_DATA_DIR`)

- `gutnumber.sqlite` (+ `-wal`, `-shm`)
- `pages/<gutnumber_id>.html.gz`: last successfully fetched page per number, for selector repair
- `failures/<gutnumber_id>-<ts>.png`: browser-fetch failure screenshots, kept 7 days
- `backups/gutnumber-YYYY-MM-DD.sqlite`: nightly, keep 14
- `chromium/`: Puppeteer download cache

## Derived queries worth naming

- **Due numbers** (daemon): `enabled = 1 AND (poll_now = 1 OR next_due_at <= ?)
  AND (running_since IS NULL OR running_since < ? - 600)` ordered by
  `poll_now DESC, next_due_at`.
- **Sparkline**: last 50 samples for a number.
- **Series data**: bucketed by `(ts / bucket_seconds) * bucket_seconds`, choosing
  `bucket_seconds` from range and `points`.
- **Cycle check**: load all dashboards' carousel playlist ids and all playlists'
  dashboard ids into two maps, DFS from the node being saved.

## Sizing

100 numbers, all at 5 min: 28,800 samples/day, ~10.5 M/year, ~600 MB/year with
raw text. Realistic mixes (mostly daily/hourly) are far smaller. Nightly backup
copies the whole file; if it grows past a few GB, add a monthly rollup table and
prune raw 5-minute samples older than a year. Not needed now.
