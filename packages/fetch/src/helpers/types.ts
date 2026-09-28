import type { CredentialLookup } from '../credentials.js';
import type { HttpOptions, HttpResult } from '../http.js';
import type { Config } from '@gut/db';

export type HelperParamType = 'string' | 'number' | 'select' | 'boolean' | 'text';

export interface HelperParam {
  key: string;
  label: string;
  type: HelperParamType;
  required?: boolean;
  default?: string | number | boolean;
  help?: string;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export interface HelperResult {
  value: number;
  /** Human-readable or JSON detail stored with the sample. */
  raw: string;
}

/** One timestamped value a helper reconstructs from its source's own history. */
export interface HistoryPoint {
  ts: number;
  value: number;
  raw: string;
}

export interface HelperContext {
  config: Config;
  credentialsFor: CredentialLookup;
  /** Per-tick cache: helpers sharing a source fetch it once (D15). */
  cache: Map<string, Promise<unknown>>;
  http(url: string, o?: HttpOptions): Promise<HttpResult>;
  json<T = unknown>(url: string, o?: HttpOptions): Promise<T>;
  /** HTML of a page: http first, headless browser on a bot wall. `proxy` uses the residential proxy. */
  page(url: string, o?: { proxy?: boolean }): Promise<string>;
}

export interface Helper {
  name: string;
  title: string;
  description: string;
  params: HelperParam[];
  /** Suggested defaults for a new number made from this helper. */
  suggest?: (params: Record<string, unknown>) => { label?: string; unit?: string; frequency?: '5m' | 'hourly' | 'daily' | 'weekly' };
  fetch(params: Record<string, unknown>, ctx: HelperContext): Promise<HelperResult>;
  /**
   * Sources that keep their own dated history. Points newer than `since` (null = everything).
   * When present the daemon records these instead of one sample per poll, so a new number
   * backfills on its first poll and later polls add only what is new (D20).
   */
  history?(params: Record<string, unknown>, ctx: HelperContext, since: number | null): Promise<HistoryPoint[]>;
}

/** Cache a promise in the per-tick cache so concurrent callers share it. */
export function cached<T>(ctx: HelperContext, key: string, make: () => Promise<T>): Promise<T> {
  let p = ctx.cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = make();
    ctx.cache.set(key, p);
    p.catch(() => ctx.cache.delete(key));
  }
  return p;
}
