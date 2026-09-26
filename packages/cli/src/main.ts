import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadConfig, openDb, listGutnumbers, getGutnumber, createGutnumber, updateGutnumber, deleteGutnumber, exportAll, importAll, backupDb, insertSamples,
  type ExportData,
} from '@gut/db';
import { PollContext, pollGutnumber, previewFetch, testHelper, listHelpers, getHelper, normalizeParams, loadCredentials, loadPrivateHelpers } from '@gut/fetch';
import { formatValue, canonicalUrl, FREQUENCIES, type BundleInput, type Frequency } from '@gut/shared';

const HELP = `gut — gutnumber command line

  gut list                                  all numbers with last value and status
  gut poll <id|slug> [--dry-run]            poll one number now (records unless --dry-run)
  gut preview <url> (--prefix T | --css S | --regex R) [--proxy] [--browser]
                                            test-fetch a URL with a selector, nothing saved
  gut add --url U --label L (--prefix T | --css S | --regex R)
          [--frequency daily] [--fetcher http|browser] [--proxy] [--unit U] [--pick first|last|largest]
  gut helpers                               list helpers and their params
  gut test-helper <name> key=value ...      run a helper once
  gut add-helper <name> --label L [--frequency hourly] [--unit U] key=value ...
  gut enable|disable <id|slug>
  gut delete <id|slug>
  gut export [file]                         definitions only (no samples) as JSON
  gut import <file> [--dry-run]             upsert definitions by slug/title
  gut import-samples <id|slug> <file.json>  [[ts, value], ...] or [{ts|t, value}, ...] history
  gut backup                                online SQLite backup into $GUTNUMBER_DATA_DIR/backups

Environment: GUTNUMBER_DATA_DIR, GUTNUMBER_PRIVATE_DIR (see .env.example).`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    url: { type: 'string' }, label: { type: 'string' }, prefix: { type: 'string' }, css: { type: 'string' }, regex: { type: 'string' },
    frequency: { type: 'string' }, fetcher: { type: 'string' }, proxy: { type: 'boolean' }, browser: { type: 'boolean' },
    unit: { type: 'string' }, pick: { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
});

const [cmd, ...args] = positionals;
const config = loadConfig();
const db = openDb(config.dbPath);
const credentialsFor = loadCredentials(config.privateDir);
const ctx = () => new PollContext({ config, credentialsFor });
await loadPrivateHelpers(config.privateDir, (m) => console.error(m));

const die = (m: string): never => {
  console.error(`error: ${m}`);
  process.exit(1);
};
const kv = (list: string[]) => Object.fromEntries(list.filter((a) => a.includes('=')).map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));

function bundleFromFlags(): BundleInput {
  const selectors: BundleInput['selectors'] = [];
  if (opt.css) selectors.push({ type: 'CssSelector', value: String(opt.css) });
  if (opt.prefix) selectors.push({ type: 'TextQuoteSelector', exact: '', prefix: String(opt.prefix) });
  if (opt.regex) selectors.push({ type: 'RegexSource', pattern: String(opt.regex), group: 1 });
  if (!selectors.length) die('give at least one of --prefix, --css, --regex');
  return { version: 1, selectors, parser: { pick: String(opt.pick ?? 'first'), thousands: ',', decimal: '.', suffixes: true } };
}

function freq(): Frequency {
  const f = String(opt.frequency ?? 'daily');
  if (!(FREQUENCIES as readonly string[]).includes(f)) die(`frequency must be one of ${FREQUENCIES.join(', ')}`);
  return f as Frequency;
}

