import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig, openDb, insertSamples, type DB } from '@gut/db';
import { credentialLookup } from '@gut/fetch';
import { buildServer } from '@gut/server';
import { startFixtureSite, type FixtureSite } from '../../../scripts/fixture-site';

let app: FastifyInstance;
let db: DB;
let site: FixtureSite;

beforeAll(async () => {
  site = await startFixtureSite();
  const dir = mkdtempSync(join(tmpdir(), 'gut-srv-'));
  const config = loadConfig({ dataDir: dir, dbPath: ':memory:', privateDir: null, tz: 'UTC' });
  db = openDb(':memory:');
  app = await buildServer({ config, db, credentialsFor: credentialLookup({}), clientDir: null, extensionDir: null });
});
afterAll(async () => {
  await app.close();
  await site.close();
});

const req = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS', url: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const r = await app.inject({ method, url: `/api/v1${url}`, payload: payload as never, headers });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, headers: r.headers };
};

const bundle = { version: 1, selectors: [{ type: 'CssSelector', value: 'td.num' }] };

describe('API', () => {
  let gid: number;
  it('creates, lists with sparkline, patches, rejects bad input', async () => {
    const c = await req('POST', '/gutnumbers', { label: 'Visitors', url: `${site.url}/page/blog-stats.html`, fetcher: 'http', bundle, frequency: 'hourly' });
    expect(c.status).toBe(201);
    gid = c.body.id;
    insertSamples(db, gid, [{ ts: 1, value: 3 }, { ts: 2, value: 4 }]);
    const l = await req('GET', '/gutnumbers');
    expect(l.body[0]).toMatchObject({ slug: 'visitors', sparkline: [[1, 3], [2, 4]] });
    expect((await req('PATCH', `/gutnumbers/visitors`, { frequency: 'daily', color: '#112233' })).body).toMatchObject({ frequency: 'daily', color: '#112233' });
    const bad = await req('POST', '/gutnumbers', { label: '', fetcher: 'http' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('validation');
    expect((await req('GET', '/gutnumbers/999')).status).toBe(404);
    expect((await req('POST', `/gutnumbers/${gid}/poll`)).status).toBe(202);
  });

  it('previews a page server-side', async () => {
    const r = await req('POST', '/preview', { url: `${site.url}/page/blog-stats.html`, bundle, strategies: ['http'] });
    expect(r.body).toMatchObject({ recommended_fetcher: 'http', results: [{ ok: true, value: 4812 }] });
  });

  it('answers CORS preflight for the bookmarklet', async () => {
    const r = await req('OPTIONS', '/gutnumbers', undefined, { origin: 'https://www.amazon.com', 'access-control-request-method': 'POST' });
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe('https://www.amazon.com');
    expect(r.headers['access-control-allow-credentials']).toBe('true');
  });

  it('visualizations, data, dashboards, playlists, loops, view bundles', async () => {
    const v = await req('POST', '/visualizations', { title: 'V', config: { range: { from: '1970-01-01T00:00:00Z' }, series: [{ gutnumber_id: gid }] } });
    expect(v.status).toBe(201);
    const data = await req('GET', `/visualizations/${v.body.id}/data`);
    expect(data.body.series[0].points).toEqual([[1, 3], [2, 4]]);
    const d = await req('POST', '/dashboards', { title: 'Office', layout: { items: [{ id: 'a', kind: 'viz', viz_id: v.body.id, x: 0, y: 0, w: 6, h: 4 }] } });
    const p = await req('POST', '/playlists', { title: 'Morning', items: [{ kind: 'dashboard', dashboard_id: d.body.id, seconds: 20 }, { kind: 'viz', viz_id: v.body.id }] });
    const loop = await req('PUT', `/dashboards/${d.body.id}`, { title: 'Office', layout: { items: [{ id: 'c', kind: 'carousel', playlist_id: p.body.id, x: 0, y: 0, w: 12, h: 4 }] } });
    expect(loop.status).toBe(409);
    expect(loop.body.error).toMatchObject({ code: 'cycle' });
    expect(loop.body.error.message).toContain('dashboard "Office" → playlist "Morning" → dashboard "Office"');
    const vb = await req('GET', `/view/playlist/${p.body.id}`);
    expect(Object.keys(vb.body.dashboards)).toEqual([String(d.body.id)]);
    expect(Object.keys(vb.body.visualizations)).toEqual([String(v.body.id)]);
    expect(JSON.stringify(vb.body)).not.toContain('td.num'); // no selectors leak into viewer payloads
    const del = await req('DELETE', `/visualizations/${v.body.id}`);
    expect(del.body).toEqual({ playlists: [p.body.id], dashboards: [d.body.id] });
    const reo = await req('POST', '/dashboards/reorder', { ids: [d.body.id] });
    expect(reo.status).toBe(200);
  });

  it('helpers, health, settings, export/import, unknown routes', async () => {
    expect((await req('GET', '/helpers')).body.map((h: { name: string }) => h.name)).toContain('hn_topic_count');
    expect((await req('GET', '/health')).body).toMatchObject({ ok: true, daemon_heartbeat_age_s: null });
    expect((await req('GET', '/settings')).body).toMatchObject({ tz: 'UTC' });
    const exp = await req('GET', '/export');
    expect(exp.body.format).toBe('gutnumber-export');
    expect((await req('POST', '/import?dry_run=1', exp.body)).status).toBe(200);
    expect((await req('POST', '/import', { nope: 1 })).status).toBe(400);
    expect((await req('GET', '/nope')).status).toBe(404);
    const h = await req('POST', '/helpers/json_api/test', { params: {} });
    expect(h.body).toMatchObject({ ok: false, error_class: 'helper_error' });
  });
});
