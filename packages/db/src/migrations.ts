/** Numbered migrations; index + 1 = PRAGMA user_version after applying. */
export const MIGRATIONS: string[] = [
  /* 001_init */ `
CREATE TABLE gutnumbers (
  id                    INTEGER PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,
  label                 TEXT NOT NULL,
  url                   TEXT,
  host                  TEXT,
  fetcher               TEXT NOT NULL CHECK (fetcher IN ('http','browser','helper')),
  bundle_json           TEXT,
  helper_name           TEXT,
  helper_params_json    TEXT,
  proxy                 TEXT NOT NULL DEFAULT 'none' CHECK (proxy IN ('none','residential')),
  frequency             TEXT NOT NULL CHECK (frequency IN ('5m','hourly','daily','weekly')),
  enabled               INTEGER NOT NULL DEFAULT 1,
  color                 TEXT NOT NULL,
  unit                  TEXT,
  decimals              INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT,
  next_due_at           INTEGER,
  poll_now              INTEGER NOT NULL DEFAULT 0,
  running_since         INTEGER,
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
  ts            INTEGER NOT NULL,
  value         REAL NOT NULL,
  raw           TEXT,
  strategy      TEXT
);
CREATE INDEX samples_by_number_ts ON samples (gutnumber_id, ts);

CREATE TABLE poll_log (
  id            INTEGER PRIMARY KEY,
  gutnumber_id  INTEGER NOT NULL REFERENCES gutnumbers(id) ON DELETE CASCADE,
  ts            INTEGER NOT NULL,
  ok            INTEGER NOT NULL,
  error_class   TEXT,
  message       TEXT,
  http_status   INTEGER,
  strategy      TEXT,
  fetcher       TEXT,
  duration_ms   INTEGER,
  proxy_used    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX poll_log_ts ON poll_log (ts);
CREATE INDEX poll_log_by_number ON poll_log (gutnumber_id, ts);

CREATE TABLE visualizations (
  id               INTEGER PRIMARY KEY,
  title            TEXT NOT NULL,
  config_json      TEXT NOT NULL,
  carousel_seconds INTEGER NOT NULL DEFAULT 20,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE dashboards (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  layout_json   TEXT NOT NULL,
  options_json  TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE playlists (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  items_json    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);
`,
];