async function run() {
  if (!cmd || cmd === 'help' || opt.help) return console.log(HELP);
  switch (cmd) {
    case 'list': {
      const rows = listGutnumbers(db);
      if (!rows.length) return console.log('(no numbers yet)');
      for (const g of rows) {
        const when = g.last_polled_at ? new Date(g.last_polled_at * 1000).toLocaleString() : 'never';
        console.log(`${String(g.id).padStart(4)}  ${g.status.padEnd(8)} ${g.frequency.padEnd(6)} ${formatValue(g.last_value, g.unit, g.decimals).padStart(16)}  ${g.slug}  (${when})`);
      }
      return;
    }
    case 'poll': {
      const g = getGutnumber(db, args[0] ?? '') ?? die(`no number ${args[0]}`);
      const c = ctx();
      let r;
      if (opt['dry-run']) r = await pollGutnumber(g, c);
      else {
        const { Daemon, SqliteStore } = await import('@gut/daemon');
        const d = new Daemon({ config, store: new SqliteStore(db), credentialsFor, browser: c.browser, log: () => {} });
        r = await d.pollOne(g, c); // records exactly as the daemon would
      }
      console.log(JSON.stringify({ ...r, html: r.html ? `(${r.html.length} bytes)` : undefined, screenshot: undefined }, null, 2));
      if (!opt['dry-run']) console.error('recorded.');
      await c.browser.close();
      return;
    }
    case 'preview': {
      const url = canonicalUrl(args[0] ?? die('url required'));
      const r = await previewFetch(ctx(), { url, bundle: bundleFromFlags(), proxy: opt.proxy ? 'residential' : 'none', strategies: opt.browser ? ['browser'] : ['http', 'browser'] });
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case 'add': {
      const url = canonicalUrl(String(opt.url ?? die('--url required')));
      const bundle = bundleFromFlags();
      const c = ctx();
      const pv = await previewFetch(c, { url, bundle, proxy: opt.proxy ? 'residential' : 'none', strategies: opt.fetcher === 'browser' ? ['browser'] : ['http', 'browser'] });
      for (const r of pv.results) console.error(`  ${r.strategy}: ${r.ok ? `${r.value} via ${r.selector}` : `${r.error_class} ${r.message ?? ''}`}`);
      const fetcher = (opt.fetcher as 'http' | 'browser' | undefined) ?? pv.recommended_fetcher ?? 'http';
      const g = createGutnumber(db, { label: String(opt.label ?? die('--label required')), url, fetcher, bundle, proxy: opt.proxy ? 'residential' : 'none', frequency: freq(), unit: opt.unit ? String(opt.unit) : null });
      console.log(`created #${g.id} ${g.slug} (${g.fetcher}, ${g.frequency})`);
      await c.browser.close();
      return;
    }
    case 'helpers': {
      for (const h of listHelpers()) {
        console.log(`${h.name} — ${h.title}\n  ${h.description}`);
        for (const p of h.params) console.log(`    ${p.key}${p.required ? '*' : ''} (${p.type}${p.options ? ': ' + p.options.map((o) => o.value).join('|') : ''})${p.default !== undefined ? ` default ${p.default}` : ''}${p.help ? ` — ${p.help}` : ''}`);
      }
      return;
    }
    case 'test-helper': {
      const r = await testHelper(ctx(), args[0] ?? die('helper name required'), kv(args.slice(1)));
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case 'add-helper': {
      const h = getHelper(args[0] ?? '') ?? die(`unknown helper ${args[0]}`);
      const params = normalizeParams(h, kv(args.slice(1)));
      const t = await testHelper(ctx(), h.name, params);
      console.error(t.ok ? `  test: ${t.value} (${t.raw})` : `  test failed: ${t.message}`);
      const s = h.suggest?.(params) ?? {};
      const label = String(opt.label ?? s.label ?? die('--label required'));
      const g = createGutnumber(db, { label, fetcher: 'helper', helper_name: h.name, helper_params: params, frequency: opt.frequency ? freq() : (s.frequency ?? 'daily'), unit: opt.unit ? String(opt.unit) : (s.unit ?? null) });
      console.log(`created #${g.id} ${g.slug} (helper ${h.name}, ${g.frequency})`);
      return;
    }
    case 'enable':
    case 'disable': {
      const g = updateGutnumber(db, args[0] ?? die('id required'), { enabled: cmd === 'enable' });
      console.log(`${g.slug}: ${g.status}`);
      return;
    }
    case 'delete': {
      const r = deleteGutnumber(db, args[0] ?? die('id required'));
      console.log(`deleted; removed from visualizations: ${r.affected_visualizations.join(', ') || 'none'}`);
      return;
    }
    case 'export': {
      const out = JSON.stringify(exportAll(db), null, 2);
      if (args[0]) writeFileSync(args[0], out + '\n');
      else console.log(out);
      return;
    }
    case 'import': {
      const data = JSON.parse(readFileSync(args[0] ?? die('file required'), 'utf8')) as ExportData;
      console.log(JSON.stringify(importAll(db, data, !!opt['dry-run']), null, 2));
      return;
    }
    case 'import-samples': {
      const g = getGutnumber(db, args[0] ?? '') ?? die(`no number ${args[0]}`);
      const rows = JSON.parse(readFileSync(args[1] ?? die('file required'), 'utf8')) as Array<[number, number] | { ts?: number; t?: string | number; value: number }>;
      const norm = rows.map((r) => (Array.isArray(r) ? { ts: r[0], value: r[1] } : { ts: typeof r.ts === 'number' ? r.ts : Math.floor(Date.parse(String(r.t)) / 1000), value: Number(r.value) })).filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.value));
      console.log(`imported ${insertSamples(db, g.id, norm)} samples into ${g.slug}`);
      return;
    }
    case 'backup': {
      const dest = join(config.dataDir, 'backups', `gutnumber-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.sqlite`);
      await backupDb(db, dest);
      console.log(dest);
      return;
    }
    default:
      die(`unknown command "${cmd}" (try: gut help)`);
  }
}

try {
  await run();
} catch (e) {
  die((e as Error).message);
} finally {
  db.close();
}
process.exit(0);
