import { applyTransform, downsample, rangeWindow, type VizConfig, type VizData, type SeriesData, type Point } from '@gut/shared';
import type { DB } from './open.js';
import { getGutnumber } from './gutnumbers.js';
import { firstSampleTs, getPoints } from './samples.js';

export interface VizDataOptions {
  tz: string;
  now?: number;
  points?: number;
  from?: number;
  to?: number;
}

/** Series for a visualization config: range → samples → transform → downsample. */
export function vizData(db: DB, config: VizConfig, o: VizDataOptions): VizData {
  const t = o.now ?? Math.floor(Date.now() / 1000);
  const ids = config.series.map((s) => s.gutnumber_id);
  const win = o.from != null ? { from: o.from, to: o.to ?? t } : rangeWindow(config.range, t, firstSampleTs(db, ids));
  const maxPoints = o.points ?? config.options?.points ?? 600;
  let bucketSeconds = 0;
  const series: SeriesData[] = [];
  for (const s of config.series) {
    const g = getGutnumber(db, s.gutnumber_id);
    if (!g) continue;
    // One sample of look-back so delta/running averages start cleanly at the window edge.
    const prev = db.prepare('SELECT ts, value FROM samples WHERE gutnumber_id = ? AND ts < ? ORDER BY ts DESC LIMIT 1').raw().get(g.id, win.from) as Point | undefined;
    let pts = getPoints(db, g.id, win.from, win.to);
    if (prev && (s.transform.kind === 'delta' || s.transform.kind === 'running_avg')) pts = [prev, ...pts];
    pts = applyTransform(pts, s.transform, o.tz);
    if (prev && s.transform.kind === 'running_avg') pts = pts.slice(1);
    const ds = downsample(pts, maxPoints, win.from, win.to);
    bucketSeconds = Math.max(bucketSeconds, ds.bucket);
    const last = pts[pts.length - 1];
    series.push({
      gutnumber_id: g.id,
      label: s.label || g.label,
      color: s.color || g.color,
      unit: s.transform.kind === 'raw' || s.transform.kind === 'running_avg' ? g.unit : g.unit,
      decimals: s.transform.kind === 'running_avg' || (s.transform.kind === 'bucket' && s.transform.agg === 'avg') ? Math.max(g.decimals, 1) : g.decimals,
      invert: !!s.invert,
      axis: s.axis ?? 'left',
      points: ds.points,
      latest: last ? { ts: last[0], value: last[1] } : null,
    });
  }
  return { series, range: win, bucket_seconds: bucketSeconds };
}
