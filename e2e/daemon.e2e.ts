import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { loadConfig, openDb, createGutnumber, getGutnumber, queryLog, type DB, type Config } from '@gut/db';
import { credentialLookup, BrowserPool } from '@gut/fetch';
import { Daemon, SqliteStore } from '@gut/daemon';
import { startFixtureSite, type FixtureSite } from '../scripts/fixture-site';

let site: FixtureSite;
let db: DB;
let config: Config;
let daemon: Daemon;
let clock = 1_900_000_000;
const browser = new BrowserPool();

const TQ = (prefix: string) => ({ type: 'TextQuoteSelector' as const, exact: '', prefix });

beforeAll(async () => {
  site = await startFixtureSite();
  const dir = mkdtempSync(join(tmpdir(), 'gut-e2e-'));
  process.env.GUT_HN_API_BASE = `${site.url}/hn`;
  process.env.TYPESAFE_BASE_URL = `${site.url}/typesafe`;
  config = loadConfig({ dataDir: dir, dbPath: join(dir, 'gutnumber.sqlite'), privateDir: null, typesafeApiKey: 'test-key', tz: 'UTC', httpConcurrency: 4, browserConcurrency: 1 });
  db = openDb(config.dbPath);
  daemon = new Daemon({
    config,
    store: new SqliteStore(db),
    credentialsFor: credentialLookup({ '127.0.0.1': { type: 'basic', user: 'test', pass: 'secret' } }),
    browser,
    clock: () => clock,
    log: () => {},
  });
  // The fixture host is local; no politeness gap needed in tests.
  (daemon.limits.gate as unknown as { gapFor: () => number }).gapFor = () => 0;
});

afterAll(async () => {
  await browser.close();
  db?.close();
  await site?.close();
});

async function tickUntilPolled(ids: number[]) {
  await daemon.tick();
  return ids.map((id) => getGutnumber(db, id)!);
}

