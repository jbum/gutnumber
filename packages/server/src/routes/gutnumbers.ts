import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import {
  listGutnumbers, mustGetGutnumber, createGutnumber, updateGutnumber, deleteGutnumber, requestPoll, lastSamples, getSamples, queryLog, getPoints, getGutnumber,
} from '@gut/db';
import { PollContext, previewFetch } from '@gut/fetch';
import { downsample, applyTransform, type Gutnumber } from '@gut/shared';
import { q, numQ, isoToTs, RateLimit } from '../util.js';
import { HttpError } from '../app.js';

export function publicGutnumber(g: Gutnumber, sparkline?: Array<[number, number]>) {
  return { ...g, sparkline };
}

const previewLimit = new RateLimit(20, 60_000);

export async function gutnumberRoutes(app: FastifyInstance) {
  const { db, config } = app.gut;
  const sched = () => ({ dailyHour: config.dailyHour, weeklyDay: config.weeklyDay, tz: config.tz });
  const idOf = (req: { params: unknown }) => (req.params as { id: string }).id;

  app.get('/gutnumbers', async (req) => {
    const { status, host, q: text } = q(req);
    return listGutnumbers(db, { status, host, q: text }).map((g) => publicGutnumber(g, lastSamples(db, g.id, 50)));
  });

  app.post('/gutnumbers', async (req, reply) => {
    const g = createGutnumber(db, req.body as never);
    return reply.code(201).send(publicGutnumber(g, []));
  });

  app.get('/gutnumbers/:id', async (req) => publicGutnumber(mustGetGutnumber(db, idOf(req)), lastSamples(db, mustGetGutnumber(db, idOf(req)).id, 50)));

  app.patch('/gutnumbers/:id', async (req) => {
    const g = updateGutnumber(db, idOf(req), (req.body ?? {}) as never, sched());
    return publicGutnumber(g, lastSamples(db, g.id, 50));
  });

  app.delete('/gutnumbers/:id', async (req) => deleteGutnumber(db, idOf(req)));

  app.post('/gutnumbers/:id/poll', async (req, reply) => {
    requestPoll(db, idOf(req));
    return reply.code(202).send({ queued: true });
  });

  app.get('/gutnumbers/:id/samples', async (req) => {
    const g = mustGetGutnumber(db, idOf(req));
    const qs = q(req);
    const to = isoToTs(qs.to) ?? Math.floor(Date.now() / 1000);
    const from = isoToTs(qs.from) ?? to - 30 * 86400;
    if (qs.raw === '1') return { samples: getSamples(db, g.id, from, to) };
    let pts = getPoints(db, g.id, from, to);
    if (qs.agg && ['hour', 'day', 'week'].includes(qs.bucket ?? '')) pts = applyTransform(pts, { kind: 'bucket', unit: qs.bucket as 'day', agg: qs.agg as 'avg' }, config.tz);
    const ds = downsample(pts, numQ(qs.points) ?? 1000, from, to);
    return { points: ds.points, bucket_seconds: ds.bucket, from, to };
  });

  app.get('/gutnumbers/:id/log', async (req) => {
    const g = mustGetGutnumber(db, idOf(req));
    return queryLog(db, { gutnumber_id: g.id, limit: numQ(q(req).limit) ?? 50 });
  });

  app.get('/gutnumbers/:id/page', async (req) => {
    const g = mustGetGutnumber(db, idOf(req));
    const p = join(config.dataDir, 'pages', `${g.id}.html.gz`);
    if (!existsSync(p)) throw new HttpError(404, 'no_page', 'no page retained yet (it is kept after the next successful poll)');
    return { html: gunzipSync(readFileSync(p)).toString('utf8'), fetched_at: new Date(statSync(p).mtimeMs).toISOString() };
  });

  app.post('/gutnumbers/:id/repair-test', async (req) => {
    const g = mustGetGutnumber(db, idOf(req));
    const body = (req.body ?? {}) as { bundle?: unknown; url?: string; fetcher?: 'http' | 'browser' };
    if (!g.url && !body.url) throw new HttpError(400, 'no_url', 'this number has no URL');
    if (!previewLimit.take()) throw new HttpError(429, 'rate_limited', 'too many previews; wait a minute');
    const ctx = new PollContext({ config, credentialsFor: app.gut.credentialsFor, browser: app.gut.browser });
    return previewFetch(ctx, { url: body.url ?? g.url!, bundle: body.bundle ?? g.bundle, proxy: g.proxy, strategies: body.fetcher ? [body.fetcher] : [g.fetcher === 'browser' ? 'browser' : 'http', ...(g.fetcher === 'browser' ? [] : (['browser'] as const))], stop_on_success: false });
  });

  app.post('/preview', async (req) => {
    if (!previewLimit.take()) throw new HttpError(429, 'rate_limited', 'too many previews; wait a minute');
    const body = (req.body ?? {}) as { url?: string; bundle?: unknown; proxy?: 'none' | 'residential'; strategies?: Array<'http' | 'browser'>; stop_on_success?: boolean };
    if (!body.url) throw new HttpError(400, 'no_url', 'url is required');
    const ctx = new PollContext({ config, credentialsFor: app.gut.credentialsFor, browser: app.gut.browser });
    return previewFetch(ctx, { url: body.url, bundle: body.bundle, proxy: body.proxy, strategies: body.strategies, stop_on_success: body.stop_on_success });
  });

  // helpers for the sample drawer
  app.delete('/gutnumbers/:id/samples/:ts', async (req) => {
    const g = mustGetGutnumber(db, idOf(req));
    const ts = Number((req.params as { ts: string }).ts);
    const n = db.prepare('DELETE FROM samples WHERE gutnumber_id = ? AND ts = ?').run(g.id, ts).changes;
    if (!n) throw new HttpError(404, 'not_found', 'no sample at that time');
    const last = db.prepare('SELECT value, raw, strategy, ts FROM samples WHERE gutnumber_id = ? ORDER BY ts DESC LIMIT 1').get(g.id) as { value: number; raw: string; strategy: string } | undefined;
    db.prepare('UPDATE gutnumbers SET last_value = ?, last_raw = ?, last_strategy = ? WHERE id = ?').run(last?.value ?? null, last?.raw ?? null, last?.strategy ?? null, g.id);
    return { deleted: n, gutnumber: getGutnumber(db, g.id) };
  });
}
