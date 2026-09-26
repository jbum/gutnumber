import { fetch as ufetch, ProxyAgent, type Dispatcher } from 'undici';
import { FetchError, asFetchError } from './errors.js';
import { detectBotWall } from './botwall.js';
import { basicHeader, type SiteCredential } from './credentials.js';

export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export interface HttpOptions {
  proxy?: string | (() => string | null) | null;
  credential?: SiteCredential | null;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  accept?: 'html' | 'json' | 'any';
  /** Skip bot-wall detection (APIs). */
  raw?: boolean;
}

export interface HttpResult {
  status: number;
  body: string;
  finalUrl: string;
  contentType: string;
  proxyUsed: boolean;
  durationMs: number;
}

const ACCEPT = {
  html: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  json: 'application/json,text/plain;q=0.9,*/*;q=0.5',
  any: '*/*',
};

const agents = new Map<string, Dispatcher>();
function agentFor(proxy: string): Dispatcher {
  // Session-specific proxy URLs are one-shot; keep the cache small.
  if (agents.size > 32) agents.clear();
  let a = agents.get(proxy);
  if (!a) agents.set(proxy, (a = new ProxyAgent(proxy)));
  return a;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with browser-like headers, optional residential proxy and site credentials, retries on transient errors. */
export async function httpGet(url: string, o: HttpOptions = {}): Promise<HttpResult> {
  const retries = o.retries ?? 3;
  let last: FetchError | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt) await sleep(1000 * 2 ** (attempt - 1));
    const proxy = typeof o.proxy === 'function' ? o.proxy() : (o.proxy ?? null);
    const started = Date.now();
    try {
      const headers: Record<string, string> = {
        'user-agent': BROWSER_UA,
        accept: ACCEPT[o.accept ?? 'html'],
        'accept-language': 'en-US,en;q=0.9',
        ...(o.headers ?? {}),
      };
      if (o.credential) headers.authorization = basicHeader(o.credential);
      const res = await ufetch(url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
        dispatcher: proxy ? agentFor(proxy) : undefined,
      });
      const body = await res.text();
      const result: HttpResult = {
        status: res.status,
        body,
        finalUrl: res.url || url,
        contentType: res.headers.get('content-type') ?? '',
        proxyUsed: !!proxy,
        durationMs: Date.now() - started,
      };
      if (!o.raw) {
        const wall = detectBotWall(body, res.status);
        if (wall) throw new FetchError('bot_wall', wall, res.status);
      }
      if (res.status === 401) throw new FetchError('http_error', 'HTTP 401: this host needs credentials (add it to credentials.json)', 401);
      if (res.status >= 400) {
        const err = new FetchError('http_error', `HTTP ${res.status}`, res.status);
        if (res.status === 429 || res.status >= 500) {
          last = err;
          continue;
        }
        throw err;
      }
      return result;
    } catch (e) {
      const fe = asFetchError(e);
      // Retry only transient failures; bot walls get a fresh proxy session from the caller.
      if (fe.errorClass === 'timeout' || fe.errorClass === 'network') {
        last = fe;
        continue;
      }
      throw fe;
    }
  }
  throw last ?? new FetchError('network', 'request failed');
}

export async function httpJson<T = unknown>(url: string, o: HttpOptions = {}): Promise<T> {
  const r = await httpGet(url, { accept: 'json', raw: true, ...o });
  try {
    return JSON.parse(r.body) as T;
  } catch {
    throw new FetchError('parse_fail', `expected JSON from ${new URL(url).host}, got ${r.contentType || 'text'}`);
  }
}
