import { useEffect, useRef, useState } from 'preact/hooks';
import { render } from 'preact';
import { GridStack } from 'gridstack';
import 'gridstack/dist/gridstack.min.css';
import type { Dashboard, DashboardItem, DashboardOptions, Visualization } from '@gut/shared';
import { api } from '../api';
import { Modal, toast, toastError, confirmDialog, useAsync } from '../components/ui';
import { ReorderList, MoveButtons } from '../components/Reorder';
import { VizChart } from '../charts/Chart';
import { ClockWidget, TextWidget, ImageWidget } from '../components/Widgets';

export function DashboardsTab() {
  const list = useAsync(() => api.dashboards(), []);
  const [editing, setEditing] = useState<Dashboard | 'new' | null>(null);
  const reorder = async (items: Dashboard[]) => {
    try {
      await api.reorderDashboards(items.map((d) => d.id));
      list.reload();
    } catch (e) {
      toastError(e);
    }
  };
  const del = async (d: Dashboard) => {
    if (!(await confirmDialog(<>Delete dashboard <b>{d.title}</b>? It is also removed from playlists.</>))) return;
    try {
      const r = await api.deleteDashboard(d.id);
      toast(r.playlists.length ? `Deleted; removed from ${r.playlists.length} playlist(s)` : 'Deleted');
      list.reload();
    } catch (e) {
      toastError(e);
    }
  };
  const [toPlaylist, setToPlaylist] = useState<Dashboard | null>(null);
  const saveToPlaylist = (d: Dashboard) => setToPlaylist(d);
  return (
    <section>
      <div class="section-head">
        <div>
          <h1>Dashboards</h1>
          <p>Visualizations and carousels arranged on a grid. Each has a kiosk URL for a browser or a Pi.</p>
        </div>
        <div class="toolbar"><button class="btn accent" onClick={() => setEditing('new')}>＋ New dashboard</button></div>
      </div>
      {list.data && !list.data.length ? (
        <div class="empty"><h2>No dashboards yet</h2><p>Lay out visualizations, clocks and carousels on a 12-column grid.</p><button class="btn accent" onClick={() => setEditing('new')}>＋ New dashboard</button></div>
      ) : (
        <ReorderList
          items={list.data ?? []}
          keyOf={(d) => d.id}
          onReorder={reorder}
          render={(d, i, move) => (
            <>
              <span class="handle" title="Drag to reorder">⠿</span>
              <div>
                <h3>{d.title}</h3>
                <div class="muted mono" style="font-size:12px">/view/dashboard/{d.id} · {d.layout.items.length} widgets · {d.options.theme}</div>
              </div>
              <div class="toolbar">
                <MoveButtons move={move} i={i} n={list.data!.length} />
                <a class="btn small ghost" href={`/view/dashboard/${d.id}`} target="_blank">View ↗</a>
                <button class="btn small ghost" onClick={() => saveToPlaylist(d)} title="Add this dashboard to a playlist">＋ Playlist</button>
                <button class="btn small ghost danger" onClick={() => del(d)}>Delete</button>
                <button class="btn small" onClick={() => setEditing(d)}>Edit</button>
              </div>
            </>
          )}
        />
      )}
      {editing && <DashboardEditor dash={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), list.reload())} />}
      {toPlaylist && <AddToPlaylist dash={toPlaylist} onClose={() => setToPlaylist(null)} />}
    </section>
  );
}

function VizPreview({ v }: { v: Visualization }) {
  const d = useAsync(() => api.vizData(v.id, 150), [v.id]);
  return <VizChart config={v.config} data={d.data} compact />;
}

function WidgetBody({ item, viz, playlistTitle }: { item: DashboardItem; viz?: Visualization; playlistTitle?: string }) {
  switch (item.kind) {
    case 'viz':
      return viz ? <VizPreview v={viz} /> : <div class="muted">missing visualization</div>;
    case 'carousel':
      return <div class="carousel-ph"><span class="kind">carousel</span><div>{playlistTitle ?? 'missing playlist'}</div><div class="muted">{item.seconds ? `${item.seconds}s each` : 'item timings'}</div></div>;
    case 'clock':
      return <ClockWidget format={item.format} showDate={item.show_date} />;
    case 'text':
      return <TextWidget markdown={item.markdown} />;
    case 'image':
      return <ImageWidget url={item.url} fit={item.fit} />;
  }
}

const uid = () => Math.random().toString(36).slice(2, 9);

