import type { Bundle, SelectorType } from './selectors/types.js';
import type { Frequency } from './schedule.js';
import type { VizConfig, DashboardLayout, DashboardOptions, PlaylistItem } from './schemas/index.js';

export type Fetcher = 'http' | 'browser' | 'helper';
export type GutStatus = 'new' | 'ok' | 'drifted' | 'failing' | 'disabled';
export type ErrorClass = 'timeout' | 'http_error' | 'bot_wall' | 'selector_miss' | 'parse_fail' | 'helper_error' | 'suspect' | 'network';

export interface Gutnumber {
  id: number;
  slug: string;
  label: string;
  url: string | null;
  host: string | null;
  fetcher: Fetcher;
  bundle: Bundle | null;
  helper_name: string | null;
  helper_params: Record<string, unknown> | null;
  proxy: 'none' | 'residential';
  frequency: Frequency;
  enabled: boolean;
  color: string;
  unit: string | null;
  decimals: number;
  notes: string | null;
  next_due_at: number | null;
  poll_now: boolean;
  running_since: number | null;
  last_polled_at: number | null;
  last_value: number | null;
  last_raw: string | null;
  last_strategy: string | null;
  last_error: string | null;
  consecutive_failures: number;
  status: GutStatus;
  created_at: number;
  updated_at: number;
}

export interface Sample {
  ts: number;
  value: number;
  raw?: string | null;
  strategy?: string | null;
}

export interface PollLogRow {
  id: number;
  gutnumber_id: number;
  ts: number;
  ok: boolean;
  error_class: ErrorClass | null;
  message: string | null;
  http_status: number | null;
  strategy: string | null;
  fetcher: string | null;
  duration_ms: number | null;
  proxy_used: boolean;
}

export interface Visualization {
  id: number;
  title: string;
  config: VizConfig;
  carousel_seconds: number;
  created_at: number;
  updated_at: number;
}

export interface Dashboard {
  id: number;
  title: string;
  sort_order: number;
  layout: DashboardLayout;
  options: DashboardOptions;
  created_at: number;
  updated_at: number;
}

export interface Playlist {
  id: number;
  title: string;
  sort_order: number;
  items: PlaylistItem[];
  created_at: number;
  updated_at: number;
}

export interface SeriesData {
  gutnumber_id: number;
  label: string;
  color: string;
  unit: string | null;
  decimals: number;
  invert: boolean;
  axis: 'left' | 'right';
  points: Array<[number, number]>;
  latest: { ts: number; value: number } | null;
}

export interface VizData {
  series: SeriesData[];
  range: { from: number; to: number };
  bucket_seconds: number;
}

export type { SelectorType };
