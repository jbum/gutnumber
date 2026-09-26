import { parseHTML } from 'linkedom';
import { resolveBundle, type Bundle, type Gutnumber, type PerSelector, type ErrorClass } from '@gut/shared';
import type { Config } from '@gut/db';
import { httpGet, httpJson, type HttpOptions } from './http.js';
import { BrowserPool } from './browser.js';
import { FetchError, asFetchError } from './errors.js';
import { proxyUrl } from './proxy.js';
import type { CredentialLookup } from './credentials.js';
import { getHelper, normalizeParams } from './helpers/registry.js';
import type { HelperContext } from './helpers/types.js';
import { makeLimits, type Limits } from './limits.js';

export type PageFetcher = 'http' | 'browser';

export interface FetchedPage {
  html: string;
  status: number;
  finalUrl: string;
  fetcher: PageFetcher;
  proxyUsed: boolean;
  durationMs: number;
  screenshot?: Buffer;
  doc?: unknown;
}

export interface PollResult {
  ok: boolean;
  value?: number;
  raw?: string;
  strategy?: string;
  fetcher: string;
  http_status?: number | null;
  error_class?: ErrorClass;
  message?: string;
  duration_ms: number;
  proxy_used: boolean;
  perSelector?: PerSelector;
  /** Page the value was read from (retained for selector repair, D12). */
  html?: string;
  screenshot?: Buffer;
  attempts: string[];
}

export interface PollContextOptions {
  config: Config;
  credentialsFor: CredentialLookup;
  browser?: BrowserPool;
  /** Shared across ticks by the daemon; a preview gets its own. */
  limits?: Limits;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

/**
 * Everything a tick needs. One instance per daemon tick (or per preview):
 * the page cache means numbers sharing a URL are fetched once (D12), and
 * helpers sharing a source share one fetch (D15).
 */
export class PollContext {
  readonly config: Config;
  readonly credentialsFor: CredentialLookup;
  readonly browser: BrowserPool;
  readonly cache = new Map<string, Promise<unknown>>();
  readonly limits: Limits;
  readonly log: (msg: string, extra?: Record<string, unknown>) => void;

  constructor(o: PollContextOptions) {
    this.config = o.config;
    this.credentialsFor = o.credentialsFor;
    this.browser = o.browser ?? new BrowserPool();
    this.limits = o.limits ?? makeLimits(o.config.httpConcurrency, o.config.browserConcurrency);
    this.log = o.log ?? (() => {});
  }

  proxyFor(useProxy: boolean): (() => string | null) | null {
    if (!useProxy) return null;
    if (!this.config.proxyTemplate) throw new FetchError('network', 'residential proxy requested but PROXY_URL_TEMPLATE is not set');
    return () => proxyUrl(this.config.proxyTemplate, this.config.proxyCountries);
  }

  /** Fetch (or reuse) a page. `fresh` bypasses the cache (e.g. new proxy session after a bot wall). */
  page(url: string, fetcher: PageFetcher, useProxy: boolean, o: { fresh?: boolean; waitFor?: string | null; screenshot?: boolean } = {}): Promise<FetchedPage> {
    const key = `page:${fetcher}:${useProxy ? 'p' : 'd'}:${url}`;
    if (!o.fresh) {
      const hit = this.cache.get(key) as Promise<FetchedPage> | undefined;
      if (hit) return hit;
    }
    const credential = this.credentialsFor(url);
    const run = async (): Promise<FetchedPage> => {
      if (fetcher === 'http') {
        const r = await this.limits.http.run(async () => {
          await this.limits.gate.wait(url);
          return httpGet(url, { proxy: this.proxyFor(useProxy), credential });
        });
        return { html: r.body, status: r.status, finalUrl: r.finalUrl, fetcher, proxyUsed: r.proxyUsed, durationMs: r.durationMs };
      }
      const p = this.proxyFor(useProxy);
      const r = await this.limits.browser.run(async () => {
        await this.limits.gate.wait(url);
        return this.browser.fetch(url, { proxy: p ? p() : null, credential, waitFor: o.waitFor, screenshot: o.screenshot ?? true });
      });
      return { html: r.html, status: r.status, finalUrl: r.finalUrl, fetcher, proxyUsed: r.proxyUsed, durationMs: r.durationMs, screenshot: r.screenshot };
    };
    const p = run();
    this.cache.set(key, p);
    p.catch(() => this.cache.delete(key));
    return p;
  }

