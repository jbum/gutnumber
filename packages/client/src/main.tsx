import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { api, type Health } from './api';
import { Toasts } from './components/ui';
import { NumbersTab } from './tabs/Numbers';
import { VisualizationsTab } from './tabs/Visualizations';
import { DashboardsTab } from './tabs/Dashboards';
import { PlaylistsTab } from './tabs/Playlists';
import { LogTab } from './tabs/Log';
import { CaptureTab } from './tabs/Capture';
import { CreditsTab } from './tabs/Credits';
import { Viewer } from './view/Viewer';

const TABS = [
  ['numbers', 'Numbers'],
  ['visualizations', 'Visualizations'],
  ['dashboards', 'Dashboards'],
  ['playlists', 'Playlists'],
  ['log', 'Log'],
  ['capture', 'Capture & setup'],
  ['credits', 'Credits'],
] as const;
type Tab = (typeof TABS)[number][0];

function parseHash(): { tab: Tab; id: number | null } {
  const [t, id] = location.hash.replace(/^#/, '').split('/');
  const tab = (TABS.find(([k]) => k === t)?.[0] ?? 'numbers') as Tab;
  return { tab, id: id ? Number(id) : null };
}

function Heartbeat({ h }: { h: Health | null }) {
  if (!h) return <span class="pulse"><i />…</span>;
  const age = h.daemon_heartbeat_age_s;
  const stale = age == null || age > 120;
  return (
    <span class={`pulse ${stale ? 'stale' : ''}`} title={age == null ? 'The daemon has never run' : `Last heartbeat ${age}s ago`}>
      <i />
      {age == null ? 'daemon not running' : stale ? `daemon silent ${Math.round(age / 60)}m` : `daemon live · ${h.numbers} numbers${h.failing ? ` · ${h.failing} failing` : ''}`}
    </span>
  );
}

function App() {
  const [route, setRoute] = useState(parseHash());
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    const load = () => api.health().then(setHealth, () => {});
    load();
    const t = setInterval(load, 20_000);
    return () => (window.removeEventListener('hashchange', on), clearInterval(t));
  }, []);
  const navigate = (hash: string) => history.replaceState(null, '', `#${hash}`);
  const today = new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return (
    <div class="shell">
      <header class="masthead">
        <div class="brand">Gut<em>number</em></div>
        <div class="dateline">{today}</div>
        <Heartbeat h={health} />
      </header>
      <nav class="tabs" aria-label="Sections">
        {TABS.map(([k, label]) => (
          <a href={`#${k}`} aria-current={route.tab === k ? 'page' : undefined}>
            {label}
            {k === 'numbers' && health ? <span class="count">{health.numbers}</span> : null}
          </a>
        ))}
      </nav>
      <main>
        {route.tab === 'numbers' && <NumbersTab openId={route.id} onNavigate={navigate} />}
        {route.tab === 'visualizations' && <VisualizationsTab />}
        {route.tab === 'dashboards' && <DashboardsTab />}
        {route.tab === 'playlists' && <PlaylistsTab />}
        {route.tab === 'log' && <LogTab />}
        {route.tab === 'capture' && <CaptureTab />}
        {route.tab === 'credits' && <CreditsTab />}
      </main>
      <Toasts />
    </div>
  );
}

const m = /^\/view\/(dashboard|playlist|viz)\/(\d+)/.exec(location.pathname);
const root = document.getElementById('app')!;
if (m) render(<Viewer kind={m[1] as 'dashboard'} id={Number(m[2])} />, root);
else render(<App />, root);
