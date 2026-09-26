import type { Transform } from './schemas/index.js';
import { zonedParts, zonedToUtc } from './schedule.js';

export type Point = [number, number]; // [ts seconds, value]

const PRESET_SECONDS: Record<string, number> = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400, '90d': 90 * 86400, '1y': 365 * 86400 };

export function rangeWindow(range: { preset: string } | { from: string; to?: string }, now: number, firstTs: number | null): { from: number; to: number } {
  if ('preset' in range) {
    if (range.preset === 'all') return { from: firstTs ?? now - 86400, to: now };
    return { from: now - (PRESET_SECONDS[range.preset] ?? 7 * 86400), to: now };
  }
  const from = Math.floor(Date.parse(range.from) / 1000);
  const to = range.to ? Math.floor(Date.parse(range.to) / 1000) : now;
  return { from: Number.isFinite(from) ? from : now - 7 * 86400, to: Number.isFinite(to) ? to : now };
}

/** Local-calendar bucket start for ts. */
export function bucketStart(ts: number, unit: 'hour' | 'day' | 'week', tz: string): number {
  if (unit === 'hour') {
    const p = zonedParts(ts, tz);
    return zonedToUtc(p.y, p.m, p.d, p.h, 0, tz);
  }
  const p = zonedParts(ts, tz);
  if (unit === 'day') return zonedToUtc(p.y, p.m, p.d, 0, 0, tz);
  const back = (p.wd + 6) % 7; // Monday start
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d - back));
  return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, tz);
}

export function applyTransform(points: Point[], t: Transform, tz: string): Point[] {
  switch (t.kind) {
    case 'raw':
      return points;
    case 'delta': {
      const out: Point[] = [];
      for (let i = 1; i < points.length; i++) out.push([points[i][0], points[i][1] - points[i - 1][1]]);
      return out;
    }
    case 'running_avg': {
      const out: Point[] = [];
      let sum = 0;
      for (let i = 0; i < points.length; i++) {
        sum += points[i][1];
        if (i >= t.window) sum -= points[i - t.window][1];
        const n = Math.min(i + 1, t.window);
        out.push([points[i][0], sum / n]);
      }
      return out;
    }
    case 'bucket': {
      const groups = new Map<number, number[]>();
      for (const [ts, v] of points) {
        const b = bucketStart(ts, t.unit, tz);
        let g = groups.get(b);
        if (!g) groups.set(b, (g = []));
        g.push(v);
      }
      return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([b, vs]) => [b, aggregate(vs, t.agg)]);
    }
  }
}

export function aggregate(vs: number[], agg: 'avg' | 'min' | 'max' | 'last' | 'sum'): number {
  switch (agg) {
    case 'avg':
      return vs.reduce((a, b) => a + b, 0) / vs.length;
    case 'min':
      return Math.min(...vs);
    case 'max':
      return Math.max(...vs);
    case 'sum':
      return vs.reduce((a, b) => a + b, 0);
    case 'last':
      return vs[vs.length - 1];
  }
}

const NICE = [60, 300, 900, 1800, 3600, 7200, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 2 * 86400, 7 * 86400, 14 * 86400, 30 * 86400];

/** Average into equal-width buckets when there are more than maxPoints; keeps the final point exact. */
export function downsample(points: Point[], maxPoints: number, from: number, to: number): { points: Point[]; bucket: number } {
  if (points.length <= maxPoints) return { points, bucket: 0 };
  const want = (to - from) / maxPoints;
  const bucket = NICE.find((n) => n >= want) ?? Math.ceil(want);
  const groups = new Map<number, { sum: number; n: number; last: number }>();
  for (const [ts, v] of points) {
    const b = Math.floor(ts / bucket) * bucket;
    const g = groups.get(b);
    if (g) {
      g.sum += v;
      g.n++;
      g.last = v;
    } else groups.set(b, { sum: v, n: 1, last: v });
  }
  const out: Point[] = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([b, g]) => [b, g.sum / g.n]);
  const last = points[points.length - 1];
  out.push(last);
  return { points: out, bucket };
}