function DashboardEditor({ dash, onClose, onSaved }: { dash: Dashboard | null; onClose: () => void; onSaved: () => void }) {
  const viz = useAsync(() => api.vizList(), []);
  const pls = useAsync(() => api.playlists(), []);
  const [title, setTitle] = useState(dash?.title ?? '');
  const [options, setOptions] = useState<DashboardOptions>(dash?.options ?? { theme: 'light', show_title: true, refresh_seconds: 300 });
  const [items, setItems] = useState<DashboardItem[]>(dash?.layout.items ?? []);
  const [itemEdit, setItemEdit] = useState<DashboardItem | null>(null);
  const [busy, setBusy] = useState(false);
  const gridEl = useRef<HTMLDivElement>(null);
  const grid = useRef<GridStack | null>(null);
  const els = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!gridEl.current) return;
    grid.current = GridStack.init({ column: 12, cellHeight: 56, margin: 5, draggable: { handle: '.widget-head' }, resizable: { handles: 'se, e, s' } }, gridEl.current);
    return () => {
      grid.current?.destroy(false);
      grid.current = null;
    };
  }, []);

  // Keep gridstack widgets in sync with `items` (add new, re-render content, drop removed).
  useEffect(() => {
    const g = grid.current;
    if (!g || !viz.data || !pls.data) return;
    const seen = new Set<string>();
    for (const it of items) {
      seen.add(it.id);
      let el = els.current.get(it.id);
      if (!el) {
        el = g.addWidget({ id: it.id, x: it.x, y: it.y, w: it.w, h: it.h })!;
        els.current.set(it.id, el);
      }
      const content = el.querySelector('.grid-stack-item-content') as HTMLElement;
      const v = it.kind === 'viz' ? viz.data.find((x) => x.id === it.viz_id) : undefined;
      const plTitle = it.kind === 'carousel' ? pls.data.find((p) => p.id === it.playlist_id)?.title : undefined;
      const label = it.kind === 'viz' ? (v?.title ?? 'visualization') : it.kind === 'carousel' ? `Carousel: ${plTitle ?? '?'}` : it.kind;
      render(
        <>
          <div class="widget-head"><b>{label}</b><span>{it.kind !== 'viz' && <button class="icon-btn" aria-label="Widget settings" onClick={() => setItemEdit(it)}>⚙</button>}<button class="icon-btn" aria-label="Remove widget" onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}>✕</button></span></div>
          <div class="widget-body"><WidgetBody item={it} viz={v} playlistTitle={plTitle} /></div>
        </>,
        content,
      );
    }
    for (const [id, el] of els.current) {
      if (!seen.has(id)) {
        render(null, el.querySelector('.grid-stack-item-content') as HTMLElement);
        g.removeWidget(el);
        els.current.delete(id);
      }
    }
  }, [items, viz.data, pls.data]);

  const positions = (): DashboardItem[] => {
    const saved = (grid.current?.save(false) ?? []) as Array<{ id?: string; x?: number; y?: number; w?: number; h?: number }>;
    const pos = new Map(saved.map((s) => [String(s.id), s]));
    return items.map((it) => {
      const p = pos.get(it.id);
      return p ? { ...it, x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? it.w, h: p.h ?? it.h } : it;
    });
  };
  const add = (value: string) => {
    const [kind, id] = value.split(':');
    const cur = positions();
    const y = cur.reduce((m, i) => Math.max(m, i.y + i.h), 0);
    const base = { id: uid(), x: 0, y, w: 6, h: 5 };
    const it: DashboardItem | null =
      kind === 'v' ? { ...base, kind: 'viz', viz_id: Number(id) } :
      kind === 'p' ? { ...base, kind: 'carousel', playlist_id: Number(id) } :
      kind === 'clock' ? { ...base, w: 4, h: 3, kind: 'clock', format: '12h', show_date: true } :
      kind === 'text' ? { ...base, w: 4, h: 3, kind: 'text', markdown: '# Heading\n\nSome **notes**.' } :
      kind === 'image' ? { ...base, w: 4, h: 4, kind: 'image', url: 'https://', fit: 'contain' } : null;
    if (!it) return;
    setItems([...cur, it]);
    if (it.kind === 'text' || it.kind === 'image') setItemEdit(it);
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = { title: title || 'Untitled dashboard', layout: { v: 1 as const, columns: 12 as const, items: positions() }, options };
      if (dash) await api.updateDashboard(dash.id, body);
      else await api.createDashboard(body);
      toast('Saved');
      onSaved();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal wide title={dash ? <>Edit <em>{dash.title}</em></> : 'New dashboard'} onClose={onClose} footer={<>{dash && <a class="btn ghost" href={`/view/dashboard/${dash.id}`} target="_blank">Open viewer ↗</a>}<div class="right"><button class="btn" onClick={onClose}>Cancel</button><button class="btn primary" onClick={save} disabled={busy}>Save</button></div></>}>
      <div class="row3">
        <div><label class="lbl">Title</label><input class="field" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></div>
        <div><label class="lbl">Theme</label><select class="field" value={options.theme} onChange={(e) => setOptions((o) => ({ ...o, theme: (e.target as HTMLSelectElement).value as 'light' }))}><option value="light">Paper (light)</option><option value="dark">Ink (dark)</option><option value="eink">eInk (black &amp; white)</option></select></div>
        <div><label class="lbl">Refresh data every</label><select class="field" value={options.refresh_seconds} onChange={(e) => setOptions((o) => ({ ...o, refresh_seconds: Number((e.target as HTMLSelectElement).value) }))}>{[60, 300, 900, 3600].map((s) => <option value={s}>{s < 3600 ? `${s / 60} min` : '1 hour'}</option>)}</select></div>
      </div>
      <div class="toolbar" style="margin:12px 0 10px">
        <label class="check" style="margin:0"><input type="checkbox" checked={options.show_title} onChange={(e) => setOptions((o) => ({ ...o, show_title: (e.target as HTMLInputElement).checked }))} /> Show title bar</label>
        <select class="field" style="width:auto;margin-left:auto" value="" onChange={(e) => (add((e.target as HTMLSelectElement).value), ((e.target as HTMLSelectElement).value = ''))} aria-label="Add widget">
          <option value="">＋ Add widget…</option>
          <optgroup label="Visualizations">{viz.data?.map((v) => <option value={`v:${v.id}`}>{v.title}</option>)}</optgroup>
          <optgroup label="Carousel playing a playlist">{pls.data?.map((p) => <option value={`p:${p.id}`}>{p.title}</option>)}</optgroup>
          <optgroup label="Other"><option value="clock">Clock</option><option value="text">Text</option><option value="image">Image</option></optgroup>
        </select>
      </div>
      <div class="grid-editor"><div class="grid-stack" ref={gridEl} /></div>
      <p class="hint">Drag widgets by their title bar; resize from the edges. A carousel shows its playlist's items in turn.</p>
      {itemEdit && <ItemSettings item={itemEdit} onClose={() => setItemEdit(null)} onSave={(n) => (setItems(positions().map((x) => (x.id === n.id ? n : x))), setItemEdit(null))} />}
    </Modal>
  );
}

