import type { FastifyInstance } from 'fastify';
import {
  listDashboards, getDashboard, createDashboard, updateDashboard, deleteDashboard, reorder,
  listPlaylists, getPlaylist, createPlaylist, updatePlaylist, deletePlaylist, listVisualizations,
} from '@gut/db';
import { idParam } from '../util.js';
import { HttpError } from '../app.js';

export async function boardRoutes(app: FastifyInstance) {
  const { db } = app.gut;
  const ids = (body: unknown) => {
    const list = (body as { ids?: unknown })?.ids;
    if (!Array.isArray(list) || !list.every((x) => Number.isInteger(x))) throw new HttpError(400, 'bad_ids', 'ids must be an array of integers');
    return list as number[];
  };

  app.get('/dashboards', async () => listDashboards(db));
  app.post('/dashboards', async (req, reply) => reply.code(201).send(createDashboard(db, req.body as never)));
  app.get('/dashboards/:id', async (req) => {
    const d = getDashboard(db, idParam(req));
    const vizTitles = Object.fromEntries(listVisualizations(db).map((v) => [v.id, v.title]));
    const playlistTitles = Object.fromEntries(listPlaylists(db).map((p) => [p.id, p.title]));
    return { ...d, viz_titles: vizTitles, playlist_titles: playlistTitles };
  });
  app.put('/dashboards/:id', async (req) => updateDashboard(db, idParam(req), req.body as never));
  app.delete('/dashboards/:id', async (req) => deleteDashboard(db, idParam(req)));
  app.post('/dashboards/reorder', async (req) => {
    reorder(db, 'dashboards', ids(req.body));
    return listDashboards(db);
  });

  app.get('/playlists', async () => listPlaylists(db));
  app.post('/playlists', async (req, reply) => reply.code(201).send(createPlaylist(db, req.body as never)));
  app.get('/playlists/:id', async (req) => getPlaylist(db, idParam(req)));
  app.put('/playlists/:id', async (req) => updatePlaylist(db, idParam(req), req.body as never));
  app.delete('/playlists/:id', async (req) => deletePlaylist(db, idParam(req)));
  app.post('/playlists/reorder', async (req) => {
    reorder(db, 'playlists', ids(req.body));
    return listPlaylists(db);
  });
}
