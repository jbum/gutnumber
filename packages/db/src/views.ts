import {
  DashboardInputSchema,
  PlaylistInputSchema,
  VisualizationInputSchema,
  buildGraph,
  findCycle,
  type Dashboard,
  type DashboardInput,
  type NodeKey,
  type Playlist,
  type PlaylistInput,
  type Visualization,
  type VisualizationInput,
} from '@gut/shared';
import { now, type DB } from './open.js';
import { Conflict, NotFound } from './gutnumbers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const toViz = (r: Row): Visualization => ({ id: r.id, title: r.title, config: JSON.parse(r.config_json), carousel_seconds: r.carousel_seconds, created_at: r.created_at, updated_at: r.updated_at });
const toDash = (r: Row): Dashboard => ({ id: r.id, title: r.title, sort_order: r.sort_order, layout: JSON.parse(r.layout_json), options: JSON.parse(r.options_json), created_at: r.created_at, updated_at: r.updated_at });
const toPl = (r: Row): Playlist => ({ id: r.id, title: r.title, sort_order: r.sort_order, items: JSON.parse(r.items_json), created_at: r.created_at, updated_at: r.updated_at });

// ---- visualizations ---------------------------------------------------------

export function listVisualizations(db: DB): Visualization[] {
  return (db.prepare('SELECT * FROM visualizations ORDER BY title COLLATE NOCASE').all() as Row[]).map(toViz);
}
export function getVisualization(db: DB, id: number): Visualization {
  const r = db.prepare('SELECT * FROM visualizations WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new NotFound(`visualization ${id} not found`);
  return toViz(r);
}
export function createVisualization(db: DB, input: VisualizationInput): Visualization {
  const v = VisualizationInputSchema.parse(input);
  const t = now();
  const info = db.prepare('INSERT INTO visualizations (title, config_json, carousel_seconds, created_at, updated_at) VALUES (?,?,?,?,?)').run(v.title, JSON.stringify(v.config), v.carousel_seconds, t, t);
  return getVisualization(db, Number(info.lastInsertRowid));
}
export function updateVisualization(db: DB, id: number, input: VisualizationInput): Visualization {
  getVisualization(db, id);
  const v = VisualizationInputSchema.parse(input);
  db.prepare('UPDATE visualizations SET title = ?, config_json = ?, carousel_seconds = ?, updated_at = ? WHERE id = ?').run(v.title, JSON.stringify(v.config), v.carousel_seconds, now(), id);
  return getVisualization(db, id);
}
export function duplicateVisualization(db: DB, id: number): Visualization {
  const v = getVisualization(db, id);
  return createVisualization(db, { title: `${v.title} (copy)`, config: v.config, carousel_seconds: v.carousel_seconds });
}
/** Removes it from playlists and dashboards too. */
export function deleteVisualization(db: DB, id: number): { playlists: number[]; dashboards: number[] } {
  getVisualization(db, id);
  const out = { playlists: [] as number[], dashboards: [] as number[] };
  db.transaction(() => {
    for (const p of listPlaylists(db)) {
      const items = p.items.filter((i) => !(i.kind === 'viz' && i.viz_id === id));
      if (items.length !== p.items.length) {
        out.playlists.push(p.id);
        db.prepare('UPDATE playlists SET items_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(items), now(), p.id);
      }
    }
    for (const d of listDashboards(db)) {
      const items = d.layout.items.filter((i) => !(i.kind === 'viz' && i.viz_id === id));
      if (items.length !== d.layout.items.length) {
        out.dashboards.push(d.id);
        db.prepare('UPDATE dashboards SET layout_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...d.layout, items }), now(), d.id);
      }
    }
    db.prepare('DELETE FROM visualizations WHERE id = ?').run(id);
  })();
  return out;
}

// ---- cycle check (D7) -------------------------------------------------------

function graphWith(db: DB, override?: { dash?: { id: number; playlistIds: number[] }; pl?: { id: number; dashboardIds: number[] } }) {
  const dashboards = listDashboards(db).map((d) => ({ id: d.id, playlistIds: d.layout.items.flatMap((i) => (i.kind === 'carousel' ? [i.playlist_id] : [])) }));
  const playlists = listPlaylists(db).map((p) => ({ id: p.id, dashboardIds: p.items.flatMap((i) => (i.kind === 'dashboard' ? [i.dashboard_id] : [])) }));
  if (override?.dash) {
    const i = dashboards.findIndex((d) => d.id === override.dash!.id);
    if (i >= 0) dashboards[i] = override.dash;
    else dashboards.push(override.dash);
  }
  if (override?.pl) {
    const i = playlists.findIndex((p) => p.id === override.pl!.id);
    if (i >= 0) playlists[i] = override.pl;
    else playlists.push(override.pl);
  }
  return buildGraph({ dashboards, playlists });
}

function describeCycle(db: DB, path: NodeKey[]): string {
  return path
    .map((k) => {
      const [kind, id] = k.split(':');
      const table = kind === 'd' ? 'dashboards' : 'playlists';
      const r = db.prepare(`SELECT title FROM ${table} WHERE id = ?`).get(Number(id)) as { title: string } | undefined;
      return `${kind === 'd' ? 'dashboard' : 'playlist'} "${r?.title ?? '(new)'}"`;
    })
    .join(' → ');
}

// ---- dashboards ---------------------------------------------------------------

export function listDashboards(db: DB): Dashboard[] {
  return (db.prepare('SELECT * FROM dashboards ORDER BY sort_order, id').all() as Row[]).map(toDash);
}
export function getDashboard(db: DB, id: number): Dashboard {
  const r = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new NotFound(`dashboard ${id} not found`);
  return toDash(r);
}
export function createDashboard(db: DB, input: DashboardInput): Dashboard {
  const v = DashboardInputSchema.parse(input);
  const t = now();
  const order = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM dashboards').get() as { n: number }).n;
  return db.transaction(() => {
    const info = db.prepare('INSERT INTO dashboards (title, sort_order, layout_json, options_json, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(v.title, order, JSON.stringify(v.layout), JSON.stringify(v.options), t, t);
    const id = Number(info.lastInsertRowid);
    assertNoCycle(db, 'd', id);
    return getDashboard(db, id);
  })();
}
export function updateDashboard(db: DB, id: number, input: DashboardInput): Dashboard {
  getDashboard(db, id);
  const v = DashboardInputSchema.parse(input);
  const playlistIds = v.layout.items.flatMap((i) => (i.kind === 'carousel' ? [i.playlist_id] : []));
  const cyc = findCycle(graphWith(db, { dash: { id, playlistIds } }), `d:${id}`);
  if (cyc) throw new Conflict(`this would create a loop: ${describeCycle(db, cyc)}`, { code: 'cycle', path: cyc });
  db.prepare('UPDATE dashboards SET title = ?, layout_json = ?, options_json = ?, updated_at = ? WHERE id = ?').run(v.title, JSON.stringify(v.layout), JSON.stringify(v.options), now(), id);
  return getDashboard(db, id);
}
export function deleteDashboard(db: DB, id: number): { playlists: number[] } {
  getDashboard(db, id);
  const out = { playlists: [] as number[] };
  db.transaction(() => {
    for (const p of listPlaylists(db)) {
      const items = p.items.filter((i) => !(i.kind === 'dashboard' && i.dashboard_id === id));
      if (items.length !== p.items.length) {
        out.playlists.push(p.id);
        db.prepare('UPDATE playlists SET items_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(items), now(), p.id);
      }
    }
    db.prepare('DELETE FROM dashboards WHERE id = ?').run(id);
  })();
  return out;
}
export function reorder(db: DB, table: 'dashboards' | 'playlists', ids: number[]): void {
  const st = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
  db.transaction(() => ids.forEach((id, i) => st.run(i + 1, id)))();
}

// ---- playlists -----------------------------------------------------------------

export function listPlaylists(db: DB): Playlist[] {
  return (db.prepare('SELECT * FROM playlists ORDER BY sort_order, id').all() as Row[]).map(toPl);
}
export function getPlaylist(db: DB, id: number): Playlist {
  const r = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new NotFound(`playlist ${id} not found`);
  return toPl(r);
}
export function createPlaylist(db: DB, input: PlaylistInput): Playlist {
  const v = PlaylistInputSchema.parse(input);
  const t = now();
  const order = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM playlists').get() as { n: number }).n;
  return db.transaction(() => {
    const info = db.prepare('INSERT INTO playlists (title, sort_order, items_json, created_at, updated_at) VALUES (?,?,?,?,?)').run(v.title, order, JSON.stringify(v.items), t, t);
    const id = Number(info.lastInsertRowid);
    assertNoCycle(db, 'p', id);
    return getPlaylist(db, id);
  })();
}
export function updatePlaylist(db: DB, id: number, input: PlaylistInput): Playlist {
  getPlaylist(db, id);
  const v = PlaylistInputSchema.parse(input);
  const dashboardIds = v.items.flatMap((i) => (i.kind === 'dashboard' ? [i.dashboard_id] : []));
  const cyc = findCycle(graphWith(db, { pl: { id, dashboardIds } }), `p:${id}`);
  if (cyc) throw new Conflict(`this would create a loop: ${describeCycle(db, cyc)}`, { code: 'cycle', path: cyc });
  db.prepare('UPDATE playlists SET title = ?, items_json = ?, updated_at = ? WHERE id = ?').run(v.title, JSON.stringify(v.items), now(), id);
  return getPlaylist(db, id);
}
export function deletePlaylist(db: DB, id: number): { dashboards: number[] } {
  getPlaylist(db, id);
  const out = { dashboards: [] as number[] };
  db.transaction(() => {
    for (const d of listDashboards(db)) {
      const items = d.layout.items.filter((i) => !(i.kind === 'carousel' && i.playlist_id === id));
      if (items.length !== d.layout.items.length) {
        out.dashboards.push(d.id);
        db.prepare('UPDATE dashboards SET layout_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...d.layout, items }), now(), d.id);
      }
    }
    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
  })();
  return out;
}

function assertNoCycle(db: DB, kind: 'd' | 'p', id: number) {
  const cyc = findCycle(graphWith(db), `${kind}:${id}` as NodeKey);
  if (cyc) throw new Conflict(`this would create a loop: ${describeCycle(db, cyc)}`, { code: 'cycle', path: cyc });
}
