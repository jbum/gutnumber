import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

export interface Config {
  dev: boolean;
  dataDir: string;
  privateDir: string | null;
  dbPath: string;
  port: number;
  host: string;
  publicUrl: string;
  tz: string;
  dailyHour: number;
  weeklyDay: number;
  proxyTemplate: string | null;
  proxyCountries: string[];
  browserConcurrency: number;
  httpConcurrency: number;
  youtubeApiKey: string | null;
  typesafeApiKey: string | null;
  clickySiteId: string | null;
  clickySitekey: string | null;
  pushoverUser: string | null;
  pushoverToken: string | null;
}

/** Minimal .env loader; never overrides variables already set. */
export function loadDotenv(path: string): boolean {
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return true;
}

const str = (k: string) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : null;
};
const int = (k: string, d: number) => {
  const v = str(k);
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

let cached: Config | null = null;

export function loadConfig(overrides: Partial<Config> = {}): Config {
  if (cached && !Object.keys(overrides).length) return cached;
  const pd = str('GUTNUMBER_PRIVATE_DIR');
  if (pd) loadDotenv(join(pd, '.env'));
  loadDotenv(resolve('.env'));
  const dev = process.env.GUTNUMBER_DEV === '1' || process.env.NODE_ENV === 'development';
  const dataDir = resolve(str('GUTNUMBER_DATA_DIR') ?? 'data');
  const cfg: Config = {
    dev,
    dataDir,
    privateDir: str('GUTNUMBER_PRIVATE_DIR') ? resolve(str('GUTNUMBER_PRIVATE_DIR')!) : null,
    dbPath: join(dataDir, 'gutnumber.sqlite'),
    port: int('PORT', 3100),
    host: str('HOST') ?? '127.0.0.1',
    publicUrl: str('PUBLIC_URL') ?? 'http://localhost:3100',
    tz: str('TZ') ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    dailyHour: int('DAILY_HOUR', 6),
    weeklyDay: int('WEEKLY_DAY', 1),
    proxyTemplate: str('PROXY_URL_TEMPLATE'),
    proxyCountries: (str('PROXY_COUNTRIES') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    browserConcurrency: int('BROWSER_CONCURRENCY', 1),
    httpConcurrency: int('HTTP_CONCURRENCY', 4),
    youtubeApiKey: str('YOUTUBE_API_KEY'),
    typesafeApiKey: str('TYPESAFE_API_KEY'),
    clickySiteId: str('CLICKY_SITE_ID'),
    clickySitekey: str('CLICKY_SITEKEY'),
    pushoverUser: str('PUSHOVER_USER'),
    pushoverToken: str('PUSHOVER_TOKEN'),
    ...overrides,
  };
  if (!overrides.dbPath) cfg.dbPath = join(cfg.dataDir, 'gutnumber.sqlite');
  for (const d of ['', 'pages', 'failures', 'backups']) mkdirSync(join(cfg.dataDir, d), { recursive: true });
  if (!Object.keys(overrides).length) cached = cfg;
  return cfg;
}