describe('daemon end to end', () => {
  it('polls an http page, records a sample, schedules the next poll', async () => {
    const g = createGutnumber(db, { label: 'Blog visitors', url: `${site.url}/page/blog-stats.html`, fetcher: 'http', frequency: 'hourly', bundle: { version: 1, selectors: [{ type: 'CssSelector', value: 'table.stats-table td.num' }, TQ('Visitors ')] } });
    const [after] = await tickUntilPolled([g.id]);
    expect(after).toMatchObject({ status: 'ok', last_value: 4812, last_strategy: 'CssSelector', consecutive_failures: 0 });
    expect(after.next_due_at).toBeGreaterThan(clock);
    expect(existsSync(join(config.dataDir, 'pages', `${g.id}.html.gz`))).toBe(true);
  });

  it('same URL is fetched once per tick for several numbers (D12)', async () => {
    const before = site.hits['page:amazon-bullets.html'] ?? 0;
    const url = `${site.url}/page/amazon-bullets.html`;
    const a = createGutnumber(db, { label: 'Overall rank', url, fetcher: 'http', frequency: 'daily', bundle: { version: 1, selectors: [TQ('Best Sellers Rank: ')] } });
    const b = createGutnumber(db, { label: 'Sudoku rank', url, fetcher: 'http', frequency: 'daily', bundle: { version: 1, selectors: [{ type: 'RegexSource', pattern: '#(\\d+) in <a[^>]*>Sudoku', group: 1 }] } });
    const [ra, rb] = await tickUntilPolled([a.id, b.id]);
    expect(ra.last_value).toBe(12345);
    expect(rb.last_value).toBe(17);
    expect(site.hits['page:amazon-bullets.html'] - before).toBe(1);
  });

  it('marks a number drifted after a redesign but keeps tracking the value', async () => {
    const base = `${site.url}/page/amazon-table.html`;
    const g = createGutnumber(db, { label: 'Table rank', url: base, fetcher: 'http', frequency: '5m', bundle: { version: 1, selectors: [{ type: 'CssSelector', value: '#productDetails_detailBullets_sections1 tr:nth-of-type(3) td' }, TQ('Best Sellers Rank ')] } });
    await tickUntilPolled([g.id]);
    expect(getGutnumber(db, g.id)).toMatchObject({ status: 'ok', last_value: 48211, last_strategy: 'CssSelector' });
    db.prepare('UPDATE gutnumbers SET url = ? WHERE id = ?').run(`${base}?drift=1&value=50000`, g.id);
    for (let i = 0; i < 3; i++) {
      clock += 400;
      db.prepare('UPDATE gutnumbers SET poll_now = 1 WHERE id = ?').run(g.id);
      await daemon.tick();
    }
    expect(getGutnumber(db, g.id)).toMatchObject({ status: 'drifted', last_value: 50000, last_strategy: 'TextQuoteSelector' });
  });

  it('bot wall: http fails, falls back to the browser, logs the class', async () => {
    const g = createGutnumber(db, { label: 'Walled', url: `${site.url}/page/amazon-bullets.html?fail=captcha`, fetcher: 'http', frequency: 'daily', bundle: { version: 1, selectors: [TQ('Best Sellers Rank: ')] } });
    const [after] = await tickUntilPolled([g.id]);
    expect(after.consecutive_failures).toBe(1);
    expect(after.last_error).toMatch(/^bot_wall/);
    const log = queryLog(db, { gutnumber_id: g.id });
    expect(log[0]).toMatchObject({ ok: false, error_class: 'bot_wall', fetcher: 'browser' });
    // retry is backed off, not at the next daily slot
    expect(after.next_due_at! - clock).toBe(900);
    expect(readdirSync(join(config.dataDir, 'failures')).some((f) => f.startsWith(`${g.id}-`))).toBe(true);
  });

  it('browser fetcher reads a JavaScript-rendered number', async () => {
    const g = createGutnumber(db, { label: 'JS downloads', url: `${site.url}/js-rendered?value=98765`, fetcher: 'browser', frequency: 'daily', bundle: { version: 1, selectors: [{ type: 'CssSelector', value: '#dl' }] } });
    const [after] = await tickUntilPolled([g.id]);
    expect(after).toMatchObject({ status: 'ok', last_value: 98765 });
  });

  it('json_api helper with basic-auth credentials and sum aggregation', async () => {
    const g = createGutnumber(db, { label: 'Human hits', fetcher: 'helper', helper_name: 'json_api', helper_params: { url: `${site.url}/json/stats`, path: '$.series[*].hits.human', agg: 'sum' }, frequency: 'hourly' });
    const [after] = await tickUntilPolled([g.id]);
    expect(after).toMatchObject({ status: 'ok', last_value: 42 });
  });

  it('hn_topic_count: one HN fetch shared by topics, one Jev call each', async () => {
    const hn0 = site.hits.hn ?? 0;
    const jev0 = site.hits.jev ?? 0;
    const ai = createGutnumber(db, { label: 'HN AI', fetcher: 'helper', helper_name: 'hn_topic_count', helper_params: { topic: 'AI (artificial intelligence)' }, frequency: 'daily' });
    const an = createGutnumber(db, { label: 'HN Anthropic', fetcher: 'helper', helper_name: 'hn_topic_count', helper_params: { topic: 'Anthropic or Claude' }, frequency: 'daily' });
    const [a, b] = await tickUntilPolled([ai.id, an.id]);
    expect(a.last_value).toBe(2); // "tiny AI agent", "AI chips"
    expect(b.last_value).toBe(1);
    expect(JSON.parse(a.last_raw!).matched.map((m: { title: string }) => m.title)).toContain('AI chips are getting cheaper');
    expect(site.hits.hn - hn0).toBe(1);
    expect(site.hits.jev - jev0).toBe(2);
  });

  it('the CLI polls a number by slug', async () => {
    // async exec: this process serves the fixture site, so it must not block
    const { stdout } = await run('npx', ['tsx', 'packages/cli/src/main.ts', 'poll', 'blog-visitors', '--dry-run'], { env: { ...process.env, GUTNUMBER_DATA_DIR: config.dataDir, GUTNUMBER_PRIVATE_DIR: '' } });
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, value: 4812 });
  });

  it('nightly maintenance prunes and backs up', async () => {
    expect(await daemon.maintenance(true)).toBe(true);
    expect(readdirSync(join(config.dataDir, 'backups')).length).toBe(1);
  });
});
