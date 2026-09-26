import { writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { nextDue, retryAt, zonedParts, formatValue, type Gutnumber, type ScheduleOptions } from '@gut/shared';
import { now, prunePollLog, backupDb, type Config } from '@gut/db';
import { BrowserPool, PollContext, pollGutnumber, makeLimits, pushover, loadCredentials, type Limits, type CredentialLookup, type PollResult } from '@gut/fetch';
import type { SqliteStore, Store } from './store.js';

export const TICK_MS = 15_000;
const MAX_IN_FLIGHT = 50;
const SUSPECT_RATIO = 1000;

export interface DaemonOptions {
  config: Config;
  store: Store;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  credentialsFor?: CredentialLookup;
  browser?: BrowserPool;
  limits?: Limits;
  /** Injected in tests. */
  clock?: () => number;
}

export class Daemon {
  readonly config: Config;
  readonly store: Store;
  readonly log: (msg: string, extra?: Record<string, unknown>) => void;
  readonly browser: BrowserPool;
  readonly limits: Limits;
  readonly credentialsFor: CredentialLookup;
  private clock: () => number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = new Set<Promise<unknown>>();
  private stopping = false;

  constructor(o: DaemonOptions) {
    this.config = o.config;
    this.store = o.store;
    this.log = o.log ?? ((m, x) => console.log(JSON.stringify({ t: new Date().toISOString(), msg: m, ...x })));
    this.browser = o.browser ?? new BrowserPool();
    this.limits = o.limits ?? makeLimits(o.config.httpConcurrency, o.config.browserConcurrency);
    this.credentialsFor = o.credentialsFor ?? loadCredentials(o.config.privateDir);
    this.clock = o.clock ?? now;
  }

  get schedule(): ScheduleOptions {
    return { dailyHour: this.config.dailyHour, weeklyDay: this.config.weeklyDay, tz: this.config.tz };
  }

  start(): void {
    this.store.releaseClaims();
    this.log('daemon started', { tz: this.config.tz, dailyHour: this.config.dailyHour, http: this.config.httpConcurrency, browser: this.config.browserConcurrency });
    const loop = async () => {
      if (this.stopping) return;
      try {
        this.tick();
        await this.maintenance();
      } catch (e) {
        this.log('tick error', { error: (e as Error).message });
      }
      if (!this.stopping) this.timer = setTimeout(loop, TICK_MS);
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await Promise.allSettled([...this.inFlight]);
    await this.browser.close();
    this.store.releaseClaims();
    this.log('daemon stopped');
  }

  /** Claim due numbers and start polling them. Returns the promise for this tick's jobs (tests await it). */
  tick(): Promise<void> {
    const t = this.clock();
    this.store.heartbeat(t);
    const room = MAX_IN_FLIGHT - this.inFlight.size;
    if (room <= 0) return Promise.resolve();
    const due = this.store.claimDue(t, room);
    if (!due.length) return Promise.resolve();
    // One context per tick: numbers sharing a URL share one fetch (D12).
    const ctx = new PollContext({ config: this.config, credentialsFor: this.credentialsFor, browser: this.browser, limits: this.limits, log: this.log });
    const jobs = due.map((g) => this.track(this.pollOne(g, ctx)));
    return Promise.allSettled(jobs).then(() => undefined);
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.inFlight.add(p);
    p.finally(() => this.inFlight.delete(p)).catch(() => {});
    return p;
  }

  async pollOne(g: Gutnumber, ctx: PollContext): Promise<PollResult> {
    let r: PollResult;
    try {
      r = await pollGutnumber(g, ctx);
    } catch (e) {
      r = { ok: false, fetcher: g.fetcher, error_class: 'network', message: (e as Error).message, duration_ms: 0, proxy_used: false, attempts: [] };
    }
    const t = this.clock();
    let suspect = false;
    if (r.ok && r.value !== undefined) {
      const prev = this.store.previousValue(g.id);
      if (prev && r.value && Math.max(Math.abs(r.value / prev), Math.abs(prev / r.value)) > SUSPECT_RATIO) suspect = true;
    }
    const next = r.ok ? nextDue(g.frequency, t, this.schedule, g.id) : retryAt(g.frequency, t, g.consecutive_failures + 1);
    const outcome = this.store.record(
      g,
      {
        ts: t,
        ok: r.ok,
        value: r.value,
        raw: r.raw,
        strategy: r.strategy,
        error_class: r.error_class,
        message: suspect ? `value jumped ${formatValue(this.store.previousValue(g.id))} → ${formatValue(r.value)}` : r.message,
        http_status: r.http_status,
        fetcher: r.fetcher,
        duration_ms: r.duration_ms,
        proxy_used: r.proxy_used,
        suspect,
      },
      next,
    );
    this.log(r.ok ? 'poll ok' : 'poll failed', { id: g.id, slug: g.slug, value: r.value, strategy: r.strategy, fetcher: r.fetcher, error: r.error_class, message: r.ok ? undefined : r.message, ms: r.duration_ms, attempts: r.attempts.join('>') });
    this.retain(g, r, t);
    if (outcome.becameFailing) void pushover(this.config, `gutnumber failing: ${g.label}`, `${r.error_class}: ${r.message}`, `${this.config.publicUrl}/#numbers/${g.id}`);
    if (outcome.recovered) void pushover(this.config, `gutnumber recovered: ${g.label}`, `value ${formatValue(r.value, g.unit, g.decimals)}`);
    return r;
  }

  /** Last fetched page for selector repair (D12); screenshot when a browser fetch failed. */
  private retain(g: Gutnumber, r: PollResult, t: number) {
    try {
      if (r.ok && r.html) writeFileSync(join(this.config.dataDir, 'pages', `${g.id}.html.gz`), gzipSync(r.html));
      if (!r.ok && r.screenshot) writeFileSync(join(this.config.dataDir, 'failures', `${g.id}-${t}.jpg`), r.screenshot);
    } catch (e) {
      this.log('retain failed', { id: g.id, error: (e as Error).message });
    }
  }

  /** Nightly: prune poll_log (30 d) and failure shots (7 d), back up the DB (keep 14). */
  async maintenance(force = false): Promise<boolean> {
    const t = this.clock();
    const p = zonedParts(t, this.config.tz);
    const day = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    if (!force && (p.h < 3 || this.store.getSetting('last_maintenance_day') === day)) return false;
    this.store.setSetting('last_maintenance_day', day);
    const db = (this.store as SqliteStore).db;
    const pruned = db ? prunePollLog(db, t - 30 * 86400) : 0;
    let shots = 0;
    const fdir = join(this.config.dataDir, 'failures');
    for (const f of readdirSync(fdir)) {
      const fp = join(fdir, f);
      if (statSync(fp).mtimeMs < (t - 7 * 86400) * 1000) {
        unlinkSync(fp);
        shots++;
      }
    }
    if (db) {
      const bdir = join(this.config.dataDir, 'backups');
      await backupDb(db, join(bdir, `gutnumber-${day}.sqlite`));
      const olds = readdirSync(bdir).filter((f) => /^gutnumber-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort().slice(0, -14);
      for (const f of olds) unlinkSync(join(bdir, f));
    }
    this.log('maintenance', { day, pruned, shots });
    return true;
  }
}
