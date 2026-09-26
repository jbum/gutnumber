import type { FastifyInstance } from 'fastify';
import { listVisualizations, getVisualization, createVisualization, updateVisualization, deleteVisualization, duplicateVisualization, vizData } from '@gut/db';
import { VizConfigSchema } from '@gut/shared';
import { idParam, q, numQ, isoToTs } from '../util.js';

export async function vizRoutes(app: FastifyInstance) {
  const { db, config } = app.gut;

  app.get('/visualizations', async () => listVisualizations(db));
  app.post('/visualizations', async (req, reply) => reply.code(201).send(createVisualization(db, req.body as never)));
  app.get('/visualizations/:id', async (req) => getVisualization(db, idParam(req)));
  app.put('/visualizations/:id', async (req) => updateVisualization(db, idParam(req), req.body as never));
  app.delete('/visualizations/:id', async (req) => deleteVisualization(db, idParam(req)));
  app.post('/visualizations/:id/duplicate', async (req, reply) => reply.code(201).send(duplicateVisualization(db, idParam(req))));

  app.get('/visualizations/:id/data', async (req) => {
    const v = getVisualization(db, idParam(req));
    const qs = q(req);
    return vizData(db, v.config, { tz: config.tz, points: numQ(qs.points), from: isoToTs(qs.from), to: isoToTs(qs.to) });
  });

  app.post('/visualizations/preview-data', async (req) => {
    const body = (req.body ?? {}) as { config?: unknown };
    return vizData(db, VizConfigSchema.parse(body.config ?? {}), { tz: config.tz });
  });
}
