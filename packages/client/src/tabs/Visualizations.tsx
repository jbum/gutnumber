import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { VizConfigSchema, type VizConfig, type Visualization, type VizSeries, type VizAnnotation, type Transform, type VizData } from '@gut/shared';
import { api, type GutnumberRow } from '../api';
import { Modal, toast, toastError, confirmDialog, useAsync } from '../components/ui';
import { VizChart } from '../charts/Chart';

const TYPES: Array<[VizConfig['type'], string]> = [['line', 'Line'], ['area', 'Area'], ['bar', 'Bar histogram'], ['step', 'Step'], ['stat', 'Big number']];
const RANGES: Array<[string, string]> = [['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['1y', '1 year'], ['all', 'All time']];

export const emptyConfig = (): VizConfig => VizConfigSchema.parse({});

function MiniViz({ v }: { v: Visualization }) {
  const d = useAsync(() => api.vizData(v.id, 150), [v.id, v.updated_at]);
  return <div class="chart-box"><VizChart config={v.config} data={d.data} compact /></div>;
}

export function VisualizationsTab() {
  const list = useAsync(() => api.vizList(), []);
  const [editing, setEditing] = useState<Visualization | 'new' | null>(null);
  const del = async (v: Visualization) => {
    if (!(await confirmDialog(<>Delete <b>{v.title}</b>? It is also removed from playlists and dashboards.</>))) return;
    try {
      const r = await api.deleteViz(v.id);
      toast(r.playlists.length + r.dashboards.length ? `Deleted; removed from ${r.playlists.length} playlist(s) and ${r.dashboards.length} dashboard(s)` : 'Deleted');
      list.reload();
    } catch (e) {
      toastError(e);
    }
  };
  const dup = async (v: Visualization) => {
    await api.duplicateViz(v.id).catch(toastError);
    list.reload();
  };
  return (
    <section>
      <div class="section-head">
        <div>
          <h1>Visualizations</h1>
          <p>Charts of one or more numbers. Put them on dashboards or in playlists.</p>
        </div>
        <div class="toolbar"><button class="btn accent" onClick={() => setEditing('new')}>＋ New visualization</button></div>
      </div>
      {list.data && !list.data.length ? (
        <div class="empty"><h2>No visualizations yet</h2><p>Pick some numbers, a range and a chart style.</p><button class="btn accent" onClick={() => setEditing('new')}>＋ New visualization</button></div>
      ) : (
        <div class="cards">
          {list.data?.map((v, i) => (
            <div class="card" key={v.id} style={{ animationDelay: `${i * 30}ms` }}>
              <div><h3>{v.title}</h3><div class="meta">{v.config.type} · {'preset' in v.config.range ? v.config.range.preset : 'custom'} · {v.config.series.length} series · {v.carousel_seconds}s</div></div>
              <MiniViz v={v} />
              <div class="foot">
                <a class="btn small ghost" href={`/view/viz/${v.id}`} target="_blank">View ↗</a>
                <button class="btn small ghost" onClick={() => dup(v)}>Duplicate</button>
                <button class="btn small ghost danger" onClick={() => del(v)}>Delete</button>
                <button class="btn small" onClick={() => setEditing(v)}>Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <VizEditor viz={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), list.reload())} />}
    </section>
  );
}

function transformKey(t: Transform) {
  return t.kind === 'bucket' ? `bucket:${t.unit}:${t.agg}` : t.kind === 'running_avg' ? `running_avg:${t.window}` : t.kind;
}
function parseTransform(k: string): Transform {
  const [kind, a, b] = k.split(':');
  if (kind === 'bucket') return { kind: 'bucket', unit: a as 'day', agg: b as 'avg' };
  if (kind === 'running_avg') return { kind: 'running_avg', window: Number(a) || 7 };
  return { kind: kind as 'raw' | 'delta' };
}
const TRANSFORMS: Array<[string, string]> = [
  ['raw', 'Raw values'],
  ['delta', 'Change between samples'],
  ['running_avg:7', 'Running average (7)'],
  ['running_avg:24', 'Running average (24)'],
  ['bucket:day:last', 'Daily (last value)'],
  ['bucket:day:avg', 'Daily average'],
  ['bucket:day:max', 'Daily max'],
  ['bucket:day:sum', 'Daily sum'],
  ['bucket:hour:avg', 'Hourly average'],
  ['bucket:week:last', 'Weekly (last value)'],
];

/** Today as YYYY-MM-DD in local time. */
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function VizEditor({ viz, onClose, onSaved }: { viz: Visualization | null; onClose: () => void; onSaved: (v: Visualization) => void }) {
  const numbers = useAsync(() => api.numbers(), []);
  const playlists = useAsync(() => api.playlists(), []);
  const [title, setTitle] = useState(viz?.title ?? '');
  const [config, setConfig] = useState<VizConfig>(viz ? VizConfigSchema.parse(structuredClone(viz.config)) : emptyConfig()); // parse fills fields added since it was saved
  const [seconds, setSeconds] = useState(viz?.carousel_seconds ?? 20);
  const [addTo, setAddTo] = useState('');
  const [data, setData] = useState<VizData | null>(null);
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map((numbers.data ?? []).map((g) => [g.id, g])), [numbers.data]);

  const first = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => api.previewData(config).then(setData, () => setData(null)), first.current ? 0 : 250);
    first.current = false;
    return () => clearTimeout(t);
  }, [config]);

  const setOpt = (k: keyof VizConfig['options'], v: unknown) => setConfig((c) => ({ ...c, options: { ...c.options, [k]: v } }));
  const setSeries = (i: number, s: Partial<VizSeries>) => setConfig((c) => ({ ...c, series: c.series.map((x, j) => (j === i ? { ...x, ...s } : x)) }));
  const setNote = (i: number, a: Partial<VizAnnotation>) => setConfig((c) => ({ ...c, annotations: c.annotations.map((x, j) => (j === i ? { ...x, ...a } : x)) }));
  const addSeries = (g: GutnumberRow) => {
    setConfig((c) => ({ ...c, series: [...c.series, { gutnumber_id: g.id, transform: { kind: 'raw' }, invert: g.unit === '#' || undefined }] }));
    if (!title) setTitle(g.label);
  };

  const save = async () => {
    if (config.annotations.some((a) => !a.label.trim() || !a.at)) return toast('Each annotation needs a date and a label');
    setBusy(true);
    try {
      const body = { title: title || 'Untitled', config, carousel_seconds: seconds };
      const v = viz ? await api.updateViz(viz.id, body) : await api.createViz(body);
      if (addTo) {
        const p = playlists.data!.find((x) => x.id === Number(addTo))!;
        await api.updatePlaylist(p.id, { title: p.title, items: [...p.items, { kind: 'viz', viz_id: v.id }] });
        toast(`Saved and added to “${p.title}”`);
      } else toast('Saved');
      onSaved(v);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const unused = (numbers.data ?? []).filter((g) => !config.series.some((s) => s.gutnumber_id === g.id));
  return (
    <Modal wide title={viz ? <>Edit <em>{viz.title}</em></> : 'New visualization'} onClose={onClose} footer={<div class="right"><button class="btn" onClick={onClose}>Cancel</button><button class="btn primary" onClick={save} disabled={busy || !config.series.length}>Save</button></div>}>
      <div class="viz-editor">
        <div>
          <label class="lbl">Title</label><input class="field" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
          <div class="row2">
            <div><label class="lbl">Style</label><select class="field" value={config.type} onChange={(e) => setConfig((c) => ({ ...c, type: (e.target as HTMLSelectElement).value as VizConfig['type'] }))}>{TYPES.map(([v, l]) => <option value={v}>{l}</option>)}</select></div>
            <div><label class="lbl">Duration shown</label><select class="field" value={'preset' in config.range ? config.range.preset : '7d'} onChange={(e) => setConfig((c) => ({ ...c, range: { preset: (e.target as HTMLSelectElement).value as '7d' } }))}>{RANGES.map(([v, l]) => <option value={v}>{l}</option>)}</select></div>
          </div>
          <label class="lbl">Numbers</label>
          {config.series.map((s, i) => {
            const g = byId.get(s.gutnumber_id);
            return (
              <div class="series-row" key={i}>
                <input type="color" value={s.color ?? g?.color ?? '#888888'} onInput={(e) => setSeries(i, { color: (e.target as HTMLInputElement).value })} aria-label="Series colour" />
                <input class="field" value={s.label ?? ''} placeholder={g?.label ?? `#${s.gutnumber_id}`} onInput={(e) => setSeries(i, { label: (e.target as HTMLInputElement).value || undefined })} aria-label="Series label" />
                <select class="field" value={transformKey(s.transform)} onChange={(e) => setSeries(i, { transform: parseTransform((e.target as HTMLSelectElement).value) })} aria-label="Transform">{TRANSFORMS.map(([v, l]) => <option value={v}>{l}</option>)}</select>
                <select class="field" value={s.axis ?? 'left'} onChange={(e) => setSeries(i, { axis: (e.target as HTMLSelectElement).value as 'left' })} aria-label="Axis"><option value="left">Left</option><option value="right">Right</option></select>
                <label class="check" style="margin:0" title="Lower is better (sales rank): draw it upward"><input type="checkbox" checked={!!s.invert} onChange={(e) => setSeries(i, { invert: (e.target as HTMLInputElement).checked || undefined })} /> invert</label>
                <button class="icon-btn" aria-label="Remove series" onClick={() => setConfig((c) => ({ ...c, series: c.series.filter((_, j) => j !== i) }))}>✕</button>
              </div>
            );
          })}
          <select class="field" value="" onChange={(e) => { const g = byId.get(Number((e.target as HTMLSelectElement).value)); if (g) addSeries(g); (e.target as HTMLSelectElement).value = ''; }} aria-label="Add a number">
            <option value="">＋ Add a number…</option>
            {unused.map((g) => <option value={g.id}>{g.label}</option>)}
          </select>
          <label class="lbl">Annotations</label>
          {(config.annotations ?? []).map((a, i) => (
            <div class="annotation-row" key={i}>
              <input class="field" type="date" value={a.at.slice(0, 10)} onInput={(e) => setNote(i, { at: (e.target as HTMLInputElement).value })} aria-label="Annotation date" />
              <input class="field" value={a.label} placeholder="What changed" onInput={(e) => setNote(i, { label: (e.target as HTMLInputElement).value })} aria-label="Annotation label" />
              <button class="icon-btn" aria-label="Remove annotation" onClick={() => setConfig((c) => ({ ...c, annotations: c.annotations.filter((_, j) => j !== i) }))}>✕</button>
            </div>
          ))}
          <button class="btn small" onClick={() => setConfig((c) => ({ ...c, annotations: [...(c.annotations ?? []), { at: localDate(), label: '' }] }))}>＋ Add annotation</button>
          <label class="lbl">Options</label>
          <div class="opts">
            <label class="check"><input type="checkbox" checked={config.options.legend} onChange={(e) => setOpt('legend', (e.target as HTMLInputElement).checked)} /> Legend</label>
            <label class="check"><input type="checkbox" checked={config.options.show_latest} onChange={(e) => setOpt('show_latest', (e.target as HTMLInputElement).checked)} /> Show latest value</label>
            <label class="check"><input type="checkbox" checked={config.options.y_from_zero} onChange={(e) => setOpt('y_from_zero', (e.target as HTMLInputElement).checked)} /> Y axis from zero</label>
            <label class="check"><input type="checkbox" checked={config.options.log_scale} onChange={(e) => setOpt('log_scale', (e.target as HTMLInputElement).checked)} /> Log scale</label>
          </div>
          <div class="row2">
            <div><label class="lbl">Seconds in a carousel</label><input class="field" type="number" min="3" max="3600" value={seconds} onInput={(e) => setSeconds(Number((e.target as HTMLInputElement).value))} /></div>
            <div><label class="lbl">Add to playlist</label><select class="field" value={addTo} onChange={(e) => setAddTo((e.target as HTMLSelectElement).value)}><option value="">—</option>{playlists.data?.map((p) => <option value={p.id}>{p.title}</option>)}</select></div>
          </div>
        </div>
        <div class="viz-preview">
          <div class="kind">Live preview</div>
          <h3>{title || 'Untitled'}</h3>
          <div class="stage"><VizChart config={config} data={data} /></div>
        </div>
      </div>
    </Modal>
  );
}
