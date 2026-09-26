/** Poll scheduling. All times are unix seconds. */

export const FREQUENCIES = ['5m', 'hourly', 'daily', 'weekly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_SECONDS: Record<Frequency, number> = { '5m': 300, hourly: 3600, daily: 86400, weekly: 604800 };

export interface ScheduleOptions {
  dailyHour: number; // 0-23 local
  weeklyDay: number; // 0=Sun … 6=Sat
  tz: string; // IANA zone
}

const JITTER_RANGE: Record<Frequency, number> = { '5m': 20, hourly: 90, daily: 180, weekly: 180 };

/** Deterministic per-number jitter so a hundred numbers do not fire in the same second. */
export function jitterFor(id: number, freq: Frequency): number {
  return ((id * 7919) % 1000) % JITTER_RANGE[freq];
}

interface ZonedParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  wd: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(ts: number, tz: string): ZonedParts {
  const parts = Object.fromEntries(fmt(tz).formatToParts(new Date(ts * 1000)).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    mi: Number(parts.minute),
    s: Number(parts.second),
    wd: WD[parts.weekday as string],
  };
}

/** Offset (seconds) of `tz` from UTC at instant ts: local = utc + offset. */
function tzOffset(ts: number, tz: string): number {
  const p = zonedParts(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) / 1000 - ts;
}

/** Unix seconds for a local wall-clock time in tz (DST gaps resolve forward). */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi) / 1000;
  let ts = guess - tzOffset(guess, tz);
  const off2 = tzOffset(ts, tz);
  ts = guess - off2;
  return ts;
}

function addDays(y: number, m: number, d: number, n: number) {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** Next scheduled poll strictly after `now`. */
export function nextDue(freq: Frequency, now: number, opts: ScheduleOptions, id = 0): number {
  const j = jitterFor(id, freq);
  switch (freq) {
    case '5m':
    case 'hourly': {
      const step = FREQUENCY_SECONDS[freq];
      let t = Math.floor(now / step) * step + j;
      while (t <= now) t += step;
      return t;
    }
    case 'daily':
    case 'weekly': {
      const p = zonedParts(now, opts.tz);
      let ahead = 0;
      if (freq === 'weekly') ahead = (opts.weeklyDay - p.wd + 7) % 7;
      for (let tries = 0; tries < 3; tries++) {
        const day = addDays(p.y, p.m, p.d, ahead);
        const t = zonedToUtc(day.y, day.m, day.d, opts.dailyHour, 0, opts.tz) + j;
        if (t > now) return t;
        ahead += freq === 'weekly' ? 7 : 1;
      }
      return now + FREQUENCY_SECONDS[freq];
    }
  }
}

/** Retry time after `failures` consecutive failures: min(frequency, 15 min × 2^(n-1)). */
export function retryAt(freq: Frequency, now: number, failures: number): number {
  const backoff = 900 * 2 ** Math.max(0, Math.min(failures - 1, 10));
  return now + Math.min(FREQUENCY_SECONDS[freq], backoff);
}
