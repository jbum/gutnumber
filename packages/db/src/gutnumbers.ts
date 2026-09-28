import {
  GutnumberCreateSchema,
  GutnumberPatchSchema,
  canonicalUrl,
  nextDue,
  paletteColor,
  slugify,
  type Gutnumber,
  type GutnumberCreate,
  type GutnumberPatch,
  type ScheduleOptions,
} from '@gut/shared';
import { now, type DB } from './open.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export function rowToGutnumber(r: Row): Gutnumber {
  return {
    id: r.id,
    slug: r.slug,
    label: r.label,
    url: r.url,
    host: r.host,
    fetcher: r.fetcher,
    bundle: r.bundle_json ? JSON.parse(r.bundle_json) : null,
    helper_name: r.helper_name,
    helper_params: r.helper_params_json ? JSON.parse(r.helper_params_json) : null,
    proxy: r.proxy,
    frequency: r.frequency,
    enabled: !!r.enabled,
    color: r.color,
    unit: r.unit,
    decimals: r.decimals,
    notes: r.notes,
    next_due_at: r.next_due_at,
    poll_now: !!r.poll_now,
    running_since: r.running_since,
    last_polled_at: r.last_polled_at,
    last_value: r.last_value,
    last_raw: r.last_raw,
    last_strategy: r.last_strategy,
    last_error: r.last_error,
    consecutive_failures: r.consecutive_failures,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function uniqueSlug(db: DB, base: string, exceptId?: number): string {
  const b = slugify(base);
  const taken = (s: string) => {
    const r = db.prepare('SELECT id FROM gutnumbers WHERE slug = ?').get(s) as { id: number } | undefined;
    return !!r && r.id !== exceptId;
  };
  if (!taken(b)) return b;
  for (let i = 2; ; i++) if (!taken(`${b}-${i}`)) return `${b}-${i}`;
}

export class NotFound extends Error {}
export class Conflict extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
  }
}

export function getGutnumber(db: DB, idOrSlug: number | string): Gutnumber | null {
  const r =
    typeof idOrSlug === 'number' || /^\d+$/.test(String(idOrSlug))
      ? db.prepare('SELECT * FROM gutnumbers WHERE id = ?').get(Number(idOrSlug))
      : db.prepare('SELECT * FROM gutnumbers WHERE slug = ?').get(String(idOrSlug));
  return r ? rowToGutnumber(r as Row) : null;
}

export function mustGetGutnumber(db: DB, idOrSlug: number | string): Gutnumber {
  const g = getGutnumber(db, idOrSlug);
  if (!g) throw new NotFound(`gutnumber ${idOrSlug} not found`);
  return g;
}

export interface ListFilter {
  status?: string;
  host?: string;
  q?: string;
}

export function listGutnumbers(db: DB, f: ListFilter = {}): Gutnumber[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.status) {
    where.push('status = ?');
    args.push(f.status);
  }
  if (f.host) {
    where.push('host = ?');
    args.push(f.host);
  }
  if (f.q) {
    where.push('(label LIKE ? OR slug LIKE ? OR url LIKE ?)');
    const q = `%${f.q}%`;
    args.push(q, q, q);
  }
  const sql = `SELECT * FROM gutnumbers ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY label COLLATE NOCASE`;
  return (db.prepare(sql).all(...args) as Row[]).map(rowToGutnumber);
}

export function createGutnumber(db: DB, input: GutnumberCreate): Gutnumber {
  const v = GutnumberCreateSchema.parse(input);
  const t = now();
  const url = v.url ? canonicalUrl(v.url) : null;
  const count = (db.prepare('SELECT COUNT(*) AS n FROM gutnumbers').get() as { n: number }).n;
  const slug = v.slug ? uniqueSlug(db, v.slug) : uniqueSlug(db, v.label);
  const info = db
    .prepare(
      `INSERT INTO gutnumbers (slug,label,url,host,fetcher,bundle_json,helper_name,helper_params_json,proxy,frequency,enabled,color,unit,decimals,notes,next_due_at,poll_now,status,created_at,updated_at)
       VALUES (@slug,@label,@url,@host,@fetcher,@bundle_json,@helper_name,@helper_params_json,@proxy,@frequency,@enabled,@color,@unit,@decimals,@notes,@next_due_at,1,@status,@t,@t)`,
    )
    .run({
      slug,
      label: v.label,
      url,
      host: hostOf(url),
      fetcher: v.fetcher,
      bundle_json: v.bundle ? JSON.stringify(v.bundle) : null,
      helper_name: v.fetcher === 'helper' ? v.helper_name : null,
      helper_params_json: v.helper_params ? JSON.stringify(v.helper_params) : null,
      proxy: v.proxy,
      frequency: v.frequency,
      enabled: v.enabled ? 1 : 0,
      color: v.color ?? paletteColor(count),
      unit: v.unit ?? null,
      decimals: v.decimals,
      notes: v.notes ?? null,
      next_due_at: t,
      status: v.enabled ? 'new' : 'disabled',
      t,
    });
  return getGutnumber(db, Number(info.lastInsertRowid))!;
}

