import type { FastifyInstance } from 'fastify';
import { getDashboard, getPlaylist, getVisualization, vizData, NotFound, type DB } from '@gut/db';
import type { Dashboard, Playlist, Visualization } from '@gut/shared';
import { idParam, q, numQ } from '../util.js';

/**
 * Everything a viewer needs in one call, without selectors, URLs or helper params.
 * Depth: a dashboard's carousels resolve their playlists; dashboards inside those
 * playlists resolve their own layout but their carousels are not expanded further
 * (the viewer shows them frozen, ARCHITECTURE §10).
 */
export interface ViewBundle {
  dashboards: Record<number, Dashboard>;
  playlists: Record<number, Playlist>;
  visualizations: Record<number, Visualization>;
}

function collect(db: DB, root: { dashboard?: number; playlist?: number; viz?: number }, maxDepth = 3): ViewBundle {
  const out: ViewBundle = { dashboards: {}, playlists: {}, visualizations: {} };
  const addViz = (id: number) => {
    if (out.visualizations[id]) return;
    try {
      out.visualizations[id] = getVisualization(db, id);
    } catch (e) {
      if (!(e instanceof NotFound)) throw e;
    }
  };
  const addDash = (id: number, depth: number) => {
    if (out.dashboards[id] || depth > maxDepth) return;
    const d = getDashboard(db, id);
    out.dashboards[id] = d;
    for (const it of d.layout.items) {
      if (it.kind === 'viz') addViz(it.viz_id);
      if (it.kind === 'carousel') addPl(it.playlist_id, depth + 1);
    }
  };
  const addPl = (id: number, depth: number) => {
    if (out.playlists[id] || depth > maxDepth) return;
    let p: Playlist;
    try {
      p = getPlaylist(db, id);
    } catch (e) {
      if (e instanceof NotFound) return;
      throw e;
    }
    out.playlists[id] = p;
    for (const it of p.items) {
      if (it.kind === 'viz') addViz(it.viz_id);
      else addDash(it.dashboard_id, depth + 1);
    }
  };
  if (root.dashboard) addDash(root.dashboard, 0);
  if (root.playlist) addPl(root.playlist, 0);
  if (root.viz) addViz(root.viz);
  return out;
}

export async function viewRoutes(app: FastifyInstance) {
  const { db, config } = app.gut;
  app.get('/view/dashboard/:id', async (req) => ({ root: { kind: 'dashboard', id: idParam(req) }, ...collect(db, { dashboard: idParam(req) }), tz: config.tz }));
  app.get('/view/playlist/:id', async (req) => ({ root: { kind: 'playlist', id: idParam(req) }, ...collect(db, { playlist: idParam(req) }), tz: config.tz }));
  app.get('/view/viz/:id', async (req) => ({ root: { kind: 'viz', id: idParam(req) }, ...collect(db, { viz: idParam(req) }), tz: config.tz }));
  app.get('/view/viz/:id/data', async (req) => {
    const v = getVisualization(db, idParam(req));
    return vizData(db, v.config, { tz: config.tz, points: numQ(q(req).points) });
  });
}
