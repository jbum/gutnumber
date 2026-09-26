import { useState } from 'preact/hooks';
import type { Playlist, PlaylistItem } from '@gut/shared';
import { api } from '../api';
import { Modal, toast, toastError, confirmDialog, useAsync } from '../components/ui';
import { ReorderList, MoveButtons } from '../components/Reorder';

export function PlaylistsTab() {
  const list = useAsync(() => api.playlists(), []);
  const viz = useAsync(() => api.vizList(), []);
  const dash = useAsync(() => api.dashboards(), []);
  const [editing, setEditing] = useState<Playlist | 'new' | null>(null);
  const vizTitle = (id: number) => viz.data?.find((v) => v.id === id)?.title ?? `viz ${id}`;
  const dashTitle = (id: number) => dash.data?.find((d) => d.id === id)?.title ?? `dashboard ${id}`;

  const reorder = async (items: Playlist[]) => {
    try {
      await api.reorderPlaylists(items.map((p) => p.id));
      list.reload();
    } catch (e) {
      toastError(e);
    }
  };
  const del = async (p: Playlist) => {
    if (!(await confirmDialog(<>Delete playlist <b>{p.title}</b>? Carousels that play it are removed from dashboards.</>))) return;
    try {
      const r = await api.deletePlaylist(p.id);
      toast(r.dashboards.length ? `Deleted; carousels removed from ${r.dashboards.length} dashboard(s)` : 'Deleted');
      list.reload();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <section>
      <div class="section-head">
        <div>
          <h1>Playlists</h1>
          <p>Visualizations and dashboards shown in turn, full screen or inside a dashboard carousel.</p>
        </div>
        <div class="toolbar"><button class="btn accent" onClick={() => setEditing('new')}>＋ New playlist</button></div>
      </div>
      {list.data && !list.data.length ? (
        <div class="empty"><h2>No playlists yet</h2><p>A playlist cycles through visualizations and dashboards.</p><button class="btn accent" onClick={() => setEditing('new')}>＋ New playlist</button></div>
      ) : (
        <ReorderList
          items={list.data ?? []}
          keyOf={(p) => p.id}
          onReorder={reorder}
          render={(p, i, move) => (
            <>
              <span class="handle" title="Drag to reorder">⠿</span>
              <div>
                <h3>{p.title}</h3>
                <div class="muted" style="font-size:13px">
                  {p.items.length ? p.items.map((it) => (it.kind === 'viz' ? vizTitle(it.viz_id) : `▦ ${dashTitle(it.dashboard_id)}`)).join(' → ') : 'empty'}
                </div>
              </div>
              <div class="toolbar">
                <MoveButtons move={move} i={i} n={list.data!.length} />
                <a class="btn small ghost" href={`/view/playlist/${p.id}`} target="_blank">Play ↗</a>
                <button class="btn small ghost danger" onClick={() => del(p)}>Delete</button>
                <button class="btn small" onClick={() => setEditing(p)}>Edit</button>
              </div>
            </>
          )}
        />
      )}
      {editing && <PlaylistEditor pl={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), list.reload())} />}
    </section>
  );
}

function PlaylistEditor({ pl, onClose, onSaved }: { pl: Playlist | null; onClose: () => void; onSaved: () => void }) {
  const viz = useAsync(() => api.vizList(), []);
  const dash = useAsync(() => api.dashboards(), []);
  const [title, setTitle] = useState(pl?.title ?? '');
  const [items, setItems] = useState<Array<PlaylistItem & { k: number }>>((pl?.items ?? []).map((it, k) => ({ ...it, k })));
  const [busy, setBusy] = useState(false);
  const nextK = () => Math.max(0, ...items.map((i) => i.k)) + 1;
  const name = (it: PlaylistItem) => (it.kind === 'viz' ? viz.data?.find((v) => v.id === it.viz_id)?.title : dash.data?.find((d) => d.id === it.dashboard_id)?.title) ?? '…';
  const defaultSeconds = (it: PlaylistItem) => (it.kind === 'viz' ? viz.data?.find((v) => v.id === it.viz_id)?.carousel_seconds ?? 20 : 30);

  const add = (value: string) => {
    const [kind, id] = value.split(':');
    if (!id) return;
    setItems((xs) => [...xs, kind === 'v' ? { kind: 'viz', viz_id: Number(id), k: nextK() } : { kind: 'dashboard', dashboard_id: Number(id), seconds: 30, k: nextK() }]);
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = { title: title || 'Untitled playlist', items: items.map(({ k: _k, ...it }) => it as PlaylistItem) };
      if (pl) await api.updatePlaylist(pl.id, body);
      else await api.createPlaylist(body);
      toast('Saved');
      onSaved();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={pl ? <>Edit <em>{pl.title}</em></> : 'New playlist'} onClose={onClose} footer={<div class="right"><button class="btn" onClick={onClose}>Cancel</button><button class="btn primary" onClick={save} disabled={busy}>Save</button></div>}>
      <label class="lbl">Title</label>
      <input class="field" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
      <label class="lbl">Items, in order</label>
      <ReorderList
        items={items}
        keyOf={(i) => i.k}
        onReorder={setItems}
        render={(it, i, move) => (
          <>
            <span class="handle">⠿</span>
            <div><span class="kind">{it.kind === 'viz' ? 'visualization' : 'dashboard'}</span><div>{name(it)}</div></div>
            <div class="toolbar">
              <input class="field" type="number" min="3" max="3600" style="width:84px" aria-label="Seconds" value={it.seconds ?? ''} placeholder={String(defaultSeconds(it))} onInput={(e) => { const v = (e.target as HTMLInputElement).value; setItems((xs) => xs.map((x) => (x.k === it.k ? ({ ...x, seconds: v ? Number(v) : undefined } as typeof x) : x))); }} />
              <span class="muted" style="font-size:12px">s</span>
              <MoveButtons move={move} i={i} n={items.length} />
              <button class="icon-btn" aria-label="Remove" onClick={() => setItems((xs) => xs.filter((x) => x.k !== it.k))}>✕</button>
            </div>
          </>
        )}
      />
      <select class="field" style="margin-top:10px" value="" onChange={(e) => (add((e.target as HTMLSelectElement).value), ((e.target as HTMLSelectElement).value = ''))} aria-label="Add item">
        <option value="">＋ Add…</option>
        <optgroup label="Visualizations">{viz.data?.map((v) => <option value={`v:${v.id}`}>{v.title}</option>)}</optgroup>
        <optgroup label="Dashboards">{dash.data?.map((d) => <option value={`d:${d.id}`}>{d.title}</option>)}</optgroup>
      </select>
      <p class="hint">A dashboard inside a playlist plays its own carousels. Saving is refused if it would make a loop.</p>
    </Modal>
  );
}
