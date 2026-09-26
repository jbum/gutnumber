import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Dashboard, DashboardItem, Playlist, PlaylistItem, Visualization, VizData } from '@gut/shared';
import { api, type ViewBundle } from '../api';
import { VizChart } from '../charts/Chart';
import { ClockWidget, TextWidget, ImageWidget } from '../components/Widgets';

type Theme = 'light' | 'dark' | 'eink';
const MAX_DEPTH = 1; // carousels nested deeper than this are frozen on their first item (ARCHITECTURE §10)

function VizView({ viz, refresh, theme, showTitle = true }: { viz: Visualization; refresh: number; theme: Theme; showTitle?: boolean }) {
  const [data, setData] = useState<VizData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.viewData(viz.id).then((d) => alive && setData(d), () => {});
    load();
    const t = setInterval(load, refresh * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [viz.id, refresh]);
  return (
    <div class="v-viz">
      {showTitle && <div class="v-title">{viz.title}{viz.config.options.subtitle && <span class="muted"> · {viz.config.options.subtitle}</span>}</div>}
      <div class="v-chart"><VizChart config={viz.config} data={data} theme={theme} /></div>
    </div>
  );
}

function itemSeconds(it: PlaylistItem, b: ViewBundle, override?: number) {
  if (override) return override;
  if (it.seconds) return it.seconds;
  return it.kind === 'viz' ? (b.visualizations[it.viz_id]?.carousel_seconds ?? 20) : 30;
}

function Carousel({ playlist, b, depth, override, refresh, theme, progress }: { playlist: Playlist; b: ViewBundle; depth: number; override?: number; refresh: number; theme: Theme; progress?: boolean }) {
  const items = playlist.items.filter((it) => (it.kind === 'viz' ? b.visualizations[it.viz_id] : b.dashboards[it.dashboard_id]));
  const [i, setI] = useState(0);
  const frozen = depth > MAX_DEPTH;
  const cur = items[i % Math.max(1, items.length)];
  useEffect(() => {
    if (frozen || items.length < 2 || !cur) return;
    const t = setTimeout(() => setI((x) => (x + 1) % items.length), itemSeconds(cur, b, override) * 1000);
    return () => clearTimeout(t);
  }, [i, items.length, frozen]);
  if (!cur) return <div class="v-empty muted">Playlist “{playlist.title}” is empty</div>;
  const secs = itemSeconds(cur, b, override);
  return (
    <div class="v-carousel" key={`${i}`}>
      <div class="v-slide">
        {cur.kind === 'viz' ? <VizView viz={b.visualizations[cur.viz_id]} refresh={refresh} theme={theme} /> : <DashboardView dash={b.dashboards[cur.dashboard_id]} b={b} depth={depth + 1} theme={theme} embedded />}
      </div>
      {progress && items.length > 1 && !frozen && <div class="v-progress" style={{ animationDuration: `${secs}s` }} />}
      {items.length > 1 && <div class="v-dots">{items.map((_, j) => <i class={j === i % items.length ? 'on' : ''} />)}</div>}
    </div>
  );
}

function Widget({ it, b, depth, refresh, theme }: { it: DashboardItem; b: ViewBundle; depth: number; refresh: number; theme: Theme }) {
  switch (it.kind) {
    case 'viz':
      return b.visualizations[it.viz_id] ? <VizView viz={b.visualizations[it.viz_id]} refresh={refresh} theme={theme} /> : null;
    case 'carousel':
      return b.playlists[it.playlist_id] ? <Carousel playlist={b.playlists[it.playlist_id]} b={b} depth={depth + 1} override={it.seconds} refresh={refresh} theme={theme} /> : null;
    case 'clock':
      return <ClockWidget format={it.format} showDate={it.show_date} />;
    case 'text':
      return <TextWidget markdown={it.markdown} />;
    case 'image':
      return <ImageWidget url={it.url} fit={it.fit} />;
  }
}

function DashboardView({ dash, b, depth, theme, embedded }: { dash: Dashboard; b: ViewBundle; depth: number; theme: Theme; embedded?: boolean }) {
  const rows = Math.max(1, ...dash.layout.items.map((i) => i.y + i.h));
  const refresh = dash.options.refresh_seconds ?? 300;
  return (
    <div class={`v-dash ${embedded ? 'embedded' : ''}`}>
      {dash.options.show_title && <header class="v-head"><h1>{dash.title}</h1>{!embedded && <Clockline />}</header>}
      <div class="v-grid" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {dash.layout.items.map((it) => (
          <div class={`v-cell k-${it.kind}`} key={it.id} style={{ gridColumn: `${it.x + 1} / span ${it.w}`, gridRow: `${it.y + 1} / span ${it.h}` }}>
            <Widget it={it} b={b} depth={depth} refresh={refresh} theme={theme} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Clockline() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return <span class="mono muted" style="font-size:12px">{now.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>;
}

export function Viewer({ kind, id }: { kind: 'dashboard' | 'playlist' | 'viz'; id: number }) {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [b, setB] = useState<ViewBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.view(kind, id).then((x) => (setB(x), setErr(null)), (e) => setErr(e.message));
    load();
    const t = setInterval(load, 10 * 60_000); // pick up edits without a reload
    return () => clearInterval(t);
  }, [kind, id]);

  const theme: Theme = (params.get('theme') as Theme) || (kind === 'dashboard' && b?.dashboards[id]?.options.theme) || 'light';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.classList.add('viewer');
    const w = params.get('w'), h = params.get('h');
    if (w && h) Object.assign(document.body.style, { width: `${w}px`, height: `${h}px`, overflow: 'hidden' });
  }, [theme]);

  if (err) return <div class="v-empty"><p class="err">{err}</p></div>;
  if (!b) return <div class="v-empty muted">Loading…</div>;
  document.title = kind === 'dashboard' ? b.dashboards[id]?.title : kind === 'playlist' ? b.playlists[id]?.title : b.visualizations[id]?.title;
  if (kind === 'dashboard' && b.dashboards[id]) return <DashboardView dash={b.dashboards[id]} b={b} depth={0} theme={theme} />;
  if (kind === 'playlist' && b.playlists[id]) return <div class="v-full"><Carousel playlist={b.playlists[id]} b={b} depth={0} refresh={300} theme={theme} progress /></div>;
  if (kind === 'viz' && b.visualizations[id]) return <div class="v-full v-pad"><VizView viz={b.visualizations[id]} refresh={300} theme={theme} /></div>;
  return <div class="v-empty muted">Not found</div>;
}