function ItemSettings({ item, onClose, onSave }: { item: DashboardItem; onClose: () => void; onSave: (i: DashboardItem) => void }) {
  const [it, setIt] = useState<DashboardItem>(item);
  const set = (k: string, v: unknown) => setIt((x) => ({ ...x, [k]: v }) as DashboardItem);
  return (
    <Modal title="Widget settings" onClose={onClose} footer={<div class="right"><button class="btn" onClick={onClose}>Cancel</button><button class="btn primary" onClick={() => onSave(it)}>Apply</button></div>}>
      {it.kind === 'text' && (<><label class="lbl">Markdown</label><textarea class="field" style="min-height:180px" value={it.markdown} onInput={(e) => set('markdown', (e.target as HTMLTextAreaElement).value)} /><div class="hint"># headings, **bold**, *italic*, `code`, [links](https://…), - lists</div></>)}
      {it.kind === 'image' && (<><label class="lbl">Image URL</label><input class="field" value={it.url} onInput={(e) => set('url', (e.target as HTMLInputElement).value)} /><label class="lbl">Fit</label><select class="field" value={it.fit} onChange={(e) => set('fit', (e.target as HTMLSelectElement).value)}><option value="contain">Contain</option><option value="cover">Cover</option></select></>)}
      {it.kind === 'clock' && (<><label class="lbl">Format</label><select class="field" value={it.format} onChange={(e) => set('format', (e.target as HTMLSelectElement).value)}><option value="12h">12-hour</option><option value="24h">24-hour</option></select><label class="check"><input type="checkbox" checked={it.show_date} onChange={(e) => set('show_date', (e.target as HTMLInputElement).checked)} /> Show date</label></>)}
      {it.kind === 'carousel' && (<><label class="lbl">Seconds per item (blank uses each item's own timing)</label><input class="field" type="number" min="3" value={it.seconds ?? ''} onInput={(e) => set('seconds', (e.target as HTMLInputElement).value ? Number((e.target as HTMLInputElement).value) : undefined)} /></>)}
    </Modal>
  );
}

function AddToPlaylist({ dash, onClose }: { dash: Dashboard; onClose: () => void }) {
  const pls = useAsync(() => api.playlists(), []);
  const [pick, setPick] = useState('');
  const [seconds, setSeconds] = useState(30);
  const add = async () => {
    const p = pls.data?.find((x) => x.id === Number(pick));
    if (!p) return;
    try {
      await api.updatePlaylist(p.id, { title: p.title, items: [...p.items, { kind: 'dashboard', dashboard_id: dash.id, seconds }] });
      toast(`Added “${dash.title}” to “${p.title}”`);
      onClose();
    } catch (e) {
      toastError(e); // a loop is refused with its path
    }
  };
  return (
    <Modal title={<>Add <em>{dash.title}</em> to a playlist</>} onClose={onClose} footer={<div class="right"><button class="btn" onClick={onClose}>Cancel</button><button class="btn primary" disabled={!pick} onClick={add}>Add</button></div>}>
      {pls.data && !pls.data.length ? <p class="muted">No playlists yet; create one on the Playlists tab.</p> : (
        <div class="row2">
          <div><label class="lbl">Playlist</label><select class="field" value={pick} onChange={(e) => setPick((e.target as HTMLSelectElement).value)}><option value="">Choose…</option>{pls.data?.map((p) => <option value={p.id}>{p.title}</option>)}</select></div>
          <div><label class="lbl">Seconds on screen</label><input class="field" type="number" min="3" value={seconds} onInput={(e) => setSeconds(Number((e.target as HTMLInputElement).value))} /></div>
        </div>
      )}
    </Modal>
  );
}