export function updateGutnumber(db: DB, idOrSlug: number | string, patch: GutnumberPatch, sched?: ScheduleOptions): Gutnumber {
  const cur = mustGetGutnumber(db, idOrSlug);
  const p = GutnumberPatchSchema.parse(patch);
  const sets: string[] = [];
  const args: Record<string, unknown> = { id: cur.id, t: now() };
  const set = (col: string, val: unknown) => {
    sets.push(`${col} = @${col}`);
    args[col] = val;
  };
  if (p.label !== undefined) set('label', p.label);
  if (p.slug !== undefined && p.slug !== cur.slug) {
    const clash = db.prepare('SELECT id FROM gutnumbers WHERE slug = ? AND id != ?').get(p.slug, cur.id);
    if (clash) throw new Conflict(`slug "${p.slug}" is already used`);
    set('slug', p.slug);
  }
  if (p.url !== undefined) {
    const u = p.url ? canonicalUrl(p.url) : null;
    set('url', u);
    set('host', hostOf(u));
  }
  if (p.fetcher !== undefined) set('fetcher', p.fetcher);
  if (p.bundle !== undefined) set('bundle_json', p.bundle ? JSON.stringify(p.bundle) : null);
  if (p.helper_name !== undefined) set('helper_name', p.helper_name);
  if (p.helper_params !== undefined) set('helper_params_json', p.helper_params ? JSON.stringify(p.helper_params) : null);
  if (p.proxy !== undefined) set('proxy', p.proxy);
  if (p.color !== undefined) set('color', p.color);
  if (p.unit !== undefined) set('unit', p.unit);
  if (p.decimals !== undefined) set('decimals', p.decimals);
  if (p.notes !== undefined) set('notes', p.notes);
  if (p.frequency !== undefined && p.frequency !== cur.frequency) {
    set('frequency', p.frequency);
    if (sched) set('next_due_at', nextDue(p.frequency, now(), sched, cur.id));
  }
  if (p.enabled !== undefined && p.enabled !== cur.enabled) {
    set('enabled', p.enabled ? 1 : 0);
    if (p.enabled) {
      set('status', cur.last_value == null ? 'new' : 'ok');
      set('consecutive_failures', 0);
      set('poll_now', 1);
    } else set('status', 'disabled');
  }
  // Selector edits re-arm a poll so the result shows up quickly.
  if (p.bundle !== undefined || p.url !== undefined || p.helper_params !== undefined || p.fetcher !== undefined) set('poll_now', 1);
  if (!sets.length) return cur;
  db.prepare(`UPDATE gutnumbers SET ${sets.join(', ')}, updated_at = @t WHERE id = @id`).run(args);
  return mustGetGutnumber(db, cur.id);
}

