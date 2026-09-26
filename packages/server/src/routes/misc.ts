import type { FastifyInstance } from 'fastify';
import { queryLog, getSetting, setSetting, exportAll, importAll, now, type ExportData } from '@gut/db';
import { listHelpers, PollContext, testHelper } from '@gut/fetch';
import { PALETTE } from '@gut/shared';
import { q, numQ, isoToTs } from '../util.js';
import { HttpError } from '../app.js';

const VERSION = '0.1.0';

export async function miscRoutes(app: FastifyInstance) {
  const { db, config } = app.gut;

  app.get('/helpers', async () => listHelpers().map((h) => ({ name: h.name, title: h.title, description: h.description, params: h.params })));

  app.post('/helpers/:name/test', async (req) => {
    const ctx = new PollContext({ config, credentialsFor: app.gut.credentialsFor, browser: app.gut.browser });
    const params = ((req.body ?? {}) as { params?: Record<string, unknown> }).params ?? {};
    return testHelper(ctx, (req.params as { name: string }).name, params);
  });

  app.get('/log', async (req) => {
    const qs = q(req);
    return queryLog(db, { problems: qs.ok === '0', since: isoToTs(qs.since), gutnumber_id: numQ(qs.gutnumber_id), limit: numQ(qs.limit) ?? 200 });
  });

  app.get('/health', async () => {
    const hb = Number(getSetting(db, 'daemon_heartbeat') ?? 0);
    const failing = (db.prepare("SELECT COUNT(*) AS n FROM gutnumbers WHERE status = 'failing' AND enabled = 1").get() as { n: number }).n;
    const total = (db.prepare('SELECT COUNT(*) AS n FROM gutnumbers').get() as { n: number }).n;
    return { ok: true, db: true, version: VERSION, daemon_heartbeat_age_s: hb ? now() - hb : null, failing, numbers: total };
  });

  app.get('/settings', async () => ({
    daily_hour: config.dailyHour,
    weekly_day: config.weeklyDay,
    tz: config.tz,
    palette: PALETTE,
    public_url: config.publicUrl,
    proxy_configured: !!config.proxyTemplate,
    typesafe_configured: !!config.typesafeApiKey,
    youtube_api_configured: !!config.youtubeApiKey,
  }));

  app.get('/export', async (_req, reply) => reply.header('content-disposition', `attachment; filename="gutnumber-export-${new Date().toISOString().slice(0, 10)}.json"`).send(exportAll(db)));

  app.post('/import', async (req) => {
    const body = req.body as ExportData;
    if (!body || (body as { format?: string }).format !== 'gutnumber-export') throw new HttpError(400, 'bad_import', 'not a gutnumber export file');
    return importAll(db, body, q(req).dry_run === '1');
  });

  app.get('/whoami', async (req) => ({ user: req.headers['x-forwarded-user'] ?? null }));
  void setSetting;
}
