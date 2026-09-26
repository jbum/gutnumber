import type { Gutnumber, Visualization, Dashboard, Playlist, VizData, PollLogRow, VizConfig, DashboardLayout, DashboardOptions, PlaylistItem } from '@gut/shared';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/v1${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new ApiError(r.status, data?.error?.code ?? 'error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details);
  return data as T;
}

export type GutnumberRow = Gutnumber & { sparkline?: Array<[number, number]> };
export interface HelperParam { key: string; label: string; type: 'string' | 'number' | 'select' | 'boolean' | 'text'; required?: boolean; default?: string | number | boolean; help?: string; options?: Array<{ value: string; label: string }>; placeholder?: string }
export interface HelperInfo { name: string; title: string; description: string; params: HelperParam[] }
export interface PreviewResult {
  results: Array<{ strategy: 'http' | 'browser'; ok: boolean; value?: number; raw?: string; selector?: string; error_class?: string; message?: string; http_status?: number; duration_ms: number }>;
  per_selector: Array<{ type: string; text: string | null; value: number | null }> | null;
  recommended_fetcher: 'http' | 'browser' | null;
  fragment_warning?: string;
}
export type LogRow = PollLogRow & { label?: string; slug?: string };
export interface Health { ok: boolean; daemon_heartbeat_age_s: number | null; failing: number; numbers: number; version: string }
export interface Settings { daily_hour: number; weekly_day: number; tz: string; palette: string[]; public_url: string; proxy_configured: boolean; typesafe_configured: boolean; youtube_api_configured: boolean }
export type HelperTest = { ok: true; value: number; raw: string; duration_ms: number; suggest: { label?: string; unit?: string; frequency?: string } | null } | { ok: false; error_class: string; message: string };
export type DashboardDetail = Dashboard & { viz_titles: Record<number, string>; playlist_titles: Record<number, string> };
export interface ViewBundle { root: { kind: 'dashboard' | 'playlist' | 'viz'; id: number }; dashboards: Record<number, Dashboard>; playlists: Record<number, Playlist>; visualizations: Record<number, Visualization>; tz: string }

export const api = {
  numbers: (q = '') => call<GutnumberRow[]>('GET', `/gutnumbers${q}`),
  number: (id: number | string) => call<GutnumberRow>('GET', `/gutnumbers/${id}`),
  createNumber: (b: unknown) => call<GutnumberRow>('POST', '/gutnumbers', b),
  patchNumber: (id: number, b: unknown) => call<GutnumberRow>('PATCH', `/gutnumbers/${id}`, b),
  deleteNumber: (id: number) => call<{ affected_visualizations: number[] }>('DELETE', `/gutnumbers/${id}`),
  pollNow: (id: number) => call<{ queued: boolean }>('POST', `/gutnumbers/${id}/poll`),
  numberLog: (id: number, limit = 50) => call<LogRow[]>('GET', `/gutnumbers/${id}/log?limit=${limit}`),
  numberSamples: (id: number, days = 30) => call<{ samples: Array<{ ts: number; value: number; raw: string | null; strategy: string | null }> }>('GET', `/gutnumbers/${id}/samples?raw=1&from=${Math.floor(Date.now() / 1000) - days * 86400}`),
  deleteSample: (id: number, ts: number) => call<unknown>('DELETE', `/gutnumbers/${id}/samples/${ts}`),
  numberPage: (id: number) => call<{ html: string; fetched_at: string }>('GET', `/gutnumbers/${id}/page`),
  repairTest: (id: number, b: unknown) => call<PreviewResult>('POST', `/gutnumbers/${id}/repair-test`, b),
  preview: (b: unknown) => call<PreviewResult>('POST', '/preview', b),
  helpers: () => call<HelperInfo[]>('GET', '/helpers'),
  testHelper: (name: string, params: Record<string, unknown>) => call<HelperTest>('POST', `/helpers/${name}/test`, { params }),
  vizList: () => call<Visualization[]>('GET', '/visualizations'),
  viz: (id: number) => call<Visualization>('GET', `/visualizations/${id}`),
  createViz: (b: { title: string; config: VizConfig; carousel_seconds: number }) => call<Visualization>('POST', '/visualizations', b),
  updateViz: (id: number, b: { title: string; config: VizConfig; carousel_seconds: number }) => call<Visualization>('PUT', `/visualizations/${id}`, b),
  deleteViz: (id: number) => call<{ playlists: number[]; dashboards: number[] }>('DELETE', `/visualizations/${id}`),
  duplicateViz: (id: number) => call<Visualization>('POST', `/visualizations/${id}/duplicate`),
  vizData: (id: number, points?: number) => call<VizData>('GET', `/visualizations/${id}/data${points ? `?points=${points}` : ''}`),
  previewData: (config: VizConfig) => call<VizData>('POST', '/visualizations/preview-data', { config }),
  dashboards: () => call<Dashboard[]>('GET', '/dashboards'),
  dashboard: (id: number) => call<DashboardDetail>('GET', `/dashboards/${id}`),
  createDashboard: (b: { title: string; layout?: DashboardLayout; options?: DashboardOptions }) => call<Dashboard>('POST', '/dashboards', b),
  updateDashboard: (id: number, b: { title: string; layout: DashboardLayout; options: DashboardOptions }) => call<Dashboard>('PUT', `/dashboards/${id}`, b),
  deleteDashboard: (id: number) => call<{ playlists: number[] }>('DELETE', `/dashboards/${id}`),
  reorderDashboards: (ids: number[]) => call<Dashboard[]>('POST', '/dashboards/reorder', { ids }),
  playlists: () => call<Playlist[]>('GET', '/playlists'),
  createPlaylist: (b: { title: string; items: PlaylistItem[] }) => call<Playlist>('POST', '/playlists', b),
  updatePlaylist: (id: number, b: { title: string; items: PlaylistItem[] }) => call<Playlist>('PUT', `/playlists/${id}`, b),
  deletePlaylist: (id: number) => call<{ dashboards: number[] }>('DELETE', `/playlists/${id}`),
  reorderPlaylists: (ids: number[]) => call<Playlist[]>('POST', '/playlists/reorder', { ids }),
  log: (problems = true, limit = 200) => call<LogRow[]>('GET', `/log?${problems ? 'ok=0&' : ''}limit=${limit}`),
  health: () => call<Health>('GET', '/health'),
  settings: () => call<Settings>('GET', '/settings'),
  view: (kind: 'dashboard' | 'playlist' | 'viz', id: number) => call<ViewBundle>('GET', `/view/${kind}/${id}`),
  viewData: (id: number, points?: number) => call<VizData>('GET', `/view/viz/${id}/data${points ? `?points=${points}` : ''}`),
  importDefs: (data: unknown, dry: boolean) => call<{ created: string[]; updated: string[] }>('POST', `/import${dry ? '?dry_run=1' : ''}`, data),
};
