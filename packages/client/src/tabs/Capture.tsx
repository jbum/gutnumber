import { useState } from 'preact/hooks';
import { api } from '../api';
import { toast, toastError, useAsync } from '../components/ui';

export function CaptureTab() {
  const settings = useAsync(() => api.settings(), []);
  const [importReport, setImportReport] = useState<string | null>(null);
  const origin = location.origin;
  const bookmarklet = `javascript:(()=>{const s=document.createElement('script');s.src='${origin}/bookmarklet/picker.js?'+Date.now();document.body.appendChild(s)})()`;
  const onImport = async (file: File | undefined, dry: boolean) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const r = await api.importDefs(data, dry);
      setImportReport(`${dry ? 'Dry run: would create' : 'Created'} ${r.created.length}, ${dry ? 'update' : 'updated'} ${r.updated.length}.\n${[...r.created.map((x) => '+ ' + x), ...r.updated.map((x) => '~ ' + x)].join('\n')}`);
      if (!dry) toast('Imported');
    } catch (e) {
      toastError(e);
    }
  };
  const s = settings.data;
  return (
    <section>
      <div class="section-head">
        <div>
          <h1>Capture &amp; setup</h1>
          <p>Two ways to point at a number on a web page, plus backup of your definitions.</p>
        </div>
      </div>
      <div class="cards">
        <div class="card">
          <span class="kind">recommended</span>
          <h3>Chrome extension</h3>
          <ol style="margin:0;padding-left:20px;line-height:1.7">
            <li>Build it: <code class="mono">npm run build</code> (output in <code class="mono">dist/extension</code>).</li>
            <li>Open <code class="mono">chrome://extensions</code>, turn on Developer mode, <b>Load unpacked</b>.</li>
            <li>In its options: server <code class="mono">{origin}</code> and this site's login.</li>
            <li>On any page: click the icon (Alt+Shift+G), hover a number, click it.</li>
          </ol>
          <p class="muted" style="margin:0">Works on sites with strict security policies (Amazon, YouTube, GitHub).</p>
        </div>
        <div class="card">
          <span class="kind">no install</span>
          <h3>Bookmarklet</h3>
          <p style="margin:0">Drag this to your bookmarks bar:</p>
          <p style="margin:0"><a class="btn accent" href={bookmarklet} onClick={(e) => (e.preventDefault(), toast('Drag it to the bookmarks bar instead of clicking'))}>⊕ Track a number</a></p>
          <p class="muted" style="margin:0">Uses your login to this site. Pages with a strict Content-Security-Policy block it; use the extension there.</p>
        </div>
        <div class="card">
          <span class="kind">server</span>
          <h3>Configuration</h3>
          {s ? (
            <dl class="kv">
              <dt>Time zone</dt><dd>{s.tz}</dd>
              <dt>Daily polls</dt><dd>{s.daily_hour}:00 · weekly on {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.weekly_day]}</dd>
              <dt>Residential proxy</dt><dd class={s.proxy_configured ? 'ok' : 'muted'}>{s.proxy_configured ? 'configured' : 'not set'}</dd>
              <dt>TypeSafe (Jev)</dt><dd class={s.typesafe_configured ? 'ok' : 'muted'}>{s.typesafe_configured ? 'configured' : 'not set'}</dd>
              <dt>YouTube Data API</dt><dd class={s.youtube_api_configured ? 'ok' : 'muted'}>{s.youtube_api_configured ? 'configured' : 'not set (RSS helper still works)'}</dd>
            </dl>
          ) : (
            <p class="muted">Loading…</p>
          )}
        </div>
        <div class="card">
          <span class="kind">backup</span>
          <h3>Export &amp; import</h3>
          <p style="margin:0">Definitions only: numbers, visualizations, dashboards, playlists. No samples.</p>
          <div class="toolbar">
            <a class="btn" href="/api/v1/export" download>Download export</a>
            <label class="btn">Import (dry run)<input type="file" accept="application/json" hidden onChange={(e) => onImport((e.target as HTMLInputElement).files?.[0], true)} /></label>
            <label class="btn">Import<input type="file" accept="application/json" hidden onChange={(e) => onImport((e.target as HTMLInputElement).files?.[0], false)} /></label>
          </div>
          {importReport && <pre class="code">{importReport}</pre>}
        </div>
      </div>
    </section>
  );
}
