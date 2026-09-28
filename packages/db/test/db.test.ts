import { describe, expect, it, beforeEach } from 'vitest';
import { openDb, createGutnumber, updateGutnumber, deleteGutnumber, getGutnumber, claimDue, recordPoll, createVisualization, createDashboard, createPlaylist, updateDashboard, updatePlaylist, deleteVisualization, deletePlaylist, getDashboard, getPlaylist, vizData, exportAll, importAll, listGutnumbers, insertSamples, getPoints, Conflict, type DB } from '@gut/db';

const bundle = { version: 1 as const, selectors: [{ type: 'CssSelector' as const, value: '#x' }, { type: 'TextQuoteSelector' as const, exact: '1', prefix: 'Rank: ' }] };
let db: DB;
beforeEach(() => {
  db = openDb(':memory:');
});

const mk = (label = 'Test number', extra = {}) => createGutnumber(db, { label, url: 'https://www.amazon.com/Some-Book/dp/B0ABCDEFGH/ref=x?utm_source=y', fetcher: 'http', bundle, frequency: 'daily', ...extra });

describe('gutnumbers', () => {
  it('creates with slug, canonical url, host, palette colour, due now', () => {
    const g = mk();
    expect(g).toMatchObject({ slug: 'test-number', url: 'https://www.amazon.com/dp/B0ABCDEFGH', host: 'amazon.com', status: 'new', poll_now: true });
    expect(g.color).toMatch(/^#/);
    expect(mk().slug).toBe('test-number-2');
  });
  it('validates', () => {
    expect(() => createGutnumber(db, { label: 'x', fetcher: 'http', frequency: 'daily' })).toThrow();
    expect(() => createGutnumber(db, { label: 'x', fetcher: 'helper', frequency: 'daily' })).toThrow();
  });
  it('patches, rejects slug clashes, toggles enabled', () => {
    const a = mk('A');
    mk('B');
    expect(() => updateGutnumber(db, a.id, { slug: 'b' })).toThrow(Conflict);
    expect(updateGutnumber(db, a.id, { enabled: false }).status).toBe('disabled');
    expect(updateGutnumber(db, 'a', { enabled: true }).status).toBe('new');
  });
  it('claims atomically and records success, drift and failure', () => {
    const g = mk();
    const t = 1_800_000_000;
    const claimed = claimDue(db, t, 10);
    expect(claimed.map((x) => x.id)).toEqual([g.id]);
    expect(claimDue(db, t, 10)).toEqual([]); // already running
    recordPoll(db, claimed[0], { ts: t, ok: true, value: 5, strategy: 'CssSelector' }, t + 86400);
    expect(getGutnumber(db, g.id)).toMatchObject({ status: 'ok', last_value: 5, running_since: null, next_due_at: t + 86400 });
    for (let i = 1; i <= 3; i++) recordPoll(db, getGutnumber(db, g.id)!, { ts: t + i, ok: true, value: 5 + i, strategy: 'TextQuoteSelector' }, t + 86400);
    expect(getGutnumber(db, g.id)!.status).toBe('drifted');
    let out;
    for (let i = 0; i < 10; i++) out = recordPoll(db, getGutnumber(db, g.id)!, { ts: t + 10 + i, ok: false, error_class: 'timeout', message: 'slow' }, t + 90000);
    expect(out!.becameFailing).toBe(true);
    expect(getGutnumber(db, g.id)).toMatchObject({ status: 'failing', consecutive_failures: 10 });
    const r = recordPoll(db, getGutnumber(db, g.id)!, { ts: t + 100, ok: true, value: 9, strategy: 'CssSelector' }, t + 99999);
    expect(r.recovered).toBe(true);
  });
  it('records dated samples from a history helper; an empty history keeps the last value', () => {
    const g = createGutnumber(db, { label: 'H', fetcher: 'helper', helper_name: 'x', frequency: 'daily' });
    const t = 1_800_000_000;
    recordPoll(db, g, { ts: t, ok: true, value: 20, raw: 'b', strategy: 'helper', samples: [{ ts: t - 200, value: 10, raw: 'a' }, { ts: t - 100, value: 20, raw: 'b' }] }, t + 86400);
    expect(getPoints(db, g.id, 0, t)).toEqual([[t - 200, 10], [t - 100, 20]]);
    recordPoll(db, getGutnumber(db, g.id)!, { ts: t + 50, ok: true, strategy: 'helper', samples: [] }, t + 86400);
    expect(getGutnumber(db, g.id)).toMatchObject({ status: 'ok', last_value: 20, last_raw: 'b', last_polled_at: t + 50 });
  });
});

describe('views, cascades and cycles', () => {
  it('delete cascades to viz series, playlists and dashboards', () => {
    const g = mk();
    const v = createVisualization(db, { title: 'V', config: { series: [{ gutnumber_id: g.id }] } });
    const p = createPlaylist(db, { title: 'P', items: [{ kind: 'viz', viz_id: v.id }] });
    const d = createDashboard(db, { title: 'D', layout: { items: [{ id: 'a', kind: 'viz', viz_id: v.id, x: 0, y: 0, w: 6, h: 4 }, { id: 'b', kind: 'carousel', playlist_id: p.id, x: 6, y: 0, w: 6, h: 4 }] } });
    expect(deleteGutnumber(db, g.id).affected_visualizations).toEqual([v.id]);
    expect(deleteVisualization(db, v.id)).toEqual({ playlists: [p.id], dashboards: [d.id] });
    expect(getPlaylist(db, p.id).items).toEqual([]);
    expect(deletePlaylist(db, p.id)).toEqual({ dashboards: [d.id] });
    expect(getDashboard(db, d.id).layout.items).toEqual([]);
  });
  it('refuses loops with a readable path', () => {
    const d = createDashboard(db, { title: 'Office' });
    const p = createPlaylist(db, { title: 'Morning', items: [{ kind: 'dashboard', dashboard_id: d.id, seconds: 30 }] });
    expect(() => updateDashboard(db, d.id, { title: 'Office', layout: { items: [{ id: 'c', kind: 'carousel', playlist_id: p.id, x: 0, y: 0, w: 12, h: 6 }] } })).toThrow(/dashboard "Office" → playlist "Morning" → dashboard "Office"/);
    // A dashboard in a playlist whose carousel plays a *different* playlist is fine.
    const p2 = createPlaylist(db, { title: 'Other' });
    expect(() => updateDashboard(db, d.id, { title: 'Office', layout: { items: [{ id: 'c', kind: 'carousel', playlist_id: p2.id, x: 0, y: 0, w: 12, h: 6 }] } })).not.toThrow();
    expect(() => updatePlaylist(db, p2.id, { title: 'Other', items: [{ kind: 'dashboard', dashboard_id: d.id, seconds: 20 }] })).toThrow(/loop/);
  });
});

describe('vizData', () => {
  it('delta, running average, daily buckets, downsampling', () => {
    const g = mk();
    const t0 = 1_800_000_000;
    insertSamples(db, g.id, Array.from({ length: 48 }, (_, i) => ({ ts: t0 + i * 3600, value: 1000 + i * 10 })));
    const base = { tz: 'UTC', now: t0 + 48 * 3600, from: t0, to: t0 + 48 * 3600 };
    const cfg = (transform: object, points = 600) => ({ v: 1 as const, type: 'line' as const, range: { preset: '7d' as const }, series: [{ gutnumber_id: g.id, transform }], options: { legend: true, y_from_zero: false, log_scale: false, show_latest: true, points } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = (tr: object, pts?: number) => vizData(db, cfg(tr, pts) as any, base).series[0];
    expect(run({ kind: 'raw' }).points.length).toBe(48);
    expect(run({ kind: 'delta' }).points.every(([, v]) => v === 10)).toBe(true);
    expect(run({ kind: 'running_avg', window: 3 }).points[2][1]).toBe(1010);
    const days = run({ kind: 'bucket', unit: 'day', agg: 'last' }).points;
    expect(days.length).toBeGreaterThanOrEqual(2);
    expect(run({ kind: 'raw' }, 10).points.length).toBeLessThanOrEqual(11);
    expect(run({ kind: 'raw' }).latest).toEqual({ ts: t0 + 47 * 3600, value: 1470 });
  });
});

describe('export / import', () => {
  it('round-trips definitions into an empty db', () => {
    const g = mk('Rank');
    createGutnumber(db, { label: 'HN AI', fetcher: 'helper', helper_name: 'hn_topic_count', helper_params: { topic: 'AI' }, frequency: 'daily' });
    const v = createVisualization(db, { title: 'Ranks', config: { series: [{ gutnumber_id: g.id, invert: true }] } });
    const p = createPlaylist(db, { title: 'Loop', items: [{ kind: 'viz', viz_id: v.id }] });
    const d = createDashboard(db, { title: 'Main', layout: { items: [{ id: 'a', kind: 'carousel', playlist_id: p.id, x: 0, y: 0, w: 12, h: 6 }] } });
    updatePlaylist(db, p.id, { title: 'Loop', items: [{ kind: 'viz', viz_id: v.id }] });
    const data = exportAll(db);
    const db2 = openDb(':memory:');
    const dry = importAll(db2, data, true);
    expect(dry.created.length).toBeGreaterThan(0);
    expect(listGutnumbers(db2)).toEqual([]); // dry run rolled back
    importAll(db2, data);
    expect(listGutnumbers(db2).map((x) => x.slug).sort()).toEqual(['hn-ai', 'rank']);
    const d2 = exportAll(db2);
    expect(d2.dashboards[0].layout.items[0]).toMatchObject({ kind: 'carousel', playlist_title: 'Loop' });
    expect(d2.visualizations[0].config.series[0]).toMatchObject({ gutnumber_slug: 'rank', invert: true });
    importAll(db2, data); // idempotent
    expect(listGutnumbers(db2).length).toBe(2);
    void d;
  });
});
