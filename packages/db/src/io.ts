import type { DB } from './open.js';
import { listGutnumbers, createGutnumber, updateGutnumber, getGutnumber } from './gutnumbers.js';
import { listVisualizations, listDashboards, listPlaylists, createVisualization, updateVisualization, createDashboard, updateDashboard, createPlaylist, updatePlaylist } from './views.js';
import type { DashboardItem, PlaylistItem, VizConfig } from '@gut/shared';

/** Definitions only (no samples, no runtime state), keyed so import can upsert. */
export function exportAll(db: DB) {
  const gut = listGutnumbers(db);
  const slugOf = new Map(gut.map((g) => [g.id, g.slug]));
  const viz = listVisualizations(db);
  const vizTitle = new Map(viz.map((v) => [v.id, v.title]));
  const dash = listDashboards(db);
  const dashTitle = new Map(dash.map((d) => [d.id, d.title]));
  const pls = listPlaylists(db);
  const plTitle = new Map(pls.map((p) => [p.id, p.title]));
  return {
    format: 'gutnumber-export',
    version: 1,
    exported_at: new Date().toISOString(),
    gutnumbers: gut.map((g) => ({
      slug: g.slug, label: g.label, url: g.url, fetcher: g.fetcher, bundle: g.bundle, helper_name: g.helper_name, helper_params: g.helper_params,
      proxy: g.proxy, frequency: g.frequency, enabled: g.enabled, color: g.color, unit: g.unit, decimals: g.decimals, notes: g.notes,
    })),
    visualizations: viz.map((v) => ({ title: v.title, carousel_seconds: v.carousel_seconds, config: { ...v.config, series: v.config.series.map((s) => ({ ...s, gutnumber_id: undefined, gutnumber_slug: slugOf.get(s.gutnumber_id) })) } })),
    dashboards: dash.map((d) => ({ title: d.title, options: d.options, layout: { ...d.layout, items: d.layout.items.map((i) => (i.kind === 'viz' ? { ...i, viz_id: undefined, viz_title: vizTitle.get(i.viz_id) } : i.kind === 'carousel' ? { ...i, playlist_id: undefined, playlist_title: plTitle.get(i.playlist_id) } : i)) } })),
    playlists: pls.map((p) => ({ title: p.title, items: p.items.map((i) => (i.kind === 'viz' ? { ...i, viz_id: undefined, viz_title: vizTitle.get(i.viz_id) } : { ...i, dashboard_id: undefined, dashboard_title: dashTitle.get(i.dashboard_id) })) })),
  };
}

export type ExportData = ReturnType<typeof exportAll>;

/** Upserts by slug (numbers) and title (everything else). */
export function importAll(db: DB, data: ExportData, dryRun = false) {
  const report = { created: [] as string[], updated: [] as string[], skipped: [] as string[] };
  const run = () => {
    for (const g of data.gutnumbers ?? []) {
      const existing = getGutnumber(db, g.slug);
      const { slug, ...rest } = g;
      if (existing) {
        updateGutnumber(db, existing.id, rest as never);
        report.updated.push(`gutnumber ${slug}`);
      } else {
        createGutnumber(db, { ...(rest as Record<string, unknown>), slug } as never);
        report.created.push(`gutnumber ${slug}`);
      }
    }
    const idBySlug = (s: string) => getGutnumber(db, s)?.id;
    const byTitle = <T extends { id: number; title: string }>(list: T[], t: string) => list.find((x) => x.title === t)?.id;
    for (const v of data.visualizations ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const series = v.config.series.map((s: any) => ({ ...s, gutnumber_slug: undefined, gutnumber_id: idBySlug(s.gutnumber_slug) })).filter((s: { gutnumber_id?: number }) => s.gutnumber_id);
      const input = { title: v.title, carousel_seconds: v.carousel_seconds, config: { ...v.config, series } as VizConfig };
      const id = byTitle(listVisualizations(db), v.title);
      if (id) updateVisualization(db, id, input);
      else createVisualization(db, input);
      report[id ? 'updated' : 'created'].push(`visualization ${v.title}`);
    }
    // Playlists first without dashboard items, then dashboards, then full playlists (breaks the chicken-and-egg).
    for (const p of data.playlists ?? []) if (!byTitle(listPlaylists(db), p.title)) createPlaylist(db, { title: p.title, items: [] });
    for (const d of data.dashboards ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = d.layout.items.map((i: any) => (i.kind === 'viz' ? { ...i, viz_title: undefined, viz_id: byTitle(listVisualizations(db), i.viz_title) } : i.kind === 'carousel' ? { ...i, playlist_title: undefined, playlist_id: byTitle(listPlaylists(db), i.playlist_title) } : i)).filter((i: DashboardItem) => (i.kind === 'viz' ? i.viz_id : i.kind === 'carousel' ? i.playlist_id : true));
      const input = { title: d.title, options: d.options, layout: { ...d.layout, items } };
      const id = byTitle(listDashboards(db), d.title);
      if (id) updateDashboard(db, id, input);
      else createDashboard(db, input);
      report[id ? 'updated' : 'created'].push(`dashboard ${d.title}`);
    }
    for (const p of data.playlists ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = p.items.map((i: any) => (i.kind === 'viz' ? { ...i, viz_title: undefined, viz_id: byTitle(listVisualizations(db), i.viz_title) } : { ...i, dashboard_title: undefined, dashboard_id: byTitle(listDashboards(db), i.dashboard_title) })).filter((i: PlaylistItem) => (i.kind === 'viz' ? i.viz_id : i.dashboard_id));
      updatePlaylist(db, byTitle(listPlaylists(db), p.title)!, { title: p.title, items });
      report.updated.push(`playlist ${p.title}`);
    }
  };
  if (dryRun) {
    try {
      db.transaction(() => {
        run();
        throw new DryRun();
      })();
    } catch (e) {
      if (!(e instanceof DryRun)) throw e;
    }
  } else db.transaction(run)();
  return report;
}
class DryRun extends Error {}