/** Deletes the number and removes it from every visualization's series. Returns affected viz ids. */
export function deleteGutnumber(db: DB, idOrSlug: number | string): { affected_visualizations: number[] } {
  const g = mustGetGutnumber(db, idOrSlug);
  const affected: number[] = [];
  db.transaction(() => {
    for (const v of db.prepare('SELECT id, config_json FROM visualizations').all() as Row[]) {
      const cfg = JSON.parse(v.config_json);
      const before = cfg.series?.length ?? 0;
      cfg.series = (cfg.series ?? []).filter((s: { gutnumber_id: number }) => s.gutnumber_id !== g.id);
      if (cfg.series.length !== before) {
        affected.push(v.id);
        db.prepare('UPDATE visualizations SET config_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(cfg), now(), v.id);
      }
    }
    db.prepare('DELETE FROM gutnumbers WHERE id = ?').run(g.id);
  })();
  return { affected_visualizations: affected };
}

export function requestPoll(db: DB, idOrSlug: number | string): void {
  const g = mustGetGutnumber(db, idOrSlug);
  db.prepare('UPDATE gutnumbers SET poll_now = 1 WHERE id = ?').run(g.id);
}

// ---- daemon side (the Store interface, D6) --------------------------------

export const STALE_CLAIM_SECONDS = 600;

/** Atomically claim up to `limit` due numbers. */
export function claimDue(db: DB, t: number, limit: number): Gutnumber[] {
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT * FROM gutnumbers
         WHERE enabled = 1 AND (poll_now = 1 OR next_due_at IS NULL OR next_due_at <= @t)
           AND (running_since IS NULL OR running_since < @stale)
         ORDER BY poll_now DESC, next_due_at LIMIT @limit`,
      )
      .all({ t, stale: t - STALE_CLAIM_SECONDS, limit }) as Row[];
    const mark = db.prepare('UPDATE gutnumbers SET running_since = ?, poll_now = 0 WHERE id = ?');
    for (const r of rows) mark.run(t, r.id);
    return rows.map(rowToGutnumber);
  })();
}

export interface PollRecord {
  ts: number;
  ok: boolean;
  value?: number;
  raw?: string | null;
  strategy?: string | null;
  error_class?: string | null;
  message?: string | null;
  http_status?: number | null;
  fetcher?: string | null;
  duration_ms?: number | null;
  proxy_used?: boolean;
  suspect?: boolean;
  /** Dated samples from a history helper, recorded instead of one sample at `ts` (D20). */
  samples?: Array<{ ts: number; value: number; raw?: string | null }>;
}

export interface RecordOutcome {
  status: Gutnumber['status'];
  becameFailing: boolean;
  recovered: boolean;
}

export const FAILING_AFTER = 10;
const DRIFT_WINDOW = 3;

export function recordPoll(db: DB, g: Gutnumber, rec: PollRecord, next_due_at: number): RecordOutcome {
  return db.transaction(() => {
    db.prepare(
      `INSERT INTO poll_log (gutnumber_id, ts, ok, error_class, message, http_status, strategy, fetcher, duration_ms, proxy_used)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      g.id,
      rec.ts,
      rec.ok ? 1 : 0,
      rec.ok ? (rec.suspect ? 'suspect' : null) : (rec.error_class ?? 'network'),
      rec.message ?? null,
      rec.http_status ?? null,
      rec.strategy ?? null,
      rec.fetcher ?? null,
      rec.duration_ms ?? null,
      rec.proxy_used ? 1 : 0,
    );
    const cur = mustGetGutnumber(db, g.id);
    if (rec.ok && (rec.value !== undefined || rec.samples)) {
      const ins = db.prepare('INSERT INTO samples (gutnumber_id, ts, value, raw, strategy) VALUES (?,?,?,?,?)');
      if (rec.samples) for (const s of rec.samples) ins.run(g.id, s.ts, s.value, truncate(s.raw ?? null, 4000), rec.strategy ?? null);
      else ins.run(g.id, rec.ts, rec.value, truncate(rec.raw, 4000), rec.strategy ?? null);
      const status = computeStatus(db, cur);
      // A history poll with nothing new keeps the last value.
      const value = rec.value ?? cur.last_value;
      const raw = rec.value !== undefined ? truncate(rec.raw, 4000) : cur.last_raw;
      db.prepare(
        `UPDATE gutnumbers SET running_since = NULL, last_polled_at = ?, last_value = ?, last_raw = ?, last_strategy = ?, last_error = NULL,
           consecutive_failures = 0, status = ?, next_due_at = ? WHERE id = ?`,
      ).run(rec.ts, value, raw, rec.strategy ?? null, status, next_due_at, g.id);
      return { status, becameFailing: false, recovered: cur.status === 'failing' };
    }
    const failures = cur.consecutive_failures + 1;
    const status = failures >= FAILING_AFTER ? 'failing' : cur.status === 'new' ? 'new' : cur.status === 'failing' ? 'failing' : cur.status;
    db.prepare(
      `UPDATE gutnumbers SET running_since = NULL, last_polled_at = ?, last_error = ?, consecutive_failures = ?, status = ?, next_due_at = ? WHERE id = ?`,
    ).run(rec.ts, `${rec.error_class ?? 'error'}: ${rec.message ?? ''}`.slice(0, 1000), failures, status, next_due_at, g.id);
    return { status: status as Gutnumber['status'], becameFailing: status === 'failing' && cur.status !== 'failing', recovered: false };
  })();
}

/** 'drifted' when the last few successes all came from a fallback selector type. */
function computeStatus(db: DB, g: Gutnumber): Gutnumber['status'] {
  if (!g.enabled) return 'disabled';
  const primary = g.bundle?.selectors?.[0]?.type;
  if (!primary || g.fetcher === 'helper') return 'ok';
  const recent = db
    .prepare('SELECT strategy FROM samples WHERE gutnumber_id = ? ORDER BY ts DESC LIMIT ?')
    .all(g.id, DRIFT_WINDOW) as Array<{ strategy: string | null }>;
  if (recent.length >= DRIFT_WINDOW && recent.every((r) => r.strategy && r.strategy !== primary)) return 'drifted';
  return 'ok';
}

function truncate(s: string | null | undefined, n: number) {
  return s == null ? null : s.length > n ? s.slice(0, n) : s;
}

/** Clear claims left behind by a crashed daemon. */
export function releaseClaims(db: DB): void {
  db.prepare('UPDATE gutnumbers SET running_since = NULL WHERE running_since IS NOT NULL').run();
}
