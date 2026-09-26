import type { Browser } from 'puppeteer';
import { FetchError, asFetchError } from './errors.js';
import { detectBotWall } from './botwall.js';
import { basicHeader, type SiteCredential } from './credentials.js';
import { splitProxy } from './proxy.js';
import { BROWSER_UA } from './http.js';

export interface BrowserFetchOptions {
  proxy?: string | null;
  credential?: SiteCredential | null;
  /** CSS selector to wait for (the bundle's primary selector), best effort. */
  waitFor?: string | null;
  timeoutMs?: number;
  screenshot?: boolean;
}

export interface BrowserResult {
  status: number;
  html: string;
  finalUrl: string;
  proxyUsed: boolean;
  durationMs: number;
  screenshot?: Buffer;
}

const BLOCKED = new Set(['image', 'media', 'font']);
const RECYCLE_AFTER = 100;

/** One shared headless Chromium, recycled every RECYCLE_AFTER pages to contain leaks. */
export class BrowserPool {
  private browser: Promise<Browser> | null = null;
  private pages = 0;
  private active = 0;

  private async get(): Promise<Browser> {
    if (this.browser && this.pages >= RECYCLE_AFTER && this.active === 0) {
      const old = this.browser;
      this.browser = null;
      this.pages = 0;
      (await old).close().catch(() => {});
    }
    if (!this.browser) {
      const { default: puppeteer } = await import('puppeteer');
      const args = ['--disable-dev-shm-usage', '--disable-gpu', '--mute-audio', '--no-first-run'];
      if (process.platform === 'linux') args.push('--no-sandbox');
      this.browser = puppeteer.launch({ headless: true, args, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined });
      this.browser.then((b) => b.on('disconnected', () => (this.browser = null))).catch(() => (this.browser = null));
    }
    return this.browser;
  }

  async fetch(url: string, o: BrowserFetchOptions = {}): Promise<BrowserResult> {
    const started = Date.now();
    const timeout = o.timeoutMs ?? 30_000;
    this.active++;
    this.pages++;
    const browser = await this.get();
    const proxy = o.proxy ? splitProxy(o.proxy) : null;
    const ctx = await browser.createBrowserContext(proxy ? { proxyServer: proxy.server } : {});
    try {
      const page = await ctx.newPage();
      await page.setUserAgent({ userAgent: BROWSER_UA });
      await page.setViewport({ width: 1280, height: 900 });
      if (proxy?.username) await page.authenticate({ username: proxy.username, password: proxy.password ?? '' });
      const siteHost = new URL(url).hostname;
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.isInterceptResolutionHandled()) return;
        if (BLOCKED.has(req.resourceType())) return void req.abort().catch(() => {});
        if (o.credential) {
          let h = '';
          try {
            h = new URL(req.url()).hostname;
          } catch {
            /* data: urls */
          }
          if (h === siteHost) return void req.continue({ headers: { ...req.headers(), authorization: basicHeader(o.credential) } }).catch(() => {});
        }
        req.continue().catch(() => {});
      });
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      await page.waitForNetworkIdle({ idleTime: 800, timeout: Math.min(12_000, timeout) }).catch(() => {});
      if (o.waitFor) await page.waitForSelector(o.waitFor, { timeout: 5_000 }).catch(() => {});
      const html = await page.content();
      const status = res?.status() ?? 0;
      const shot = o.screenshot ? Buffer.from(await page.screenshot({ type: 'jpeg', quality: 40 })) : undefined;
      const wall = detectBotWall(html, status);
      if (wall) throw Object.assign(new FetchError('bot_wall', wall, status), { screenshot: shot });
      if (status === 401) throw new FetchError('http_error', 'HTTP 401: this host needs credentials (add it to credentials.json)', 401);
      if (status >= 400) throw Object.assign(new FetchError('http_error', `HTTP ${status}`, status), { screenshot: shot });
      return { status, html, finalUrl: page.url(), proxyUsed: !!proxy, durationMs: Date.now() - started, screenshot: shot };
    } catch (e) {
      throw asFetchError(e);
    } finally {
      this.active--;
      await ctx.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    if (this.browser) (await this.browser).close().catch(() => {});
    this.browser = null;
  }
}
