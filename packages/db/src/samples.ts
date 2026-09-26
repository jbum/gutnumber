import type { DB } from './open.js';
import type { Sample, PollLogRow } from '@gut/shared';

export function getSamples(db: DB, gutnumberId: number, from: number, to: number): Sample[] {
  return db
    .prepare('SELECT ts, value, raw, strategy FROM samples WHERE gutnumber_id = ? AND ts >= ? AND ts <= ? ORDER BY ts')
    .all(gutnumberId, from, to) as Sample[];
}

/** (ts, value) only, for charting. */
export function getPoints(db: DB, gutnumberId: number, from: number, to: number): Array<[number, number]> {
  return (db.prepare('SELECT ts, value FROM samples WHERE gutnumber_id = ? AND ts >= ? AND ts <= ? ORDER BY ts').raw().all(gutnumberId, from, to) as Array<[number, number]>);
}

export function lastSamples(db: DB, gutnumberId: number, n: number): Array<[number, number]> {
  const rows = db.prepare('SELECT ts, value FROM samples WHERE gutnumber_id = ? ORDER BY ts DESC LIMIT ?').raw().all(gutnumberId, n) as Array<[number, number]>;
  return rows.reverse();
}

export function lastSample(db: DB, gutnumberId: number): { ts: number; value: number } | null {
  return (db.prepare('SELECT ts, value FROM samples WHERE gutnumber_id = ? ORDER BY ts DESC LIMIT 1').get(gutnumberId) as { ts: number; value: number } | undefined) ?? null;
}

export function previousValue(db: DB, gutnumberId: number): number | null {
  const r = db.prepare('SELECT value FROM samples WHERE gutnumber_id = ? ORDER BY ts DESC LIMIT 1').get(gutnumberId) as { value: number } | undefined;
  return r?.value ?? null;
}

export function firstSampleTs(db: DB, ids: number[]): number | null {
  if (!ids.length) return null;
  const r = db.prepare(`SELECT MIN(ts) AS t FROM samples WHERE gutnumber_id IN (${ids.map(() => '?').join(',')})`).get(...ids) as { t: number | null };
  return r.t;
}

export function deleteSample(db: DB, gutnumberId: number, ts: number): number {
  return db.prepare('DELETE FROM samples WHERE gutnumber_id = ? AND ts = ?').run(gutnumberId, ts).changes;
}

export function insertSamples(db: DB, gutnumberId: number, rows: Array<{ ts: number; value: number; raw?: string | null; strategy?: string | null }>): number {
  const st = db.prepare('INSERT INTO samples (gutnumber_id, ts, value, raw, strategy) VALUES (?,?,?,?,?)');
  return db.transaction(() => {
    for (const r of rows) st.run(gutnumberId, r.ts, r.value, r.raw ?? null, r.strategy ?? 'import');
    return rows.length;
  })();
}

// ---- poll log ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toLog = (r: any): PollLogRow & { label?: string; slug?: string } => ({ ...r, ok: !!r.ok, proxy_used: !!r.proxy_used });

export interface LogQuery {
  gutnumber_id?: number;
  problems?: boolean; // ok=0 or flagged
  since?: number;
  limit?: number;
}

export function queryLog(db: DB, q: LogQuery = {}) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.gutnumber_id) {
    where.push('l.gutnumber_id = ?');
    args.push(q.gutnumber_id);
  }
  if (q.problems) where.push('(l.ok = 0 OR l.error_class IS NOT NULL)');
  if (q.since) {
    where.push('l.ts >= ?');
    args.push(q.since);
  }
  const limit = Math.min(q.limit ?? 200, 2000);
  return (
    db
      .prepare(
        `SELECT l.*, g.label, g.slug FROM poll_log l JOIN gutnumbers g ON g.id = l.gutnumber_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.ts DESC, l.id DESC LIMIT ${limit}`,
      )
      .all(...args) as unknown[]
  ).map(toLog);
}

export function prunePollLog(db: DB, olderThan: number): number {
  return db.prepare('DELETE FROM poll_log WHERE ts < ?').run(olderThan).changes;
}