  helperContext(): HelperContext {
    return {
      config: this.config,
      credentialsFor: this.credentialsFor,
      cache: this.cache,
      http: (url: string, o?: HttpOptions) =>
        this.limits.http.run(async () => {
          await this.limits.gate.wait(url);
          return httpGet(url, { credential: this.credentialsFor(url), ...(o ?? {}) });
        }),
      json: <T>(url: string, o?: HttpOptions) =>
        this.limits.http.run(async () => {
          await this.limits.gate.wait(url);
          return httpJson<T>(url, { credential: this.credentialsFor(url), ...(o ?? {}) });
        }),
      page: async (url: string, o?: { proxy?: boolean }) => {
        try {
          return (await this.page(url, 'http', !!o?.proxy)).html;
        } catch (e) {
          const fe = asFetchError(e);
          if (fe.errorClass !== 'bot_wall') throw fe;
          return (await this.page(url, 'browser', !!o?.proxy, { screenshot: false })).html;
        }
      },
    };
  }
}

function docOf(page: FetchedPage) {
  if (!page.doc) page.doc = parseHTML(page.html).document;
  return page.doc;
}

function primaryCss(bundle: Bundle | null): string | null {
  const s = bundle?.selectors.find((x) => x.type === 'CssSelector');
  return s && s.type === 'CssSelector' ? s.value : null;
}

/** Resolve a bundle against a page; throws FetchError on miss. */
function readValue(page: FetchedPage, bundle: Bundle) {
  const r = resolveBundle(bundle, { doc: docOf(page), html: page.html });
  if (!r.ok) throw Object.assign(new FetchError(r.error, r.message, page.status), { perSelector: r.perSelector });
  return r;
}

const FALLBACK_TO_BROWSER = new Set<ErrorClass>(['bot_wall', 'selector_miss', 'parse_fail']);

/** Poll one gutnumber. Never throws: failures come back as { ok: false }. */
export async function pollGutnumber(g: Pick<Gutnumber, 'id' | 'url' | 'fetcher' | 'bundle' | 'proxy' | 'helper_name' | 'helper_params'>, ctx: PollContext): Promise<PollResult> {
  const started = Date.now();
  const attempts: string[] = [];
  const useProxy = g.proxy === 'residential';
  const done = (x: Omit<PollResult, 'duration_ms' | 'attempts'>): PollResult => ({ ...x, duration_ms: Date.now() - started, attempts });

  if (g.fetcher === 'helper') {
    const h = g.helper_name ? getHelper(g.helper_name) : null;
    if (!h) return done({ ok: false, fetcher: 'helper', error_class: 'helper_error', message: `unknown helper "${g.helper_name}"`, proxy_used: false });
    attempts.push(`helper:${h.name}`);
    try {
      const params = normalizeParams(h, g.helper_params ?? {});
      const r = await h.fetch(params, ctx.helperContext());
      if (!Number.isFinite(r.value)) throw new FetchError('parse_fail', `helper returned ${r.value}`);
      return done({ ok: true, value: r.value, raw: r.raw, strategy: 'helper', fetcher: 'helper', proxy_used: false });
    } catch (e) {
      const fe = e instanceof FetchError ? e : new FetchError('helper_error', (e as Error).message);
      return done({ ok: false, fetcher: 'helper', error_class: fe.errorClass, message: fe.message, http_status: fe.httpStatus ?? null, proxy_used: false });
    }
  }

  if (!g.url || !g.bundle) return done({ ok: false, fetcher: g.fetcher, error_class: 'helper_error', message: 'number has no url or selector bundle', proxy_used: false });
  const bundle = g.bundle;
  const plan: Array<{ fetcher: PageFetcher; fresh?: boolean }> = [{ fetcher: g.fetcher as PageFetcher }];
  let lastErr: FetchError | null = null;
  let lastPage: FetchedPage | null = null;
  let perSelector: PerSelector | undefined;
  let lastShot: Buffer | undefined;

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    attempts.push(`${step.fetcher}${step.fresh ? '(fresh)' : ''}`);
    try {
      const page = await ctx.page(g.url, step.fetcher, useProxy, { fresh: step.fresh, waitFor: primaryCss(bundle) });
      lastPage = page;
      const r = readValue(page, bundle);
      return done({ ok: true, value: r.value, raw: r.raw, strategy: r.strategy, fetcher: page.fetcher, http_status: page.status, proxy_used: page.proxyUsed, perSelector: r.perSelector, html: page.html });
    } catch (e) {
      const fe = asFetchError(e);
      perSelector = (e as { perSelector?: PerSelector }).perSelector ?? perSelector;
      lastErr = fe;
      const shot = (e as { screenshot?: Buffer }).screenshot;
      if (shot) lastShot = shot;
      else if (lastPage?.screenshot) lastShot = lastPage.screenshot;
      // A bot wall through the proxy: try once more with a fresh session (new IP).
      if (fe.errorClass === 'bot_wall' && useProxy && step.fetcher === 'http' && !step.fresh && !plan.some((s) => s.fresh)) plan.splice(i + 1, 0, { fetcher: 'http', fresh: true });
      // Then fall back from http to the browser once per cycle.
      if (FALLBACK_TO_BROWSER.has(fe.errorClass) && step.fetcher === 'http' && !plan.some((s) => s.fetcher === 'browser')) plan.push({ fetcher: 'browser' });
    }
  }
  return done({
    ok: false,
    fetcher: plan[plan.length - 1].fetcher,
    error_class: lastErr?.errorClass ?? 'network',
    message: lastErr?.message ?? 'failed',
    http_status: lastErr?.httpStatus ?? lastPage?.status ?? null,
    proxy_used: useProxy,
    perSelector,
    screenshot: lastShot,
  });
}
